#!/usr/bin/env python3
"""
Benchmark Langflow vs gMAS-demo via HTTP/WebSocket APIs.

Compares health, metadata fetch, validate/build, import, execution latency,
token metrics (UI estimate vs observability provider), and optional concurrency.

Usage:
  python scripts/benchmark_langflow_vs_gmas.py --config scripts/benchmark.config.example.json
  python scripts/benchmark_langflow_vs_gmas.py --gmas-url http://localhost:8000 --graph-id <uuid>

Requires: httpx (apps/api dev dependency). Optional: websockets for stream TTFT.
"""

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError as exc:  # pragma: no cover
    print("Install httpx: pip install httpx", file=sys.stderr)
    raise SystemExit(1) from exc


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = Path(__file__).resolve().parent
DEFAULT_REPORT_DIR = REPO_ROOT / "benchmarks" / "reports"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ms(start: float, end: float | None = None) -> float:
    return round(((end if end is not None else time.perf_counter()) - start) * 1000, 2)


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    k = (len(ordered) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(ordered) - 1)
    if f == c:
        return round(ordered[f], 2)
    return round(ordered[f] + (ordered[c] - ordered[f]) * (k - f), 2)


def stats(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {"count": 0, "min_ms": None, "max_ms": None, "mean_ms": None, "p50_ms": None, "p95_ms": None}
    return {
        "count": len(values),
        "min_ms": round(min(values), 2),
        "max_ms": round(max(values), 2),
        "mean_ms": round(statistics.mean(values), 2),
        "p50_ms": percentile(values, 50),
        "p95_ms": percentile(values, 95),
    }


def _tool_names(agent: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for tool in agent.get("tools") or []:
        if isinstance(tool, str):
            names.append(tool)
        elif isinstance(tool, dict):
            name = tool.get("name") or tool.get("tool_name")
            if isinstance(name, str):
                names.append(name)
    return names


def analyze_gmas_graph(body: dict[str, Any]) -> dict[str, Any]:
    """Structural metrics for a gMAS graph JSON payload."""
    agents = body.get("agents") or []
    edges = body.get("edges") or []

    tools: set[str] = set()
    models: set[str] = set()
    agents_with_tools = 0
    agents_with_input_schema = 0
    agents_with_output_schema = 0
    agents_with_llm_config = 0

    for agent in agents:
        tool_list = _tool_names(agent)
        if tool_list:
            agents_with_tools += 1
            tools.update(tool_list)
        if agent.get("input_schema"):
            agents_with_input_schema += 1
        if agent.get("output_schema"):
            agents_with_output_schema += 1
        llm_cfg = agent.get("llm_config")
        if isinstance(llm_cfg, dict):
            agents_with_llm_config += 1
            model = llm_cfg.get("model_name") or llm_cfg.get("model")
            if isinstance(model, str) and model.strip():
                models.add(model.strip())
        backbone = agent.get("llm_backbone")
        if isinstance(backbone, str) and backbone.strip():
            models.add(backbone.strip())

    enabled_edges = 0
    disabled_edges = 0
    conditional_edges = 0
    loop_edges = 0
    weighted_edges = 0
    for edge in edges:
        if edge.get("enabled") is False:
            disabled_edges += 1
        else:
            enabled_edges += 1
        condition = edge.get("condition")
        if condition and condition not in {"always", "skip"}:
            conditional_edges += 1
        if condition == "loop":
            loop_edges += 1
        weight = edge.get("weight")
        if isinstance(weight, (int, float)) and float(weight) != 1.0:
            weighted_edges += 1

    task_targets = body.get("task_targets") or []
    execution_order_len = len(body.get("execution_order") or [])

    return {
        "graph_id": body.get("graph_id"),
        "name": body.get("name"),
        "agent_count": len(agents),
        "edge_count": len(edges),
        "enabled_edge_count": enabled_edges,
        "disabled_edge_count": disabled_edges,
        "conditional_edge_count": conditional_edges,
        "loop_edge_count": loop_edges,
        "weighted_edge_count": weighted_edges,
        "unique_tool_count": len(tools),
        "tools": sorted(tools),
        "agents_with_tools": agents_with_tools,
        "agents_with_input_schema": agents_with_input_schema,
        "agents_with_output_schema": agents_with_output_schema,
        "agents_with_llm_config": agents_with_llm_config,
        "unique_llm_model_count": len(models),
        "llm_models": sorted(models),
        "has_start_node": bool(body.get("start_node")),
        "has_end_node": bool(body.get("end_node")),
        "start_node": body.get("start_node"),
        "end_node": body.get("end_node"),
        "task_target_count": len(task_targets),
        "task_query_len": len(str(body.get("task_query") or "")),
        "execution_order_len": execution_order_len,
        "validation_error_count": len(body.get("validation_errors") or []),
        "json_bytes": len(json.dumps(body, ensure_ascii=False).encode("utf-8")),
    }


def analyze_langflow_flow(body: dict[str, Any]) -> dict[str, Any]:
    """Structural metrics for a Langflow flow payload."""
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    nodes = data.get("nodes") if isinstance(data.get("nodes"), list) else []
    edges = data.get("edges") if isinstance(data.get("edges"), list) else []

    node_types: dict[str, int] = {}
    llm_nodes = 0
    io_nodes = 0
    tool_nodes = 0

    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_data = node.get("data") if isinstance(node.get("data"), dict) else {}
        ntype = (
            node_data.get("type")
            or node.get("type")
            or node_data.get("node", {}).get("name")
            or "unknown"
        )
        ntype_str = str(ntype)
        node_types[ntype_str] = node_types.get(ntype_str, 0) + 1
        lowered = ntype_str.lower()
        if "llm" in lowered or "language" in lowered or "model" in lowered:
            llm_nodes += 1
        if "input" in lowered or "output" in lowered or "chat" in lowered:
            io_nodes += 1
        if "tool" in lowered:
            tool_nodes += 1

    return {
        "flow_id": body.get("id") or body.get("flow_id"),
        "name": body.get("name"),
        "node_count": len(nodes),
        "edge_count": len(edges),
        "node_types": node_types,
        "llm_like_node_count": llm_nodes,
        "io_node_count": io_nodes,
        "tool_node_count": tool_nodes,
        "json_bytes": len(json.dumps(body, ensure_ascii=False).encode("utf-8")),
    }


def compile_validate_stats(durations_ms: list[float]) -> dict[str, Any]:
    """Aggregate repeated validate/build timings (validate endpoint runs GraphBuilder.build)."""
    if not durations_ms:
        return {}
    ordered = sorted(durations_ms)
    warm_delta = None
    if len(ordered) >= 2:
        warm_delta = round(ordered[0] - ordered[-1], 2)
    return {
        "compile_validate_ms": ordered[-1],
        "compile_validate_first_ms": ordered[0],
        "compile_validate_last_ms": ordered[-1],
        "compile_validate_warmup_delta_ms": warm_delta,
        **{f"compile_validate_{k}": v for k, v in stats(durations_ms).items() if k != "count"},
        "compile_validate_repeats": len(durations_ms),
    }


def strip_graph_tools(graph: dict[str, Any]) -> dict[str, Any]:
    """Return graph JSON with tools cleared on every agent (LLM-only parity with Langflow)."""
    agents = []
    for agent in graph.get("agents") or []:
        if not isinstance(agent, dict):
            continue
        agents.append({**agent, "tools": []})
    return {**graph, "agents": agents}


def merge_gmas_runner_config(
    base: dict[str, Any] | None,
    *,
    disable_tools: bool,
) -> dict[str, Any]:
    cfg = dict(base or {})
    cfg.setdefault("enable_parallel", False)
    cfg.setdefault("adaptive", False)
    cfg.setdefault("max_retries", 1)
    cfg.setdefault("timeout", 180)
    if disable_tools:
        cfg["max_tool_iterations"] = 0
    return cfg


def _parse_iso_ts(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _wall_ms(started_at: Any, completed_at: Any) -> float | None:
    start = _parse_iso_ts(started_at)
    end = _parse_iso_ts(completed_at)
    if start is None or end is None:
        return None
    return round((end - start).total_seconds() * 1000, 2)


def _graph_inline_payload(graph: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "name",
        "description",
        "agents",
        "edges",
        "positions",
        "start_node",
        "end_node",
        "task_targets",
        "task_query",
        "llm_provider_id",
        "llm_model",
        "run_config",
    )
    return {k: graph[k] for k in keys if k in graph}


@dataclass
class PhaseResult:
    name: str
    platform: str
    ok: bool
    duration_ms: float
    error: str | None = None
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class RunMetrics:
    platform: str
    run_index: int
    ok: bool
    scenario_id: str = ""
    scenario_name: str = ""
    architecture: str = ""
    repeat_index: int = 0
    graph_id: str | None = None
    flow_id: str | None = None
    run_start_ms: float | None = None
    e2e_ms: float | None = None
    poll_count: int = 0
    ttft_ms: float | None = None
    status: str | None = None
    agent_count: int = 0
    agent_steps: int = 0
    tool_calls: int = 0
    tokens_ui_total: int | None = None
    tokens_ui_sum_agents: int | None = None
    tokens_provider_input: int | None = None
    tokens_provider_output: int | None = None
    trace_id: str | None = None
    trace_event_count: int | None = None
    event_counts: dict[str, int] = field(default_factory=dict)
    error: str | None = None
    output_preview: str | None = None
    e2e_per_agent_ms: float | None = None
    time_to_first_agent_ms: float | None = None
    compile_setup_ms: float | None = None
    agent_llm_ms_sum: float | None = None
    agent_llm_ms_mean: float | None = None
    agent_llm_ms_max: float | None = None
    tool_duration_ms_sum: float | None = None
    run_end_total_ms: float | None = None
    orchestration_overhead_ms: float | None = None
    llm_calls: int = 0
    agent_errors: int = 0
    tool_success_count: int = 0
    tool_error_count: int = 0
    executed_agent_count: int = 0
    event_total: int = 0
    first_event_ms: float | None = None
    ws_ttft_ms: float | None = None
    poll_wait_ms: float | None = None
    execution_wall_ms: float | None = None
    agent_gap_ms_mean: float | None = None
    agent_gap_ms_max: float | None = None
    agent_llm_ms_min: float | None = None
    graph_structure: dict[str, Any] = field(default_factory=dict)
    raw_summary: dict[str, Any] = field(default_factory=dict)


class LangflowClient:
    def __init__(self, base_url: str, api_key: str = "", timeout: float = 300.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        headers: dict[str, str] = {"Accept": "application/json"}
        if api_key:
            headers["x-api-key"] = api_key
        self.client = httpx.Client(base_url=self.base_url, headers=headers, timeout=timeout)

    def close(self) -> None:
        self.client.close()

    def health(self) -> PhaseResult:
        t0 = time.perf_counter()
        try:
            resp = self.client.get("/health_check")
            resp.raise_for_status()
            body = resp.json()
            return PhaseResult(
                "health",
                "langflow",
                True,
                ms(t0),
                data={"endpoint": "/health_check", "body": body},
            )
        except Exception as exc:
            return PhaseResult("health", "langflow", False, ms(t0), error=str(exc))

    def version(self) -> PhaseResult:
        t0 = time.perf_counter()
        try:
            resp = self.client.get("/api/v1/version")
            resp.raise_for_status()
            body = resp.json()
            return PhaseResult("version", "langflow", True, ms(t0), data=body)
        except Exception as exc:
            return PhaseResult("version", "langflow", False, ms(t0), error=str(exc))

    def get_flow(self, flow_id: str) -> PhaseResult:
        t0 = time.perf_counter()
        try:
            resp = self.client.get(f"/api/v1/flows/{flow_id}")
            resp.raise_for_status()
            body = resp.json()
            analysis = analyze_langflow_flow(body if isinstance(body, dict) else {})
            analysis["flow_id"] = flow_id
            return PhaseResult(
                "fetch_flow",
                "langflow",
                True,
                ms(t0),
                data=analysis,
            )
        except Exception as exc:
            return PhaseResult("fetch_flow", "langflow", False, ms(t0), error=str(exc))

    def list_flows(self) -> PhaseResult:
        t0 = time.perf_counter()
        try:
            resp = self.client.get("/api/v1/flows/")
            resp.raise_for_status()
            body = resp.json()
            flows = body if isinstance(body, list) else body.get("flows") or []
            return PhaseResult(
                "list_flows",
                "langflow",
                True,
                ms(t0),
                data={"flow_count": len(flows) if isinstance(flows, list) else 0},
            )
        except Exception as exc:
            return PhaseResult("list_flows", "langflow", False, ms(t0), error=str(exc))

    def build_flow_job(self, flow_id: str) -> PhaseResult:
        """Langflow async build — measures job enqueue latency."""
        t0 = time.perf_counter()
        try:
            resp = self.client.post(f"/api/v1/build/{flow_id}/flow", json={})
            resp.raise_for_status()
            body = resp.json() if resp.content else {}
            return PhaseResult(
                "build_flow",
                "langflow",
                True,
                ms(t0),
                data={"flow_id": flow_id, "job_id": body.get("job_id")},
            )
        except Exception as exc:
            return PhaseResult("build_flow", "langflow", False, ms(t0), error=str(exc))

    def run_sync(
        self,
        flow_id: str,
        task_query: str,
        run_index: int = 0,
        stream: bool = False,
    ) -> RunMetrics:
        payload = {
            "input_value": task_query,
            "output_type": "chat",
            "input_type": "chat",
        }
        url = f"/api/v1/run/{flow_id}"
        params = {"stream": "true" if stream else "false"}
        t0 = time.perf_counter()
        metrics = RunMetrics(platform="langflow", run_index=run_index, ok=False)

        try:
            if stream:
                ttft_start = time.perf_counter()
                first_byte_ms: float | None = None
                chunks = 0
                with self.client.stream(
                    "POST",
                    url,
                    params=params,
                    json=payload,
                    headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
                ) as resp:
                    resp.raise_for_status()
                    for _chunk in resp.iter_bytes():
                        if first_byte_ms is None:
                            first_byte_ms = ms(ttft_start)
                        chunks += 1
                metrics.run_start_ms = ms(t0)
                metrics.e2e_ms = ms(t0)
                metrics.ttft_ms = first_byte_ms
                metrics.ws_ttft_ms = first_byte_ms
                metrics.first_event_ms = first_byte_ms
                metrics.ok = True
                metrics.status = "completed"
                metrics.raw_summary = {"stream_chunks": chunks}
                return metrics

            resp = self.client.post(url, params=params, json=payload)
            metrics.run_start_ms = ms(t0)
            resp.raise_for_status()
            body = resp.json() if resp.content else {}
            metrics.e2e_ms = ms(t0)
            metrics.flow_id = flow_id
            _apply_langflow_tokens(metrics, body)
            outputs = body.get("outputs") if isinstance(body, dict) else None
            has_output = bool(outputs) and any(
                isinstance(o, dict) and o.get("outputs") for o in outputs if isinstance(outputs, list)
            )
            metrics.ok = has_output
            metrics.status = "completed" if has_output else "empty_output"
            if not has_output:
                metrics.error = "Langflow returned empty outputs"
            metrics.raw_summary = _summarize_langflow_response(body)
            _finalize_run_metrics(metrics)
            return metrics
        except Exception as exc:
            metrics.run_start_ms = ms(t0) if metrics.run_start_ms is None else metrics.run_start_ms
            metrics.e2e_ms = ms(t0)
            metrics.error = str(exc)
            metrics.status = "failed"
            return metrics


class GmasClient:
    def __init__(self, base_url: str, timeout: float = 300.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.client = httpx.Client(base_url=self.base_url, timeout=timeout)

    def close(self) -> None:
        self.client.close()

    def health(self) -> PhaseResult:
        t0 = time.perf_counter()
        try:
            resp = self.client.get("/api/health")
            resp.raise_for_status()
            return PhaseResult("health", "gmas", True, ms(t0), data=resp.json())
        except Exception as exc:
            return PhaseResult("health", "gmas", False, ms(t0), error=str(exc))

    def list_graphs(self) -> PhaseResult:
        t0 = time.perf_counter()
        try:
            resp = self.client.get("/api/graphs")
            resp.raise_for_status()
            body = resp.json()
            graphs = body if isinstance(body, list) else []
            return PhaseResult(
                "list_graphs",
                "gmas",
                True,
                ms(t0),
                data={"graph_count": len(graphs)},
            )
        except Exception as exc:
            return PhaseResult("list_graphs", "gmas", False, ms(t0), error=str(exc))

    def history_summary(self) -> PhaseResult:
        t0 = time.perf_counter()
        try:
            resp = self.client.get("/api/execution/history/summary")
            resp.raise_for_status()
            body = resp.json()
            return PhaseResult("history_summary", "gmas", True, ms(t0), data=body)
        except Exception as exc:
            return PhaseResult("history_summary", "gmas", False, ms(t0), error=str(exc))

    def validate_inline(self, graph: dict[str, Any]) -> PhaseResult:
        t0 = time.perf_counter()
        try:
            payload = _graph_inline_payload(graph)
            resp = self.client.post("/api/graphs/validate", json=payload)
            resp.raise_for_status()
            body = resp.json()
            is_valid = bool(body.get("is_valid", False))
            return PhaseResult(
                "validate_inline",
                "gmas",
                is_valid,
                ms(t0),
                error=None if is_valid else "; ".join((body.get("errors") or [])[:3]) or "invalid",
                data={
                    "is_valid": is_valid,
                    "execution_order_len": len(body.get("execution_order") or []),
                    "error_count": len(body.get("errors") or []),
                    "warning_count": len(body.get("warnings") or []),
                },
            )
        except Exception as exc:
            return PhaseResult("validate_inline", "gmas", False, ms(t0), error=str(exc))

    def get_graph(self, graph_id: str) -> PhaseResult:
        t0 = time.perf_counter()
        try:
            resp = self.client.get(f"/api/graphs/{graph_id}")
            resp.raise_for_status()
            body = resp.json()
            analysis = analyze_gmas_graph(body if isinstance(body, dict) else {})
            analysis["graph_id"] = graph_id
            analysis["fetch_ms"] = ms(t0)
            return PhaseResult(
                "fetch_graph",
                "gmas",
                True,
                ms(t0),
                data=analysis,
            )
        except Exception as exc:
            return PhaseResult("fetch_graph", "gmas", False, ms(t0), error=str(exc))

    def compile_validate_graph(self, graph_id: str, repeats: int = 1) -> PhaseResult:
        """POST /validate — includes GraphBuilder.build() on the server (graph compile)."""
        durations: list[float] = []
        last_body: dict[str, Any] = {}
        t_all = time.perf_counter()
        try:
            for _ in range(max(1, repeats)):
                t0 = time.perf_counter()
                resp = self.client.post(f"/api/graphs/{graph_id}/validate")
                resp.raise_for_status()
                durations.append(ms(t0))
                last_body = resp.json() if resp.content else {}
            is_valid = bool(last_body.get("is_valid", False))
            errors = last_body.get("errors") or []
            warnings = last_body.get("warnings") or []
            execution_order = last_body.get("execution_order") or []
            data = {
                "graph_id": graph_id,
                "is_valid": is_valid,
                "errors": errors,
                "warnings": warnings,
                "error_count": len(errors),
                "warning_count": len(warnings),
                "execution_order": execution_order,
                "execution_order_len": len(execution_order),
                **compile_validate_stats(durations),
            }
            return PhaseResult(
                "compile_validate",
                "gmas",
                is_valid,
                ms(t_all),
                error=None if is_valid else "; ".join(errors[:5]) or "invalid",
                data=data,
            )
        except Exception as exc:
            return PhaseResult("compile_validate", "gmas", False, ms(t_all), error=str(exc))

    def validate_graph(self, graph_id: str, repeats: int = 1) -> PhaseResult:
        return self.compile_validate_graph(graph_id, repeats=repeats)

    def import_langflow(self, langflow_json_path: Path, name_override: str | None = None) -> PhaseResult:
        t0 = time.perf_counter()
        try:
            raw = json.loads(langflow_json_path.read_text(encoding="utf-8"))
            payload: dict[str, Any] = {"source": "langflow", "payload": raw}
            if name_override:
                payload["name_override"] = name_override
            resp = self.client.post("/api/graphs/import", json=payload)
            resp.raise_for_status()
            body = resp.json()
            graph = body.get("graph") or {}
            return PhaseResult(
                "import_langflow",
                "gmas",
                True,
                ms(t0),
                data={
                    "graph_id": graph.get("graph_id"),
                    "name": graph.get("name"),
                    "import_mode": body.get("import_mode"),
                    "warnings": body.get("warnings") or [],
                    "agent_count": len(graph.get("agents") or []),
                    "edge_count": len(graph.get("edges") or []),
                },
            )
        except Exception as exc:
            return PhaseResult("import_langflow", "gmas", False, ms(t0), error=str(exc))

    def get_graph_body(self, graph_id: str) -> dict[str, Any]:
        resp = self.client.get(f"/api/graphs/{graph_id}")
        resp.raise_for_status()
        body = resp.json()
        return body if isinstance(body, dict) else {}

    def start_run(
        self,
        graph_id: str,
        task_query: str,
        llm_provider_id: str | None = None,
        runner_config: dict[str, Any] | None = None,
        graph_payload: dict[str, Any] | None = None,
    ) -> tuple[str | None, float, str | None]:
        payload: dict[str, Any] = {
            "task_query": task_query,
        }
        if graph_payload is not None:
            payload["graph"] = graph_payload
            payload["graph_id"] = graph_id
        else:
            payload["graph_id"] = graph_id
        if llm_provider_id:
            payload["llm_provider_id"] = llm_provider_id
        if runner_config:
            payload["config"] = runner_config
        t0 = time.perf_counter()
        try:
            resp = self.client.post("/api/execution/run", json=payload)
            resp.raise_for_status()
            body = resp.json()
            return body.get("run_id"), ms(t0), None
        except Exception as exc:
            return None, ms(t0), str(exc)

    def poll_run(self, run_id: str) -> dict[str, Any]:
        resp = self.client.get(f"/api/execution/{run_id}")
        resp.raise_for_status()
        return resp.json()

    def cancel_run(self, run_id: str) -> PhaseResult:
        t0 = time.perf_counter()
        try:
            resp = self.client.delete(f"/api/execution/{run_id}")
            resp.raise_for_status()
            return PhaseResult("cancel", "gmas", True, ms(t0), data={"run_id": run_id})
        except Exception as exc:
            return PhaseResult("cancel", "gmas", False, ms(t0), error=str(exc))

    def run_until_done(
        self,
        graph_id: str,
        task_query: str,
        *,
        run_index: int = 0,
        poll_interval: float = 0.25,
        timeout_seconds: float = 300.0,
        llm_provider_id: str | None = None,
        runner_config: dict[str, Any] | None = None,
        graph_payload: dict[str, Any] | None = None,
        measure_ws_ttft: bool = False,
    ) -> RunMetrics:
        metrics = RunMetrics(platform="gmas", run_index=run_index, ok=False)
        t0 = time.perf_counter()
        run_id, start_ms, start_err = self.start_run(
            graph_id,
            task_query,
            llm_provider_id=llm_provider_id,
            runner_config=runner_config,
            graph_payload=graph_payload,
        )
        metrics.run_start_ms = start_ms
        if start_err or not run_id:
            metrics.error = start_err or "missing run_id"
            metrics.status = "failed"
            metrics.e2e_ms = ms(t0)
            return metrics

        ws_ttft: float | None = None
        ws_thread = None
        ws_result: list[float | None] = [None]
        if measure_ws_ttft:
            import threading

            def _ws_worker() -> None:
                ws_result[0] = asyncio.run(_gmas_ws_ttft(self.base_url, run_id))

            ws_thread = threading.Thread(target=_ws_worker, daemon=True)
            ws_thread.start()

        deadline = time.perf_counter() + timeout_seconds
        last_body: dict[str, Any] = {}
        poll_count = 0
        poll_wait_ms = 0.0
        first_agent_at: float | None = None
        first_event_at: float | None = None

        while time.perf_counter() < deadline:
            poll_count += 1
            try:
                last_body = self.poll_run(run_id)
            except Exception as exc:
                metrics.error = str(exc)
                metrics.poll_count = poll_count
                metrics.status = "failed"
                break

            events = last_body.get("events") or []
            if first_event_at is None and isinstance(events, list) and events:
                first_event_at = time.perf_counter()
            if first_agent_at is None:
                for event in events:
                    if isinstance(event, dict) and event.get("event_type") == "agent_start":
                        first_agent_at = time.perf_counter()
                        break

            status = str(last_body.get("status") or "").lower()
            if status in {"completed", "failed", "error", "cancelled", "canceled"}:
                metrics.status = status
                metrics.ok = status == "completed"
                break
            time.sleep(poll_interval)
            poll_wait_ms += poll_interval * 1000
        else:
            metrics.error = f"timeout after {timeout_seconds}s"
            metrics.status = "timeout"

        if ws_thread is not None:
            ws_thread.join(timeout=5)
            ws_ttft = ws_result[0]

        metrics.poll_count = poll_count
        metrics.poll_wait_ms = round(poll_wait_ms, 2)
        metrics.e2e_ms = ms(t0)
        metrics.ttft_ms = ws_ttft
        metrics.ws_ttft_ms = ws_ttft
        if first_event_at is not None:
            metrics.first_event_ms = ms(t0, first_event_at)
        if first_agent_at is not None:
            metrics.time_to_first_agent_ms = ms(t0, first_agent_at)
            if metrics.run_start_ms is not None:
                metrics.compile_setup_ms = round(metrics.time_to_first_agent_ms - metrics.run_start_ms, 2)

        _fill_gmas_run_metrics(metrics, last_body)
        _finalize_run_metrics(metrics)
        return metrics


class ObservabilityClient:
    def __init__(self, base_url: str, api_key: str = "", timeout: float = 60.0):
        self.base_url = base_url.rstrip("/")
        headers: dict[str, str] = {"Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self.client = httpx.Client(base_url=self.base_url, headers=headers, timeout=timeout)

    def close(self) -> None:
        self.client.close()

    def health(self) -> PhaseResult:
        t0 = time.perf_counter()
        try:
            resp = self.client.get("/api/health")
            resp.raise_for_status()
            return PhaseResult("health", "observability", True, ms(t0), data=resp.json())
        except Exception as exc:
            return PhaseResult("health", "observability", False, ms(t0), error=str(exc))

    def enrich_gmas_run(self, metrics: RunMetrics, project_id: str, environment: str) -> None:
        trace_id = metrics.trace_id
        if not trace_id:
            return
        try:
            resp = self.client.get(f"/api/v1/traces/{trace_id}")
            if resp.status_code == 404:
                return
            resp.raise_for_status()
            trace = resp.json()
            events = trace.get("events") or []
            metrics.trace_event_count = len(events)
            input_tokens = 0
            output_tokens = 0
            llm_completed = 0
            tool_spans = 0
            obs_event_types: dict[str, int] = {}
            for event in events:
                et = str(event.get("event_type") or "unknown")
                obs_event_types[et] = obs_event_types.get(et, 0) + 1
                if et == "llm.completed":
                    llm_completed += 1
                    usage = (event.get("payload") or {}).get("usage") or {}
                    input_tokens += int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
                    output_tokens += int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
                if et.startswith("tool."):
                    tool_spans += 1
            if input_tokens or output_tokens:
                metrics.tokens_provider_input = input_tokens
                metrics.tokens_provider_output = output_tokens
            metrics.raw_summary["observability_llm_completed"] = llm_completed
            metrics.raw_summary["observability_tool_spans"] = tool_spans
            metrics.raw_summary["observability_event_types"] = obs_event_types
        except Exception:
            return


def _summarize_langflow_response(body: Any) -> dict[str, Any]:
    summary: dict[str, Any] = {"keys": list(body.keys()) if isinstance(body, dict) else []}
    if not isinstance(body, dict):
        return summary
    outputs = body.get("outputs")
    if isinstance(outputs, list):
        summary["output_count"] = len(outputs)
    session_id = body.get("session_id")
    if session_id:
        summary["session_id"] = session_id
    tokens_in, tokens_out, tokens_total, text = _extract_langflow_usage(body)
    if tokens_total:
        summary["tokens_total"] = tokens_total
    if tokens_in or tokens_out:
        summary["tokens_input"] = tokens_in
        summary["tokens_output"] = tokens_out
    if text:
        summary["output_preview"] = text[:200]
    return summary


def _extract_langflow_usage(body: dict[str, Any]) -> tuple[int, int, int, str]:
    """Walk Langflow run JSON for provider usage and final text."""
    input_tokens = 0
    output_tokens = 0
    total_tokens = 0
    text = ""

    def _walk(node: Any) -> None:
        nonlocal input_tokens, output_tokens, total_tokens, text
        if isinstance(node, dict):
            usage = node.get("usage")
            if isinstance(usage, dict):
                input_tokens += int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
                output_tokens += int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
                total_tokens += int(usage.get("total_tokens") or 0)
            props = node.get("properties")
            if isinstance(props, dict):
                u2 = props.get("usage")
                if isinstance(u2, dict):
                    input_tokens += int(u2.get("input_tokens") or u2.get("prompt_tokens") or 0)
                    output_tokens += int(u2.get("output_tokens") or u2.get("completion_tokens") or 0)
                    total_tokens += int(u2.get("total_tokens") or 0)
            for key in ("text", "message"):
                val = node.get(key)
                if isinstance(val, str) and val.strip():
                    text = val.strip()
            for val in node.values():
                _walk(val)
        elif isinstance(node, list):
            for item in node:
                _walk(item)

    _walk(body.get("outputs"))
    if not total_tokens and (input_tokens or output_tokens):
        total_tokens = input_tokens + output_tokens
    return input_tokens, output_tokens, total_tokens, text


def _apply_langflow_tokens(metrics: RunMetrics, body: dict[str, Any]) -> None:
    inp, out, total, text = _extract_langflow_usage(body)
    if total:
        metrics.tokens_ui_total = total
    if inp or out:
        metrics.tokens_provider_input = inp or None
        metrics.tokens_provider_output = out or None
    if text:
        metrics.output_preview = text[:200]


def _finalize_run_metrics(metrics: RunMetrics) -> None:
    if metrics.e2e_ms is not None and metrics.agent_count > 0:
        metrics.e2e_per_agent_ms = round(metrics.e2e_ms / metrics.agent_count, 2)
    if metrics.e2e_ms is not None and metrics.agent_llm_ms_sum is not None:
        overhead = metrics.e2e_ms - metrics.agent_llm_ms_sum
        if metrics.compile_setup_ms is not None:
            overhead -= metrics.compile_setup_ms
        metrics.orchestration_overhead_ms = round(max(0.0, overhead), 2)


def _fill_gmas_run_metrics(metrics: RunMetrics, body: dict[str, Any]) -> None:
    run_id = body.get("run_id")
    metrics.raw_summary = {
        "run_id": run_id,
        "graph_id": body.get("graph_id"),
        "trigger_source": body.get("trigger_source"),
        "error": body.get("error"),
        "started_at": body.get("started_at"),
        "completed_at": body.get("completed_at"),
    }
    metrics.trace_id = run_id

    events = body.get("events") or []
    counts: dict[str, int] = {}
    token_sum = 0
    tool_calls = 0
    agent_starts = 0
    total_tokens: int | None = None
    agent_durations: list[float] = []
    tool_durations: list[float] = []
    agent_start_times: list[datetime] = []
    tool_success = 0
    tool_errors = 0
    agent_errors = 0

    if isinstance(events, list):
        metrics.event_total = len(events)
        for event in events:
            if not isinstance(event, dict):
                continue
            et = str(event.get("event_type") or "unknown")
            counts[et] = counts.get(et, 0) + 1
            if et == "agent_start":
                agent_starts += 1
                ts = _parse_iso_ts(event.get("timestamp"))
                if ts:
                    agent_start_times.append(ts)
            if et == "agent_output":
                tok = event.get("tokens_used")
                if isinstance(tok, (int, float)):
                    token_sum += int(tok)
                dur = event.get("duration_ms")
                if isinstance(dur, (int, float)):
                    agent_durations.append(float(dur))
            if et == "agent_error":
                agent_errors += 1
            if et in {"tool_call", "tool_result", "tool_start", "tool_end"}:
                tool_calls += 1
            if et == "tool_end":
                if event.get("success") is False:
                    tool_errors += 1
                else:
                    tool_success += 1
                dur = event.get("duration_ms")
                if isinstance(dur, (int, float)):
                    tool_durations.append(float(dur))
            if et == "tool_error":
                tool_errors += 1
            if et == "run_end":
                tok = event.get("total_tokens")
                if isinstance(tok, (int, float)):
                    total_tokens = int(tok)
                ans = event.get("final_answer")
                if isinstance(ans, str) and ans.strip():
                    metrics.output_preview = ans.strip()[:200]
                total_time = event.get("total_time")
                if isinstance(total_time, (int, float)):
                    metrics.run_end_total_ms = round(float(total_time) * 1000, 2)
                executed = event.get("executed_agents")
                if isinstance(executed, list):
                    metrics.executed_agent_count = len(executed)

    metrics.event_counts = counts
    metrics.agent_count = agent_starts or counts.get("agent_start", 0)
    metrics.agent_steps = counts.get("agent_output", 0)
    metrics.llm_calls = len(agent_durations) or metrics.agent_steps
    metrics.tool_calls = tool_calls
    metrics.agent_errors = agent_errors
    metrics.tool_success_count = tool_success
    metrics.tool_error_count = tool_errors
    if agent_durations:
        metrics.agent_llm_ms_sum = round(sum(agent_durations), 2)
        metrics.agent_llm_ms_mean = round(statistics.mean(agent_durations), 2)
        metrics.agent_llm_ms_max = round(max(agent_durations), 2)
        metrics.agent_llm_ms_min = round(min(agent_durations), 2)
    if len(agent_start_times) >= 2:
        gaps = [
            (agent_start_times[i] - agent_start_times[i - 1]).total_seconds() * 1000
            for i in range(1, len(agent_start_times))
        ]
        metrics.agent_gap_ms_mean = round(statistics.mean(gaps), 2)
        metrics.agent_gap_ms_max = round(max(gaps), 2)
    if tool_durations:
        metrics.tool_duration_ms_sum = round(sum(tool_durations), 2)
    if token_sum:
        metrics.tokens_ui_sum_agents = token_sum

    wall = _wall_ms(body.get("started_at"), body.get("completed_at"))
    if wall is not None:
        metrics.execution_wall_ms = wall

    result = body.get("result")
    if isinstance(result, dict):
        tok = result.get("total_tokens")
        if isinstance(tok, (int, float)):
            total_tokens = int(tok)
        executed = result.get("executed_agents")
        if isinstance(executed, list) and executed:
            metrics.executed_agent_count = len(executed)
            if not metrics.agent_count:
                metrics.agent_count = len(executed)
        total_time = result.get("total_time")
        if isinstance(total_time, (int, float)) and metrics.run_end_total_ms is None:
            metrics.run_end_total_ms = round(float(total_time) * 1000, 2)

    if total_tokens is not None:
        metrics.tokens_ui_total = total_tokens

    metrics.raw_summary["event_counts"] = counts
    if agent_durations:
        metrics.raw_summary["agent_durations_ms"] = agent_durations


async def _gmas_ws_ttft(base_url: str, run_id: str) -> float | None:
    try:
        import websockets
    except ImportError:
        return None

    ws_base = base_url.replace("http://", "ws://").replace("https://", "wss://")
    url = f"{ws_base}/ws/execution/{run_id}"
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, open_timeout=10) as ws:
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=30)
                if not msg:
                    continue
                try:
                    data = json.loads(msg)
                except json.JSONDecodeError:
                    continue
                et = str(data.get("type") or data.get("event_type") or "")
                if et in {"agent_start", "agent_step", "llm_start", "run_progress"}:
                    return ms(t0)
                if et in {"run_end", "run_error"}:
                    return ms(t0)
    except Exception:
        return None


async def _run_gmas_concurrent(
    gmas: GmasClient,
    graph_id: str,
    task_query: str,
    *,
    concurrency: int,
    llm_provider_id: str | None,
    runner_config: dict[str, Any] | None,
    graph_payload: dict[str, Any] | None,
    poll_interval: float,
    timeout_seconds: float,
    measure_ws_ttft: bool = False,
) -> list[RunMetrics]:
    async def one(idx: int) -> RunMetrics:
        return await asyncio.to_thread(
            gmas.run_until_done,
            graph_id,
            task_query,
            run_index=idx,
            poll_interval=poll_interval,
            timeout_seconds=timeout_seconds,
            llm_provider_id=llm_provider_id,
            runner_config=runner_config,
            graph_payload=graph_payload,
            measure_ws_ttft=measure_ws_ttft,
        )

    return list(await asyncio.gather(*[one(i) for i in range(concurrency)]))


def load_config(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def merge_config(cfg: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    langflow = cfg.get("langflow") or {}
    gmas = cfg.get("gmas") or {}
    obs = cfg.get("observability") or {}
    run_cfg = cfg.get("run") or {}
    imp = cfg.get("import") or {}

    if args.langflow_url:
        langflow["base_url"] = args.langflow_url
    if args.langflow_api_key is not None:
        langflow["api_key"] = args.langflow_api_key
    if args.flow_id:
        langflow["flow_id"] = args.flow_id

    if args.gmas_url:
        gmas["base_url"] = args.gmas_url
    if args.graph_id:
        gmas["graph_id"] = args.graph_id
    if args.llm_provider_id:
        gmas["llm_provider_id"] = args.llm_provider_id

    if args.observability_url:
        obs["base_url"] = args.observability_url
    if args.observability_api_key is not None:
        obs["api_key"] = args.observability_api_key

    if args.task_query:
        cfg["task_query"] = args.task_query
    if args.runs is not None:
        run_cfg["runs_per_scenario"] = args.runs
    if args.skip_execution:
        run_cfg["skip_execution"] = True
    if args.dry_run:
        run_cfg["skip_execution"] = True
    if args.concurrency is not None:
        run_cfg["concurrency"] = args.concurrency
    if args.measure_stream_ttft:
        run_cfg["measure_stream_ttft"] = True
        run_cfg["measure_ws_ttft"] = True

    cfg["langflow"] = langflow
    cfg["gmas"] = gmas
    cfg["observability"] = obs
    cfg["run"] = run_cfg
    cfg["import"] = imp
    return cfg


def normalize_scenarios(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """Expand config into a list of benchmark scenarios."""
    explicit = cfg.get("scenarios")
    if isinstance(explicit, list) and explicit:
        return [s for s in explicit if s.get("enabled", True)]

    langflow = cfg.get("langflow") or {}
    gmas = cfg.get("gmas") or {}
    run_cfg = cfg.get("run") or {}
    return [
        {
            "id": "default",
            "name": "Default scenario",
            "architecture": "custom",
            "enabled": True,
            "task_query": cfg.get("task_query"),
            "runs": run_cfg.get("runs_per_scenario", 1),
            "concurrency": run_cfg.get("concurrency", 1),
            "platforms": ["langflow", "gmas"],
            "langflow": langflow,
            "gmas": gmas,
        }
    ]


def _tag_run(
    metrics: RunMetrics,
    *,
    scenario: dict[str, Any],
    repeat_index: int,
    run_index: int,
) -> None:
    metrics.scenario_id = str(scenario.get("id") or "")
    metrics.scenario_name = str(scenario.get("name") or metrics.scenario_id)
    metrics.architecture = str(scenario.get("architecture") or "")
    metrics.repeat_index = repeat_index
    metrics.run_index = run_index


def _run_metric_stats(items: list[RunMetrics], attr: str) -> dict[str, float | None]:
    values = [getattr(r, attr) for r in items if getattr(r, attr, None) is not None]
    return stats([float(v) for v in values])


def build_comparison(phases: list[PhaseResult], runs: list[RunMetrics]) -> dict[str, Any]:
    by_platform: dict[str, list[RunMetrics]] = {}
    for run in runs:
        by_platform.setdefault(run.platform, []).append(run)

    comparison: dict[str, Any] = {"platforms": {}, "head_to_head": {}}
    for platform, items in by_platform.items():
        ok_items = [r for r in items if r.ok]
        comparison["platforms"][platform] = {
            "runs": len(items),
            "success_rate": round(len(ok_items) / len(items), 3) if items else None,
            "run_start_ms": stats([r.run_start_ms for r in ok_items if r.run_start_ms is not None]),
            "e2e_ms": stats([r.e2e_ms for r in ok_items if r.e2e_ms is not None]),
            "ttft_ms": stats([r.ttft_ms for r in ok_items if r.ttft_ms is not None]),
            "first_event_ms": _run_metric_stats(ok_items, "first_event_ms"),
            "ws_ttft_ms": _run_metric_stats(ok_items, "ws_ttft_ms"),
            "time_to_first_agent_ms": _run_metric_stats(ok_items, "time_to_first_agent_ms"),
            "compile_setup_ms": _run_metric_stats(ok_items, "compile_setup_ms"),
            "poll_wait_ms": _run_metric_stats(ok_items, "poll_wait_ms"),
            "execution_wall_ms": _run_metric_stats(ok_items, "execution_wall_ms"),
            "agent_gap_ms_mean": _run_metric_stats(ok_items, "agent_gap_ms_mean"),
            "agent_llm_ms_sum": _run_metric_stats(ok_items, "agent_llm_ms_sum"),
            "orchestration_overhead_ms": _run_metric_stats(ok_items, "orchestration_overhead_ms"),
            "tokens_ui_total": stats([float(r.tokens_ui_total) for r in ok_items if r.tokens_ui_total is not None]),
            "tokens_provider_total": stats(
                [
                    float((r.tokens_provider_input or 0) + (r.tokens_provider_output or 0))
                    for r in ok_items
                    if r.tokens_provider_input is not None or r.tokens_provider_output is not None
                ]
            ),
        }

    lf = comparison["platforms"].get("langflow", {}).get("e2e_ms", {})
    gm = comparison["platforms"].get("gmas", {}).get("e2e_ms", {})
    if lf.get("mean_ms") and gm.get("mean_ms"):
        comparison["head_to_head"]["e2e_mean_delta_ms"] = round(gm["mean_ms"] - lf["mean_ms"], 2)
        comparison["head_to_head"]["gmas_slower"] = gm["mean_ms"] > lf["mean_ms"]

    comparison["phases"] = {
        "langflow_ok": sum(1 for p in phases if p.platform == "langflow" and p.ok),
        "gmas_ok": sum(1 for p in phases if p.platform == "gmas" and p.ok),
        "observability_ok": sum(1 for p in phases if p.platform == "observability" and p.ok),
    }
    comparison["compile_validate"] = _compile_phase_summary(phases)
    comparison["design_time"] = _design_phase_summary(phases)
    comparison["by_scenario"] = _build_scenario_matrix(runs)
    return comparison


def _design_phase_summary(phases: list[PhaseResult]) -> dict[str, Any]:
    """Aggregate list/fetch/build/validate API timings (no execution)."""
    summary: dict[str, Any] = {"phases": [], "by_name": {}}
    design_names = {
        "list_graphs",
        "list_flows",
        "history_summary",
        "fetch_flow",
        "fetch_graph",
        "build_flow",
        "validate_inline",
    }
    for phase in phases:
        base = phase.name.split(":", 1)[0]
        if base not in design_names and not phase.name.startswith(("fetch_flow:", "fetch_graph:", "build_flow:", "validate_inline:")):
            continue
        row = {
            "phase": phase.name,
            "platform": phase.platform,
            "ok": phase.ok,
            "duration_ms": phase.duration_ms,
            "error": phase.error,
            "data": phase.data,
        }
        summary["phases"].append(row)
        bucket = summary["by_name"].setdefault(base, {"durations_ms": [], "ok_count": 0, "fail_count": 0})
        bucket["durations_ms"].append(phase.duration_ms)
        if phase.ok:
            bucket["ok_count"] += 1
        else:
            bucket["fail_count"] += 1
    for name, bucket in summary["by_name"].items():
        bucket["stats"] = stats(bucket["durations_ms"])
        del bucket["durations_ms"]
    return summary


def _compile_phase_summary(phases: list[PhaseResult]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for phase in phases:
        if not phase.name.startswith("compile_validate"):
            continue
        data = phase.data or {}
        rows.append(
            {
                "phase": phase.name,
                "graph_id": data.get("graph_id"),
                "ok": phase.ok,
                "duration_ms": phase.duration_ms,
                "compile_validate_ms": data.get("compile_validate_ms"),
                "compile_validate_p50_ms": data.get("compile_validate_p50_ms"),
                "compile_validate_repeats": data.get("compile_validate_repeats"),
                "execution_order_len": data.get("execution_order_len"),
                "error_count": data.get("error_count"),
                "warning_count": data.get("warning_count"),
            }
        )
    return rows


def _collect_graph_profiles(phases: list[PhaseResult]) -> dict[str, dict[str, Any]]:
    profiles: dict[str, dict[str, Any]] = {}
    for phase in phases:
        data = phase.data or {}
        graph_id = data.get("graph_id")
        if not graph_id:
            continue
        profile = profiles.setdefault(str(graph_id), {"graph_id": graph_id})
        if phase.name.startswith("fetch_graph"):
            profile["structure"] = {k: v for k, v in data.items() if k != "graph_id"}
        if phase.name.startswith("compile_validate"):
            profile["compile_validate"] = {
                k: v
                for k, v in data.items()
                if k.startswith("compile_validate") or k in {
                    "is_valid",
                    "execution_order_len",
                    "error_count",
                    "warning_count",
                    "execution_order",
                }
            }
    return profiles


def _build_scenario_matrix(runs: list[RunMetrics]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[RunMetrics]] = {}
    for run in runs:
        key = (run.scenario_id or "default", run.platform)
        grouped.setdefault(key, []).append(run)

    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for run in runs:
        sid = run.scenario_id or "default"
        if sid in seen:
            continue
        seen.add(sid)
        sample = next(r for r in runs if (r.scenario_id or "default") == sid)
        row: dict[str, Any] = {
            "scenario_id": sid,
            "scenario_name": sample.scenario_name,
            "architecture": sample.architecture,
            "platforms": {},
        }
        for platform in ("langflow", "gmas"):
            items = grouped.get((sid, platform), [])
            ok_items = [r for r in items if r.ok]
            row["platforms"][platform] = {
                "runs": len(items),
                "success_rate": round(len(ok_items) / len(items), 3) if items else None,
                "e2e_ms": stats([r.e2e_ms for r in ok_items if r.e2e_ms is not None]),
                "run_start_ms": stats([r.run_start_ms for r in ok_items if r.run_start_ms is not None]),
                "tokens_ui_total": stats(
                    [float(r.tokens_ui_total) for r in ok_items if r.tokens_ui_total is not None]
                ),
                "agent_count_mean": round(
                    statistics.mean([r.agent_count for r in ok_items if r.agent_count > 0]), 2
                )
                if any(r.agent_count > 0 for r in ok_items)
                else None,
                "e2e_per_agent_ms": stats(
                    [r.e2e_per_agent_ms for r in ok_items if r.e2e_per_agent_ms is not None]
                ),
                "first_event_ms": _run_metric_stats(ok_items, "first_event_ms"),
                "time_to_first_agent_ms": _run_metric_stats(ok_items, "time_to_first_agent_ms"),
                "compile_setup_ms": _run_metric_stats(ok_items, "compile_setup_ms"),
                "poll_wait_ms": _run_metric_stats(ok_items, "poll_wait_ms"),
                "execution_wall_ms": _run_metric_stats(ok_items, "execution_wall_ms"),
                "agent_gap_ms_mean": _run_metric_stats(ok_items, "agent_gap_ms_mean"),
                "agent_llm_ms_sum": _run_metric_stats(ok_items, "agent_llm_ms_sum"),
                "orchestration_overhead_ms": _run_metric_stats(ok_items, "orchestration_overhead_ms"),
            }
        lf = row["platforms"].get("langflow", {}).get("e2e_ms", {})
        gm = row["platforms"].get("gmas", {}).get("e2e_ms", {})
        if lf.get("mean_ms") and gm.get("mean_ms"):
            row["e2e_delta_ms"] = round(gm["mean_ms"] - lf["mean_ms"], 2)
        rows.append(row)
    return rows


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Langflow vs gMAS benchmark",
        "",
        f"- Generated: `{report['generated_at']}`",
        f"- Report id: `{report['report_id']}`",
        "",
        "## Configuration",
        "",
        "```json",
        json.dumps(report.get("config_summary") or {}, indent=2),
        "```",
        "",
        "## Phase results",
        "",
        "| Platform | Phase | OK | ms | Notes |",
        "| --- | --- | --- | ---: | --- |",
    ]
    for phase in report.get("phases") or []:
        note = phase.get("error") or json.dumps(phase.get("data") or {}, ensure_ascii=False)[:120]
        lines.append(
            f"| {phase['platform']} | {phase['name']} | {'yes' if phase['ok'] else 'no'} | "
            f"{phase['duration_ms']} | {note} |"
        )

    profiles = report.get("graph_profiles") or {}
    if profiles:
        lines.extend(["", "## Graph structure & compile", ""])
        for graph_id, profile in profiles.items():
            structure = profile.get("structure") or {}
            compile_info = profile.get("compile_validate") or {}
            lines.append(f"### Graph `{graph_id}` — {structure.get('name', '')}")
            lines.append("")
            lines.append("| Metric | Value |")
            lines.append("| --- | --- |")
            for key in (
                "agent_count",
                "edge_count",
                "enabled_edge_count",
                "conditional_edge_count",
                "loop_edge_count",
                "unique_tool_count",
                "agents_with_tools",
                "agents_with_input_schema",
                "agents_with_output_schema",
                "unique_llm_model_count",
                "execution_order_len",
                "json_bytes",
                "fetch_ms",
            ):
                val = structure.get(key)
                if val is not None:
                    lines.append(f"| {key} | {val} |")
            for key in (
                "compile_validate_ms",
                "compile_validate_p50_ms",
                "compile_validate_repeats",
                "compile_validate_warmup_delta_ms",
                "error_count",
                "warning_count",
            ):
                val = compile_info.get(key)
                if val is not None:
                    lines.append(f"| {key} | {val} |")
            lines.append("")

    lines.extend(["", "## Scenario matrix", ""])
    lines.append(
        "| Scenario | Architecture | LF e2e p50 | gMAS e2e p50 | gMAS setup p50 | gMAS LLM p50 | Δ ms | LF ok | gMAS ok |"
    )
    lines.append("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |")
    for row in (report.get("comparison") or {}).get("by_scenario") or []:
        lf = (row.get("platforms") or {}).get("langflow") or {}
        gm = (row.get("platforms") or {}).get("gmas") or {}
        lf_e2e = (lf.get("e2e_ms") or {}).get("p50_ms")
        gm_e2e = (gm.get("e2e_ms") or {}).get("p50_ms")
        gm_setup = (gm.get("compile_setup_ms") or {}).get("p50_ms")
        gm_llm = (gm.get("agent_llm_ms_sum") or {}).get("p50_ms")
        lines.append(
            f"| {row.get('scenario_name')} | {row.get('architecture')} | "
            f"{lf_e2e if lf_e2e is not None else '-'} | "
            f"{gm_e2e if gm_e2e is not None else '-'} | "
            f"{gm_setup if gm_setup is not None else '-'} | "
            f"{gm_llm if gm_llm is not None else '-'} | "
            f"{row.get('e2e_delta_ms', '-')} | "
            f"{lf.get('success_rate', '-')} | {gm.get('success_rate', '-')} |"
        )

    design = (report.get("comparison") or {}).get("design_time") or {}
    by_name = design.get("by_name") or {}
    if by_name:
        lines.extend(["", "## Design-time API latency", ""])
        lines.append("| Phase | p50 ms | mean ms | ok | fail |")
        lines.append("| --- | ---: | ---: | ---: | ---: |")
        for name, info in sorted(by_name.items()):
            st = info.get("stats") or {}
            lines.append(
                f"| {name} | {st.get('p50_ms', '-')} | {st.get('mean_ms', '-')} | "
                f"{info.get('ok_count', 0)} | {info.get('fail_count', 0)} |"
            )

    lines.extend(["", "## Run metrics", ""])
    current_scenario = None
    for run in report.get("runs") or []:
        sid = run.get("scenario_id") or "default"
        if sid != current_scenario:
            current_scenario = sid
            lines.extend(
                [
                    f"### Scenario: {run.get('scenario_name') or sid} (`{run.get('architecture')}`)",
                    "",
                ]
            )
        lines.append(
            f"#### {run['platform']} repeat #{run.get('repeat_index', run['run_index']) + 1}"
        )
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("| --- | --- |")
        for key in (
            "ok",
            "status",
            "architecture",
            "graph_id",
            "flow_id",
            "run_start_ms",
            "time_to_first_agent_ms",
            "compile_setup_ms",
            "e2e_ms",
            "e2e_per_agent_ms",
            "first_event_ms",
            "ws_ttft_ms",
            "agent_llm_ms_sum",
            "agent_llm_ms_mean",
            "agent_llm_ms_min",
            "agent_llm_ms_max",
            "agent_gap_ms_mean",
            "agent_gap_ms_max",
            "orchestration_overhead_ms",
            "execution_wall_ms",
            "poll_wait_ms",
            "ttft_ms",
            "poll_count",
            "agent_count",
            "executed_agent_count",
            "agent_steps",
            "llm_calls",
            "tool_calls",
            "tool_duration_ms_sum",
            "agent_errors",
            "event_total",
            "tokens_ui_total",
            "tokens_ui_sum_agents",
            "tokens_provider_input",
            "tokens_provider_output",
            "output_preview",
            "trace_event_count",
            "error",
        ):
            val = run.get(key)
            if val is not None:
                lines.append(f"| {key} | {val} |")
        lines.append("")

    comp = report.get("comparison") or {}
    lines.extend(["## Aggregated comparison", "", "```json", json.dumps(comp, indent=2), "```", ""])
    return "\n".join(lines)


def write_csv_report(report: dict[str, Any], path: Path) -> None:
    import csv

    fields = [
        "scenario_id",
        "scenario_name",
        "architecture",
        "platform",
        "repeat_index",
        "ok",
        "status",
        "run_start_ms",
        "time_to_first_agent_ms",
        "compile_setup_ms",
        "e2e_ms",
        "e2e_per_agent_ms",
        "first_event_ms",
        "ws_ttft_ms",
        "agent_llm_ms_sum",
        "agent_llm_ms_mean",
        "agent_llm_ms_min",
        "agent_llm_ms_max",
        "agent_gap_ms_mean",
        "agent_gap_ms_max",
        "orchestration_overhead_ms",
        "execution_wall_ms",
        "poll_wait_ms",
        "ttft_ms",
        "poll_count",
        "agent_count",
        "executed_agent_count",
        "agent_steps",
        "llm_calls",
        "tool_calls",
        "tool_duration_ms_sum",
        "agent_errors",
        "tool_success_count",
        "tool_error_count",
        "event_total",
        "tokens_ui_total",
        "tokens_provider_input",
        "tokens_provider_output",
        "graph_agent_count",
        "graph_edge_count",
        "graph_tool_count",
        "compile_validate_p50_ms",
        "graph_id",
        "flow_id",
        "error",
    ]
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        profiles = report.get("graph_profiles") or {}
        for run in report.get("runs") or []:
            row = {k: run.get(k) for k in fields}
            gid = run.get("graph_id")
            if gid and gid in profiles:
                structure = (profiles[gid].get("structure") or {})
                compile_info = (profiles[gid].get("compile_validate") or {})
                row["graph_agent_count"] = structure.get("agent_count")
                row["graph_edge_count"] = structure.get("edge_count")
                row["graph_tool_count"] = structure.get("unique_tool_count")
                row["compile_validate_p50_ms"] = compile_info.get("compile_validate_p50_ms")
            writer.writerow(row)


def _unwrap_phase(phase: PhaseResult) -> tuple[bool, float, str | None, dict[str, Any]]:
    return phase.ok, phase.duration_ms, phase.error, phase.data


def run_benchmark(cfg: dict[str, Any], report_dir: Path, scenario_filter: str | None = None) -> dict[str, Any]:
    langflow_cfg = cfg.get("langflow") or {}
    gmas_cfg = cfg.get("gmas") or {}
    obs_cfg = cfg.get("observability") or {}
    run_cfg = cfg.get("run") or {}
    imp_cfg = cfg.get("import") or {}

    default_task = cfg.get("task_query") or "Reply with exactly: benchmark-ok"
    timeout_seconds = float(run_cfg.get("timeout_seconds") or 300)
    poll_interval = float(run_cfg.get("poll_interval_seconds") or 0.25)
    skip_execution = bool(run_cfg.get("skip_execution"))
    measure_stream_ttft = bool(
        run_cfg.get("measure_stream_ttft", run_cfg.get("measure_ws_ttft", False))
    )
    measure_design_time = bool(run_cfg.get("measure_design_time", True))
    compile_repeats = max(1, int(run_cfg.get("compile_validate_repeats") or 1))

    scenarios = normalize_scenarios(cfg)
    if scenario_filter:
        scenarios = [s for s in scenarios if s.get("id") == scenario_filter]
        if not scenarios:
            raise SystemExit(f"Unknown scenario id: {scenario_filter}")

    phases: list[PhaseResult] = []
    runs: list[RunMetrics] = []
    run_counter = 0
    validated_graphs: set[str] = set()
    stripped_graph_cache: dict[str, dict[str, Any]] = {}

    langflow = LangflowClient(
        langflow_cfg.get("base_url") or os.getenv("LANGFLOW_SERVER_URL", "http://localhost:7860"),
        api_key=langflow_cfg.get("api_key") or os.getenv("LANGFLOW_API_KEY", ""),
        timeout=timeout_seconds,
    )
    gmas = GmasClient(
        gmas_cfg.get("base_url") or os.getenv("GMAS_API_URL", "http://localhost:8000"),
        timeout=timeout_seconds,
    )
    obs = ObservabilityClient(
        obs_cfg.get("base_url") or os.getenv("GMAS_OBSERVABILITY_URL", "http://localhost:8100"),
        api_key=obs_cfg.get("api_key") or os.getenv("GMAS_OBSERVABILITY_API_KEY", ""),
    )

    try:
        phases.append(langflow.health())
        phases.append(langflow.version())
        phases.append(gmas.health())
        phases.append(obs.health())

        flow_id = langflow_cfg.get("flow_id") or os.getenv("FLOW_ID", "")
        graph_id = gmas_cfg.get("graph_id") or os.getenv("GMAS_GRAPH_ID", "")

        import_path = imp_cfg.get("langflow_json_path") or ""
        if import_path:
            path = Path(import_path)
            if not path.is_absolute():
                path = REPO_ROOT / path
            if path.exists():
                phases.append(gmas.import_langflow(path, imp_cfg.get("name_override")))

        if measure_design_time:
            phases.append(gmas.list_graphs())
            phases.append(langflow.list_flows())
            phases.append(gmas.history_summary())

        for scenario in scenarios:
            sid = str(scenario.get("id") or "")
            sc_langflow = {**langflow_cfg, **(scenario.get("langflow") or {})}
            sc_gmas = {**gmas_cfg, **(scenario.get("gmas") or {})}
            task_query = scenario.get("task_query") or default_task
            runs_per = int(scenario.get("runs") or run_cfg.get("runs_per_scenario") or 1)
            concurrency = max(1, int(scenario.get("concurrency") or run_cfg.get("concurrency") or 1))
            platforms = scenario.get("platforms") or ["langflow", "gmas"]
            sc_flow = sc_langflow.get("flow_id") or flow_id
            sc_graph = sc_gmas.get("graph_id") or graph_id
            graph_structure: dict[str, Any] = {}
            flow_structure: dict[str, Any] = {}

            if sc_flow and "langflow" in platforms:
                p = langflow.get_flow(sc_flow)
                flow_structure = p.data or {}
                phases.append(PhaseResult(f"fetch_flow:{sid}", "langflow", p.ok, p.duration_ms, p.error, p.data))
                if measure_design_time:
                    build = langflow.build_flow_job(sc_flow)
                    phases.append(
                        PhaseResult(f"build_flow:{sid}", "langflow", build.ok, build.duration_ms, build.error, build.data)
                    )
            if sc_graph and sc_graph not in validated_graphs and "gmas" in platforms:
                p = gmas.get_graph(sc_graph)
                graph_structure = p.data or {}
                phases.append(PhaseResult(f"fetch_graph:{sid}", "gmas", p.ok, p.duration_ms, p.error, p.data))
                val = gmas.compile_validate_graph(sc_graph, repeats=compile_repeats)
                phases.append(
                    PhaseResult(f"compile_validate:{sid}", "gmas", val.ok, val.duration_ms, val.error, val.data)
                )
                validated_graphs.add(sc_graph)
            elif sc_graph:
                for phase in reversed(phases):
                    data = phase.data or {}
                    if phase.name.startswith("fetch_graph") and data.get("graph_id") == sc_graph:
                        graph_structure = data
                        break

            disable_tools = sc_gmas.get("disable_tools", gmas_cfg.get("disable_tools", True))
            if measure_design_time and sc_graph and "gmas" in platforms and disable_tools:
                if sc_graph not in stripped_graph_cache:
                    stripped_graph_cache[sc_graph] = strip_graph_tools(gmas.get_graph_body(sc_graph))
                val_inline = gmas.validate_inline(stripped_graph_cache[sc_graph])
                phases.append(
                    PhaseResult(
                        f"validate_inline:{sid}",
                        "gmas",
                        val_inline.ok,
                        val_inline.duration_ms,
                        val_inline.error,
                        {**(val_inline.data or {}), "graph_id": sc_graph},
                    )
                )

            if skip_execution:
                continue

            llm_provider_id = sc_gmas.get("llm_provider_id") or gmas_cfg.get("llm_provider_id")
            runner_config = merge_gmas_runner_config(
                sc_gmas.get("config") or sc_gmas.get("run_config") or gmas_cfg.get("config"),
                disable_tools=bool(disable_tools),
            )
            graph_payload: dict[str, Any] | None = None
            if sc_graph and disable_tools:
                if sc_graph not in stripped_graph_cache:
                    stripped_graph_cache[sc_graph] = strip_graph_tools(gmas.get_graph_body(sc_graph))
                graph_payload = stripped_graph_cache[sc_graph]
            sc_timeout = float(scenario.get("timeout_seconds") or timeout_seconds)

            if sc_flow and "langflow" in platforms:
                for repeat in range(runs_per):
                    run = langflow.run_sync(
                        sc_flow,
                        task_query,
                        run_index=run_counter,
                        stream=measure_stream_ttft,
                    )
                    run.flow_id = sc_flow
                    llm_steps = flow_structure.get("llm_like_node_count") or 0
                    if isinstance(llm_steps, int) and llm_steps > 0:
                        run.agent_count = llm_steps
                        run.llm_calls = llm_steps
                    _tag_run(run, scenario=scenario, repeat_index=repeat, run_index=run_counter)
                    run.raw_summary["mode"] = "stream" if measure_stream_ttft else "sync"
                    runs.append(run)
                    run_counter += 1

            if sc_graph and "gmas" in platforms:
                if concurrency > 1:
                    batch = asyncio.run(
                        _run_gmas_concurrent(
                            gmas,
                            sc_graph,
                            task_query,
                            concurrency=concurrency,
                            llm_provider_id=llm_provider_id,
                            runner_config=runner_config,
                            graph_payload=graph_payload,
                            poll_interval=poll_interval,
                            timeout_seconds=sc_timeout,
                            measure_ws_ttft=measure_stream_ttft,
                        )
                    )
                    for repeat, run in enumerate(batch):
                        run.graph_id = sc_graph
                        run.graph_structure = graph_structure
                        _tag_run(run, scenario=scenario, repeat_index=repeat, run_index=run_counter)
                        obs.enrich_gmas_run(
                            run,
                            project_id=obs_cfg.get("project_id") or "gmas-demo",
                            environment=obs_cfg.get("environment") or "development",
                        )
                        runs.append(run)
                        run_counter += 1
                else:
                    for repeat in range(runs_per):
                        run = gmas.run_until_done(
                            sc_graph,
                            task_query,
                            run_index=run_counter,
                            poll_interval=poll_interval,
                            timeout_seconds=sc_timeout,
                            llm_provider_id=llm_provider_id,
                            runner_config=runner_config,
                            graph_payload=graph_payload,
                            measure_ws_ttft=measure_stream_ttft,
                        )
                        run.graph_id = sc_graph
                        run.graph_structure = graph_structure
                        run.raw_summary["disable_tools"] = disable_tools
                        _tag_run(run, scenario=scenario, repeat_index=repeat, run_index=run_counter)
                        obs.enrich_gmas_run(
                            run,
                            project_id=obs_cfg.get("project_id") or "gmas-demo",
                            environment=obs_cfg.get("environment") or "development",
                        )
                        runs.append(run)
                        run_counter += 1
    finally:
        langflow.close()
        gmas.close()
        obs.close()

    graph_profiles = _collect_graph_profiles(phases)

    report_id = str(uuid.uuid4())
    report = {
        "report_id": report_id,
        "generated_at": utc_now_iso(),
        "config_summary": {
            "task_query": default_task,
            "scenario_count": len(scenarios),
            "scenario_ids": [s.get("id") for s in scenarios],
            "skip_execution": skip_execution,
            "compile_validate_repeats": compile_repeats,
            "measure_stream_ttft": measure_stream_ttft,
            "measure_design_time": measure_design_time,
        },
        "scenarios": scenarios,
        "graph_profiles": graph_profiles,
        "phases": [asdict(p) for p in phases],
        "runs": [asdict(r) for r in runs],
        "comparison": build_comparison(phases, runs),
    }

    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = report_dir / f"benchmark_{stamp}_{report_id[:8]}.json"
    md_path = report_dir / f"benchmark_{stamp}_{report_id[:8]}.md"
    csv_path = report_dir / f"benchmark_{stamp}_{report_id[:8]}.csv"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    write_csv_report(report, csv_path)

    prefix = f"benchmark_{stamp}_{report_id[:8]}"
    visual_paths: dict[str, str] = {}
    try:
        import benchmark_visualize as viz

        visual_paths = viz.write_visual_report(report, report_dir, prefix)
        md_path.write_text(
            md_path.read_text(encoding="utf-8") + "\n" + viz.render_comparison_table_md(viz.build_comparison_rows(report)),
            encoding="utf-8",
        )
    except Exception as exc:
        visual_paths = {"visualize_error": str(exc)}

    report["output_paths"] = {
        "json": str(json_path),
        "markdown": str(md_path),
        "csv": str(csv_path),
        **visual_paths,
    }
    return report


def print_summary(report: dict[str, Any]) -> None:
    print("\n=== Langflow vs gMAS benchmark ===\n")
    for phase in report.get("phases") or []:
        status = "OK" if phase["ok"] else "FAIL"
        print(f"[{status}] {phase['platform']:14} {phase['name']:18} {phase['duration_ms']:8.2f} ms")
        if phase.get("error"):
            print(f"       error: {phase['error']}")

    print("\n--- Runs ---")
    for run in report.get("runs") or []:
        label = run.get("scenario_id") or "default"
        setup = run.get("compile_setup_ms")
        llm_sum = run.get("agent_llm_ms_sum")
        ttfa = run.get("time_to_first_agent_ms")
        extra = ""
        if setup is not None:
            extra += f" setup={setup}ms"
        if ttfa is not None:
            extra += f" ttfa={ttfa}ms"
        if llm_sum is not None:
            extra += f" llm={llm_sum}ms"
        if run.get("poll_wait_ms") is not None:
            extra += f" poll={run['poll_wait_ms']}ms"
        print(
            f"[{'OK' if run['ok'] else 'FAIL'}] {label:16} {run['platform']:10} "
            f"#{run.get('repeat_index', 0) + 1} "
            f"start={run.get('run_start_ms')}ms e2e={run.get('e2e_ms')}ms "
            f"agents={run.get('agent_count')} tokens={run.get('tokens_ui_total')}{extra}"
        )
        if run.get("error"):
            print(f"       error: {run['error']}")

    profiles = report.get("graph_profiles") or {}
    if profiles:
        print("\n--- Graph compile (validate/build) ---")
        for graph_id, profile in profiles.items():
            compile_info = profile.get("compile_validate") or {}
            structure = profile.get("structure") or {}
            print(
                f"  {graph_id} agents={structure.get('agent_count')} edges={structure.get('edge_count')} "
                f"compile_p50={compile_info.get('compile_validate_p50_ms')}ms "
                f"order_len={compile_info.get('execution_order_len')}"
            )

    comp = report.get("comparison") or {}
    print("\n--- Scenario matrix (e2e p50 ms) ---")
    for row in comp.get("by_scenario") or []:
        lf = (row.get("platforms") or {}).get("langflow", {}).get("e2e_ms", {})
        gm = (row.get("platforms") or {}).get("gmas", {}).get("e2e_ms", {})
        print(
            f"  {row.get('scenario_name'):28} LF={lf.get('p50_ms', '-')}  "
            f"gMAS={gm.get('p50_ms', '-')}  Δ={row.get('e2e_delta_ms', '-')}"
        )

    paths = report.get("output_paths") or {}
    if paths:
        print("\nReports:")
        print(f"  JSON:  {paths.get('json')}")
        print(f"  MD:    {paths.get('markdown')}")
        print(f"  CSV:   {paths.get('csv')}")
        if paths.get("html_dashboard"):
            print(f"  HTML:  {paths.get('html_dashboard')}")
        if paths.get("comparison_csv"):
            print(f"  Table: {paths.get('comparison_csv')}")
        charts = [v for k, v in paths.items() if k.startswith("chart_")]
        if charts:
            print(f"  Charts: {len(charts)} PNG in {Path(charts[0]).parent}")
        if paths.get("visualize_error"):
            print(f"  Visualize error: {paths.get('visualize_error')}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark Langflow vs gMAS-demo APIs")
    parser.add_argument("--config", type=Path, help="JSON config path")
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR)
    parser.add_argument("--langflow-url", help="Langflow base URL")
    parser.add_argument("--langflow-api-key", default=None, help="Langflow x-api-key")
    parser.add_argument("--flow-id", help="Langflow flow UUID")
    parser.add_argument("--gmas-url", help="gMAS API base URL")
    parser.add_argument("--graph-id", help="gMAS graph UUID")
    parser.add_argument("--llm-provider-id", help="Optional gMAS llm_provider_id")
    parser.add_argument("--observability-url", help="Observability service URL")
    parser.add_argument("--observability-api-key", default=None)
    parser.add_argument("--task-query", help="Prompt for execution runs")
    parser.add_argument("--runs", type=int, help="Repeat count per platform")
    parser.add_argument("--concurrency", type=int, help="Parallel gMAS runs")
    parser.add_argument("--skip-execution", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="Health + metadata + validate/import only")
    parser.add_argument("--measure-stream-ttft", action="store_true", help="Langflow stream / gMAS WS TTFT")
    parser.add_argument("--scenario", help="Run only one scenario id from config")
    parser.add_argument("--json-only", action="store_true", help="Suppress human summary")
    parser.add_argument(
        "--visualize-only",
        type=Path,
        help="Generate charts/table/HTML from an existing benchmark JSON report",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.visualize_only:
        import benchmark_visualize as viz

        paths = viz.visualize_report_file(args.visualize_only, args.report_dir)
        print(json.dumps(paths, indent=2, ensure_ascii=False))
        print(f"\nOpen dashboard: {paths.get('html_dashboard')}")
        return 0
    cfg = load_config(args.config)
    cfg = merge_config(cfg, args)
    report = run_benchmark(cfg, args.report_dir, scenario_filter=args.scenario)
    if not args.json_only:
        print_summary(report)
    else:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    failed_phases = sum(1 for p in report["phases"] if not p["ok"])
    failed_runs = sum(1 for r in report["runs"] if not r["ok"])
    return 1 if failed_phases or failed_runs else 0


if __name__ == "__main__":
    raise SystemExit(main())
