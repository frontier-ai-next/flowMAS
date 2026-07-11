"""Scheduled workflow runs — cron, interval, and one-shot (Langflow Background Agents–style)."""

import logging
import uuid
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger

from backend.models.schedule import ScheduleCreate, ScheduleResponse, ScheduleUpdate
from backend.services.run_launcher import launch_graph_run
from backend.services.storage_service import storage
from backend.session import get_current_session_id, session_scope

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


def _parse_tz(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def _schedule_to_response(data: dict[str, Any]) -> ScheduleResponse:
    graph = storage.get_graph(data.get("graph_id", ""))
    run_config = data.get("run_config")
    return ScheduleResponse(
        schedule_id=data["schedule_id"],
        name=data["name"],
        graph_id=data["graph_id"],
        graph_name=(graph or {}).get("name"),
        task_query=data["task_query"],
        schedule_type=data["schedule_type"],
        cron_expression=data.get("cron_expression"),
        interval_seconds=data.get("interval_seconds"),
        run_at=data.get("run_at"),
        timezone=data.get("timezone") or "UTC",
        enabled=bool(data.get("enabled", True)),
        llm_provider_id=data.get("llm_provider_id"),
        llm_model=data.get("llm_model"),
        run_config=run_config if isinstance(run_config, dict) else None,
        next_run_at=data.get("next_run_at"),
        last_run_at=data.get("last_run_at"),
        last_run_id=data.get("last_run_id"),
        last_status=data.get("last_status"),
        run_count=int(data.get("run_count") or 0),
        created_at=data.get("created_at") or "",
        updated_at=data.get("updated_at") or "",
    )


def _compute_next_run(data: dict[str, Any]) -> datetime | None:
    if not data.get("enabled", True):
        return None
    tz = _parse_tz(data.get("timezone") or "UTC")
    kind = data.get("schedule_type")
    now = datetime.now(tz)

    try:
        if kind == "cron" and data.get("cron_expression"):
            trigger = CronTrigger.from_crontab(data["cron_expression"], timezone=tz)
            return trigger.get_next_fire_time(None, now)
        if kind == "interval" and data.get("interval_seconds"):
            trigger = IntervalTrigger(seconds=int(data["interval_seconds"]), timezone=tz)
            return trigger.get_next_fire_time(None, now)
        if kind == "once" and data.get("run_at"):
            run_at = datetime.fromisoformat(str(data["run_at"]).replace("Z", "+00:00"))
            if run_at.tzinfo is None:
                run_at = run_at.replace(tzinfo=UTC)
            return run_at.astimezone(tz) if run_at > now else None
    except Exception as exc:
        logger.warning("Could not compute next_run for %s: %s", data.get("schedule_id"), exc)
    return None


def _build_trigger(data: dict[str, Any]):
    tz = _parse_tz(data.get("timezone") or "UTC")
    kind = data.get("schedule_type")
    if kind == "cron":
        return CronTrigger.from_crontab(data["cron_expression"], timezone=tz)
    if kind == "interval":
        return IntervalTrigger(seconds=int(data["interval_seconds"]), timezone=tz)
    if kind == "once" and data.get("run_at"):
        run_at = datetime.fromisoformat(str(data["run_at"]).replace("Z", "+00:00"))
        if run_at.tzinfo is None:
            run_at = run_at.replace(tzinfo=UTC)
        return DateTrigger(run_date=run_at.astimezone(tz))
    raise ValueError(f"Invalid schedule configuration for {data.get('schedule_id')}")


async def _execute_scheduled_job(schedule_id: str) -> None:
    located = storage.find_schedule(schedule_id)
    if located is None:
        return
    owner_session_id, data = located

    with session_scope(owner_session_id):
        if not data.get("enabled", True):
            return

        graph_id = data.get("graph_id", "")
        if storage.get_graph(graph_id) is None:
            logger.warning(
                "Disabling schedule %s: graph '%s' not found in session %s",
                schedule_id,
                graph_id,
                owner_session_id,
            )
            data["enabled"] = False
            data["last_run_at"] = datetime.now(UTC).isoformat()
            data["last_status"] = f"error: graph '{graph_id}' not found"
            data["next_run_at"] = None
            storage.save_schedule(schedule_id, data)
            _unregister_job(schedule_id, owner_session_id)
            return

        try:
            from backend.models.execution import RunnerConfigSchema

            run_config = data.get("run_config")
            config = RunnerConfigSchema.model_validate(run_config) if run_config else None
            run_id = await launch_graph_run(
                graph_id=data["graph_id"],
                task_query=data["task_query"],
                config=config,
                llm_provider_id=data.get("llm_provider_id"),
                llm_model=data.get("llm_model"),
                trigger_source="schedule",
                schedule_id=schedule_id,
                schedule_name=data.get("name"),
            )
            data["last_run_id"] = run_id
            data["last_run_at"] = datetime.now(UTC).isoformat()
            data["last_status"] = "started"
            data["run_count"] = int(data.get("run_count") or 0) + 1
        except Exception as exc:
            logger.exception("Scheduled run failed for %s", schedule_id)
            data["last_run_at"] = datetime.now(UTC).isoformat()
            data["last_status"] = f"error: {exc}"

        if data.get("schedule_type") == "once":
            data["enabled"] = False
            data["next_run_at"] = None
        else:
            nxt = _compute_next_run(data)
            data["next_run_at"] = nxt.isoformat() if nxt else None

        storage.save_schedule(schedule_id, data)

        if data.get("schedule_type") == "once" or not data.get("enabled", True):
            _unregister_job(schedule_id, owner_session_id)


def _job_id(schedule_id: str, session_id: str | None = None) -> str:
    sid = session_id or get_current_session_id()
    return f"schedule:{sid}:{schedule_id}"


def _unregister_job(schedule_id: str, session_id: str | None = None) -> None:
    if _scheduler is None:
        return
    job_id = _job_id(schedule_id, session_id)
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)


