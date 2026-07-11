"""Execution orchestration: bridges the web API to MACPRunner."""

import asyncio
import contextlib
import operator
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.models.execution import (
    BudgetConfigSchema,
    EarlyStopConditionSchema,
    EarlyStopType,
    ErrorPolicySchema,
    LLMProviderConfig,
    MemoryConfigSchema,
    PruningConfigSchema,
    RunnerConfigSchema,
    TopologyHookSchema,
    TopologyHookType,
)
from backend.services.graph_service import build_gmas_graph
from backend.services.observability_service import create_observability_callback
from backend.services.storage_service import storage
from backend.services.tool_registry_service import build_tool_registry, get_tool_runtime_config
from backend.session import get_current_session_id


class RunState:
    """Tracks a single execution run."""

    def __init__(
        self,
        run_id: str,
        graph_data: dict[str, Any],
        task_query: str,
        *,
        trigger_source: str = "manual",
        schedule_id: str | None = None,
        schedule_name: str | None = None,
        session_id: str | None = None,
    ):
        self.run_id = run_id
        self.graph_data = graph_data
        self.task_query = task_query
        self.trigger_source = trigger_source
        self.schedule_id = schedule_id
        self.schedule_name = schedule_name
        self.session_id = session_id or get_current_session_id()
        self.status: str = "pending"
        self.queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self.task: asyncio.Task | None = None
        self.result: dict[str, Any] | None = None
        self.events: list[dict[str, Any]] = []
        self.started_at: str = datetime.now(UTC).isoformat()
        self.completed_at: str | None = None
        self.cancelled: bool = False
        self.error: str | None = None


# In-memory store for active runs
_active_runs: dict[str, RunState] = {}


def _run_session_id(run: dict[str, Any] | RunState | None) -> str | None:
    if run is None:
        return None
    if isinstance(run, RunState):
        return run.session_id
    value = run.get("session_id")
    return value if isinstance(value, str) else None


def _run_visible_to_current_session(run: dict[str, Any] | RunState | None) -> bool:
    owner = _run_session_id(run)
    return owner == get_current_session_id()


def _describe_exception(exc: Exception) -> str:
    """Build a human-friendly detail string for an execution failure.

    Adds a hint for the most common operator mistakes (bad/missing API key,
    rate limits) so the UI shows something actionable instead of a bare
    exception repr.
    """
    raw = (str(exc) or "").strip()
    lowered = raw.lower()
    cls = exc.__class__.__name__.lower()
    hint = ""
    if (
        "api key" in lowered
        or "api_key" in lowered
        or "unauthor" in lowered
        or "401" in lowered
        or "authenticationerror" in cls
    ):
        hint = "Authentication failed — check the provider API key in Settings → LLM Providers."
    elif "rate limit" in lowered or "429" in lowered or "ratelimit" in cls:
        hint = "Provider rate limit reached — wait and retry, or lower concurrency."
    elif (
        "not found" in lowered
        or "404" in lowered
        or "model" in lowered
        and "exist" in lowered
    ):
        hint = "Model or resource not found — verify the model name for this provider."
    elif "timeout" in lowered or "timed out" in lowered:
        hint = "Request timed out — the provider was slow or unreachable."
    base = raw or exc.__class__.__name__
    return f"{hint} ({base})" if hint else base


def get_active_run(run_id: str) -> RunState | None:
    run_state = _active_runs.get(run_id)
    if run_state is None or not _run_visible_to_current_session(run_state):
        return None
    return run_state


async def start_execution(
    graph_data: dict[str, Any],
    task_query: str,
    config: RunnerConfigSchema | None = None,
    llm_provider: LLMProviderConfig | None = None,
    *,
    trigger_source: str = "manual",
    schedule_id: str | None = None,
    schedule_name: str | None = None,
) -> str:
    """Start an async execution and return the run_id."""
    run_id = str(uuid.uuid4())[:12]
    run_state = RunState(
        run_id=run_id,
        graph_data=graph_data,
        task_query=task_query,
        trigger_source=trigger_source,
        schedule_id=schedule_id,
        schedule_name=schedule_name,
        session_id=get_current_session_id(),
    )
    _active_runs[run_id] = run_state

    run_state.task = asyncio.create_task(
        _run_execution(run_state, config, llm_provider)
    )
    return run_id


