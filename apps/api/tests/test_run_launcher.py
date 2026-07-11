import pytest

from backend.models.execution import ExecutionRequest
from backend.services import run_launcher


@pytest.mark.asyncio
async def test_inline_graph_keeps_separate_graph_id(monkeypatch):
    captured = {}

    async def fake_launch(**kwargs):
        captured.update(kwargs)
        return "run-1"

    monkeypatch.setattr(run_launcher, "launch_graph_run", fake_launch)
    request = ExecutionRequest(
        graph_id="saved-graph",
        graph={"name": "Inline snapshot", "agents": [], "edges": []},
        task_query="test",
    )

    assert await run_launcher.launch_from_request(request) == "run-1"
    assert captured["graph_id"] == "saved-graph"
    assert captured["graph_data"]["name"] == "Inline snapshot"
