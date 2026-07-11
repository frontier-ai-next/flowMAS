"""Validated ingestion models."""

from typing import Any

from pydantic import BaseModel, Field


class EventIn(BaseModel):
    schema_version: str = "1.0"
    event_id: str = Field(min_length=1, max_length=128)
    event_type: str = Field(min_length=1, max_length=128)
    trace_id: str = Field(min_length=1, max_length=128)
    span_id: str | None = Field(default=None, max_length=128)
    parent_span_id: str | None = Field(default=None, max_length=128)
    timestamp: str
    sequence: int = 0
    project_id: str = Field(min_length=1, max_length=128)
    environment: str = Field(default="development", max_length=64)
    source: dict[str, Any] = Field(default_factory=dict)
    attributes: dict[str, Any] = Field(default_factory=dict)
    payload: dict[str, Any] = Field(default_factory=dict)


class EventBatchIn(BaseModel):
    events: list[EventIn] = Field(min_length=1, max_length=500)

