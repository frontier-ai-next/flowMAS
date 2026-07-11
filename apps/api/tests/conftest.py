"""Shared pytest fixtures for the API test suite."""

import pytest

from backend.services.storage_service import StorageService
from backend.session import new_session_id, session_scope


@pytest.fixture(autouse=True)
def api_session(tmp_path, monkeypatch):
    """Every test runs inside an isolated anonymous session and data directory."""
    data_dir = str(tmp_path / "data")
    isolated = StorageService(data_dir)
    monkeypatch.setattr("backend.config.settings.data_dir", data_dir)
    monkeypatch.setattr("backend.services.storage_service.storage", isolated)
    monkeypatch.setattr("backend.services.schedule_service.storage", isolated)
    monkeypatch.setattr("backend.services.execution_service.storage", isolated)
    monkeypatch.setattr("backend.services.graph_service.storage", isolated)
    monkeypatch.setattr("backend.services.agent_service.storage", isolated)
    monkeypatch.setattr("backend.services.run_launcher.storage", isolated)
    monkeypatch.setattr("backend.routers.execution.storage", isolated)
    monkeypatch.setattr("backend.routers.config.storage", isolated)
    monkeypatch.setattr("backend.services.tool_registry_service.storage", isolated)
    with session_scope(new_session_id()):
        yield isolated
