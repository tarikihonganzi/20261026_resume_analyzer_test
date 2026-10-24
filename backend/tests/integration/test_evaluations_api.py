"""POST /api/evaluations（SSE）の統合テスト。

通常の応答の内容は、`TestClient`（偽の LLM）で確認する。切断でキャンセルされることは、
実際の HTTP サーバー（uvicorn）に、実際のソケットで接続して確認する。
"""

import asyncio
import json
import socket
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx2
import pytest
import uvicorn
from fastapi.testclient import TestClient

from app.domain.errors import LlmUnavailableError
from app.domain.models import Config
from app.llm.fake_client import FakeClient
from app.llm.openai_client import OpenAIClient
from app.llm.requests import ExtractRequest
from app.llm.schemas import (
    ConditionExtraction,
    EvaluatedPoint,
    ExtractionResult,
    FinalEvaluation,
    Quote,
)
from app.main import create_app
from app.settings import AppSettings
from fixtures import resume_factory as factory
from fixtures.openai_api import api_response

MakeApp = Callable[..., TestClient]


def condition(id: str, kind: str = "boolean", **overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": id,
        "label": f"条件 {id}",
        "kind": kind,
        "required": kind == "boolean",
        "min_value": 3 if kind == "number" else None,
        "unit": "年" if kind == "number" else None,
        "source": "preset",
        "category": None,
    }
    return base | overrides


CONDITIONS = [condition("a"), condition("b", "number"), condition("c"), condition("d", "number")]


def form(conditions: list[dict[str, Any]] | None = None, **extra: str) -> dict[str, str]:
    return {"conditions": json.dumps(CONDITIONS if conditions is None else conditions)} | extra


def always(client: FakeClient) -> Callable[[Config], FakeClient]:
    """どんな設定でも、同じ偽のクライアントを返す。"""
    return lambda _config: client


def parse_sse(body: str) -> list[tuple[str, Any]]:
    events: list[tuple[str, Any]] = []
    for block in body.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        events.append((fields["event"], json.loads(fields["data"])))
    return events


def evaluate_text(client: TestClient, **kwargs: Any) -> list[tuple[str, Any]]:
    response = client.post("/api/evaluations", data=form(text=factory.make_text()), **kwargs)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    return parse_sse(response.text)


# --- 正常系 ---


def test_stream_has_two_stages_and_then_the_result(make_app: MakeApp) -> None:
    events = evaluate_text(make_app())

    assert [name for name, _ in events] == ["stage", "stage", "result"]
    assert events[0][1] == {"stage": "extracting"}
    assert events[1][1] == {"stage": "scoring"}


def test_result_has_everything_the_screen_needs(make_app: MakeApp) -> None:
    result = evaluate_text(make_app())[-1][1]

    assert set(result) == {
        "score",
        "original_score",
        "clipped",
        "match_rate",
        "missing_required",
        "conditions",
        "summary",
        "strengths",
        "weaknesses",
    }
    assert [c["condition"]["id"] for c in result["conditions"]] == ["a", "b", "c", "d"]
    assert {c["status"] for c in result["conditions"]} == {"achieved", "unmet"}
    assert result["match_rate"] == 50
    assert [m["condition_id"] for m in result["missing_required"]] == ["c"]
    first_quote = result["conditions"][0]["quotes"][0]
    assert first_quote["source_name"] == "貼り付けテキスト"
    assert first_quote["verified"] == "match"


def test_uploaded_docx_uses_its_file_name_as_the_source_name(make_app: MakeApp) -> None:
    response = make_app().post(
        "/api/evaluations",
        data=form(),
        files={"file": ("田中_職務経歴書.docx", factory.make_docx())},
    )

    result = parse_sse(response.text)[-1][1]
    assert result["conditions"][0]["quotes"][0]["source_name"] == "田中_職務経歴書.docx"
    assert "田中_職務経歴書.docx" in result["conditions"][0]["reason"]


def test_pdf_quotes_are_not_verified(make_app: MakeApp) -> None:
    response = make_app().post(
        "/api/evaluations", data=form(), files={"file": ("職歴書.pdf", factory.make_pdf_digital())}
    )

    result = parse_sse(response.text)[-1][1]
    quotes = [q for c in result["conditions"] for q in c["quotes"]]
    assert quotes
    assert {q["verified"] for q in quotes} == {"skipped"}


def test_today_comes_from_the_server_clock(make_app: MakeApp) -> None:
    from datetime import date

    fake = FakeClient()
    client = make_app(today=lambda: date(2030, 1, 2), client_factory=always(fake))

    evaluate_text(client)

    assert fake.extract_calls[0].today == date(2030, 1, 2)


# --- ストリームの前の検証（通常の HTTP エラー） ---