async def _run_execution(
    run_state: RunState,
    config_schema: RunnerConfigSchema | None,
    llm_provider: LLMProviderConfig | None,
) -> None:
    """Execute a workflow and stream normalized events to the run queue."""
    run_state.status = "running"

    try:
        from gmas.callbacks import BaseCallbackHandler
        from gmas.execution import LLMCallerFactory, MACPRunner

        # callback handler that pushes events to the WS queue
        class _EventBridge(BaseCallbackHandler):
            """Converts MACPRunner callbacks into event dicts for the frontend."""

            def _emit(self, event: dict[str, Any]) -> None:
                event.setdefault("run_id", run_state.run_id)
                event.setdefault("timestamp", datetime.now(UTC).isoformat())
                event["_seq"] = len(run_state.events)
                run_state.events.append(event)
                run_state.queue.put_nowait(event)

            # Run lifecycle
            def on_run_start(
                self, *, run_id, query, num_agents=0, execution_order=None, **kw
            ):
                self._emit(
                    {
                        "event_type": "run_start",
                        "num_agents": num_agents,
                        "execution_order": execution_order or [],
                        "query": query,
                    }
                )

            def on_run_end(
                self,
                *,
                run_id,
                output,
                success=True,
                error=None,
                total_tokens=0,
                total_time_ms=0.0,
                executed_agents=None,
                **kw,
            ):
                self._emit(
                    {
                        "event_type": "run_end",
                        "final_answer": output,
                        "success": success,
                        "total_tokens": total_tokens,
                        "total_time": total_time_ms / 1000.0,
                        "executed_agents": executed_agents or [],
                        "error": str(error) if error else None,
                    }
                )

            # Agent lifecycle
            def on_agent_start(
                self,
                *,
                run_id,
                agent_id,
                agent_name="",
                step_index=0,
                prompt="",
                predecessors=None,
                **kw,
            ):
                self._emit(
                    {
                        "event_type": "agent_start",
                        "agent_id": agent_id,
                        "agent_name": agent_name,
                        "step_index": step_index,
                        "predecessors": predecessors or [],
                        "prompt_preview": prompt,
                    }
                )

            def on_agent_end(
                self,
                *,
                run_id,
                agent_id,
                output,
                agent_name="",
                step_index=0,
                tokens_used=0,
                duration_ms=0.0,
                is_final=False,
                **kw,
            ):
                self._emit(
                    {
                        "event_type": "agent_output",
                        "agent_id": agent_id,
                        "agent_name": agent_name,
                        "content": output,
                        "tokens_used": tokens_used,
                        "duration_ms": duration_ms,
                        "is_final": is_final,
                    }
                )

            def on_agent_error(
                self,
                error,
                *,
                run_id,
                agent_id,
                error_type="",
                will_retry=False,
                attempt=0,
                max_attempts=0,
                **kw,
            ):
                self._emit(
                    {
                        "event_type": "agent_error",
                        "agent_id": agent_id,
                        "error_type": error_type,
                        "error_message": str(error),
                        "will_retry": will_retry,
                        "attempt": attempt,
                        "max_attempts": max_attempts,
                    }
                )

            # Tool events
            def on_tool_start(
                self, *, run_id, agent_id="", tool_name, action="", arguments=None, **kw
            ):
                self._emit(
                    {
                        "event_type": "tool_call",
                        "agent_id": agent_id,
                        "tool_name": tool_name,
                        "action": action,
                        "arguments": arguments,
                    }
                )

            def on_tool_end(
                self,
                *,
                run_id,
                agent_id="",
                tool_name,
                action="",
                success=True,
                duration_ms=0.0,
                result_summary="",
                output_size=0,
                **kw,
            ):
                self._emit(
                    {
                        "event_type": "tool_end",
                        "agent_id": agent_id,
                        "tool_name": tool_name,
                        "action": action,
                        "success": success,
                        "duration_ms": duration_ms,
                        "result_summary": result_summary,
                    }
                )

            def on_tool_error(
                self,
                *,
                run_id,
                agent_id="",
                tool_name,
                action="",
                error_type="",
                error_message="",
                **kw,
            ):
                self._emit(
                    {
                        "event_type": "tool_error",
                        "agent_id": agent_id,
                        "tool_name": tool_name,
                        "action": action,
                        "error_type": error_type,
                        "error_message": error_message,
                    }
                )

            # Topology / dynamic graph
            def on_topology_changed(
                self,
                *,
                run_id,
                reason,
                old_remaining,
                new_remaining,
                change_count=0,
                **kw,
            ):
                self._emit(
                    {
                        "event_type": "topology_changed",
                        "reason": reason,
                        "old_remaining": old_remaining,
                        "new_remaining": new_remaining,
                        "change_count": change_count,
                    }
                )

            # Prune / fallback
            def on_prune(self, *, run_id, agent_id, reason, **kw):
                self._emit(
                    {
                        "event_type": "prune",
                        "agent_id": agent_id,
                        "reason": reason,
                    }
                )

            def on_fallback(
                self, *, run_id, failed_agent_id, fallback_agent_id, reason="", **kw
            ):
                self._emit(
                    {
                        "event_type": "fallback",
                        "failed_agent_id": failed_agent_id,
                        "fallback_agent_id": fallback_agent_id,
                        "reason": reason,
                    }
                )

            # Parallel execution
            def on_parallel_start(self, *, run_id, agent_ids, group_index=0, **kw):
                self._emit(
                    {
                        "event_type": "parallel_start",
                        "agent_ids": agent_ids,
                        "group_index": group_index,
                    }
                )

            def on_parallel_end(
                self,
                *,
                run_id,
                agent_ids,
                group_index=0,
                successful=None,
                failed=None,
                **kw,
            ):
                self._emit(
                    {
                        "event_type": "parallel_end",
                        "agent_ids": agent_ids,
                        "group_index": group_index,
                        "successful": successful or [],
                        "failed": failed or [],
                    }
                )

            # Memory
            def on_memory_read(
                self, *, run_id, agent_id, entries_count=0, keys=None, **kw
            ):
                self._emit(
                    {
                        "event_type": "memory_read",
                        "agent_id": agent_id,
                        "entries_count": entries_count,
                        "keys": keys or [],
                    }
                )

            def on_memory_write(self, *, run_id, agent_id, key, value_size=0, **kw):
                self._emit(
                    {
                        "event_type": "memory_write",
                        "agent_id": agent_id,
                        "key": key,
                        "value_size": value_size,
                    }
                )

            # Budget
            def on_budget_warning(
                self, *, run_id, budget_type, current, limit, ratio=0.0, **kw
            ):
                self._emit(
                    {
                        "event_type": "budget_warning",
                        "budget_type": budget_type,
                        "current": current,
                        "limit": limit,
                        "ratio": ratio,
                    }
                )

            def on_budget_exceeded(
                self, *, run_id, budget_type, current, limit, action_taken="", **kw
            ):
                self._emit(
                    {
                        "event_type": "budget_exceeded",
                        "budget_type": budget_type,
                        "current": current,
                        "limit": limit,
                        "action_taken": action_taken,
                    }
                )

        handler = _EventBridge()

        def _emit_topology_hook_action(action: Any, ctx: Any) -> None:
            action_types = _topology_action_types(action)
            if not action_types:
                return
            handler._emit(
                {
                    "event_type": "topology_changed",
                    "reason": "topology_hook",
                    "action_types": action_types,
                    "agent_id": getattr(ctx, "agent_id", None),
                    "old_remaining": list(getattr(ctx, "remaining_agents", []) or []),
                    "new_end_agent": getattr(action, "new_end_agent", None),
                }
            )

        # Build graph
        graph_data = dict(run_state.graph_data)
        if run_state.task_query:
            graph_data["task_query"] = run_state.task_query
        graph = build_gmas_graph(graph_data)

        execution_mode = config_schema.execution_mode if config_schema else "round"
        tool_registry = build_tool_registry(get_tool_runtime_config())
        runtime_handlers = _build_callback_handlers(config_schema, run_state.run_id)
        observability_handler = create_observability_callback(run_state)
        if observability_handler is not None:
            runtime_handlers.append(observability_handler)
            if execution_mode == "stream":
                # gMAS stream() emits StreamEvents but does not initialize its
                # callback manager. Proxy the public registry so tool spans are
                # still captured without modifying gMAS.
                tool_registry = observability_handler.wrap_tool_registry(tool_registry)
        callback_handlers = runtime_handlers if execution_mode == "stream" else [handler, *runtime_handlers]
        runner_config = _build_runner_config(
            config_schema,
            callback_handlers,
            tool_registry,
            topology_hook_emit=_emit_topology_hook_action,
        )

        # LLM runtime: global + per-agent callers + factory + structured caller.
        #
        # Resolution order inside MACPRunner:
        #   1. async_llm_callers[agent_id]      — our per-agent tool-aware caller
        #   2. llm_factory.get_async_caller()    — same builder, used for agents
        #                                          that have llm_config but no
        #                                          explicit entry above (multi-
        #                                          model fallback)
        #   3. async_default_caller              — global fallback
        # Structured caller (system/user/tool messages) is handled separately.
        default_provider = llm_provider
        llm_factory = _build_llm_factory(default_provider, LLMCallerFactory)
        async_llm_callers = _build_agent_async_callers(graph_data, default_provider)
        async_structured_llm_caller = _build_async_structured_caller(
            default_provider, graph_data
        )
        async_default_caller = _build_async_text_caller(default_provider, graph_data)
        if observability_handler is not None:
            provider_name = getattr(default_provider, "provider_type", None)
            default_model = getattr(default_provider, "default_model", None)
            async_default_caller = observability_handler.wrap_async_llm(
                async_default_caller, model=default_model, provider=provider_name
            )
            async_structured_llm_caller = observability_handler.wrap_async_llm(
                async_structured_llm_caller, model=default_model, provider=provider_name
            )
            agent_models = {
                str(agent.get("agent_id")): (agent.get("llm_config") or {}).get(
                    "model_name"
                )
                for agent in graph_data.get("agents", [])
                if agent.get("agent_id")
            }
            async_llm_callers = {
                agent_id: observability_handler.wrap_async_llm(
                    caller,
                    agent_id=agent_id,
                    model=agent_models.get(agent_id) or default_model,
                    provider=provider_name,
                )
                for agent_id, caller in async_llm_callers.items()
            }
        # Keep gMAS `astream()` for lifecycle events, but do not pass a token
        # streaming LLM caller here. The vendor stream path does not wrap
        # `async_streaming_llm_caller` in the runner timeout; providers that
        # hang on SSE can otherwise leave the whole pipeline stuck at
        # `agent_start`. The normal async caller path below is timeout-bound
        # and still emits agent output events through `astream()`.
        async_streaming_caller = None

        runner = MACPRunner(
            async_llm_caller=async_default_caller,
            async_llm_callers=async_llm_callers,
            llm_factory=llm_factory,
            async_structured_llm_caller=async_structured_llm_caller,
            async_streaming_llm_caller=async_streaming_caller,
            tool_registry=tool_registry,
            config=runner_config,
        )

        if execution_mode == "stream":
            await _run_with_stream_api(
                runner,
                graph,
                run_state,
                observability_handler=observability_handler,
            )
            _normalize_run_end_event(run_state.events)
        else:
            result = await runner.arun_round(graph)
            if result.early_stopped:
                handler._emit(
                    {
                        "event_type": "early_stop",
                        "reason": result.early_stop_reason or "Early stop triggered",
                    }
                )
            _normalize_run_end_event(run_state.events, early_stopped=bool(result.early_stopped))

        run_state.status = "completed"
        run_state.completed_at = datetime.now(UTC).isoformat()

        # Extract final result from last run_end event
        for ev in reversed(run_state.events):
            if ev.get("event_type") == "run_end":
                run_state.result = ev
                break

    except asyncio.CancelledError:
        run_state.status = "cancelled"
        cancel_event = {
            "event_type": "cancelled",
            "run_id": run_state.run_id,
            "timestamp": datetime.now(UTC).isoformat(),
            "_seq": len(run_state.events),
        }
        run_state.events.append(cancel_event)
        await run_state.queue.put(cancel_event)
    except Exception as exc:
        run_state.status = "error"
        # Some SDK/auth exceptions stringify to "" — fall back to the class name
        # so the UI never shows an empty error. Keep the type for context.
        message = str(exc).strip() or exc.__class__.__name__
        error_event = {
            "event_type": "error",
            "run_id": run_state.run_id,
            "error": message,
            "error_type": exc.__class__.__name__,
            "error_detail": _describe_exception(exc),
            "timestamp": datetime.now(UTC).isoformat(),
        }
        run_state.error = message
        error_event["_seq"] = len(run_state.events)
        run_state.events.append(error_event)
        await run_state.queue.put(error_event)
    finally:
        for cb in locals().get("runtime_handlers", []):
            close = getattr(cb, "close", None)
            if callable(close):
                with contextlib.suppress(Exception):
                    close()
        run_state.completed_at = run_state.completed_at or datetime.now(UTC).isoformat()
        await run_state.queue.put(None)  # Sentinel
        _persist_run(run_state)
        _active_runs.pop(run_state.run_id, None)


