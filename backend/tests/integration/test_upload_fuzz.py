"""アップロードのファズ。壊れた・変なファイルを、検証と評価に当てても、サーバーのエラー
（5xx）にならず、決まった形のエラー（413・422）か、成功（200）で、返ることを確かめる。

MarkItDown などの、外部の変換ライブラリは、壊れたファイルで、想定外の例外を出すことがある。
そのとき、利用者には、読み取れない旨が分かるエラーを返し、サーバーは落ちてはいけない。
"""

import json
import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.main import create_app
from app.settings import AppSettings
from fixtures import resume_factory as factory

EXAMPLES = int(os.environ.get("FUZZ_EXAMPLES", "60"))

_data_dir = Path(tempfile.mkdtemp(prefix="app-upload-fuzz-"))
client = TestClient(
    create_app(AppSettings(data_dir=_data_dir, llm_mode="fake"), environ={}),
    base_url="http://127.0.0.1",
    raise_server_exceptions=False,
)

CONDITIONS = json.dumps(
    [
        {
            "id": "a",
            "label": "条件",
            "kind": "boolean",
            "required": True,
            "min_value": None,
            "unit": None,
            "source": "custom",
            "category": None,
            "description": None,
        }
    ]
)
ALLOWED = {200, 413, 422}

extensions = st.sampled_from(
    ["", ".docx", ".xlsx", ".xls", ".pptx", ".pdf", ".txt", ".md", ".csv", ".html", ".zip", ".bin"]
)


def _join(stem: str, extension: str) -> str:
    return f"{stem}{extension}"


names = st.builds(
    _join,
    st.text(
        alphabet=st.characters(blacklist_categories=("Cs",), blacklist_characters="\x00"),
        max_size=40,
    ),
    extensions,
)

# 実在する形式を、壊した・切った・混ぜたもの（ランダムな文字列より、変換器の奥まで届く）
_SEEDS = [
    factory.make_docx(),
    factory.make_xlsx(),
    factory.make_pptx(),
    factory.make_pdf_digital(),
    factory.make_text().encode("utf-8"),
    factory.make_text().encode("utf-16"),
    factory.make_text().encode("shift_jis", errors="ignore"),
]


@st.composite
def contents(draw: st.DrawFn) -> bytes:
    kind = draw(st.sampled_from(["random", "truncated", "flipped", "prefixed", "empty"]))
    if kind == "random":
        return draw(st.binary(max_size=2000))
    if kind == "empty":
        return b""
    seed = draw(st.sampled_from(_SEEDS))
    if kind == "truncated":
        return seed[: draw(st.integers(0, len(seed)))]
    if kind == "prefixed":
        return draw(st.binary(max_size=64)) + seed
    flipped = bytearray(seed)
    for _ in range(draw(st.integers(1, 8))):
        flipped[draw(st.integers(0, len(flipped) - 1))] = draw(st.integers(0, 255))
    return bytes(flipped)


common = settings(
    max_examples=EXAMPLES,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)


@common
@given(name=names, content=contents())
def test_resume_check_never_fails_with_a_server_error(name: str, content: bytes) -> None:
    response = client.post("/api/resumes/check", files={"file": (name, content)})

    assert response.status_code in ALLOWED, (response.status_code, response.text[:200])
    if response.status_code != 200:
        body = response.json()
        assert set(body) >= {"code", "message"}
        assert body["message"]  # 利用者に、理由を伝える


@common
@given(name=names, content=contents())
def test_evaluation_never_fails_with_a_server_error(name: str, content: bytes) -> None:
    response = client.post(
        "/api/evaluations", data={"conditions": CONDITIONS}, files={"files": (name, content)}
    )

    # 成功は、SSE のストリーム（200）。入力の問題は、ストリームの前に、JSON のエラーで返る
    assert response.status_code in ALLOWED, (response.status_code, response.text[:200])
    if response.status_code == 200:
        assert "event: result" in response.text or "event: error" in response.text


@common
@given(
    text=st.text(
        alphabet=st.characters(blacklist_categories=("Cs",), blacklist_characters="\x00"),
        max_size=3000,
    )
)
def test_pasted_text_never_fails_with_a_server_error(text: str) -> None:
    check = client.post("/api/resumes/check", data={"text": text})
    evaluation = client.post("/api/evaluations", data={"conditions": CONDITIONS, "text": text})

    assert check.status_code in ALLOWED
    assert evaluation.status_code in ALLOWED


@common
@given(count=st.integers(min_value=0, max_value=9), with_text=st.booleans())
def test_any_number_of_documents_is_either_accepted_or_rejected_cleanly(
    count: int, with_text: bool
) -> None:
    files = [("files", (f"経歴{i}.txt", factory.make_text().encode())) for i in range(count)]
    data = {"conditions": CONDITIONS}
    if with_text:
        data["text"] = factory.make_text()

    response = client.post("/api/evaluations", data=data, files=files)

    total = count + (1 if with_text else 0)
    assert response.status_code in ALLOWED
    if total == 0:
        assert response.status_code == 422
        assert response.json()["code"] == "invalid_input"
    elif total > 5:
        assert response.status_code == 422
        assert response.json()["code"] == "too_many_resumes"
    else:
        assert response.status_code == 200


def test_the_fuzz_depth_can_be_raised_for_a_deeper_run() -> None:
    # 通常は短く（check を遅くしない）。深く調べるときは、FUZZ_EXAMPLES=2000 のように指定する
    assert EXAMPLES >= 1
    pytest.importorskip("hypothesis")