@pytest.mark.parametrize(
    ("data", "status", "code"),
    [
        pytest.param({"conditions": "[{"}, 422, "invalid_conditions", id="broken-json"),
        pytest.param({"conditions": '[{"id": "a"}]'}, 422, "invalid_conditions", id="bad-shape"),
        pytest.param({"conditions": "[]"}, 422, "no_conditions", id="no-conditions"),
        pytest.param(
            {"conditions": json.dumps([condition("a"), condition("a")])},
            422,
            "invalid_conditions",
            id="duplicate-ids",
        ),
        pytest.param({}, 422, "invalid_request", id="missing-conditions"),
    ],
)
def test_bad_conditions_are_rejected_before_the_stream(
    make_app: MakeApp, data: dict[str, str], status: int, code: str
) -> None:
    response = make_app().post("/api/evaluations", data=data | {"text": factory.make_text()})

    assert response.status_code == status
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["code"] == code


def test_resume_problems_are_rejected_before_the_stream(make_app: MakeApp) -> None:
    client = make_app()

    unreadable = client.post(
        "/api/evaluations", data=form(), files={"file": ("broken.docx", factory.make_broken_docx())}
    )
    too_short = client.post("/api/evaluations", data=form(text="短い"))
    neither = client.post("/api/evaluations", data=form())

    assert (unreadable.status_code, unreadable.json()["code"]) == (422, "conversion_failed")
    assert (too_short.status_code, too_short.json()["code"]) == (422, "empty_text")
    assert (neither.status_code, neither.json()["code"]) == (422, "invalid_input")


def test_file_over_the_limit_is_413_before_the_stream(make_app: MakeApp) -> None:
    client = make_app()
    client.put("/api/settings", json={"max_file_size_mb": 1})

    response = client.post(
        "/api/evaluations", data=form(), files={"file": ("big.txt", b"a" * (1024 * 1024 + 1))}
    )

    assert response.status_code == 413
    assert "1 MB" in response.json()["message"]


def test_missing_api_key_in_real_mode_is_rejected_before_the_stream(make_app: MakeApp) -> None:
    response = make_app(llm_mode="real").post(
        "/api/evaluations", data=form(text=factory.make_text())
    )

    assert response.status_code == 422
    assert response.json()["code"] == "llm_auth"
    assert "設定ページ" in response.json()["message"]


# --- ストリームの途中のエラー ---


def test_llm_failure_is_an_error_event_in_the_stream(make_app: MakeApp) -> None:
    failing = FakeClient(fail_with=LlmUnavailableError("rate_limit"))
    client = make_app(client_factory=always(failing))

    events = evaluate_text(client)

    assert [name for name, _ in events] == ["stage", "error"]
    assert events[1][1] == {
        "code": "llm_unavailable",
        "message": str(LlmUnavailableError("rate_limit")),
    }


# --- 実際の OpenAIClient（HTTP を差し替え）と、設定の反映 ---


def real_app(make_app: MakeApp, handler: Callable[[httpx2.Request], httpx2.Response]) -> TestClient:
    def factory_(config: Config) -> OpenAIClient:
        return OpenAIClient(
            config,
            http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)),
            max_retries=0,
        )

    return make_app(llm_mode="real", openai_factory=factory_)


def canned_extraction() -> ExtractionResult:
    text = factory.make_text().splitlines()[1]  # 「1級建築施工管理技士（2018年取得）」を含む行
    quote = Quote(source_name="貼り付けテキスト", location=None, text=text)

    def one(condition_id: str, **values: Any) -> ConditionExtraction:
        fields: dict[str, Any] = {"has_skill": None, "years": None, "reason": "r", "quotes": []}
        return ConditionExtraction.model_validate({"condition_id": condition_id} | fields | values)

    return ExtractionResult(
        results=[
            one(
                "a",
                has_skill=True,
                reason=f'"貼り付けテキスト"の位置に「{text}」とあるため。',
                quotes=[quote],
            ),
            one("b", years=1.0),
            one("c", has_skill=False),
            one("d", years=4.0),
        ]
    )


def canned_evaluation(score: int) -> FinalEvaluation:
    point = EvaluatedPoint(text="**良い**", reason="r", quotes=[])
    return FinalEvaluation(score=score, summary=point, strengths=[point], weaknesses=[])