async def _run_with_stream_api(
    runner: Any,
    graph: Any,
    run_state: RunState,
    *,
    observability_handler: Any | None = None,
) -> None:
    """Run via `astream()` and forward stream events to websocket queue."""
    async for stream_event in runner.astream(graph):
        payload = _serialize_stream_event(stream_event, run_state.run_id)
        payload["_seq"] = len(run_state.events)
        run_state.events.append(payload)
        await run_state.queue.put(payload)
        if observability_handler is not None:
            # gMAS stream mode exposes StreamEvent objects rather than invoking
            # callback lifecycle methods, so the SDK normalizes them here.
            observability_handler.capture_stream_event(payload)


def _serialize_stream_event(stream_event: Any, run_id: str) -> dict[str, Any]:
    """Normalize gMAS StreamEvent objects to web event payloads.

    NOTE: gMAS' base ``StreamEvent.to_dict()`` only emits base fields and
    drops subclass-specific data (``agent_id``, ``tokens_used``, ``error_message``
    etc). We prefer ``model_dump()`` so the full subclass payload survives,
    falling back to ``to_dict()`` for non-pydantic events and finally a string
    representation for unknown shapes.
    """
    if hasattr(stream_event, "model_dump"):
        try:
            payload = stream_event.model_dump(mode="json")
        except Exception:
            payload = stream_event.to_dict() if hasattr(stream_event, "to_dict") else {}
    elif hasattr(stream_event, "to_dict"):
        payload = stream_event.to_dict()
    elif isinstance(stream_event, dict):
        payload = dict(stream_event)
    else:
        payload = {
            "event_type": getattr(stream_event, "event_type", "event"),
            "content": str(stream_event),
        }

    payload.setdefault("event_type", getattr(stream_event, "event_type", "event"))
    payload["run_id"] = run_id

    ts = payload.get("timestamp")
    if hasattr(ts, "isoformat"):
        payload["timestamp"] = ts.isoformat()
    elif ts is None:
        payload["timestamp"] = datetime.now(UTC).isoformat()

    return payload


def _build_callback_handlers(
    config_schema: RunnerConfigSchema | None, run_id: str
) -> list[Any]:
    modes = set(config_schema.callback_modes if config_schema else [])
    if not modes:
        return []

    from gmas.callbacks import (
        FileCallbackHandler,
        MetricsCallbackHandler,
        StdoutCallbackHandler,
    )

    handlers: list[Any] = []
    if "stdout" in modes:
        handlers.append(
            StdoutCallbackHandler(color=False, show_prompts=False, show_outputs=False)
        )
    if "metrics" in modes:
        handlers.append(MetricsCallbackHandler())
    if "file" in modes:
        log_path = Path(settings.data_dir) / "runs" / f"{run_id}.jsonl"
        handlers.append(FileCallbackHandler(log_path, append=True))
    return handlers


def _resolve_api_key(value: str | None) -> str:
    if not value:
        return ""
    value = value.strip()
    if value.startswith("$"):
        return os.environ.get(value[1:], "").strip()
    return value


