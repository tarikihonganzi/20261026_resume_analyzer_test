"""ビルドしたフロント（frontend/dist）を、FastAPI が同じオリジンで配信する（利用時の起動）。"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import AppSettings

INDEX = "<!doctype html><title>マッチング評価</title><div id=root></div>"


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    path = tmp_path / "dist"
    (path / "assets").mkdir(parents=True)
    (path / "index.html").write_text(INDEX, encoding="utf-8")
    (path / "assets" / "app-abc123.js").write_text("console.log('app')", encoding="utf-8")
    return path


def client_for(tmp_path: Path, static_dir: Path | None) -> TestClient:
    settings = AppSettings(data_dir=tmp_path / "data", llm_mode="fake", static_dir=static_dir)
    return TestClient(create_app(settings, environ={}), base_url="http://127.0.0.1")


def test_serves_index_html_at_root(tmp_path: Path, dist: Path) -> None:
    response = client_for(tmp_path, dist).get("/")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.text == INDEX


def test_serves_built_assets(tmp_path: Path, dist: Path) -> None:
    response = client_for(tmp_path, dist).get("/assets/app-abc123.js")

    assert response.status_code == 200
    assert response.text == "console.log('app')"


def test_api_routes_take_priority_over_static_files(tmp_path: Path, dist: Path) -> None:
    response = client_for(tmp_path, dist).get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unknown_api_path_is_a_json_error_not_the_html_page(tmp_path: Path, dist: Path) -> None:
    response = client_for(tmp_path, dist).get("/api/unknown")

    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert set(response.json()) == {"code", "message"}


def test_missing_file_is_404(tmp_path: Path, dist: Path) -> None:
    assert client_for(tmp_path, dist).get("/assets/missing.js").status_code == 404


def test_cannot_read_files_outside_the_dist_directory(tmp_path: Path, dist: Path) -> None:
    (tmp_path / "secret.txt").write_text("secret", encoding="utf-8")
    client = client_for(tmp_path, dist)

    for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt"):
        response = client.get(path)
        assert "secret" not in response.text, path


def test_host_check_applies_to_static_files_too(tmp_path: Path, dist: Path) -> None:
    response = client_for(tmp_path, dist).get("/", headers={"Host": "evil.example"})

    assert response.status_code == 400


def test_without_a_build_only_the_api_is_served(tmp_path: Path) -> None:
    client = client_for(tmp_path, None)

    assert client.get("/api/health").status_code == 200
    assert client.get("/").status_code == 404


def test_a_missing_dist_directory_is_ignored(tmp_path: Path) -> None:
    client = client_for(tmp_path, tmp_path / "does-not-exist")

    assert client.get("/api/health").status_code == 200
    assert client.get("/").status_code == 404


def test_static_dir_can_be_set_by_environment_variable(tmp_path: Path) -> None:
    built = tmp_path / "frontend-dist"
    built.mkdir()

    from_env = AppSettings.from_env({"APP_STATIC_DIR": str(built)})

    assert from_env.static_dir == built
