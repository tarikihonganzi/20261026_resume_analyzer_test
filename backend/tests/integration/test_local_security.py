"""ローカル API の保護（仕様 10、13.1 #20）: Host と Origin の検査。CORS は有効にしない。"""

from collections.abc import Callable, MutableMapping
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import AppSettings

MakeApp = Callable[..., TestClient]


def condition_set_body() -> dict[str, Any]:
    return {"name": "x", "conditions": []}


# --- Host（DNS リバインディング対策） ---


@pytest.mark.parametrize(
    "host", ["127.0.0.1", "127.0.0.1:8000", "localhost", "localhost:5173", "LOCALHOST:8000"]
)
def test_local_host_names_are_accepted(make_app: MakeApp, host: str) -> None:
    response = make_app().get("/api/health", headers={"Host": host})

    assert response.status_code == 200


@pytest.mark.parametrize(
    "host",
    [
        "evil.example",
        "evil.example:8000",
        "127.0.0.1.evil.example",
        "localhost.evil.example",
        "0.0.0.0",
        "[::1]",
        "192.168.1.10:8000",
        "",
    ],
)
def test_other_host_names_are_rejected(make_app: MakeApp, host: str) -> None:
    response = make_app().get("/api/health", headers={"Host": host})

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_host"


def test_the_host_is_checked_for_every_path(make_app: MakeApp) -> None:
    client = make_app()

    for path in ("/api/catalog", "/api/settings", "/api/condition-sets", "/docs", "/anything"):
        assert client.get(path, headers={"Host": "evil.example"}).status_code == 400


# --- Origin（他のサイトからの送信の防止） ---


@pytest.mark.parametrize("method", ["post", "put", "delete"])
def test_state_changing_request_from_another_origin_is_forbidden(
    make_app: MakeApp, method: str
) -> None:
    client = make_app()

    response = client.request(
        method.upper(),
        "/api/condition-sets" if method == "post" else "/api/condition-sets/x",
        json=condition_set_body(),
        headers={"Origin": "https://evil.example"},
    )

    assert response.status_code == 403
    assert response.json()["code"] == "invalid_origin"


def test_forbidden_request_has_no_effect(make_app: MakeApp) -> None:
    client = make_app()

    client.put(
        "/api/settings", json={"model": "hacked"}, headers={"Origin": "https://evil.example"}
    )

    assert client.get("/api/settings").json()["model"] == "response-standard"


@pytest.mark.parametrize(
    ("host", "origin"),
    [
        ("127.0.0.1:8000", "http://127.0.0.1:8000"),
        ("127.0.0.1", "http://127.0.0.1"),
        ("localhost:5173", "http://localhost:5173"),  # 開発時（Vite の転送）
        ("localhost:8000", "http://LOCALHOST:8000"),
    ],
)
def test_own_origin_is_accepted(make_app: MakeApp, host: str, origin: str) -> None:
    response = make_app().post(
        "/api/condition-sets", json=condition_set_body(), headers={"Host": host, "Origin": origin}
    )

    assert response.status_code == 201


@pytest.mark.parametrize(
    ("host", "origin"),
    [
        ("127.0.0.1:8000", "http://127.0.0.1:9999"),  # ポートが違う
        ("127.0.0.1:8000", "http://localhost:8000"),  # ホスト名が違う
        ("127.0.0.1:8000", "https://127.0.0.1:8000"),  # スキームが違う
        ("127.0.0.1:8000", "null"),  # サンドボックスの iframe など
        ("127.0.0.1:8000", "http://127.0.0.1:8000.evil.example"),
        ("127.0.0.1:8000", ""),
    ],
)
def test_origin_that_is_not_the_server_itself_is_forbidden(
    make_app: MakeApp, host: str, origin: str
) -> None:
    response = make_app().post(
        "/api/condition-sets", json=condition_set_body(), headers={"Host": host, "Origin": origin}
    )

    assert response.status_code == 403


def test_request_without_an_origin_header_is_accepted(make_app: MakeApp) -> None:
    # ブラウザ以外（curl・テスト）は Origin を送らない。ブラウザは、POST に必ず Origin を付ける
    assert make_app().post("/api/condition-sets", json=condition_set_body()).status_code == 201