def _register_job(data: dict[str, Any]) -> None:
    if _scheduler is None or not data.get("enabled", True):
        return
    schedule_id = data["schedule_id"]
    session_id = data.get("session_id") or get_current_session_id()
    graph_id = data.get("graph_id", "")
    if storage.get_graph(graph_id) is None:
        logger.warning(
            "Disabling orphan schedule %s: graph '%s' not found in session %s",
            schedule_id,
            graph_id,
            session_id,
        )
        data["enabled"] = False
        data["last_status"] = f"error: graph '{graph_id}' not found"
        data["next_run_at"] = None
        storage.save_schedule(schedule_id, data)
        return

    _unregister_job(schedule_id, session_id)
    try:
        trigger = _build_trigger(data)
    except Exception as exc:
        logger.warning("Skip scheduling %s: %s", schedule_id, exc)
        return

    _scheduler.add_job(
        _execute_scheduled_job,
        trigger=trigger,
        id=_job_id(schedule_id, session_id),
        args=[schedule_id],
        replace_existing=True,
        misfire_grace_time=300,
    )
    next_run = _compute_next_run(data)
    data["next_run_at"] = next_run.isoformat() if next_run else None
    storage.save_schedule(schedule_id, data)


def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.start()
    job_count = 0
    for session_id, item in storage.iter_all_schedules():
        if not item.get("enabled", True):
            continue
        with session_scope(session_id):
            _register_job(item)
            job_count += 1
    logger.info("Schedule worker started (%d jobs)", job_count)


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


def list_schedules() -> list[ScheduleResponse]:
    items = storage.list_schedules()
    for item in items:
        nxt = _compute_next_run(item)
        item["next_run_at"] = nxt.isoformat() if nxt else item.get("next_run_at")
    return [_schedule_to_response(s) for s in items]


def get_schedule(schedule_id: str) -> ScheduleResponse | None:
    data = storage.get_schedule(schedule_id)
    if data is None:
        return None
    nxt = _compute_next_run(data)
    data["next_run_at"] = nxt.isoformat() if nxt else data.get("next_run_at")
    return _schedule_to_response(data)


def create_schedule(body: ScheduleCreate) -> ScheduleResponse:
    graph = storage.get_graph(body.graph_id)
    if graph is None:
        raise ValueError(f"Graph '{body.graph_id}' not found")

    run_at = body.run_at
    if body.schedule_type == "once" and run_at is not None:
        if run_at.tzinfo is None:
            run_at = run_at.replace(tzinfo=_parse_tz(body.timezone))
        if run_at.astimezone(UTC) <= datetime.now(UTC):
            raise ValueError("run_at must be a future date/time for a one-shot schedule")

    schedule_id = uuid.uuid4().hex[:12]
    data: dict[str, Any] = {
        "schedule_id": schedule_id,
        "session_id": get_current_session_id(),
        "name": body.name,
        "graph_id": body.graph_id,
        "task_query": body.task_query,
        "schedule_type": body.schedule_type,
        "cron_expression": body.cron_expression,
        "interval_seconds": body.interval_seconds,
        "run_at": run_at.isoformat() if run_at else None,
        "timezone": body.timezone or "UTC",
        "enabled": body.enabled,
        "llm_provider_id": body.llm_provider_id,
        "llm_model": body.llm_model,
        "run_config": body.run_config.model_dump() if body.run_config else None,
        "run_count": 0,
    }
    storage.save_schedule(schedule_id, data)
    if body.enabled:
        _register_job(data)
    return get_schedule(schedule_id) or _schedule_to_response(data)


def update_schedule(schedule_id: str, patch: ScheduleUpdate) -> ScheduleResponse | None:
    data = storage.get_schedule(schedule_id)
    if data is None:
        return None

    updates = patch.model_dump(exclude_unset=True)
    if "run_config" in updates and updates["run_config"] is not None:
        updates["run_config"] = patch.run_config.model_dump() if patch.run_config else None
    if "run_at" in updates and updates["run_at"] is not None:
        updates["run_at"] = patch.run_at.isoformat() if patch.run_at else None

    data.update(updates)
    storage.save_schedule(schedule_id, data)
    _unregister_job(schedule_id)
    if data.get("enabled", True):
        _register_job(data)
    return get_schedule(schedule_id)


def delete_schedule(schedule_id: str) -> bool:
    _unregister_job(schedule_id)
    return storage.delete_schedule(schedule_id)


async def trigger_schedule_now(schedule_id: str) -> dict[str, str]:
    data = storage.get_schedule(schedule_id)
    if data is None:
        raise ValueError(f"Schedule '{schedule_id}' not found")
    await _execute_scheduled_job(schedule_id)
    refreshed = storage.get_schedule(schedule_id) or data
    return {
        "schedule_id": schedule_id,
        "last_run_id": refreshed.get("last_run_id") or "",
        "last_status": refreshed.get("last_status") or "",
    }


def set_schedule_enabled(schedule_id: str, enabled: bool) -> ScheduleResponse | None:
    return update_schedule(schedule_id, ScheduleUpdate(enabled=enabled))
