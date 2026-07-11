"""Buffered, fail-open telemetry delivery client."""

import asyncio
import inspect
import logging
from dataclasses import dataclass
from typing import Any
from collections.abc import Awaitable, Callable

import httpx

from .models import TelemetryEvent
from .redaction import redact

logger = logging.getLogger(__name__)
BatchTransport = Callable[[list[dict[str, Any]]], Awaitable[None] | None]


@dataclass(frozen=True, slots=True)
class ObservabilityConfig:
    endpoint: str
    project_id: str
    environment: str = "development"
    api_key: str = ""
    timeout_seconds: float = 2.0
    batch_size: int = 50
    queue_size: int = 10_000
    capture_content: bool = True
    max_string_length: int = 32_000


class ObservabilityClient:
    """Deliver telemetry through one asyncio queue and one worker task."""

    def __init__(
        self,
        config: ObservabilityConfig,
        *,
        transport: BatchTransport | None = None,
        background: bool = True,
    ) -> None:
        self.config = config
        self._transport = transport
        self._queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue(
            config.queue_size
        )
        self._closed = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._worker_task: asyncio.Task[None] | None = None
        self._start_task: asyncio.Task[None] | None = None
        self._http_client: httpx.AsyncClient | None = None
        if background:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                pass
            else:
                self._start_task = loop.create_task(self.start())

    async def start(self) -> None:
        """Start the shared delivery worker on the current event loop."""
        if self._closed or self._worker_task is not None:
            return
        loop = asyncio.get_running_loop()
        if self._loop is not None and self._loop is not loop:
            raise RuntimeError("ObservabilityClient cannot move between event loops")
        self._loop = loop
        if self._transport is None:
            await self._ensure_http_client()
        self._worker_task = loop.create_task(self._work(), name="gmas-observability")

    def emit(self, event: TelemetryEvent) -> None:
        """Synchronously enqueue an event without blocking a gMAS callback."""
        if self._closed:
            return
        data = redact(event.to_dict(), max_string_length=self.config.max_string_length)
        loop = self._loop
        if loop is not None and loop.is_running():
            loop.call_soon_threadsafe(self._enqueue, data)
            return
        self._enqueue(data)

    def _enqueue(self, data: dict[str, Any]) -> None:
        try:
            self._queue.put_nowait(data)
        except asyncio.QueueFull:
            logger.warning("gMAS observability queue is full; dropping event")

    def flush(self) -> None:
        self._run_or_schedule(self.flush_async())

    async def flush_async(self) -> None:
        """Deliver all events accepted before this call."""
        await asyncio.sleep(0)
        if self._worker_task is not None:
            await self._queue.join()
            return
        while not self._queue.empty():
            batch = self._drain_batch()
            if not batch:
                break
            await self._safe_send(batch)
            for _ in batch:
                self._queue.task_done()

    def close(self) -> None:
        self._run_or_schedule(self.aclose())

    async def aclose(self) -> None:
        """Flush pending events and release the worker and HTTP client."""
        if self._closed:
            return
        self._closed = True
        if self._start_task is not None and self._worker_task is None:
            await self._start_task
        await self.flush_async()
        if self._worker_task is not None:
            await self._queue.put(None)
            await self._worker_task
            self._worker_task = None
        if self._http_client is not None:
            await self._http_client.aclose()
            self._http_client = None

    async def _work(self) -> None:
        while True:
            first = await self._queue.get()
            if first is None:
                self._queue.task_done()
                return
            batch = [first, *self._drain_batch(self.config.batch_size - 1)]
            await self._safe_send(batch)
            for _ in batch:
                self._queue.task_done()

    def _drain_batch(self, limit: int | None = None) -> list[dict[str, Any]]:
        batch: list[dict[str, Any]] = []
        maximum = limit if limit is not None else self.config.batch_size
        while len(batch) < maximum:
            try:
                item = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            if item is None:
                self._queue.task_done()
                continue
            batch.append(item)
        return batch

    async def _safe_send(self, batch: list[dict[str, Any]]) -> None:
        try:
            transport = self._transport or self._http_transport
            result = transport(batch)
            if inspect.isawaitable(result):
                await result
        except Exception as exc:  # observability must remain fail-open
            logger.warning("Could not deliver gMAS observability batch: %s", exc)

    def _run_or_schedule(self, awaitable: Awaitable[None]) -> None:
        """Bridge sync lifecycle calls without creating helper threads."""
        try:
            running_loop = asyncio.get_running_loop()
        except RuntimeError:
            running_loop = None
        if running_loop is not None:
            if (
                self._loop is not None
                and self._loop is not running_loop
                and self._loop.is_running()
            ):
                asyncio.run_coroutine_threadsafe(awaitable, self._loop)
                return
            running_loop.create_task(awaitable)
            return
        if self._loop is not None and self._loop.is_running():
            future = asyncio.run_coroutine_threadsafe(awaitable, self._loop)
            future.result(timeout=self.config.timeout_seconds + 1.0)
            return
        asyncio.run(awaitable)

    async def _ensure_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(
                timeout=self.config.timeout_seconds,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "gmas-observability/0.1",
                    **(
                        {"Authorization": f"Bearer {self.config.api_key}"}
                        if self.config.api_key
                        else {}
                    ),
                },
            )
        return self._http_client

    async def _http_transport(self, batch: list[dict[str, Any]]) -> None:
        client = await self._ensure_http_client()
        response = await client.post(
            self.config.endpoint.rstrip("/") + "/api/v1/events/batch",
            json={"events": batch},
        )
        response.raise_for_status()
