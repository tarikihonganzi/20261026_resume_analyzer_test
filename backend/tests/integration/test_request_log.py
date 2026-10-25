"""リクエストのログ（仕様 8.3、13.1 #36）。内容（職歴書・API キー・クエリ）は、ログに出さない。"""

import re
from collections.abc import Iterator
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.logging_setup import log_file_name, shutdown_logging
from app.main import create_app
from app.settings import AppSettings
from fixtures import resume_factory as factory

LINE = re.compile(
    r"request method=(?P<method>\w+) path=(?P<path>\S+) status=(?P<status>\d+) "
    r"duration_ms=(?P<ms>\d+)"
)


@pytest.fixture(autouse=True)
def _clean_logging() -> Iterator[None]:  # pyright: ignore[reportUnusedFunction]
    shutdown_logging()
    yield
    shutdown_logging()


def make_client(tmp_path: Path, **options: object) -> tuple[TestClient, Path]:
    log_dir = tmp_path / "log"
    settings = AppSettings(data_dir=tmp_path / "data", llm_mode="fake", log_dir=log_dir)
    app = create_app(settings, environ={}, **options)  # pyright: ignore[reportArgumentType]
    client = TestClient(app, base_url="http://127.0.0.1", raise_server_exceptions=False)
    return client, log_dir


def log_text(log_dir: Path) -> str:
    shutdown_logging()  # 書き込みを確定して、ファイルを閉じる
    return (log_dir / log_file_name(date.today())).read_text(encoding="utf-8")


def test_each_api_request_is_logged_with_method_path_status_and_duration(tmp_path: Path) -> None:
    client, log_dir = make_client(tmp_path)

    client.get("/api/health")

    [match] = LINE.finditer(log_text(log_dir))
    assert match.group("method") == "GET"
    assert match.group("path") == "/api/health"
    assert match.group("status") == "200"
    assert int(match.group("ms")) >= 0


def test_the_request_id_is_in_the_log_and_the_response_header(tmp_path: Path) -> None:
    client, log_dir = make_client(tmp_path)

    response = client.get("/api/health")

    request_id = response.headers["x-request-id"]
    assert re.fullmatch(r"[0-9a-f]{8}", request_id)
    assert f"[{request_id}]" in log_text(log_dir)


def test_each_request_gets_its_own_id(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    ids = {client.get("/api/health").headers["x-request-id"] for _ in range(5)}

    assert len(ids) == 5


def test_a_request_id_sent_by_the_client_is_not_trusted(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.get("/api/health", headers={"X-Request-ID": "forged\nINJECT"})

    assert response.headers["x-request-id"] != "forged\nINJECT"


def test_the_query_string_is_not_logged(tmp_path: Path) -> None:
    client, log_dir = make_client(tmp_path)

    client.get("/api/health?token=sk-secret-query-0000")

    assert "sk-secret-query" not in log_text(log_dir)


def test_request_bodies_are_not_logged(tmp_path: Path) -> None:
    client, log_dir = make_client(tmp_path)
    resume = factory.make_text()

    client.put("/api/settings", json={"openai_api_key": "sk-secret-body-9999"})
    client.post(
        "/api/evaluations",
        data={"conditions": "[]", "text": resume},
    )
    client.post("/api/resumes/check", data={"text": resume})

    text = log_text(log_dir)
    assert "sk-secret-body" not in text
    for line in resume.splitlines():
        if len(line) >= 8:
            assert line not in text


def test_a_streaming_evaluation_is_logged_once_when_it_ends(tmp_path: Path) -> None:
    client, log_dir = make_client(tmp_path)
    conditions = (
        '[{"id":"a","label":"条件","kind":"boolean","required":true,"min_value":null,'
        '"unit":null,"source":"custom","category":null,"description":null}]'
    )

    response = client.post(
        "/api/evaluations", data={"conditions": conditions, "text": factory.make_text()}
    )

    assert response.status_code == 200
    matches = [m for m in LINE.finditer(log_text(log_dir)) if m.group("path") == "/api/evaluations"]
    assert [(m.group("method"), m.group("status")) for m in matches] == [("POST", "200")]


def test_rejected_requests_are_logged_too(tmp_path: Path) -> None:
    client, log_dir = make_client(tmp_path)

    client.get("/api/health", headers={"Host": "evil.example"})
    client.get("/api/does-not-exist")

    statuses = [(m.group("path"), m.group("status")) for m in LINE.finditer(log_text(log_dir))]
    assert ("/api/health", "400") in statuses
    assert ("/api/does-not-exist", "404") in statuses


def test_an_unexpected_exception_is_logged_as_500_with_the_same_request_id(
    tmp_path: Path,
) -> None:
    log_dir = tmp_path / "log"
    settings = AppSettings(data_dir=tmp_path / "data", llm_mode="fake", log_dir=log_dir)
    app = create_app(settings, environ={})

    def boom() -> None:
        raise RuntimeError("sk-secret-in-exception")

    app.add_api_route("/api/_boom", boom)
    client = TestClient(app, base_url="http://127.0.0.1", raise_server_exceptions=False)

    response = client.get("/api/_boom")

    text = log_text(log_dir)
    assert response.status_code == 500
    assert "sk-secret-in-exception" not in text
    # 500 の応答は、フレームワークの外側が作るので、ヘッダーには ID が付かない。ログで、突き合わせる
    [request_line] = [line for line in text.splitlines() if "path=/api/_boom status=500" in line]
    request_id = re.search(r"\[([0-9a-f]{8})\]", request_line)
    assert request_id is not None
    error_lines = [
        line for line in text.splitlines() if "unexpected error type=RuntimeError" in line
    ]
    assert [f"[{request_id.group(1)}]" in line for line in error_lines] == [True]


def test_files_that_the_frontend_serves_are_not_logged(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<title>x</title>", encoding="utf-8")
    log_dir = tmp_path / "log"
    settings = AppSettings(
        data_dir=tmp_path / "data", llm_mode="fake", log_dir=log_dir, static_dir=dist
    )
    client = TestClient(create_app(settings, environ={}), base_url="http://127.0.0.1")

    assert client.get("/").status_code == 200
    client.get("/api/health")

    paths = [m.group("path") for m in LINE.finditer(log_text(log_dir))]
    assert paths == ["/api/health"]


def test_without_a_log_directory_nothing_is_written_or_configured(tmp_path: Path) -> None:
    import logging

    settings = AppSettings(data_dir=tmp_path / "data", llm_mode="fake")

    client = TestClient(create_app(settings, environ={}), base_url="http://127.0.0.1")
    response = client.get("/api/health")

    assert response.status_code == 200
    assert "x-request-id" in response.headers
    assert not (tmp_path / "log").exists()
    assert [h for h in logging.getLogger("app").handlers if h.get_name() == "app-logging"] == []
