"""Scheduled workflow API (Langflow Background Agents–style)."""

from fastapi import APIRouter, HTTPException

from backend.models.schedule import ScheduleCreate, ScheduleResponse, ScheduleUpdate
from backend.services import schedule_service

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


@router.get("", response_model=list[ScheduleResponse])
def list_schedules():
    return schedule_service.list_schedules()


@router.post("", response_model=ScheduleResponse, status_code=201)
def create_schedule(body: ScheduleCreate):
    try:
        return schedule_service.create_schedule(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{schedule_id}", response_model=ScheduleResponse)
def get_schedule(schedule_id: str):
    item = schedule_service.get_schedule(schedule_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Schedule '{schedule_id}' not found")
    return item


@router.put("/{schedule_id}", response_model=ScheduleResponse)
def update_schedule(schedule_id: str, body: ScheduleUpdate):
    item = schedule_service.update_schedule(schedule_id, body)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Schedule '{schedule_id}' not found")
    return item


@router.delete("/{schedule_id}")
def delete_schedule(schedule_id: str):
    if not schedule_service.delete_schedule(schedule_id):
        raise HTTPException(status_code=404, detail=f"Schedule '{schedule_id}' not found")
    return {"schedule_id": schedule_id, "deleted": True}


@router.post("/{schedule_id}/run", status_code=202)
async def run_schedule_now(schedule_id: str):
    try:
        return await schedule_service.trigger_schedule_now(schedule_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{schedule_id}/pause", response_model=ScheduleResponse)
def pause_schedule(schedule_id: str):
    item = schedule_service.set_schedule_enabled(schedule_id, False)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Schedule '{schedule_id}' not found")
    return item


@router.post("/{schedule_id}/resume", response_model=ScheduleResponse)
def resume_schedule(schedule_id: str):
    item = schedule_service.set_schedule_enabled(schedule_id, True)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Schedule '{schedule_id}' not found")
    return item
