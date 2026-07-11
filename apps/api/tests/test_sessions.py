"""Anonymous session isolation tests."""

import backend.services.storage_service as storage_svc
from backend.session import new_session_id, session_scope


def test_storage_isolated_between_sessions():
    storage = storage_svc.storage
    session_a = new_session_id()
    session_b = new_session_id()

    with session_scope(session_a):
        storage.save_graph("graph-a", {"graph_id": "graph-a", "name": "A", "agents": [], "edges": []})
        assert storage.get_graph("graph-a") is not None
        assert len(storage.list_graphs()) == 1

    with session_scope(session_b):
        assert storage.get_graph("graph-a") is None
        assert storage.list_graphs() == []

    with session_scope(session_a):
        assert storage.get_graph("graph-a") is not None


def test_runs_persist_session_id():
    from backend.services import execution_service

    storage = storage_svc.storage
    session_id = new_session_id()
    with session_scope(session_id):
        storage.save_run("run-1", {
            "run_id": "run-1",
            "session_id": session_id,
            "status": "completed",
            "task_query": "test",
            "events": [],
        })
        history = execution_service.get_run_history()
        assert len(history) == 1
        assert history[0]["run_id"] == "run-1"

    other = new_session_id()
    with session_scope(other):
        assert execution_service.get_run_detail("run-1") is None
        assert execution_service.get_run_history() == []


def test_find_schedule_across_sessions():
    storage = storage_svc.storage
    session_id = new_session_id()
    with session_scope(session_id):
        storage.save_schedule("sched-1", {
            "schedule_id": "sched-1",
            "session_id": session_id,
            "name": "Job",
            "graph_id": "g1",
            "task_query": "q",
            "schedule_type": "interval",
            "interval_seconds": 60,
            "enabled": True,
        })

    located = storage.find_schedule("sched-1")
    assert located is not None
    owner, data = located
    assert owner == session_id
    assert data["schedule_id"] == "sched-1"