def test_reads_from_another_origin_are_not_blocked_but_get_no_cors_permission(
    make_app: MakeApp,
) -> None:
    response = make_app().get("/api/catalog", headers={"Origin": "https://evil.example"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_preflight_request_gets_no_cors_headers(make_app: MakeApp) -> None:
    response = make_app().options(
        "/api/condition-sets",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert not any(name.startswith("access-control-") for name in response.headers)


def test_the_check_of_a_streaming_request_happens_before_the_body_is_read(
    make_app: MakeApp,
) -> None:
    response = make_app().post(
        "/api/resumes/check",
        data={"text": "x" * 100},
        headers={"Origin": "https://evil.example"},
    )

    assert response.status_code == 403


# --- デモモード（APP_ALLOW_REMOTE=1。仕様 13.1 #26） ---


def make_demo_app(tmp_path: Path) -> TestClient:
    settings = AppSettings(data_dir=tmp_path / "data", llm_mode="fake", allow_remote=True)
    return TestClient(create_app(settings, environ={}), base_url="http://127.0.0.1")


@pytest.mark.parametrize(
    "host", ["192.168.1.10:8000", "demo-pc.local:8000", "10.0.0.5", "[::1]:8000"]
)
def test_demo_mode_accepts_other_host_names(tmp_path: Path, host: str) -> None:
    response = make_demo_app(tmp_path).get("/api/health", headers={"Host": host})

    assert response.status_code == 200


def test_demo_mode_accepts_a_request_from_its_own_origin_on_another_host(tmp_path: Path) -> None:
    response = make_demo_app(tmp_path).post(
        "/api/condition-sets",
        json=condition_set_body(),
        headers={"Host": "192.168.1.10:8000", "Origin": "http://192.168.1.10:8000"},
    )

    assert response.status_code == 201


@pytest.mark.parametrize("origin", ["https://evil.example", "http://192.168.1.99:8000", "null"])
def test_demo_mode_still_rejects_other_origins(tmp_path: Path, origin: str) -> None:
    response = make_demo_app(tmp_path).post(
        "/api/condition-sets",
        json=condition_set_body(),
        headers={"Host": "192.168.1.10:8000", "Origin": origin},
    )

    assert response.status_code == 403


def test_demo_mode_is_off_by_default(make_app: MakeApp) -> None:
    assert make_app().get("/api/health", headers={"Host": "192.168.1.10:8000"}).status_code == 400


def test_demo_mode_warns_in_the_log(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level("WARNING", logger="app"):
        make_demo_app(tmp_path)

    assert "デモモード" in caplog.text


def test_normal_mode_does_not_warn(make_app: MakeApp, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level("WARNING", logger="app"):
        make_app()

    assert "デモモード" not in caplog.text


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("1", True),
        (" 1 ", True),
        ("true", False),
        ("TRUE", False),
        ("yes", False),
        ("0", False),
        ("", False),
    ],
)
def test_demo_mode_is_read_from_the_environment(value: str, expected: bool) -> None:
    settings = AppSettings.from_env({"APP_ALLOW_REMOTE": value})

    assert settings.allow_remote is expected


def test_demo_mode_is_off_when_the_variable_is_missing() -> None:
    assert AppSettings.from_env({}).allow_remote is False


# --- フレームワークが出すエラーも、同じ形にする（Copilot のレビュー: PR#17） ---


def test_unsupported_method_is_a_json_error_that_keeps_the_allow_header(make_app: MakeApp) -> None:
    response = make_app().put("/api/catalog", json={})

    assert response.status_code == 405
    assert response.json()["code"] == "http_405"
    assert "detail" not in response.json()
    assert "GET" in response.headers["allow"]


def test_unknown_path_is_a_json_error(make_app: MakeApp) -> None:
    response = make_app().get("/api/nothing-here")

    assert response.status_code == 404
    assert response.json()["code"] == "http_404"


def test_broken_multipart_is_a_json_error(make_app: MakeApp) -> None:
    response = make_app().post(
        "/api/resumes/check", content=b"abc", headers={"Content-Type": "multipart/form-data"}
    )

    assert response.status_code == 400
    assert response.json()["code"] == "http_400"
    assert set(response.json()) == {"code", "message"}


async def test_non_http_scopes_pass_through_untouched() -> None:
    # lifespan（起動・終了）などの、HTTP でない通信は、Host・Origin の検査の対象外
    from app.api.security import LocalOnlyMiddleware

    seen: list[str] = []

    async def inner(scope: Any, receive: Any, send: Any) -> None:
        seen.append(scope["type"])

    async def receive() -> dict[str, Any]:
        return {}

    async def send(message: MutableMapping[str, Any]) -> None:
        raise AssertionError("応答を返してはいけない")

    await LocalOnlyMiddleware(inner)({"type": "lifespan"}, receive, send)

    assert seen == ["lifespan"]
