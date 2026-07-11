"""Optional integration with the standalone gMAS observability product."""

import asyncio
import logging
import threading
import weakref
from typing import Any

from backend.config import settings

logger = logging.getLogger(__name__)
_clients_by_loop: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, Any] = (
    weakref.WeakKeyDictionary()
)
_clients_lock = threading.RLock()
_client: Any | None = None


async def start_observability() -> None:
    global _client
    if not settings.observability_enabled:
        return
    loop = asyncio.get_running_loop()
    with _clients_lock:
        if loop in _clients_by_loop:
            return
    try:
        from gmas_observability import ObservabilityClient, ObservabilityConfig

        client = ObservabilityClient(
            ObservabilityConfig(
                endpoint=settings.observability_endpoint,
                project_id=settings.observability_project,
                environment=settings.observability_environment,
                api_key=settings.observability_api_key,
                timeout_seconds=settings.observability_timeout_seconds,
                capture_content=settings.observability_capture_content,
            ),
            background=False,
        )
        await client.start()
        with _clients_lock:
            _clients_by_loop[loop] = client
            _client = client
    except Exception as exc:  # integration must never block application startup
        logger.warning("Could not initialize gMAS observability: %s", exc)


async def shutdown_observability() -> None:
    global _client
    loop = asyncio.get_running_loop()
    with _clients_lock:
        client = _clients_by_loop.pop(loop, None)
        if client is _client:
            _client = next(iter(_clients_by_loop.values()), None)
    if client is not None:
        await client.aclose()


def _current_client() -> Any | None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    with _clients_lock:
        if loop is not None:
            client = _clients_by_loop.get(loop)
            if client is not None:
                return client
        return _client


def create_observability_callback(run_state: Any) -> Any | None:
    """Create a per-run, fail-open SDK callback when observability is enabled."""
    if not settings.observability_enabled:
        return None
    try:
        from gmas_observability import GMASObservabilityCallback

        client = _current_client()
        if client is None:
            logger.warning("gMAS observability is enabled but has not been started")
            return None
        graph = run_state.graph_data or {}
        attributes = {
            "graph_id": graph.get("graph_id"),
            "graph_name": graph.get("name"),
            "trigger_source": run_state.trigger_source,
            "schedule_id": run_state.schedule_id,
        }
        session_id = getattr(run_state, "session_id", None)
        if session_id:
            attributes["session_id"] = session_id
        return GMASObservabilityCallback(
            client,
            trace_id=run_state.run_id,
            attributes=attributes,
        )
    except Exception as exc:  # integration must never block a workflow
        logger.warning("Could not initialize gMAS observability: %s", exc)
        return None
