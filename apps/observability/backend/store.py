"""Async SQLAlchemy event store for the self-hosted observability service."""

import asyncio
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, Index, Integer, String, case, cast, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .models import EventIn


class Base(DeclarativeBase):
    pass


class EventRecord(Base):
    __tablename__ = "events"
    __table_args__ = (
        Index("idx_events_trace", "trace_id", "sequence", "timestamp"),
        Index("idx_events_project_time", "project_id", "timestamp"),
        Index("idx_events_type", "event_type"),
    )

    event_id: Mapped[str] = mapped_column(String, primary_key=True)
    schema_version: Mapped[str] = mapped_column(String, nullable=False)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    trace_id: Mapped[str] = mapped_column(String, nullable=False)
    span_id: Mapped[str | None] = mapped_column(String)
    parent_span_id: Mapped[str | None] = mapped_column(String)
    timestamp: Mapped[str] = mapped_column(String, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    project_id: Mapped[str] = mapped_column(String, nullable=False)
    environment: Mapped[str] = mapped_column(String, nullable=False)
    source_json: Mapped[dict[str, Any]] = mapped_column(
        "source_json", JSON, nullable=False
    )
    attributes_json: Mapped[dict[str, Any]] = mapped_column(
        "attributes_json", JSON, nullable=False
    )
    payload_json: Mapped[dict[str, Any]] = mapped_column(
        "payload_json", JSON, nullable=False
    )


class EventStore:
    def __init__(self, database_path: str | Path) -> None:
        path = Path(database_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self._engine = create_async_engine(f"sqlite+aiosqlite:///{path}")
        self._sessions = async_sessionmaker(self._engine, expire_on_commit=False)
        self._cache_generation = 0
        self._trace_cache: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
        self._overview_cache: dict[tuple[Any, ...], dict[str, Any]] = {}
        self._trace_cache_lock = asyncio.Lock()
        self._overview_cache_lock = asyncio.Lock()

    async def initialize(self) -> None:
        async with self._engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
            await connection.exec_driver_sql("PRAGMA journal_mode=WAL")
            await connection.exec_driver_sql("PRAGMA synchronous=NORMAL")

    async def insert(self, events: list[EventIn]) -> int:
        rows = [
            {
                "event_id": event.event_id,
                "schema_version": event.schema_version,
                "event_type": event.event_type,
                "trace_id": event.trace_id,
                "span_id": event.span_id,
                "parent_span_id": event.parent_span_id,
                "timestamp": event.timestamp,
                "sequence": event.sequence,
                "project_id": event.project_id,
                "environment": event.environment,
                "source_json": event.source,
                "attributes_json": event.attributes,
                "payload_json": event.payload,
            }
            for event in events
        ]
        async with self._sessions.begin() as session:
            result = await session.execute(
                sqlite_insert(EventRecord)
                .values(rows)
                .on_conflict_do_nothing(index_elements=[EventRecord.event_id])
            )
        if (result.rowcount or 0) > 0:
            self._cache_generation += 1
            self._trace_cache.clear()
            self._overview_cache.clear()
        return max(result.rowcount or 0, 0)

    async def list_traces(
        self,
        *,
        project_id: str | None = None,
        environment: str | None = None,
        search: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        key = (project_id, environment, search, limit, offset)
        cached = self._trace_cache.get(key)
        if cached is not None:
            return cached
        async with self._trace_cache_lock:
            cached = self._trace_cache.get(key)
            if cached is not None:
                return cached
            generation = self._cache_generation
            result = await self._list_traces_uncached(
                project_id=project_id,
                environment=environment,
                search=search,
                limit=limit,
                offset=offset,
            )
            if generation == self._cache_generation:
                self._trace_cache[key] = result
            return result

    async def _list_traces_uncached(
        self,
        *,
        project_id: str | None = None,
        environment: str | None = None,
        search: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        payload = EventRecord.payload_json
        attributes = EventRecord.attributes_json
        input_tokens = func.coalesce(
            func.json_extract(payload, "$.usage.input_tokens"),
            func.json_extract(payload, "$.usage.prompt_tokens"),
            func.json_extract(payload, "$.response.usage.input_tokens"),
            func.json_extract(payload, "$.response.usage.prompt_tokens"),
            0,
        )
        output_tokens = func.coalesce(
            func.json_extract(payload, "$.usage.output_tokens"),
            func.json_extract(payload, "$.usage.completion_tokens"),
            func.json_extract(payload, "$.response.usage.output_tokens"),
            func.json_extract(payload, "$.response.usage.completion_tokens"),
            0,
        )
        has_usage = func.coalesce(
            func.json_extract(payload, "$.usage.input_tokens"),
            func.json_extract(payload, "$.usage.prompt_tokens"),
            func.json_extract(payload, "$.response.usage.input_tokens"),
            func.json_extract(payload, "$.response.usage.prompt_tokens"),
        ).is_not(None) & func.coalesce(
            func.json_extract(payload, "$.usage.output_tokens"),
            func.json_extract(payload, "$.usage.completion_tokens"),
            func.json_extract(payload, "$.response.usage.output_tokens"),
            func.json_extract(payload, "$.response.usage.completion_tokens"),
        ).is_not(None)
        statement = select(
            EventRecord.trace_id.label("trace_id"),
            EventRecord.project_id.label("project_id"),
            EventRecord.environment.label("environment"),
            func.min(EventRecord.timestamp).label("started_at"),
            func.max(EventRecord.timestamp).label("updated_at"),
            func.count().label("event_count"),
            func.sum(case((EventRecord.event_type.like("%.failed"), 1), else_=0)).label(
                "error_count"
            ),
            func.count(
                func.distinct(
                    case(
                        (
                            EventRecord.event_type == "agent.started",
                            func.json_extract(payload, "$.agent_id"),
                        )
                    )
                )
            ).label("agent_count"),
            func.sum(
                case((EventRecord.event_type == "llm.completed", 1), else_=0)
            ).label("llm_count"),
            func.sum(
                case(
                    (
                        (EventRecord.event_type == "llm.completed") & has_usage,
                        1,
                    ),
                    else_=0,
                )
            ).label("usage_count"),
            func.sum(
                case(
                    (
                        EventRecord.event_type.like("tool.%")
                        & (EventRecord.event_type != "tool.started"),
                        1,
                    ),
                    else_=0,
                )
            ).label("tool_count"),
            func.max(
                case(
                    (
                        EventRecord.event_type == "run.completed",
                        func.json_extract(payload, "$.duration_ms"),
                    )
                )
            ).label("duration_ms"),
            func.sum(
                case(
                    (
                        EventRecord.event_type == "llm.completed",
                        input_tokens + output_tokens,
                    ),
                    else_=0,
                )
            ).label("total_tokens"),
            func.max(
                case(
                    (
                        EventRecord.event_type == "run.completed",
                        func.json_extract(payload, "$.total_tokens"),
                    )
                )
            ).label("gmas_total_tokens"),
            func.max(
                case(
                    (
                        EventRecord.event_type == "run.completed",
                        func.json_extract(payload, "$.success"),
                    )
                )
            ).label("success"),
            func.max(func.json_extract(attributes, "$.graph_name")).label("graph_name"),
            func.max(
                case(
                    (
                        EventRecord.event_type == "run.started",
                        func.json_extract(payload, "$.query"),
                    )
                )
            ).label("input"),
        )
        if project_id:
            statement = statement.where(EventRecord.project_id == project_id)
        if environment:
            statement = statement.where(EventRecord.environment == environment)
        if search:
            needle = f"%{search}%"
            statement = statement.where(
                EventRecord.trace_id.like(needle)
                | cast(attributes, String).like(needle)
                | cast(payload, String).like(needle)
            )
        statement = (
            statement.group_by(
                EventRecord.trace_id, EventRecord.project_id, EventRecord.environment
            )
            .order_by(func.max(EventRecord.timestamp).desc())
            .limit(limit)
            .offset(offset)
        )
        async with self._sessions() as session:
            result = await session.execute(statement)
        return [dict(row) for row in result.mappings().all()]

    async def overview(
        self, *, project_id: str | None = None, environment: str | None = None
    ) -> dict[str, Any]:
        key = (project_id, environment)
        cached = self._overview_cache.get(key)
        if cached is not None:
            return cached
        async with self._overview_cache_lock:
            cached = self._overview_cache.get(key)
            if cached is not None:
                return cached
            generation = self._cache_generation
            result = await self._overview_uncached(
                project_id=project_id,
                environment=environment,
            )
            if generation == self._cache_generation:
                self._overview_cache[key] = result
            return result

    async def _overview_uncached(
        self, *, project_id: str | None = None, environment: str | None = None
    ) -> dict[str, Any]:
        traces = await self.list_traces(
            project_id=project_id, environment=environment, limit=500, offset=0
        )
        completed = [trace for trace in traces if trace.get("success") is not None]
        successful = sum(1 for trace in completed if trace.get("success"))
        durations = [
            float(trace["duration_ms"])
            for trace in completed
            if trace.get("duration_ms") is not None
        ]
        provider_usage = await self.token_timeseries(
            project_id=project_id, environment=environment, days=None
        )
        return {
            "trace_count": len(traces),
            "success_rate": round(successful / len(completed) * 100, 1)
            if completed
            else None,
            "error_count": sum(int(trace.get("error_count") or 0) for trace in traces),
            "total_tokens": sum(int(point["tokens"]) for point in provider_usage),
            "usage_calls": sum(int(point["usage_calls"]) for point in provider_usage),
            "agent_runs": sum(int(trace.get("agent_count") or 0) for trace in traces),
            "llm_calls": sum(int(point["llm_calls"]) for point in provider_usage),
            "avg_duration_ms": round(sum(durations) / len(durations), 1)
            if durations
            else None,
        }

    async def token_timeseries(
        self,
        *,
        project_id: str | None = None,
        environment: str | None = None,
        days: int | None = 30,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> list[dict[str, Any]]:
        """Aggregate LLM provider token usage into UTC calendar days."""
        payload = EventRecord.payload_json
        day = func.date(EventRecord.timestamp)
        statement = (
            select(
                day.label("date"),
                func.count(func.distinct(EventRecord.trace_id)).label("traces"),
                func.sum(
                    case(
                        (func.json_extract(payload, "$.success") == 1, 1),
                        else_=0,
                    )
                ).label("successful_traces"),
            )
            .where(EventRecord.event_type == "run.completed")
            .group_by(day)
            .order_by(day)
        )
        if project_id:
            statement = statement.where(EventRecord.project_id == project_id)
        if environment:
            statement = statement.where(EventRecord.environment == environment)
        if start_date is None and days is not None:
            end_date = datetime.now(UTC).date()
            start_date = end_date - timedelta(days=days - 1)
        if start_date is not None:
            statement = statement.where(EventRecord.timestamp >= start_date.isoformat())
        if end_date is not None:
            exclusive_end = end_date + timedelta(days=1)
            statement = statement.where(
                EventRecord.timestamp < exclusive_end.isoformat()
            )
        async with self._sessions() as session:
            rows = (await session.execute(statement)).mappings().all()
            input_tokens = func.coalesce(
                func.json_extract(payload, "$.usage.input_tokens"),
                func.json_extract(payload, "$.usage.prompt_tokens"),
                func.json_extract(payload, "$.response.usage.input_tokens"),
                func.json_extract(payload, "$.response.usage.prompt_tokens"),
                0,
            )
            output_tokens = func.coalesce(
                func.json_extract(payload, "$.usage.output_tokens"),
                func.json_extract(payload, "$.usage.completion_tokens"),
                func.json_extract(payload, "$.response.usage.output_tokens"),
                func.json_extract(payload, "$.response.usage.completion_tokens"),
                0,
            )
            has_usage = func.coalesce(
                func.json_extract(payload, "$.usage.input_tokens"),
                func.json_extract(payload, "$.usage.prompt_tokens"),
                func.json_extract(payload, "$.response.usage.input_tokens"),
                func.json_extract(payload, "$.response.usage.prompt_tokens"),
            ).is_not(None) & func.coalesce(
                func.json_extract(payload, "$.usage.output_tokens"),
                func.json_extract(payload, "$.usage.completion_tokens"),
                func.json_extract(payload, "$.response.usage.output_tokens"),
                func.json_extract(payload, "$.response.usage.completion_tokens"),
            ).is_not(None)
            usage_statement = (
                select(
                    day.label("date"),
                    func.sum(input_tokens).label("input_tokens"),
                    func.sum(output_tokens).label("output_tokens"),
                    func.count().label("llm_calls"),
                    func.sum(case((has_usage, 1), else_=0)).label("usage_calls"),
                )
                .where(EventRecord.event_type == "llm.completed")
                .group_by(day)
                .order_by(day)
            )
            if project_id:
                usage_statement = usage_statement.where(
                    EventRecord.project_id == project_id
                )
            if environment:
                usage_statement = usage_statement.where(
                    EventRecord.environment == environment
                )
            if start_date is not None:
                usage_statement = usage_statement.where(
                    EventRecord.timestamp >= start_date.isoformat()
                )
            if end_date is not None:
                usage_statement = usage_statement.where(
                    EventRecord.timestamp < (end_date + timedelta(days=1)).isoformat()
                )
            usage_rows = (await session.execute(usage_statement)).mappings().all()
        usage_by_day = {
            str(row["date"]): {
                "input_tokens": int(row["input_tokens"] or 0),
                "output_tokens": int(row["output_tokens"] or 0),
                "llm_calls": int(row["llm_calls"] or 0),
                "usage_calls": int(row["usage_calls"] or 0),
            }
            for row in usage_rows
        }
        runs_by_day = {str(row["date"]): row for row in rows}
        values = {}
        for day_value in runs_by_day.keys() | usage_by_day.keys():
            run = runs_by_day.get(day_value)
            usage = usage_by_day.get(day_value, {})
            input_count = int(usage.get("input_tokens", 0))
            output_count = int(usage.get("output_tokens", 0))
            values[day_value] = {
                "date": day_value,
                "tokens": input_count + output_count,
                "input_tokens": input_count,
                "output_tokens": output_count,
                "llm_calls": int(usage.get("llm_calls", 0)),
                "usage_calls": int(usage.get("usage_calls", 0)),
                "traces": int(run["traces"] or 0) if run else 0,
                "successful_traces": int(run["successful_traces"] or 0) if run else 0,
            }
        if start_date is None or end_date is None:
            return [values[key] for key in sorted(values)]
        bucket_count = (end_date - start_date).days + 1
        return [
            values.get(
                (start_date + timedelta(days=offset)).isoformat(),
                {
                    "date": (start_date + timedelta(days=offset)).isoformat(),
                    "tokens": 0,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "llm_calls": 0,
                    "usage_calls": 0,
                    "traces": 0,
                    "successful_traces": 0,
                },
            )
            for offset in range(bucket_count)
        ]

    async def get_trace(self, trace_id: str) -> dict[str, Any] | None:
        statement = (
            select(EventRecord)
            .where(EventRecord.trace_id == trace_id)
            .order_by(EventRecord.sequence, EventRecord.timestamp, EventRecord.event_id)
        )
        async with self._sessions() as session:
            records = (await session.scalars(statement)).all()
        if not records:
            return None
        events = [self._decode(record) for record in records]
        return {
            "trace_id": trace_id,
            "project_id": events[0]["project_id"],
            "environment": events[0]["environment"],
            "started_at": events[0]["timestamp"],
            "updated_at": events[-1]["timestamp"],
            "events": events,
        }

    async def stats(self) -> dict[str, int]:
        statement = select(
            func.count(EventRecord.event_id),
            func.count(func.distinct(EventRecord.trace_id)),
        )
        async with self._sessions() as session:
            events, traces = (await session.execute(statement)).one()
        return {"events": int(events), "traces": int(traces)}

    @staticmethod
    def _decode(record: EventRecord) -> dict[str, Any]:
        return {
            "event_id": record.event_id,
            "schema_version": record.schema_version,
            "event_type": record.event_type,
            "trace_id": record.trace_id,
            "span_id": record.span_id,
            "parent_span_id": record.parent_span_id,
            "timestamp": record.timestamp,
            "sequence": record.sequence,
            "project_id": record.project_id,
            "environment": record.environment,
            "source": record.source_json,
            "attributes": record.attributes_json,
            "payload": record.payload_json,
        }

    async def close(self) -> None:
        await self._engine.dispose()
