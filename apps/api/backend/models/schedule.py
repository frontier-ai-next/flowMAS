"""Scheduled workflow execution models (Langflow Background Agents–style)."""

from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, Field, model_validator

from backend.models.execution import RunnerConfigSchema

ScheduleType = Literal["cron", "interval", "once"]


class ScheduleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    graph_id: str = Field(min_length=1)
    task_query: str = Field(min_length=1)
    schedule_type: ScheduleType
    cron_expression: str | None = None
    interval_seconds: int | None = Field(default=None, ge=30, le=86400 * 7)
    run_at: datetime | None = None
    timezone: str = "UTC"
    enabled: bool = True
    llm_provider_id: str | None = None
    llm_model: str | None = None
    run_config: RunnerConfigSchema | None = None

    @model_validator(mode="after")
    def validate_schedule_fields(self) -> Self:
        if self.schedule_type == "cron" and not (self.cron_expression or "").strip():
            raise ValueError("cron_expression is required when schedule_type is cron")
        if self.schedule_type == "interval" and self.interval_seconds is None:
            raise ValueError("interval_seconds is required when schedule_type is interval")
        if self.schedule_type == "once" and self.run_at is None:
            raise ValueError("run_at is required when schedule_type is once")
        if self.cron_expression:
            self.cron_expression = self.cron_expression.strip()
        return self


class ScheduleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    task_query: str | None = Field(default=None, min_length=1)
    schedule_type: ScheduleType | None = None
    cron_expression: str | None = None
    interval_seconds: int | None = Field(default=None, ge=30, le=86400 * 7)
    run_at: datetime | None = None
    timezone: str | None = None
    enabled: bool | None = None
    llm_provider_id: str | None = None
    llm_model: str | None = None
    run_config: RunnerConfigSchema | None = None


class ScheduleResponse(BaseModel):
    schedule_id: str
    name: str
    graph_id: str
    graph_name: str | None = None
    task_query: str
    schedule_type: ScheduleType
    cron_expression: str | None = None
    interval_seconds: int | None = None
    run_at: str | None = None
    timezone: str = "UTC"
    enabled: bool = True
    llm_provider_id: str | None = None
    llm_model: str | None = None
    run_config: dict | None = None
    next_run_at: str | None = None
    last_run_at: str | None = None
    last_run_id: str | None = None
    last_status: str | None = None
    run_count: int = 0
    created_at: str
    updated_at: str
