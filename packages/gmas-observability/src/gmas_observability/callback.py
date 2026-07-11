"""Adapter from the current public gMAS callback API to canonical telemetry."""

from collections import defaultdict
from contextlib import suppress
from functools import wraps
from time import perf_counter
from typing import Any
from uuid import uuid4

from .client import ObservabilityClient
from .models import TelemetryEvent

try:
    from gmas.callbacks import BaseCallbackHandler
except ImportError:  # Keep the wire client usable without installing gMAS.

    class BaseCallbackHandler:  # type: ignore[no-redef]
        pass


def _safe_llm_response(result: Any) -> Any:
    """Keep useful provider data while excluding raw responses and reasoning."""
    if result is None or isinstance(result, (str, bool, int, float)):
        return result

    allowed = ("content", "tool_calls", "model", "finish_reason")
    if isinstance(result, dict):
        response = {key: result[key] for key in allowed if key in result}
        usage = _safe_llm_usage(result)
        if usage is not None:
            response["usage"] = usage
        return response

    response: dict[str, Any] = {}
    for key in ("content", "tool_calls"):
        if hasattr(result, key):
            response[key] = getattr(result, key)

    # Provider usage is valuable, but the complete raw object may contain
    # hidden reasoning, headers, or other sensitive implementation details.
    raw = getattr(result, "raw_response", None)
    if raw is not None:
        usage = _safe_llm_usage(result)
        if usage is not None:
            response["usage"] = usage
        raw_model = getattr(raw, "model", None)
        if raw_model:
            response["model"] = str(raw_model)

    return response or {"type": type(result).__name__}


def _safe_llm_usage(result: Any) -> dict[str, Any] | None:
    """Extract non-content token accounting from common provider responses."""
    if isinstance(result, dict):
        usage = result.get("usage")
    else:
        usage = getattr(result, "usage", None)
        raw = getattr(result, "raw_response", None)
        if usage is None and raw is not None:
            usage = getattr(raw, "usage", None)
    if usage is None:
        return None
    if hasattr(usage, "model_dump"):
        usage = usage.model_dump(mode="json")
    if isinstance(usage, dict):
        allowed = {
            "input_tokens",
            "output_tokens",
            "prompt_tokens",
            "completion_tokens",
            "total_tokens",
        }
        return {
            str(key): value
            for key, value in usage.items()
            if key in allowed and isinstance(value, int) and not isinstance(value, bool)
        }
    return None


