"""Tests for scheduled workflow runs."""

from datetime import UTC, datetime, timedelta

import pytest

import backend.services.storage_service as storage_svc
from backend.models.schedule import ScheduleCreate
from backend.services import schedule_service


@pytest.fixture
def sample_graph():
    storage = storage_svc.storage
    graph_id = "sched-test-graph"
    storage.save_graph(graph_id, {
        "graph_id": graph_id,
        "name": "Schedule Test Graph",
        "agents": [],
        "edges": [],
    })
    yield graph_id
    storage.delete_graph(graph_id)
    for s in storage.list_schedules():
        schedule_service.delete_schedule(s["schedule_id"])


def test_create_interval_schedule(sample_graph):
    created = schedule_service.create_schedule(ScheduleCreate(
        name="Hourly",
        graph_id=sample_graph,
        task_query="Run hourly task",
        schedule_type="interval",
        interval_seconds=3600,
    ))
    assert created.schedule_id
    assert created.enabled is True
    assert created.next_run_at is not None
    assert created.interval_seconds == 3600


def test_pause_and_resume(sample_graph):
    created = schedule_service.create_schedule(ScheduleCreate(
        name="Pausable",
        graph_id=sample_graph,
        task_query="Task",
        schedule_type="interval",
        interval_seconds=120,
    ))
    paused = schedule_service.set_schedule_enabled(created.schedule_id, False)
    assert paused is not None
    assert paused.enabled is False

    resumed = schedule_service.set_schedule_enabled(created.schedule_id, True)
    assert resumed is not None
    assert resumed.enabled is True


def test_compute_next_run_cron(sample_graph):
    created = schedule_service.create_schedule(ScheduleCreate(
        name="Cron",
        graph_id=sample_graph,
        task_query="Daily",
        schedule_type="cron",
        cron_expression="0 9 * * *",
    ))
    assert created.cron_expression == "0 9 * * *"
    assert created.next_run_at is not None


def test_create_future_one_shot_schedule(sample_graph):
    run_at = datetime.now(UTC) + timedelta(minutes=5)
    created = schedule_service.create_schedule(ScheduleCreate(
        name="One shot",
        graph_id=sample_graph,
        task_query="Run once",
        schedule_type="once",
        run_at=run_at,
    ))
    assert created.run_at == run_at.isoformat()
    assert created.next_run_at is not None


def test_reject_past_one_shot_schedule(sample_graph):
    with pytest.raises(ValueError, match="future"):
        schedule_service.create_schedule(ScheduleCreate(
            name="Too late",
            graph_id=sample_graph,
            task_query="Run once",
            schedule_type="once",
            run_at=datetime.now(UTC) - timedelta(minutes=1),
        ))
