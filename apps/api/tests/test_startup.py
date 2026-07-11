"""Application startup smoke tests."""

from fastapi.testclient import TestClient

from backend.main import app


def test_app_starts_without_active_session():
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