class _ProviderTextResult(str):
    """A string result that preserves non-content provider token usage."""

    def __new__(cls, value: str, usage: Any = None):
        instance = super().__new__(cls, value)
        instance.usage = usage
        return instance


def _build_async_openai_tools_caller(
    *,
    base_url: str,
    api_key: str,
    model: str,
    temperature: float,
    max_tokens: int,
    timeout: float,
    top_p: float | None,
    top_k: int | None,
    tool_calling_enabled: bool,
    tool_choice: str,
    parallel_tool_calls: bool | None,
    extra_params: dict[str, Any] | None = None,
):
    from openai import AsyncOpenAI
    from gmas.tools import parse_openai_response

    client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=timeout)

    async def _caller(
        prompt: str | list[dict[str, str]], tools: list[dict[str, Any]] | None = None
    ):
        messages = (
            prompt
            if isinstance(prompt, list)
            else [{"role": "user", "content": prompt}]
        )
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if top_p is not None:
            kwargs["top_p"] = top_p
        extra_body: dict[str, Any] = {}
        if extra_params and "api.openai.com" not in base_url:
            extra_body.update(extra_params)
        if top_k is not None and "api.openai.com" not in base_url:
            extra_body["top_k"] = top_k
        if extra_body:
            kwargs["extra_body"] = extra_body
        if tools and tool_calling_enabled:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = tool_choice
            if parallel_tool_calls is not None:
                kwargs["parallel_tool_calls"] = parallel_tool_calls

        response = await client.chat.completions.create(**kwargs)
        if tools and tool_calling_enabled:
            return parse_openai_response(response)
        message = response.choices[0].message
        content = message.content or getattr(message, "reasoning_content", None) or ""
        return _ProviderTextResult(content, getattr(response, "usage", None))

    _caller.supports_structured = True  # type: ignore[attr-defined]
    return _caller


def _provider_defaults(provider: LLMProviderConfig | None) -> dict[str, Any]:
    if provider is None:
        return {
            "base_url": "https://api.openai.com/v1",
            "api_key": "",
            "model": "gpt-4o-mini",
            "temperature": 0.2,
            "max_tokens": 2000,
            "timeout": 180.0,
            "top_p": None,
            "top_k": None,
            "tool_calling_enabled": True,
            "tool_choice": "auto",
            "parallel_tool_calls": None,
            "extra_params": {},
        }

    return {
        "base_url": _normalize_base_url(provider.base_url or ""),
        "api_key": _resolve_api_key(provider.api_key),
        "model": provider.default_model or "gpt-4o-mini",
        "temperature": 0.2,
        "max_tokens": 2000,
        "timeout": 180.0,
        "top_p": None,
        "top_k": None,
        "tool_calling_enabled": True,
        "tool_choice": "auto",
        "parallel_tool_calls": None,
        "extra_params": {},
    }


def _normalize_base_url(base_url: str) -> str:
    if not base_url:
        return base_url
    url = base_url.rstrip("/")
    if url.endswith("/chat/completions"):
        url = url[: -len("/chat/completions")]
        url = url.rstrip("/")
    from urllib.parse import urlparse

    path = urlparse(url).path
    if path in ("", "/"):
        return f"{url}/v1"
    return url


def _agent_llm_settings(
    agent: dict[str, Any], provider: LLMProviderConfig | None
) -> dict[str, Any]:
    defaults = _provider_defaults(provider)
    llm_cfg = agent.get("llm_config") or {}

    model_name = (
        llm_cfg.get("model_name") or agent.get("llm_backbone") or defaults["model"]
    )
    if provider is not None:
        # Workflow-level provider: same credentials for every agent; per-agent model stays.
        api_key = defaults["api_key"]
        base_url = _normalize_base_url(defaults["base_url"])
    else:
        api_key = _resolve_api_key(llm_cfg.get("api_key") or defaults["api_key"])
        base_url = _normalize_base_url(llm_cfg.get("base_url") or defaults["base_url"])

    return {
        "model": model_name,
        "api_key": api_key,
        "base_url": base_url,
        "temperature": float(
            llm_cfg.get("temperature")
            if llm_cfg.get("temperature") is not None
            else defaults["temperature"]
        ),
        "max_tokens": int(
            llm_cfg.get("max_tokens")
            if llm_cfg.get("max_tokens") is not None
            else defaults["max_tokens"]
        ),
        "timeout": float(
            llm_cfg.get("timeout")
            if llm_cfg.get("timeout") is not None
            else defaults["timeout"]
        ),
        "top_p": llm_cfg.get("top_p", defaults["top_p"]),
        "top_k": llm_cfg.get("top_k", defaults["top_k"]),
        "tool_calling_enabled": bool(
            llm_cfg.get("tool_calling_enabled")
            if llm_cfg.get("tool_calling_enabled") is not None
            else defaults["tool_calling_enabled"]
        ),
        "tool_choice": llm_cfg.get("tool_choice") or defaults["tool_choice"],
        "parallel_tool_calls": llm_cfg.get(
            "parallel_tool_calls", defaults["parallel_tool_calls"]
        ),
        "extra_params": llm_cfg.get("extra_params") or defaults["extra_params"],
    }


def _first_agent_settings_with_api_key(
    graph_data: dict[str, Any], provider: LLMProviderConfig | None
) -> dict[str, Any] | None:
    for agent in graph_data.get("agents", []):
        cfg = _agent_llm_settings(agent, provider)
        if cfg["api_key"]:
            return cfg
    return None


def _build_async_text_caller(
    provider: LLMProviderConfig | None, graph_data: dict[str, Any] | None = None
):
    settings = _provider_defaults(provider)
    api_key = settings["api_key"]
    if not api_key and graph_data is not None:
        fallback = _first_agent_settings_with_api_key(graph_data, provider)
        if fallback is not None:
            settings = fallback
            api_key = fallback["api_key"]

    if not api_key:

        async def _mock_caller(prompt: str) -> str:
            return f"[Mock LLM Response] Received prompt of {len(prompt)} characters."

        return _mock_caller

    try:
        return _build_async_openai_tools_caller(
            base_url=settings["base_url"],
            api_key=api_key,
            model=settings["model"],
            temperature=settings["temperature"],
            max_tokens=settings["max_tokens"],
            timeout=settings["timeout"],
            top_p=settings["top_p"],
            top_k=settings["top_k"],
            tool_calling_enabled=settings["tool_calling_enabled"],
            tool_choice=settings["tool_choice"],
            parallel_tool_calls=settings["parallel_tool_calls"],
            extra_params=settings["extra_params"],
        )
    except Exception:

        async def _fallback(
            prompt: Any, tools: list[dict[str, Any]] | None = None
        ) -> str:
            _ = tools
            if isinstance(prompt, list):
                text_len = sum(
                    len(str(m.get("content", "")))
                    for m in prompt
                    if isinstance(m, dict)
                )
            else:
                text_len = len(str(prompt))
            return f"[LLM unavailable] Prompt length: {text_len}"

        return _fallback


