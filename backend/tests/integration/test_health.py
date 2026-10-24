from fastapi.testclient import TestClient

from app.main import create_app


def test_health_returns_ok() -> None:
    client = TestClient(create_app(), base_url="http://127.0.0.1")

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