def test_whole_flow_with_the_real_client_over_a_mocked_http(make_app: MakeApp) -> None:
    requests: list[dict[str, Any]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        requests.append(body)
        if body["text"]["format"]["name"] == "ExtractionResult":
            return httpx2.Response(200, json=api_response(canned_extraction().model_dump_json()))
        return httpx2.Response(200, json=api_response(canned_evaluation(100).model_dump_json()))

    client = real_app(make_app, handler)
    client.put("/api/settings", json={"openai_api_key": "sk-test-0123456789abcdef"})

    events = evaluate_text(client)

    assert [name for name, _ in events] == ["stage", "stage", "result"]
    result = events[-1][1]
    assert result["match_rate"] == 50  # a と d が達成
    assert (result["original_score"], result["score"], result["clipped"]) == (100, 70, True)
    assert result["conditions"][0]["quotes"][0]["verified"] == "match"
    assert [r["text"]["format"]["name"] for r in requests] == [
        "ExtractionResult",
        "FinalEvaluation",
    ]
    assert all(r["store"] is False for r in requests)
    # 2 回目（最終評価）には、コードが算出した値が渡る
    header = requests[1]["input"][0]["content"][0]["text"]
    assert "マッチ度合い: 50%" in header
    assert "必須条件の未達: 条件 c（未達）" in header


def test_settings_saved_in_the_page_are_used_by_the_next_evaluation(make_app: MakeApp) -> None:
    seen: list[dict[str, Any]] = []
    urls: list[str] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        urls.append(str(request.url))
        seen.append(json.loads(request.content))
        return httpx2.Response(401, json={"error": {"message": "x"}})

    client = real_app(make_app, handler)
    client.put(
        "/api/settings",
        json={
            "openai_api_key": "sk-test-0123456789abcdef",
            "openai_base_url": "https://llm.example/v1",
            "model": "gpt-first",
        },
    )

    first = evaluate_text(client)
    client.put("/api/settings", json={"model": "gpt-second"})
    second = evaluate_text(client)

    assert [e[0] for e in first] == ["stage", "error"]
    assert first[1][1]["code"] == "llm_auth"
    assert [s["model"] for s in seen] == ["gpt-first", "gpt-second"]
    assert urls == ["https://llm.example/v1/responses"] * 2
    assert second[1][1]["code"] == "llm_auth"


def test_key_never_appears_in_the_stream_or_the_logs(
    make_app: MakeApp, caplog: pytest.LogCaptureFixture
) -> None:
    key = "sk-test-SECRETKEY-0123456789"

    def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(401, json={"error": {"message": f"bad key {key}"}})

    client = real_app(make_app, handler)
    client.put("/api/settings", json={"openai_api_key": key})

    with caplog.at_level("DEBUG"):
        response = client.post("/api/evaluations", data=form(text=factory.make_text()))

    assert key not in response.text
    assert key not in caplog.text


# --- 職歴書が残らない（受け入れ基準 9） ---


def test_nothing_of_the_resume_is_left_on_disk(make_app: MakeApp, tmp_path: Path) -> None:
    client = make_app()
    client.post("/api/evaluations", data=form(), files={"file": ("a.docx", factory.make_docx())})
    client.post("/api/evaluations", data=form(text=factory.make_text()))

    # 設定や条件セットを保存していないので、データのディレクトリ自体が作られない
    assert not (tmp_path / "data").exists()


# --- 切断でキャンセルされる（実際の HTTP サーバー） ---


class TrackingClient(FakeClient):
    """抽出の呼び出しが始まったこと・キャンセルされたこと・閉じられたことを記録する。"""

    def __init__(self) -> None:
        super().__init__()
        self.started = threading.Event()
        self.cancelled = threading.Event()
        self.closed = threading.Event()

    async def extract(self, request: ExtractRequest) -> ExtractionResult:
        self.started.set()
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            self.cancelled.set()
            raise
        raise AssertionError("到達しないはず")

    async def aclose(self) -> None:
        self.closed.set()


@pytest.fixture
def live_server(tmp_path: Path) -> Iterator[tuple[str, TrackingClient]]:
    tracking = TrackingClient()
    app = create_app(
        AppSettings(data_dir=tmp_path / "data", llm_mode="fake"),
        environ={},
        client_factory=lambda _config: tracking,
    )

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="off")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.02)
    assert server.started
    try:
        yield f"http://127.0.0.1:{port}", tracking
    finally:
        server.should_exit = True
        thread.join(timeout=10)


async def test_disconnect_cancels_the_llm_call_and_closes_the_client(
    live_server: tuple[str, TrackingClient],
) -> None:
    base_url, tracking = live_server

    async with (
        httpx2.AsyncClient(base_url=base_url, timeout=10) as http,
        http.stream("POST", "/api/evaluations", data=form(text=factory.make_text())) as response,
    ):
        assert response.status_code == 200
        lines = response.aiter_lines()
        assert "event: stage" in await anext(lines)  # 最初の段階が届いた
        assert await asyncio.to_thread(tracking.started.wait, 5)
        assert not tracking.cancelled.is_set()
        # `async with` を抜けて、接続を切った

    assert await asyncio.to_thread(tracking.cancelled.wait, 5), "切断で LLM 呼び出しが止まらない"
    assert await asyncio.to_thread(tracking.closed.wait, 5), "切断で LLM のクライアントが閉じない"