def _build_async_streaming_text_caller(
    provider: LLMProviderConfig | None,
    graph_data: dict[str, Any] | None = None,
):
    """Build a token streaming caller for gMAS astream().

    The gMAS streaming hook accepts only ``prompt -> async iterator[token]`` and
    does not receive agent/tool context. We therefore use it as a pure LLM
    streaming path; tool-enabled agents keep the normal tool-aware caller.
    """
    settings = _provider_defaults(provider)
    api_key = settings["api_key"]
    if not api_key and graph_data is not None:
        fallback = _first_agent_settings_with_api_key(graph_data, provider)
        if fallback is not None:
            settings = fallback
            api_key = fallback["api_key"]

    if not api_key:
        return None

    async def _stream(prompt: str):
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            api_key=api_key, base_url=settings["base_url"], timeout=settings["timeout"]
        )
        fallback_caller = _build_async_openai_tools_caller(
            base_url=settings["base_url"],
            api_key=api_key,
            model=settings["model"],
            temperature=settings["temperature"],
            max_tokens=settings["max_tokens"],
            timeout=settings["timeout"],
            top_p=settings["top_p"],
            top_k=settings["top_k"],
            tool_calling_enabled=False,
            tool_choice="none",
            parallel_tool_calls=None,
            extra_params=settings["extra_params"],
        )
        first_token_timeout = min(float(settings["timeout"]), 15.0)
        per_token_timeout = min(float(settings["timeout"]), 30.0)
        emitted = False

        try:
            stream = await asyncio.wait_for(
                client.chat.completions.create(
                    model=settings["model"],
                    messages=[{"role": "user", "content": prompt}],
                    temperature=settings["temperature"],
                    max_tokens=settings["max_tokens"],
                    stream=True,
                ),
                timeout=first_token_timeout,
            )
            iterator = stream.__aiter__()
            while True:
                try:
                    chunk = await asyncio.wait_for(
                        iterator.__anext__(),
                        timeout=per_token_timeout if emitted else first_token_timeout,
                    )
                except StopAsyncIteration:
                    break

                if not chunk.choices:
                    continue
                delta_obj = chunk.choices[0].delta
                delta = delta_obj.content or getattr(
                    delta_obj, "reasoning_content", None
                )
                if delta:
                    emitted = True
                    yield delta
        except Exception:
            if emitted:
                return

        if not emitted:
            text = await asyncio.wait_for(
                fallback_caller(prompt), timeout=float(settings["timeout"])
            )
            if text:
                yield text

    return _stream


def _build_async_structured_caller(
    provider: LLMProviderConfig | None, graph_data: dict[str, Any] | None = None
):
    settings = _provider_defaults(provider)
    api_key = settings["api_key"]
    if not api_key and graph_data is not None:
        fallback = _first_agent_settings_with_api_key(graph_data, provider)
        if fallback is not None:
            settings = fallback
            api_key = fallback["api_key"]

    if not api_key:
        return None

    try:
        base_caller = _build_async_openai_tools_caller(
            base_url=settings["base_url"],
            api_key=api_key,
            model=settings["model"],
            temperature=settings["temperature"],
            max_tokens=settings["max_tokens"],
            timeout=settings["timeout"],
            top_p=settings["top_p"],
            top_k=settings["top_k"],
            tool_calling_enabled=settings["tool_calling_enabled"],
            tool_choice=settings["tool_choice"],
            parallel_tool_calls=settings["parallel_tool_calls"],
            extra_params=settings["extra_params"],
        )
    except Exception:
        return None

    async def structured_caller(messages: list[dict[str, str]]) -> str:
        return await base_caller(messages)

    return structured_caller


def _build_llm_factory(provider: LLMProviderConfig | None, llm_factory_cls: Any):
    """Build an LLMCallerFactory whose async builder produces our
    tool-aware OpenAI-compatible caller.

    This keeps multi-model support working — when an agent has its own
    `llm_config` but no entry in `async_llm_callers`, the runner falls
    through to the factory and gets a caller built with the same code
    path as our explicit callers (honoring tool_calling_enabled,
    tool_choice, top_k, parallel_tool_calls, extra_params).
    """
    settings = _provider_defaults(provider)
    if not settings["api_key"]:
        return None

    from gmas.core.agent import AgentLLMConfig as _CoreAgentLLMConfig

    default_cfg = _CoreAgentLLMConfig(
        model_name=settings["model"],
        base_url=settings["base_url"],
        api_key=settings["api_key"],
        temperature=settings["temperature"],
        max_tokens=settings["max_tokens"],
        timeout=settings["timeout"],
        top_p=settings["top_p"],
    )

    def _async_builder(config: Any):
        # Workflow provider credentials apply to every agent; per-agent model/tuning stay.
        if provider is not None:
            api_key = settings["api_key"]
            base_url = settings["base_url"]
        else:
            api_key = (
                config.resolve_api_key() if hasattr(config, "resolve_api_key") else None
            ) or settings["api_key"]
            base_url = (config.base_url if config else None) or settings["base_url"]
        model = (config.model_name if config else None) or settings["model"]
        temperature = (
            config.temperature
            if (config and config.temperature is not None)
            else settings["temperature"]
        )
        max_tokens = (
            config.max_tokens
            if (config and config.max_tokens is not None)
            else settings["max_tokens"]
        )
        timeout = (
            config.timeout
            if (config and config.timeout is not None)
            else settings["timeout"]
        )
        top_p = (
            config.top_p if (config and config.top_p is not None) else settings["top_p"]
        )
        extra = dict(getattr(config, "extra_params", None) or {})
        top_k = extra.pop("top_k", settings.get("top_k"))
        tool_choice = extra.pop("tool_choice", settings.get("tool_choice", "auto"))
        tool_calling_enabled = extra.pop(
            "tool_calling_enabled", settings.get("tool_calling_enabled", True)
        )
        parallel_tool_calls = extra.pop(
            "parallel_tool_calls", settings.get("parallel_tool_calls")
        )

        return _build_async_openai_tools_caller(
            base_url=_normalize_base_url(base_url),
            api_key=api_key,
            model=model,
            temperature=float(temperature),
            max_tokens=int(max_tokens),
            timeout=float(timeout),
            top_p=top_p,
            top_k=top_k,
            tool_calling_enabled=bool(tool_calling_enabled),
            tool_choice=str(tool_choice),
            parallel_tool_calls=parallel_tool_calls,
            extra_params=extra or None,
        )

    return llm_factory_cls(
        default_config=default_cfg,
        async_caller_builder=_async_builder,
        # No sync builder — runner uses async path in our backend.
    )


