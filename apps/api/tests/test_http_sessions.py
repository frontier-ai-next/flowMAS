"""HTTP-level anonymous session middleware tests."""

from fastapi.testclient import TestClient

from backend.main import app
from backend.session import SESSION_COOKIE, is_valid_session_id


def test_health_sets_session_cookie():
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        cookie = response.cookies.get(SESSION_COOKIE)
        assert cookie
        assert is_valid_session_id(cookie)


def test_graphs_isolated_by_session_cookie():
    with TestClient(app) as client_a, TestClient(app) as client_b:
        created = client_a.post(
            "/api/graphs",
            json={
                "name": "Session A graph",
                "agents": [],
                "edges": [],
            },
        )
        assert created.status_code == 201
        graph_id = created.json()["graph_id"]

        listed_a = client_a.get("/api/graphs")
        listed_b = client_b.get("/api/graphs")
        assert listed_a.status_code == 200
        assert listed_b.status_code == 200

        ids_a = {item["graph_id"] for item in listed_a.json()}
        ids_b = {item["graph_id"] for item in listed_b.json()}
        assert graph_id in ids_a
        assert graph_id not in ids_b

        client_a.delete(f"/api/graphs/{graph_id}")
