"""ローカル API の保護（仕様 10、13.1 #20）: Host と Origin の検査。CORS は有効にしない。"""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

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

    assert client.get("/api/settings").json()["model"] == "gpt-5.5"


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