def _build_agent_async_callers(
    graph_data: dict[str, Any], provider: LLMProviderConfig | None
) -> dict[str, Any]:
    """Build explicit per-agent async callers (multi-model mode)."""
    callers: dict[str, Any] = {}

    for agent in graph_data.get("agents", []):
        agent_id = agent.get("agent_id")
        if not agent_id:
            continue

        settings = _agent_llm_settings(agent, provider)
        if not settings["api_key"]:
            continue

        with contextlib.suppress(Exception):
            text_caller = _build_async_openai_tools_caller(
                base_url=settings["base_url"],
                api_key=settings["api_key"],
                model=settings["model"],
                temperature=settings["temperature"],
                max_tokens=settings["max_tokens"],
                timeout=settings["timeout"],
                top_p=settings["top_p"],
                top_k=settings["top_k"],
                tool_calling_enabled=settings["tool_calling_enabled"],
                tool_choice=settings["tool_choice"],
                parallel_tool_calls=settings["parallel_tool_calls"],
                extra_params=settings["extra_params"],
            )
            callers[agent_id] = text_caller

    return callers


def _build_budget_config(schema: BudgetConfigSchema | None):
    if schema is None:
        return None

    from gmas.execution import BudgetConfig

    return BudgetConfig(
        total_token_limit=schema.total_token_limit,
        total_request_limit=schema.total_request_limit,
        total_time_limit_seconds=schema.total_time_limit_seconds,
        node_token_limit=schema.node_token_limit,
        node_request_limit=schema.node_request_limit,
        node_time_limit_seconds=schema.node_time_limit_seconds,
        max_prompt_length=schema.max_prompt_length,
        max_response_length=schema.max_response_length,
        warn_at_usage_ratio=schema.warn_at_usage_ratio,
    )


def _build_memory_config(schema: MemoryConfigSchema | None):
    if schema is None:
        return None

    from gmas.execution import MemoryConfig

    return MemoryConfig(
        working_max_entries=schema.working_max_entries,
        working_default_ttl=schema.working_default_ttl,
        long_term_max_entries=schema.long_term_max_entries,
        long_term_default_ttl=schema.long_term_default_ttl,
        auto_compress=schema.auto_compress,
        promote_after_accesses=schema.promote_after_accesses,
        demote_inactive_after=schema.demote_inactive_after,
        cleanup_interval=schema.cleanup_interval,
        hidden_state_dim=schema.hidden_state_dim,
    )


def _build_pruning_config(schema: PruningConfigSchema | None):
    if schema is None:
        return None

    from gmas.execution import PruningConfig

    return PruningConfig(
        min_weight_threshold=schema.min_weight_threshold,
        min_probability_threshold=schema.min_probability_threshold,
        max_consecutive_errors=schema.max_consecutive_errors,
        skip_on_predecessor_failure=schema.skip_on_predecessor_failure,
        token_budget=schema.token_budget,
        min_quality_threshold=schema.min_quality_threshold,
        enable_fallback=schema.enable_fallback,
        max_fallback_attempts=schema.max_fallback_attempts,
    )


def _build_error_policy(schema: ErrorPolicySchema | None):
    if schema is None:
        return None

    from gmas.execution import ErrorPolicy

    return ErrorPolicy(
        on_timeout=schema.on_timeout,
        on_retry_exhausted=schema.on_retry_exhausted,
        on_budget_exceeded=schema.on_budget_exceeded,
        on_agent_not_found=schema.on_agent_not_found,
        on_validation_error=schema.on_validation_error,
        on_unknown_error=schema.on_unknown_error,
        max_skipped_agents=schema.max_skipped_agents,
        abort_on_critical_path=schema.abort_on_critical_path,
    )


def _build_early_stop_condition(schema: EarlyStopConditionSchema):
    from gmas.execution.runner import EarlyStopCondition

    if schema.type == EarlyStopType.KEYWORD and schema.keyword:
        return EarlyStopCondition.on_keyword(schema.keyword, reason=schema.reason)

    if schema.type == EarlyStopType.TOKEN_LIMIT and schema.max_tokens:
        return EarlyStopCondition.on_token_limit(
            schema.max_tokens, reason=schema.reason
        )

    if schema.type == EarlyStopType.AGENT_COUNT and schema.max_agents:
        return EarlyStopCondition.on_agent_count(
            schema.max_agents, reason=schema.reason
        )

    if schema.type == EarlyStopType.METADATA and schema.metadata_key:
        comparator_map = {
            "eq": operator.eq,
            "ne": operator.ne,
            "gt": operator.gt,
            "gte": operator.ge,
            "lt": operator.lt,
            "lte": operator.le,
            "contains": lambda a, b: b in a if hasattr(a, "__contains__") else False,
        }
        cmp_func = comparator_map.get(
            schema.metadata_comparator.value if schema.metadata_comparator else "eq"
        )
        return EarlyStopCondition.on_metadata(
            key=schema.metadata_key,
            value=schema.metadata_value,
            comparator=cmp_func,
            reason=schema.reason,
        )

    if schema.type == EarlyStopType.CUSTOM and schema.custom_predicate:
        pred = schema.custom_predicate

        def _predicate(ctx):
            response_text = (ctx.response or "").lower()
            if pred == "response_contains" and schema.keyword:
                return schema.keyword.lower() in response_text
            if pred == "response_not_contains" and schema.keyword:
                return schema.keyword.lower() not in response_text
            if pred == "has_any_error":
                return bool(ctx.metadata.get("errors")) or bool(
                    ctx.step_result and getattr(ctx.step_result, "error", None)
                )
            if pred == "all_steps_success":
                return bool(ctx.execution_order) and not bool(
                    ctx.metadata.get("errors")
                )
            return False

        return EarlyStopCondition.on_custom(
            _predicate, reason=schema.reason or "Custom condition met"
        )

    if (
        schema.type in (EarlyStopType.COMBINE_ANY, EarlyStopType.COMBINE_ALL)
        and schema.conditions
    ):
        child_conditions = [
            c
            for c in (_build_early_stop_condition(child) for child in schema.conditions)
            if c is not None
        ]
        if not child_conditions:
            return None
        if schema.type == EarlyStopType.COMBINE_ANY:
            return EarlyStopCondition.combine_any(
                child_conditions, reason=schema.reason or "One of conditions met"
            )
        return EarlyStopCondition.combine_all(
            child_conditions, reason=schema.reason or "All conditions met"
        )

    return None


def _build_early_stop_conditions(schemas: list[EarlyStopConditionSchema]) -> list[Any]:
    return [
        cond
        for cond in (_build_early_stop_condition(schema) for schema in schemas)
        if cond is not None
    ]