class GMASObservabilityCallback(BaseCallbackHandler):
    """Captures gMAS lifecycle events without changing gMAS itself."""

    raise_error = False
    run_inline = True

    def __init__(
        self,
        client: ObservabilityClient,
        *,
        trace_id: str | None = None,
        attributes: dict[str, Any] | None = None,
    ) -> None:
        self.client = client
        self.trace_id = trace_id
        self.attributes = dict(attributes or {})
        self._sequence = 0
        self._latest_run_span: str | None = None
        self._run_spans: dict[str, str] = {}
        self._agent_spans: dict[tuple[str, str], list[str]] = defaultdict(list)
        self._latest_agent_spans: dict[str, str] = {}
        self._active_agent_order: list[str] = []
        self._agent_step_indices: dict[str, int] = {}
        self._tool_spans: dict[tuple[str, str, str, str], list[str]] = defaultdict(list)

    def _emit(
        self,
        event_type: str,
        run_id: Any,
        payload: dict[str, Any],
        *,
        span_id: str | None = None,
        parent_span_id: str | None = None,
    ) -> None:
        self._sequence += 1
        rid = str(run_id)
        self.client.emit(
            TelemetryEvent(
                event_type=event_type,
                trace_id=self.trace_id or rid,
                project_id=self.client.config.project_id,
                environment=self.client.config.environment,
                payload=payload,
                attributes=self.attributes,
                span_id=span_id,
                parent_span_id=parent_span_id,
                sequence=self._sequence,
            )
        )

    def on_run_start(
        self, *, run_id, query, num_agents=0, execution_order=None, **kwargs
    ):
        span_id = str(uuid4())
        self._run_spans[str(run_id)] = span_id
        self._latest_run_span = span_id
        self._emit(
            "run.started",
            run_id,
            {
                "query": query if self.client.config.capture_content else None,
                "num_agents": num_agents,
                "execution_order": execution_order or [],
            },
            span_id=span_id,
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
        **kwargs,
    ):
        self._emit(
            "run.completed",
            run_id,
            {
                "output": output if self.client.config.capture_content else None,
                "success": success,
                "error": str(error) if error else None,
                "total_tokens": total_tokens,
                "duration_ms": total_time_ms,
                "executed_agents": executed_agents or [],
            },
            span_id=self._run_spans.get(str(run_id)),
        )

    def on_agent_start(
        self,
        *,
        run_id,
        agent_id,
        agent_name="",
        step_index=0,
        prompt="",
        predecessors=None,
        **kwargs,
    ):
        span_id = str(uuid4())
        self._agent_spans[(str(run_id), str(agent_id))].append(span_id)
        self._latest_agent_spans[str(agent_id)] = span_id
        self._active_agent_order.append(str(agent_id))
        self._agent_step_indices[span_id] = int(step_index)
        self._emit(
            "agent.started",
            run_id,
            {
                "agent_id": agent_id,
                "agent_name": agent_name,
                "step_index": step_index,
                "prompt": prompt if self.client.config.capture_content else None,
                "predecessors": predecessors or [],
            },
            span_id=span_id,
            parent_span_id=self._run_spans.get(str(run_id)),
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
        **kwargs,
    ):
        spans = self._agent_spans[(str(run_id), str(agent_id))]
        span_id = spans.pop() if spans else None
        recorded_step_index = (
            self._agent_step_indices.pop(span_id, step_index) if span_id else step_index
        )
        self._emit(
            "agent.completed",
            run_id,
            {
                "agent_id": agent_id,
                "agent_name": agent_name,
                "step_index": recorded_step_index,
                "output": output if self.client.config.capture_content else None,
                "tokens_used": tokens_used,
                "duration_ms": duration_ms,
                "is_final": is_final,
            },
            span_id=span_id,
            parent_span_id=self._run_spans.get(str(run_id)),
        )
        if self._latest_agent_spans.get(str(agent_id)) == span_id:
            self._latest_agent_spans.pop(str(agent_id), None)
        with suppress(ValueError):
            self._active_agent_order.remove(str(agent_id))

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
        **kwargs,
    ):
        spans = self._agent_spans[(str(run_id), str(agent_id))]
        self._emit(
            "agent.failed",
            run_id,
            {
                "agent_id": agent_id,
                "error_type": error_type or type(error).__name__,
                "error_message": str(error),
                "will_retry": will_retry,
                "attempt": attempt,
                "max_attempts": max_attempts,
            },
            span_id=spans[-1] if spans else None,
            parent_span_id=self._run_spans.get(str(run_id)),
        )

    def on_retry(
        self,
        *,
        run_id,
        agent_id,
        attempt,
        max_attempts=0,
        delay_ms=0.0,
        error="",
        **kwargs,
    ):
        self._emit(
            "agent.retry",
            run_id,
            {
                "agent_id": agent_id,
                "attempt": attempt,
                "max_attempts": max_attempts,
                "delay_ms": delay_ms,
                "error": error,
            },
            parent_span_id=self._run_spans.get(str(run_id)),
        )

    def _lifecycle(self, name: str, run_id: Any, values: dict[str, Any]) -> None:
        values.pop("parent_run_id", None)
        self._emit(
            name, run_id, values, parent_span_id=self._run_spans.get(str(run_id))
        )

    def on_plan_created(self, *, run_id, **kwargs):
        self._lifecycle("plan.created", run_id, kwargs)

    def on_topology_changed(self, *, run_id, **kwargs):
        self._lifecycle("topology.changed", run_id, kwargs)

    def on_prune(self, *, run_id, **kwargs):
        self._lifecycle("agent.pruned", run_id, kwargs)

    def on_fallback(self, *, run_id, **kwargs):
        self._lifecycle("agent.fallback", run_id, kwargs)

    def on_parallel_start(self, *, run_id, **kwargs):
        self._lifecycle("parallel.started", run_id, kwargs)

    def on_parallel_end(self, *, run_id, **kwargs):
        self._lifecycle("parallel.completed", run_id, kwargs)

    def on_memory_read(self, *, run_id, **kwargs):
        self._lifecycle("memory.read", run_id, kwargs)

    def on_memory_write(self, *, run_id, **kwargs):
        self._lifecycle("memory.written", run_id, kwargs)

    def on_budget_warning(self, *, run_id, **kwargs):
        self._lifecycle("budget.warning", run_id, kwargs)

    def on_budget_exceeded(self, *, run_id, **kwargs):
        self._lifecycle("budget.exceeded", run_id, kwargs)

    def on_tool_start(
        self, *, run_id, agent_id="", tool_name, action="", arguments=None, **kwargs
    ):
        if not agent_id and self._active_agent_order:
            agent_id = self._active_agent_order[-1]
        span_id = str(uuid4())
        key = (str(run_id), str(agent_id), str(tool_name), str(action))
        self._tool_spans[key].append(span_id)
        agent_spans = self._agent_spans[(str(run_id), str(agent_id))]
        self._emit(
            "tool.started",
            run_id,
            {
                "agent_id": agent_id,
                "tool_name": tool_name,
                "action": action,
                "arguments": arguments if self.client.config.capture_content else None,
            },
            span_id=span_id,
            parent_span_id=agent_spans[-1]
            if agent_spans
            else self._run_spans.get(str(run_id)),
        )

    def on_tool_end(
        self,
        *,
        run_id,
        agent_id="",
        tool_name,
        action="",
        success=True,
        output_size=0,
        duration_ms=0.0,
        result_summary="",
        **kwargs,
    ):
        if not agent_id and self._active_agent_order:
            agent_id = self._active_agent_order[-1]
        key = (str(run_id), str(agent_id), str(tool_name), str(action))
        spans = self._tool_spans[key]
        self._emit(
            "tool.completed",
            run_id,
            {
                "agent_id": agent_id,
                "tool_name": tool_name,
                "action": action,
                "success": success,
                "output_size": output_size,
                "duration_ms": duration_ms,
                "result_summary": result_summary
                if self.client.config.capture_content
                else None,
            },
            span_id=spans.pop() if spans else None,
        )

    def on_tool_error(
        self,
        *,
        run_id,
        agent_id="",
        tool_name="",
        action="",
        error_type="",
        error_message="",
        **kwargs,
    ):
        if not agent_id and self._active_agent_order:
            agent_id = self._active_agent_order[-1]
        key = (str(run_id), str(agent_id), str(tool_name), str(action))
        spans = self._tool_spans[key]
        self._emit(
            "tool.failed",
            run_id,
            {
                "agent_id": agent_id,
                "tool_name": tool_name,
                "action": action,
                "error_type": error_type,
                "error_message": error_message,
            },
            span_id=spans.pop() if spans else None,
        )

    def capture_stream_event(self, event: dict[str, Any]) -> None:
        """Capture gMAS StreamEvent payloads when callbacks are not invoked."""
        raw_type = str(event.get("event_type", "event"))
        payload = {
            k: v
            for k, v in event.items()
            if k not in {"event_type", "timestamp", "run_id", "_seq"}
        }
        run_id = event.get("run_id", self.trace_id or "unknown")
        if raw_type == "run_start":
            self.on_run_start(
                run_id=run_id,
                query=payload.pop("query", ""),
                num_agents=payload.pop("num_agents", 0),
                execution_order=payload.pop("execution_order", []),
                **payload,
            )
        elif raw_type == "run_end":
            self.on_run_end(
                run_id=run_id,
                output=payload.pop("final_answer", payload.pop("output", "")),
                total_time_ms=float(payload.pop("total_time", 0.0)) * 1000,
                **payload,
            )
        elif raw_type == "agent_start":
            self.on_agent_start(
                run_id=run_id,
                prompt=payload.pop("prompt_preview", payload.pop("prompt", "")),
                **payload,
            )
        elif raw_type == "agent_output":
            self.on_agent_end(
                run_id=run_id,
                output=payload.pop("content", payload.pop("output", "")),
                **payload,
            )
        elif raw_type == "agent_error":
            message = str(payload.pop("error_message", ""))
            self.on_agent_error(RuntimeError(message), run_id=run_id, **payload)
        else:
            self._emit(
                raw_type.replace("_", "."),
                run_id,
                payload,
                parent_span_id=self._run_spans.get(str(run_id)),
            )

    def wrap_async_llm(
        self,
        caller: Any,
        *,
        agent_id: str | None = None,
        model: str | None = None,
        provider: str | None = None,
    ) -> Any:
        """Wrap an application-supplied async LLM caller without changing gMAS."""
        if caller is None:
            return None

        @wraps(caller)
        async def observed(*args: Any, **kwargs: Any) -> Any:
            span_id = str(uuid4())
            run_id = self.trace_id or "external"
            effective_agent_id = agent_id
            if effective_agent_id is None and self._active_agent_order:
                effective_agent_id = self._active_agent_order[-1]
            parent = (
                self._latest_agent_spans.get(str(effective_agent_id))
                if effective_agent_id is not None
                else None
            )
            parent = parent or self._latest_run_span
            request = (
                {"args": list(args), "kwargs": kwargs}
                if self.client.config.capture_content
                else None
            )
            self._emit(
                "llm.started",
                run_id,
                {
                    "agent_id": effective_agent_id,
                    "model": model,
                    "provider": provider,
                    "request": request,
                },
                span_id=span_id,
                parent_span_id=parent,
            )
            started = perf_counter()
            try:
                result = await caller(*args, **kwargs)
            except Exception as exc:
                self._emit(
                    "llm.failed",
                    run_id,
                    {
                        "agent_id": effective_agent_id,
                        "model": model,
                        "provider": provider,
                        "error_type": type(exc).__name__,
                        "error_message": str(exc),
                        "duration_ms": (perf_counter() - started) * 1000,
                    },
                    span_id=span_id,
                    parent_span_id=parent,
                )
                raise
            self._emit(
                "llm.completed",
                run_id,
                {
                    "agent_id": effective_agent_id,
                    "model": model,
                    "provider": provider,
                    "response": _safe_llm_response(result)
                    if self.client.config.capture_content
                    else None,
                    "usage": _safe_llm_usage(result),
                    "duration_ms": (perf_counter() - started) * 1000,
                },
                span_id=span_id,
                parent_span_id=parent,
            )
            return result

        return observed

    def wrap_tool_registry(self, registry: Any) -> Any:
        """Proxy ToolRegistry for gMAS stream mode, where callbacks are absent."""
        callback = self

        class ObservedToolRegistry:
            def __getattr__(self, name: str) -> Any:
                return getattr(registry, name)

            def execute(self, call: Any) -> Any:
                tool_name = str(getattr(call, "name", "tool"))
                arguments = getattr(call, "arguments", None)
                run_id = callback.trace_id or "external"
                callback.on_tool_start(
                    run_id=run_id,
                    tool_name=tool_name,
                    arguments=arguments,
                )
                started = perf_counter()
                try:
                    result = registry.execute(call)
                except Exception as exc:
                    callback.on_tool_error(
                        run_id=run_id,
                        tool_name=tool_name,
                        error_type=type(exc).__name__,
                        error_message=str(exc),
                    )
                    raise
                duration_ms = (perf_counter() - started) * 1000
                if getattr(result, "success", True):
                    output = getattr(result, "output", "") or ""
                    callback.on_tool_end(
                        run_id=run_id,
                        tool_name=tool_name,
                        success=True,
                        output_size=len(str(output)),
                        duration_ms=duration_ms,
                        result_summary=_truncate_tool_result(str(output)),
                    )
                else:
                    callback.on_tool_error(
                        run_id=run_id,
                        tool_name=tool_name,
                        error_type="ToolExecutionError",
                        error_message=str(getattr(result, "error", "") or ""),
                    )
                return result

        return ObservedToolRegistry()

    def close(self) -> None:
        self.client.flush()


def _truncate_tool_result(value: str, limit: int = 2_000) -> str:
    return value if len(value) <= limit else value[:limit] + "…[TRUNCATED]"
