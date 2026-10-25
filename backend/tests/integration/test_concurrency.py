"""同時に複数の評価が走るとき。リクエストごとの状態（リクエスト ID・書類・結果）が、
混ざらないことを確かめる。個人利用でも、2 つのタブや、再実行の重なりで、評価は同時に走りうる。
"""

import asyncio
import json
import re
from collections.abc import Iterator
from datetime import date
from pathlib import Path

import httpx2
import pytest

from app.llm.fake_client import FakeClient
from app.logging_setup import log_file_name, shutdown_logging
from app.main import create_app
from app.settings import AppSettings
from fixtures import resume_factory as factory

CONDITIONS = json.dumps(
    [
        {
            "id": f"c{i}",
            "label": f"条件 {i}",
            "kind": "boolean",
            "required": i == 0,
            "min_value": None,
            "unit": None,
            "source": "custom",
            "category": None,
            "description": None,
        }
        for i in range(3)
    ]
)


@pytest.fixture(autouse=True)
def _clean_logging() -> Iterator[None]:  # pyright: ignore[reportUnusedFunction]
    shutdown_logging()
    yield
    shutdown_logging()


def parse_result(body: str) -> dict[str, object]:
    for block in body.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        if fields.get("event") == "result":
            return json.loads(fields["data"])
    raise AssertionError(f"結果がありません: {body[:200]}")


async def test_concurrent_evaluations_do_not_mix_documents_or_request_ids(tmp_path: Path) -> None:
    log_dir = tmp_path / "log"
    settings = AppSettings(data_dir=tmp_path / "data", llm_mode="fake", log_dir=log_dir)
    # 段階ごとに少し待つ（評価が、重なって進むように）
    app = create_app(
        settings, environ={}, client_factory=lambda _config: FakeClient(delay_sec=0.05)
    )
    transport = httpx2.ASGITransport(app=app)

    async def evaluate(client: httpx2.AsyncClient, number: int) -> tuple[int, dict[str, object]]:
        # 応募者ごとに、ファイル名と内容が違う
        text = f"職務経歴書 {number}\n" + factory.make_text()
        response = await client.post(
            "/api/evaluations",
            data={"conditions": CONDITIONS},
            files={"files": (f"応募者{number}.txt", text.encode("utf-8"))},
        )
        assert response.status_code == 200
        return number, parse_result(response.text)

    async with httpx2.AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
        results = await asyncio.gather(*(evaluate(client, n) for n in range(8)))

    for number, result in results:
        text = json.dumps(result, ensure_ascii=False)
        # 自分の応募者の名前だけが、根拠に出る（他の応募者の名前が、混ざらない）
        assert f"応募者{number}.txt" in text
        for other in range(8):
            if other != number:
                assert f"応募者{other}.txt" not in text

    shutdown_logging()
    lines = (log_dir / log_file_name(date.today())).read_text(encoding="utf-8").splitlines()
    by_request: dict[str, list[str]] = {}
    for line in lines:
        matched = re.search(r"\[([0-9a-f]{8})\] (app\.\S+): (.*)", line)
        if matched:
            by_request.setdefault(matched.group(1), []).append(matched.group(3))
    pipelines = [
        messages
        for messages in by_request.values()
        if any("evaluation start" in m for m in messages)
    ]
    # 8 件の評価が、それぞれ別のリクエスト ID で、開始・2 段階・完了・リクエストの記録を、
    # 1 回ずつ持つ
    assert len(pipelines) == 8
    for messages in pipelines:
        assert sum("evaluation start" in m for m in messages) == 1
        assert sum("stage=extracting done" in m for m in messages) == 1
        assert sum("stage=scoring done" in m for m in messages) == 1
        assert sum("evaluation done" in m for m in messages) == 1
        assert sum(m.startswith("request method=POST path=/api/evaluations") for m in messages) == 1


async def test_changing_the_settings_during_an_evaluation_does_not_break_it(
    tmp_path: Path,
) -> None:
    settings = AppSettings(data_dir=tmp_path / "data", llm_mode="fake")
    app = create_app(settings, environ={}, client_factory=lambda _config: FakeClient(delay_sec=0.2))
    transport = httpx2.ASGITransport(app=app)
    headers = {"Host": "127.0.0.1"}

    async with httpx2.AsyncClient(
        transport=transport, base_url="http://127.0.0.1", headers=headers
    ) as client:

        async def evaluate() -> httpx2.Response:
            return await client.post(
                "/api/evaluations",
                data={"conditions": CONDITIONS},
                files={"files": ("a.txt", factory.make_text().encode("utf-8"))},
            )

        async def change_settings() -> list[int]:
            await asyncio.sleep(0.1)
            return [
                (await client.put("/api/settings", json={"model": f"gpt-{i}"})).status_code
                for i in range(5)
            ]

        response, statuses = await asyncio.gather(evaluate(), change_settings())

    assert response.status_code == 200
    assert "event: result" in response.text
    assert statuses == [200] * 5