def _topology_action_types(action: Any) -> list[str]:
    types: list[str] = []
    if getattr(action, "early_stop", False):
        types.append("early_stop")
    if getattr(action, "add_edges", None):
        types.append("add_edges")
    if getattr(action, "remove_edges", None):
        types.append("remove_edges")
    if getattr(action, "skip_agents", None):
        types.append("skip_agents")
    if getattr(action, "force_agents", None):
        types.append("force_agents")
    if getattr(action, "condition_skip_agents", None):
        types.append("condition_skip_agents")
    if getattr(action, "condition_unskip_agents", None):
        types.append("condition_unskip_agents")
    if getattr(action, "insert_chains", None):
        types.append("insert_chains")
    if getattr(action, "new_end_agent", None):
        types.append("new_end_agent")
    if getattr(action, "trigger_rebuild", False):
        types.append("trigger_rebuild")
    return types


def _wrap_async_topology_hook(hook: Any, on_action: Any) -> Any:
    async def wrapped(ctx: Any, graph: Any) -> Any:
        action = await hook(ctx, graph)
        if action is not None:
            on_action(action, ctx)
        return action

    return wrapped


def _normalize_run_end_event(events: list[dict[str, Any]], *, early_stopped: bool = False) -> None:
    """Align run_end.success with API completed status for intentional early stop / skip."""
    run_end: dict[str, Any] | None = None
    for event in reversed(events):
        if event.get("event_type") == "run_end":
            run_end = event
            break
    if run_end is None:
        return

    has_early_stop = early_stopped or any(ev.get("event_type") == "early_stop" for ev in events)
    if has_early_stop and not run_end.get("error"):
        run_end["success"] = True
        run_end["outcome"] = "early_stop"
        run_end["early_stopped"] = True
    elif run_end.get("success") is False and not run_end.get("error"):
        run_end["outcome"] = "partial"
    elif run_end.get("success") is True:
        run_end.setdefault("outcome", "completed")


def _build_topology_hooks(
    schemas: list[TopologyHookSchema],
    *,
    on_hook_action: Any | None = None,
) -> list[Any]:
    """Convert UI topology-hook schemas into async hook callables."""
    if not schemas:
        return []

    from gmas.execution.runner import TopologyAction

    hooks = []
    for s in schemas:
        if s.type == TopologyHookType.STOP_ON_KEYWORD and s.keyword:
            kw = s.keyword

            async def _stop_hook(ctx, _graph, _kw=kw):
                if _kw.lower() in (ctx.response or "").lower():
                    return TopologyAction(
                        early_stop=True, early_stop_reason=f"Keyword '{_kw}' found"
                    )
                return None

            hooks.append(_stop_hook)

        elif s.type == TopologyHookType.SKIP_ON_TOKEN_BUDGET and s.token_threshold:
            threshold = s.token_threshold

            async def _budget_hook(ctx, _graph, _th=threshold):
                if ctx.total_tokens > _th:
                    return TopologyAction(skip_agents=list(ctx.remaining_agents))
                return None

            hooks.append(_budget_hook)

        elif s.type == TopologyHookType.FORCE_REVIEWER_ON_ERROR and s.reviewer_agent_id:
            reviewer = s.reviewer_agent_id

            async def _reviewer_hook(ctx, _graph, _rev=reviewer):
                if ctx.step_result and not getattr(ctx.step_result, "success", True):
                    return TopologyAction(force_agents=[_rev])
                return None

            hooks.append(_reviewer_hook)

        elif (
            s.type == TopologyHookType.INSERT_CHAIN_ON_KEYWORD
            and s.keyword
            and s.source_agent
            and s.target_agent
        ):
            kw, src, tgt = s.keyword, s.source_agent, s.target_agent

            async def _insert_hook(ctx, _graph, _kw=kw, _src=src, _tgt=tgt):
                if _kw.lower() in (ctx.response or "").lower():
                    return TopologyAction(insert_chains=[(_src, _tgt)])
                return None

            hooks.append(_insert_hook)

        elif (
            s.type == TopologyHookType.ADD_EDGE_ON_KEYWORD
            and s.keyword
            and s.source_agent
            and s.target_agent
        ):
            kw, src, tgt, w = s.keyword, s.source_agent, s.target_agent, s.weight

            async def _add_edge_hook(ctx, _graph, _kw=kw, _src=src, _tgt=tgt, _w=w):
                if _kw.lower() in (ctx.response or "").lower():
                    return TopologyAction(add_edges=[(_src, _tgt, _w)])
                return None

            hooks.append(_add_edge_hook)

        elif (
            s.type == TopologyHookType.REMOVE_EDGE_ON_KEYWORD
            and s.keyword
            and s.source_agent
            and s.target_agent
        ):
            kw, src, tgt = s.keyword, s.source_agent, s.target_agent

            async def _remove_edge_hook(ctx, _graph, _kw=kw, _src=src, _tgt=tgt):
                if _kw.lower() in (ctx.response or "").lower():
                    return TopologyAction(remove_edges=[(_src, _tgt)])
                return None

            hooks.append(_remove_edge_hook)

        elif (
            s.type == TopologyHookType.REDIRECT_END_ON_KEYWORD
            and s.keyword
            and s.target_agent
        ):
            kw, tgt = s.keyword, s.target_agent

            async def _redirect_hook(ctx, _graph, _kw=kw, _tgt=tgt):
                if _kw.lower() in (ctx.response or "").lower():
                    remaining = list(ctx.remaining_agents or [])
                    skip = [agent_id for agent_id in remaining if agent_id != _tgt]
                    return TopologyAction(
                        new_end_agent=_tgt,
                        skip_agents=skip,
                        force_agents=[_tgt] if _tgt not in (ctx.execution_order or []) else [],
                    )
                return None

            hooks.append(_redirect_hook)

        elif (
            s.type == TopologyHookType.SKIP_AGENT_ON_KEYWORD
            and s.keyword
            and s.target_agent
        ):
            kw, tgt = s.keyword, s.target_agent

            async def _skip_hook(ctx, _graph, _kw=kw, _tgt=tgt):
                if _kw.lower() in (ctx.response or "").lower():
                    return TopologyAction(skip_agents=[_tgt])
                return None

            hooks.append(_skip_hook)

        elif (
            s.type == TopologyHookType.CONDITION_SKIP_AGENT_ON_KEYWORD
            and s.keyword
            and s.target_agent
        ):
            kw, tgt = s.keyword, s.target_agent

            async def _condition_skip_hook(ctx, _graph, _kw=kw, _tgt=tgt):
                if _kw.lower() in (ctx.response or "").lower():
                    return TopologyAction(condition_skip_agents=[_tgt])
                return None

            hooks.append(_condition_skip_hook)

        elif (
            s.type == TopologyHookType.CONDITION_UNSKIP_AGENT_ON_KEYWORD
            and s.keyword
            and s.target_agent
        ):
            kw, tgt = s.keyword, s.target_agent

            async def _condition_unskip_hook(ctx, _graph, _kw=kw, _tgt=tgt):
                if _kw.lower() in (ctx.response or "").lower():
                    return TopologyAction(condition_unskip_agents=[_tgt])
                return None

            hooks.append(_condition_unskip_hook)

        elif s.type == TopologyHookType.TRIGGER_REBUILD_ON_KEYWORD and s.keyword:
            kw = s.keyword

            async def _trigger_rebuild_hook(ctx, _graph, _kw=kw):
                if _kw.lower() in (ctx.response or "").lower():
                    return TopologyAction(trigger_rebuild=True)
                return None

            hooks.append(_trigger_rebuild_hook)

    if on_hook_action:
        return [_wrap_async_topology_hook(hook, on_hook_action) for hook in hooks]
    return hooks


