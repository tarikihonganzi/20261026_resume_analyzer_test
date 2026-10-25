"""エラーの統一（仕様 7）。どの失敗も、`{code, message}` の同じ形で返し、内部の情報を出さない。"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.domain.errors import (
    ConditionSetNotFoundError,
    DomainError,
    LlmAuthError,
    LlmError,
    LlmResponseError,
    LlmUnavailableError,
    StorageCorruptedError,
)
from app.main import create_app
from app.settings import AppSettings


def client_raising(error: Exception, tmp_path: Path) -> TestClient:
    """指定した例外を送出するだけのルートを足した、アプリのクライアント。"""
    app = create_app(AppSettings(data_dir=tmp_path / "data", llm_mode="fake"), environ={})

    def boom() -> None:
        raise error

    app.add_api_route("/api/_boom", boom)
    # 想定外の例外も、サーバー側で再送出せず、応答として受け取る（実際の起動と同じ）
    return TestClient(app, base_url="http://127.0.0.1", raise_server_exceptions=False)


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        pytest.param(
            ConditionSetNotFoundError("条件セットがありません"), 404, "not_found", id="404"
        ),
        pytest.param(
            StorageCorruptedError("data.json の内容が壊れています"),
            500,
            "storage_error",
            id="storage",
        ),
        pytest.param(LlmAuthError(), 422, "llm_auth", id="auth"),
        pytest.param(LlmUnavailableError("timeout"), 502, "llm_unavailable", id="unavailable"),
        pytest.param(LlmResponseError("invalid"), 502, "llm_response", id="response"),
        pytest.param(LlmError("AI サービスの失敗"), 502, "llm_error", id="llm-base"),
        pytest.param(DomainError("想定していない業務エラー"), 500, "error", id="domain-fallback"),
    ],
)
def test_domain_errors_are_mapped_to_a_status_and_the_unified_body(
    tmp_path: Path, error: Exception, status: int, code: str
) -> None:
    response = client_raising(error, tmp_path).get("/api/_boom")

    assert response.status_code == status
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == {"code": code, "message": str(error)}


def test_an_unexpected_exception_is_a_unified_500_without_internal_details(tmp_path: Path) -> None:
    secret = "sk-secret-key-0123456789 /home/user/データ/resume.pdf"

    response = client_raising(RuntimeError(secret), tmp_path).get("/api/_boom")

    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert body["code"] == "internal_error"
    assert secret not in response.text
    assert "RuntimeError" not in response.text
    assert "Traceback" not in response.text


def test_an_unexpected_exception_is_logged_without_its_message(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level("ERROR", logger="app")

    client_raising(RuntimeError("sk-secret-in-message"), tmp_path).get("/api/_boom")

    assert any("RuntimeError" in record.getMessage() for record in caplog.records)
    assert all("sk-secret-in-message" not in record.getMessage() for record in caplog.records)
