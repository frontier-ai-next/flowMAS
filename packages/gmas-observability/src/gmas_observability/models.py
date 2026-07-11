"""Versioned wire models with no runtime dependencies."""

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4


@dataclass(slots=True)
class TelemetryEvent:
    """Canonical event envelope accepted by the observability service."""

    event_type: str
    trace_id: str
    project_id: str
    environment: str
    payload: dict[str, Any] = field(default_factory=dict)
    attributes: dict[str, Any] = field(default_factory=dict)
    span_id: str | None = None
    parent_span_id: str | None = None
    event_id: str = field(default_factory=lambda: str(uuid4()))
    timestamp: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    sequence: int = 0
    schema_version: str = "1.0"
    source: dict[str, str] = field(
        default_factory=lambda: {"framework": "gmas", "integration": "python-sdk"}
    )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