def _build_runner_config(
    config_schema: RunnerConfigSchema | None,
    callbacks: list[Any],
    tool_registry: Any,
    *,
    topology_hook_emit: Any | None = None,
):
    """Build gMAS RunnerConfig from API schema."""
    from gmas.execution import ErrorPolicy, RoutingPolicy, RunnerConfig

    if config_schema is None:
        # Slow reasoning models need a generous per-agent budget even when the
        # caller did not send an explicit config.
        return RunnerConfig(
            timeout=180.0, callbacks=callbacks, tool_registry=tool_registry
        )

    early_stops = _build_early_stop_conditions(config_schema.early_stop_conditions)
    topo_hooks = _build_topology_hooks(
        config_schema.topology_hooks or [],
        on_hook_action=topology_hook_emit,
    )
    enable_dyn = config_schema.enable_dynamic_topology or bool(early_stops) or bool(topo_hooks)

    routing_policy = RoutingPolicy.TOPOLOGICAL
    with contextlib.suppress(Exception):
        routing_policy = RoutingPolicy(config_schema.routing_policy)

    # Guard against tiny/zero per-agent timeouts: slow reasoning models need a
    # generous budget, and a 0 here would make every agent time out instantly.
    effective_timeout = config_schema.timeout
    if not effective_timeout or effective_timeout < 60:
        effective_timeout = 180.0

    return RunnerConfig(
        timeout=effective_timeout,
        adaptive=config_schema.adaptive,
        enable_parallel=config_schema.enable_parallel,
        max_parallel_size=config_schema.max_parallel_size,
        max_retries=config_schema.max_retries,
        retry_delay=config_schema.retry_delay,
        retry_backoff=config_schema.retry_backoff,
        update_states=config_schema.update_states,
        routing_policy=routing_policy,
        pruning_config=_build_pruning_config(config_schema.pruning_config),
        enable_hidden_channels=config_schema.enable_hidden_channels,
        hidden_combine_strategy=config_schema.hidden_combine_strategy,
        pass_embeddings=config_schema.pass_embeddings,
        error_policy=_build_error_policy(config_schema.error_policy) or ErrorPolicy(),
        budget_config=_build_budget_config(config_schema.budget_config),
        enable_memory=config_schema.enable_memory,
        memory_context_limit=config_schema.memory_context_limit,
        memory_config=_build_memory_config(config_schema.memory_config),
        enable_token_streaming=config_schema.enable_token_streaming,
        broadcast_task_to_all=config_schema.broadcast_task_to_all,
        enable_dynamic_topology=enable_dyn,
        max_tool_iterations=config_schema.max_tool_iterations,
        max_loop_iterations=config_schema.max_loop_iterations,
        early_stop_conditions=early_stops,
        async_topology_hooks=topo_hooks,
        callbacks=callbacks,
        tool_registry=tool_registry,
    )


def cancel_execution(run_id: str) -> bool:
    """Cancel a running execution."""
    run_state = _active_runs.get(run_id)
    if run_state is None or not _run_visible_to_current_session(run_state):
        return False
    if run_state.task and not run_state.task.done():
        run_state.cancelled = True
        run_state.task.cancel()
        return True
    return False


def get_run_history() -> list[dict[str, Any]]:
    """Get runs for the current session — active (in-memory) and persisted."""
    session_id = get_current_session_id()
    persisted = [
        r for r in storage.list_runs()
        if _run_session_id(r) == session_id
    ]
    persisted_ids = {r.get("run_id") for r in persisted}
    active_entries = []
    for run_id, state in _active_runs.items():
        if state.session_id != session_id:
            continue
        if run_id in persisted_ids:
            continue
        active_entries.append({
            "run_id": state.run_id,
            "session_id": state.session_id,
            "status": state.status,
            "task_query": state.task_query,
            "graph_id": (state.graph_data or {}).get("graph_id"),
            "events": state.events,
            "result": state.result,
            "started_at": state.started_at,
            "completed_at": state.completed_at,
        })
    active_entries.sort(key=lambda r: r.get("started_at") or "", reverse=True)
    return active_entries + persisted


def get_run_history_summary() -> dict[str, Any]:
    """Return lightweight run counters without returning full event logs."""
    runs = get_run_history()
    by_status: dict[str, int] = {}
    latest_started_at: str | None = None

    for run in runs:
        status = str(run.get("status") or "unknown")
        by_status[status] = by_status.get(status, 0) + 1
        started_at = run.get("started_at") or run.get("created_at")
        if isinstance(started_at, str) and (
            latest_started_at is None or started_at > latest_started_at
        ):
            latest_started_at = started_at

    return {
        "total": len(runs),
        "running": by_status.get("running", 0),
        "by_status": by_status,
        "latest_started_at": latest_started_at,
    }


def get_run_detail(run_id: str) -> dict[str, Any] | None:
    """Get a specific run's details (current session only)."""
    active = _active_runs.get(run_id)
    if active is not None:
        if not _run_visible_to_current_session(active):
            return None
        return {
            "run_id": active.run_id,
            "session_id": active.session_id,
            "status": active.status,
            "task_query": active.task_query,
            "graph_id": (active.graph_data or {}).get("graph_id"),
            "trigger_source": active.trigger_source,
            "schedule_id": active.schedule_id,
            "schedule_name": active.schedule_name,
            "events": active.events,
            "result": active.result,
            "error": active.error,
            "started_at": active.started_at,
            "completed_at": active.completed_at,
        }
    persisted = storage.get_run(run_id)
    if persisted is None or not _run_visible_to_current_session(persisted):
        return None
    return persisted


def _persist_run(run_state: RunState) -> None:
    """Save completed run to disk."""
    storage.save_run(
        run_state.run_id,
        {
            "run_id": run_state.run_id,
            "session_id": run_state.session_id,
            "status": run_state.status,
            "task_query": run_state.task_query,
            "graph_id": (run_state.graph_data or {}).get("graph_id"),
            "trigger_source": run_state.trigger_source,
            "schedule_id": run_state.schedule_id,
            "schedule_name": run_state.schedule_name,
            "events": run_state.events,
            "result": run_state.result,
            "error": run_state.error,
            "started_at": run_state.started_at,
            "completed_at": run_state.completed_at,
        },
    )
