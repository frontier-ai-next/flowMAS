"""Standalone ingestion, query API, and minimal trace explorer."""

import html
import json
import secrets
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from urllib.parse import quote, urlencode

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from .config import settings
from .models import EventBatchIn
from .store import EventStore

store = EventStore(Path(settings.data_dir) / "observability.sqlite3")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await store.initialize()
    yield
    await store.close()


app = FastAPI(
    title="gMAS Observability",
    description="Self-hosted tracing and analytics for applications built on gMAS",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


def authorize(authorization: str | None = Header(default=None)) -> None:
    if not settings.api_key:
        return
    expected = f"Bearer {settings.api_key}"
    if not authorization or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Invalid observability API key")


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", **await store.stats()}


@app.post("/api/v1/events/batch", status_code=202, dependencies=[Depends(authorize)])
async def ingest(batch: EventBatchIn) -> dict:
    return {"accepted": await store.insert(batch.events)}


@app.get("/api/v1/traces", dependencies=[Depends(authorize)])
async def traces(
    project_id: str | None = None,
    environment: str | None = None,
    search: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    items = await store.list_traces(
        project_id=project_id,
        environment=environment,
        search=search,
        limit=limit,
        offset=offset,
    )
    return {"items": items, "limit": limit, "offset": offset}


@app.get("/api/v1/metrics/overview", dependencies=[Depends(authorize)])
async def metrics_overview(
    project_id: str | None = None, environment: str | None = None
) -> dict:
    return await store.overview(project_id=project_id, environment=environment)


@app.get("/api/v1/metrics/tokens", dependencies=[Depends(authorize)])
async def token_metrics(
    project_id: str | None = None,
    environment: str | None = None,
    days: int = Query(default=30, ge=0, le=365),
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict:
    if (start_date is None) != (end_date is None):
        raise HTTPException(
            status_code=422, detail="start_date and end_date must be provided together"
        )
    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=422, detail="start_date must not be after end_date"
        )
    if start_date and end_date and (end_date - start_date).days >= 366:
        raise HTTPException(
            status_code=422, detail="date range must not exceed 366 days"
        )
    points = await store.token_timeseries(
        project_id=project_id,
        environment=environment,
        days=None if days == 0 else days,
        start_date=start_date,
        end_date=end_date,
    )
    return {
        "points": points,
        "days": days,
        "start_date": start_date,
        "end_date": end_date,
        "timezone": "UTC",
    }


@app.get("/api/v1/traces/{trace_id}", dependencies=[Depends(authorize)])
async def trace_detail(trace_id: str) -> dict:
    trace = await store.get_trace(trace_id)
    if trace is None:
        raise HTTPException(status_code=404, detail="Trace not found")
    return trace


@app.get("/", response_class=HTMLResponse, dependencies=[Depends(authorize)])
async def dashboard(
    project: str | None = None,
    environment: str | None = None,
    q: str | None = None,
    period: str = "30",
    start_date: date | None = None,
    end_date: date | None = None,
) -> str:
    selected_period = period if period in {"today", "7", "30", "custom"} else "30"
    today = datetime.now(UTC).date()
    custom_start = start_date or today - timedelta(days=29)
    custom_end = end_date or today
    if custom_start > custom_end:
        custom_start, custom_end = custom_end, custom_start
    if (custom_end - custom_start).days >= 366:
        custom_start = custom_end - timedelta(days=365)
    days = {"today": 1, "7": 7, "30": 30}.get(selected_period)
    rows = await store.list_traces(
        project_id=project, environment=environment, search=q, limit=100
    )
    metrics = await store.overview(project_id=project, environment=environment)
    token_points = await store.token_timeseries(
        project_id=project,
        environment=environment,
        days=days,
        start_date=custom_start if selected_period == "custom" else None,
        end_date=custom_end if selected_period == "custom" else None,
    )
    kpis = "".join(
        (
            _kpi("Traces", metrics["trace_count"], "workflow executions"),
            _kpi(
                "Success",
                _percent(metrics["success_rate"]),
                f"{metrics['error_count']} failed observations",
                "good",
            ),
            _kpi("Avg latency", _duration(metrics["avg_duration_ms"]), "end-to-end"),
            _kpi(
                "Tokens",
                _provider_tokens(metrics["total_tokens"], metrics["usage_calls"]),
                f"provider usage · {_coverage(metrics['usage_calls'], metrics['llm_calls'])}",
            ),
            _kpi("Agent runs", metrics["agent_runs"], "gMAS-native"),
        )
    )
    body = (
        "".join(
            f"<tr class='trace-row'><td><a class='trace-link' href='/traces/{quote(row['trace_id'])}'>"
            f"<strong>{_h(row.get('graph_name') or 'gMAS workflow')}</strong><small>{_h(row['trace_id'])}</small></a></td>"
            f"<td><span class='status {'ok' if row.get('success') else 'error' if row.get('success') is not None else 'running'}'>"
            f"{'success' if row.get('success') else 'failed' if row.get('success') is not None else 'running'}</span></td>"
            f"<td><span class='input-preview'>{_h(_truncate(row.get('input') or '—', 72))}</span></td>"
            f"<td>{row.get('agent_count') or 0} <small>agents</small><br>{row.get('llm_count') or 0} <small>LLM</small></td>"
            f"<td>{_duration(row.get('duration_ms'))}<br><small>{_provider_tokens(row.get('total_tokens') or 0, row.get('usage_count') or 0)} provider tok · {_coverage(row.get('usage_count') or 0, row.get('llm_count') or 0)}</small></td>"
            f"<td><span class='env'>{_h(row['environment'])}</span><br><small>{_time(row['updated_at'])}</small></td></tr>"
            for row in rows
        )
        or "<tr><td colspan='6'><div class='empty'>No traces match these filters yet.</div></td></tr>"
    )
    return _page(
        "Traces",
        f"""
        {_header()}
        <main><section class='hero'><div><span class='eyebrow'>gMAS CONTROL PLANE</span><h1>Multi-agent observability</h1>
        <p>See decisions, handoffs, model calls, memory and topology—not just logs.</p></div></section>
        <section class='kpis'>{kpis}</section>
        <section class='panel analytics-panel'><div class='panel-head analytics-head'><div><h2>Provider token usage over time</h2><p>Input and output tokens reported by LLM providers · UTC</p></div>{_period_controls(selected_period, custom_start, custom_end, project, environment, q)}</div>
        {_token_chart(token_points)}</section>
        <section class='panel'><div class='panel-head'><div><h2>Recent traces</h2><p>End-to-end workflow executions</p></div>
        <form class='filters'><input name='q' value='{_h(q or "")}' placeholder='Search trace, graph, input…'>
        <input name='project' value='{_h(project or "")}' placeholder='Project'>
        <select name='environment'><option value=''>All environments</option>{_option("development", environment)}{_option("production", environment)}{_option("staging", environment)}</select>
        <input type='hidden' name='period' value='{_h(selected_period)}'>
        <input type='hidden' name='start_date' value='{_h(custom_start)}'>
        <input type='hidden' name='end_date' value='{_h(custom_end)}'>
        <button>Filter</button></form></div>
        <div class='table-wrap'><table><thead><tr><th>Workflow / trace</th><th>Status</th><th>Input</th><th>Execution</th><th>Usage</th><th>Context</th></tr></thead>
        <tbody>{body}</tbody></table></div></section></main>
    """,
    )


@app.get(
    "/traces/{trace_id}", response_class=HTMLResponse, dependencies=[Depends(authorize)]
)
async def trace_page(trace_id: str) -> str:
    trace = await store.get_trace(trace_id)
    if trace is None:
        raise HTTPException(status_code=404, detail="Trace not found")
    events = trace["events"]
    run_start = next(
        (event for event in events if event["event_type"] == "run.started"), events[0]
    )
    run_end = next(
        (event for event in reversed(events) if event["event_type"] == "run.completed"),
        events[-1],
    )
    attributes = run_start.get("attributes") or {}
    payload_start, payload_end = run_start["payload"], run_end["payload"]
    observations = _observations(events)
    agents = _agent_flow(events)
    graph = _execution_graph(events)
    waterfall = _waterfall(observations, events)
    agent_usage = _agent_token_usage(events)
    provider_tokens = sum(item["tokens"] for item in agent_usage)
    provider_calls = sum(item["usage_calls"] for item in agent_usage)
    llm_calls = sum(item["calls"] for item in agent_usage)
    cards = "".join(
        f"<details class='event-card'><summary><span class='event-dot {_event_kind(event['event_type'])}'></span>"
        f"<strong>{_h(event['event_type'])}</strong><span>{_event_subject(event)}</span><time>{_time(event['timestamp'])}</time></summary>"
        f"<pre>{_h(_pretty(event['payload']))}</pre></details>"
        for event in events
    )
    return _page(
        f"Trace {trace_id}",
        f"""
        {_header()}
        <main><a class='back' href='/'>← All traces</a>
        <section class='trace-title'><div><span class='eyebrow'>{_h(trace["project_id"])} · {_h(trace["environment"])}</span>
        <h1>{_h(attributes.get("graph_name") or "gMAS workflow")}</h1><code>{_h(trace_id)}</code></div>
        <span class='status {"ok" if payload_end.get("success") else "error"}'>{"success" if payload_end.get("success") else "failed"}</span></section>
        <section class='kpis trace-kpis'>
          {_kpi("Duration", _duration(payload_end.get("duration_ms")), "end-to-end")}
          {_kpi("Tokens", _provider_tokens(provider_tokens, provider_calls), f"provider usage · {_coverage(provider_calls, llm_calls)}")}
          {_kpi("Agents", len(agents), "executed")}
          {_kpi("Observations", len(observations), f"{len(events)} events")}
        </section>
        <div class='trace-grid'><div class='trace-main'>
          <section class='panel'><div class='panel-head'><div><h2>gMAS execution graph</h2><p>Planned topology, actual handoffs and runtime state reconstructed from telemetry</p></div><span class='native'>gMAS native</span></div>{graph}</section>
          <section class='panel'><div class='panel-head'><div><h2>Provider token usage by agent</h2><p>Input and output tokens reported for each agent's LLM calls</p></div><span class='native'>provider usage</span></div>{_agent_token_chart(agent_usage)}</section>
          <section class='panel'><div class='panel-head'><div><h2>Span waterfall</h2><p>Agents, model generations and tool calls on one clock</p></div></div>{waterfall}</section>
          <section class='panel'><div class='panel-head'><div><h2>Event stream</h2><p>Raw canonical telemetry for deep debugging</p></div><span class='count'>{len(events)}</span></div><div class='events'>{cards}</div></section>
        </div><aside>
          <section class='panel sticky'><h2>Run context</h2><label>Input</label><div class='content-box'>{_h(payload_start.get("query") or "—")}</div>
          <label>Final output</label><div class='content-box'>{_h(payload_end.get("output") or "—")}</div>
          <label>Graph</label><div class='meta-list'><span>ID</span><code>{_h(attributes.get("graph_id") or "inline")}</code><span>Trigger</span><b>{_h(attributes.get("trigger_source") or "unknown")}</b><span>Started</span><b>{_time(trace["started_at"])}</b></div></section>
        </aside></div></main>
    """,
    )


def _pretty(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)


def _period_controls(
    selected: str,
    start_date: date,
    end_date: date,
    project: str | None,
    environment: str | None,
    query: str | None,
) -> str:
    links = []
    for value, label in (
        ("today", "Today"),
        ("7", "Last 7 days"),
        ("30", "Last 30 days"),
    ):
        params = {
            key: item
            for key, item in {
                "period": value,
                "project": project,
                "environment": environment,
                "q": query,
            }.items()
            if item
        }
        links.append(
            f"<a class='period-link{' active' if value == selected else ''}' href='/?{urlencode(params)}'>{label}</a>"
        )
    hidden = "".join(
        f"<input type='hidden' name='{key}' value='{_h(value)}'>"
        for key, value in {
            "project": project,
            "environment": environment,
            "q": query,
        }.items()
        if value
    )
    return f"""<div class='period-controls'><nav class='period-picker'>{"".join(links)}</nav>
    <form class='date-range'>{hidden}<input type='hidden' name='period' value='custom'>
    <label>From<input type='date' name='start_date' value='{start_date.isoformat()}' max='{end_date.isoformat()}'></label>
    <label>To<input type='date' name='end_date' value='{end_date.isoformat()}' min='{start_date.isoformat()}'></label>
    <button class='{"active" if selected == "custom" else ""}'>Apply</button></form></div>"""


def _token_chart(points: list[dict[str, object]]) -> str:
    if not points:
        return "<div class='empty'>No completed runs in this period.</div>"
    width, height = 1040, 260
    left, right, top, bottom = 58, 22, 22, 40
    plot_width, plot_height = width - left - right, height - top - bottom
    maximum = max(int(point["tokens"]) for point in points) or 1
    coordinates = []
    slot_width = plot_width / max(len(points), 1)
    bar_width = min(44, max(4, slot_width * 0.68))
    for index, point in enumerate(points):
        x = left + (index + 0.5) * slot_width
        y = top + (1 - int(point["tokens"]) / maximum) * plot_height
        coordinates.append((x, y, point))
    grid = []
    for step in range(5):
        ratio = step / 4
        y = top + ratio * plot_height
        value = round(maximum * (1 - ratio))
        grid.append(
            f"<line x1='{left}' y1='{y:.1f}' x2='{left + plot_width}' y2='{y:.1f}'/><text x='{left - 10}' y='{y + 3:.1f}'>{_h(_compact(value))}</text>"
        )
    bars = "".join(
        f"<g class='chart-bar {_usage_state(int(point['usage_calls']), int(point['llm_calls']))}' tabindex='0' role='img' data-date='{_h(point['date'])}' data-tokens='{_h(int(point['tokens']))}' data-input-tokens='{_h(int(point['input_tokens']))}' data-output-tokens='{_h(int(point['output_tokens']))}' data-llm-calls='{_h(int(point['llm_calls']))}' data-usage-calls='{_h(int(point['usage_calls']))}' data-usage-status='{_usage_state(int(point['usage_calls']), int(point['llm_calls']))}' data-traces='{_h(int(point['traces']))}' data-successful='{_h(int(point['successful_traces']))}' data-failed='{_h(int(point['traces']) - int(point['successful_traces']))}' aria-label='{_h(point['date'])}: {_h(int(point['tokens']))} captured provider tokens, {_h(int(point['usage_calls']))} of {_h(int(point['llm_calls']))} LLM calls with usage'>"
        f"<rect x='{x - bar_width / 2:.1f}' y='{y:.1f}' width='{bar_width:.1f}' height='{max(top + plot_height - y, 1):.1f}' rx='3'/><title>"
        f"{_h(point['date'])}\nCaptured tokens: {_h(int(point['tokens']))}\nUsage: {_h(int(point['usage_calls']))}/{_h(int(point['llm_calls']))} LLM calls\nCompleted runs: {_h(int(point['traces']))}</title></g>"
        for x, y, point in coordinates
    )
    label_indices = (
        sorted(
            {
                round(index * (len(points) - 1) / min(5, len(points) - 1))
                for index in range(min(5, len(points) - 1) + 1)
            }
        )
        if len(points) > 1
        else [0]
    )
    labels = "".join(
        f"<text class='x-label' x='{coordinates[index][0]:.1f}' y='{height - 13}'>{_h(str(points[index]['date'])[5:])}</text>"
        for index in label_indices
    )
    total = sum(int(point["tokens"]) for point in points)
    total_input = sum(int(point["input_tokens"]) for point in points)
    total_output = sum(int(point["output_tokens"]) for point in points)
    traces = sum(int(point["traces"]) for point in points)
    llm_calls = sum(int(point["llm_calls"]) for point in points)
    usage_calls = sum(int(point["usage_calls"]) for point in points)
    return f"""<div class='chart-summary'><strong>{_provider_tokens(total, usage_calls)} tokens</strong><span class='usage-source'>captured provider usage</span><span class='token-split input'><i></i>{_provider_tokens(total_input, usage_calls)} input</span><span class='token-split output'><i></i>{_provider_tokens(total_output, usage_calls)} output</span><span>{_coverage(usage_calls, llm_calls)}</span><span>{traces} completed runs</span></div>
    <div class='chart-wrap'><div class='chart-tooltip' role='status' aria-live='polite'></div><svg class='token-chart' viewBox='0 0 {width} {height}' role='img' aria-label='Daily token usage chart'>
    <g class='chart-grid'>{"".join(grid)}</g><g class='chart-bars'>{bars}</g><g class='chart-labels'>{labels}</g>
    </svg></div>"""


def _agent_token_usage(events: list[dict]) -> list[dict[str, object]]:
    names: dict[str, str] = {}
    usage: dict[str, dict[str, object]] = {}
    for event in events:
        payload = event.get("payload") or {}
        agent_id = payload.get("agent_id")
        if agent_id and event["event_type"].startswith("agent."):
            agent_id = str(agent_id)
            names[agent_id] = str(
                payload.get("agent_name") or names.get(agent_id) or agent_id
            )
            usage.setdefault(
                agent_id,
                {
                    "agent_id": agent_id,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "calls": 0,
                    "usage_calls": 0,
                },
            )
        if event["event_type"] != "llm.completed":
            continue
        agent_id = str(agent_id) if agent_id else "[unattributed]"
        if agent_id == "[unattributed]":
            names[agent_id] = "Unattributed"
        item = usage.setdefault(
            agent_id,
            {
                "agent_id": agent_id,
                "input_tokens": 0,
                "output_tokens": 0,
                "calls": 0,
                "usage_calls": 0,
            },
        )
        item["calls"] = int(item["calls"]) + 1
        response = payload.get("response")
        legacy_usage = response.get("usage") if isinstance(response, dict) else None
        raw_usage = payload.get("usage") or legacy_usage
        if not isinstance(raw_usage, dict):
            continue
        input_tokens = raw_usage.get("input_tokens", raw_usage.get("prompt_tokens", 0))
        output_tokens = raw_usage.get(
            "output_tokens", raw_usage.get("completion_tokens", 0)
        )
        input_tokens = (
            input_tokens
            if isinstance(input_tokens, int) and not isinstance(input_tokens, bool)
            else 0
        )
        output_tokens = (
            output_tokens
            if isinstance(output_tokens, int) and not isinstance(output_tokens, bool)
            else 0
        )
        has_input = any(key in raw_usage for key in ("input_tokens", "prompt_tokens"))
        has_output = any(
            key in raw_usage for key in ("output_tokens", "completion_tokens")
        )
        if not (has_input and has_output):
            continue
        item["input_tokens"] = int(item["input_tokens"]) + input_tokens
        item["output_tokens"] = int(item["output_tokens"]) + output_tokens
        item["usage_calls"] = int(item["usage_calls"]) + 1
    result = []
    for agent_id, item in usage.items():
        item["agent_name"] = names.get(agent_id, agent_id)
        item["tokens"] = int(item["input_tokens"]) + int(item["output_tokens"])
        item["usage_status"] = _usage_state(
            int(item["usage_calls"]), int(item["calls"])
        )
        result.append(item)
    return sorted(
        result,
        key=lambda item: (
            item["agent_id"] == "[unattributed]",
            -int(item["tokens"]),
            str(item["agent_name"]),
        ),
    )


def _agent_token_chart(items: list[dict[str, object]]) -> str:
    if not items:
        return "<div class='empty'>Provider token usage is unavailable for this trace.</div>"
    width, height = 1040, 270
    left, right, top, bottom = 58, 22, 22, 52
    plot_width, plot_height = width - left - right, height - top - bottom
    maximum = max(int(item["tokens"]) for item in items) or 1
    slot_width = plot_width / len(items)
    bar_width = min(68, max(12, slot_width * 0.62))
    grid = []
    for step in range(5):
        ratio = step / 4
        y = top + ratio * plot_height
        value = round(maximum * (1 - ratio))
        grid.append(
            f"<line x1='{left}' y1='{y:.1f}' x2='{left + plot_width}' y2='{y:.1f}'/><text x='{left - 10}' y='{y + 3:.1f}'>{_h(_compact(value))}</text>"
        )
    bars = []
    for index, item in enumerate(items):
        x = left + (index + 0.5) * slot_width
        input_height = int(item["input_tokens"]) / maximum * plot_height
        output_height = int(item["output_tokens"]) / maximum * plot_height
        bottom_y = top + plot_height
        output_y = bottom_y - input_height - output_height
        input_y = bottom_y - input_height
        label = _truncate(str(item["agent_name"]), 16)
        status = str(item["usage_status"])
        missing_bar = (
            f"<rect class='agent-missing-bar' x='{x - bar_width / 2:.1f}' y='{bottom_y - 4:.1f}' width='{bar_width:.1f}' height='4' rx='2'/>"
            if status == "unavailable"
            else ""
        )
        bars.append(
            f"<g class='agent-token-bar {status}' tabindex='0' role='img' data-agent='{_h(item['agent_name'])}' data-tokens='{int(item['tokens'])}' data-input-tokens='{int(item['input_tokens'])}' data-output-tokens='{int(item['output_tokens'])}' data-calls='{int(item['calls'])}' data-usage-calls='{int(item['usage_calls'])}' data-usage-status='{status}' aria-label='{_h(item['agent_name'])}: {_provider_tokens(item['tokens'], item['usage_calls'])} captured provider tokens, {int(item['usage_calls'])} of {int(item['calls'])} calls with usage'>"
            f"<rect class='agent-input-bar' x='{x - bar_width / 2:.1f}' y='{input_y:.1f}' width='{bar_width:.1f}' height='{max(input_height, 0):.1f}'/><rect class='agent-output-bar' x='{x - bar_width / 2:.1f}' y='{output_y:.1f}' width='{bar_width:.1f}' height='{max(output_height, 0):.1f}' rx='3'/>{missing_bar}<text class='agent-token-label' x='{x:.1f}' y='{height - 17}'>{_h(label)}</text></g>"
        )
    total_input = sum(int(item["input_tokens"]) for item in items)
    total_output = sum(int(item["output_tokens"]) for item in items)
    calls = sum(int(item["calls"]) for item in items)
    usage_calls = sum(int(item["usage_calls"]) for item in items)
    return f"""<div class='chart-summary'><strong>{_provider_tokens(total_input + total_output, usage_calls)} tokens</strong><span class='usage-source'>captured provider usage</span><span class='token-split input'><i></i>{_provider_tokens(total_input, usage_calls)} input</span><span class='token-split output'><i></i>{_provider_tokens(total_output, usage_calls)} output</span><span>{_coverage(usage_calls, calls)}</span></div>
    <div class='chart-wrap agent-token-wrap'><div class='chart-tooltip' role='status' aria-live='polite'></div><svg class='token-chart agent-token-chart' viewBox='0 0 {width} {height}' role='img' aria-label='Provider token usage by agent'>
    <g class='chart-grid'>{"".join(grid)}</g><g>{"".join(bars)}</g></svg></div>"""


def _observations(events: list[dict]) -> list[dict]:
    grouped: dict[str, dict] = {}
    for event in events:
        span_id = event.get("span_id")
        if not span_id:
            continue
        item = grouped.setdefault(span_id, {"span_id": span_id, "events": []})
        item["events"].append(event)
        item["parent_span_id"] = event.get("parent_span_id") or item.get(
            "parent_span_id"
        )
    result = []
    for item in grouped.values():
        ordered = sorted(item["events"], key=lambda event: event["timestamp"])
        start, end = ordered[0], ordered[-1]
        payload = start.get("payload") or {}
        kind = start["event_type"].split(".")[0]
        subject = (
            payload.get("agent_name")
            or payload.get("agent_id")
            or payload.get("tool_name")
            or payload.get("model")
            or kind
        )
        item.update(
            {
                "start": start["timestamp"],
                "end": end["timestamp"],
                "kind": kind,
                "subject": str(subject),
                "status": "error"
                if any(e["event_type"].endswith("failed") for e in ordered)
                else "ok",
            }
        )
        result.append(item)
    return sorted(result, key=lambda item: item["start"])


def _agent_flow(events: list[dict]) -> list[dict]:
    agents: dict[str, dict] = {}
    order: list[str] = []
    for event in events:
        payload = event.get("payload") or {}
        agent_id = payload.get("agent_id")
        if not agent_id or not event["event_type"].startswith("agent."):
            continue
        if event["event_type"] == "agent.started" and agent_id not in agents:
            order.append(agent_id)
            agents[agent_id] = {
                "id": agent_id,
                "name": payload.get("agent_name") or agent_id,
                "status": "running",
                "predecessors": payload.get("predecessors") or [],
            }
        if agent_id in agents and event["event_type"] in {
            "agent.completed",
            "agent.failed",
        }:
            agents[agent_id]["status"] = (
                "ok" if event["event_type"] == "agent.completed" else "error"
            )
    return [agents[agent_id] for agent_id in order]


def _execution_graph(events: list[dict]) -> str:
    """Render a dependency graph from the gMAS plan and agent lifecycle events."""
    nodes: dict[str, dict] = {}
    order: list[str] = []
    run_start = next(
        (event for event in events if event["event_type"] == "run.started"), None
    )
    for agent_id in (run_start or {}).get("payload", {}).get("execution_order", []):
        agent_id = str(agent_id)
        order.append(agent_id)
        nodes[agent_id] = {
            "id": agent_id,
            "name": agent_id,
            "status": "planned",
            "predecessors": [],
        }

    parallel_agents: set[str] = set()
    topology_events: list[dict] = []
    for event in events:
        payload = event.get("payload") or {}
        event_type = event["event_type"]
        agent_id = payload.get("agent_id")
        if event_type == "parallel.started":
            parallel_agents.update(str(value) for value in payload.get("agent_ids", []))
        if event_type in {"topology.changed", "agent.fallback"}:
            topology_events.append(event)
        if event_type == "agent.fallback":
            fallback_id = payload.get("fallback_agent_id")
            if fallback_id and fallback_id not in nodes:
                order.append(str(fallback_id))
                nodes[str(fallback_id)] = {
                    "id": str(fallback_id),
                    "name": str(fallback_id),
                    "status": "fallback",
                    "predecessors": [str(payload.get("failed_agent_id"))],
                }
        if not agent_id or not event_type.startswith("agent."):
            continue
        agent_id = str(agent_id)
        if agent_id not in nodes:
            order.append(agent_id)
            nodes[agent_id] = {
                "id": agent_id,
                "name": agent_id,
                "status": "planned",
                "predecessors": [],
            }
        node = nodes[agent_id]
        if event_type == "agent.started":
            node.update(
                name=payload.get("agent_name") or agent_id,
                status="running",
                predecessors=[str(value) for value in payload.get("predecessors", [])],
                step=payload.get("step_index"),
            )
        elif event_type == "agent.completed":
            node.update(
                status="ok",
                duration_ms=payload.get("duration_ms"),
                gmas_tokens=payload.get("tokens_used"),
                output=payload.get("output"),
            )
        elif event_type == "agent.failed":
            node.update(status="error", error=payload.get("error_message"))
        elif event_type == "agent.pruned":
            node.update(status="pruned", reason=payload.get("reason"))

    if not nodes:
        return "<div class='empty'>No topology data captured.</div>"

    # Assign dependency levels. Cycles or unresolved dependencies stay at the
    # current level, which keeps malformed runtime graphs renderable.
    levels = {agent_id: 0 for agent_id in nodes}
    for _ in range(len(nodes)):
        changed = False
        for agent_id, node in nodes.items():
            known = [
                levels[parent]
                for parent in node["predecessors"]
                if parent in levels and parent != agent_id
            ]
            target = max(known, default=-1) + 1 if known else levels[agent_id]
            if target > levels[agent_id] and target < len(nodes):
                levels[agent_id] = target
                changed = True
        if not changed:
            break

    columns: dict[int, list[str]] = {}
    for agent_id in order:
        columns.setdefault(levels[agent_id], []).append(agent_id)
    positions: dict[str, tuple[float, float]] = {}
    for level, ids in columns.items():
        for row, agent_id in enumerate(ids):
            positions[agent_id] = (35 + level * 235, 42 + row * 108)

    width = max(760, (max(columns) + 1) * 235 + 40)
    height = max(190, max(len(ids) for ids in columns.values()) * 108 + 55)
    edges: list[str] = []
    for target_id, node in nodes.items():
        tx, ty = positions[target_id]
        for source_id in node["predecessors"]:
            if source_id not in positions:
                continue
            sx, sy = positions[source_id]
            x1, y1, x2, y2 = sx + 176, sy + 34, tx, ty + 34
            bend = max((x2 - x1) * 0.45, 30)
            edges.append(
                f"<path class='graph-edge' data-source='{_h(source_id)}' data-target='{_h(target_id)}' d='M{x1:.0f},{y1:.0f} C{x1 + bend:.0f},{y1:.0f} {x2 - bend:.0f},{y2:.0f} {x2:.0f},{y2:.0f}' marker-end='url(#arrow)'/><circle class='edge-pulse' data-source='{_h(source_id)}' data-target='{_h(target_id)}' cx='{(x1 + x2) / 2:.0f}' cy='{(y1 + y2) / 2:.0f}' r='2.5'/>"
            )

    usage_by_agent = {
        str(item["agent_id"]): item for item in _agent_token_usage(events)
    }
    node_svg: list[str] = []
    for agent_id in order:
        node = nodes[agent_id]
        x, y = positions[agent_id]
        status = node["status"]
        details = []
        if node.get("duration_ms") is not None:
            details.append(_duration(node["duration_ms"]))
        provider_usage = usage_by_agent.get(agent_id)
        if provider_usage is not None:
            details.append(
                f"{_provider_tokens(provider_usage['tokens'], provider_usage['usage_calls'])} provider tok"
            )
        subtitle = " · ".join(details) or (
            "not executed" if status == "planned" else status
        )
        parallel = " parallel" if agent_id in parallel_agents else ""
        badge = (
            "PAR"
            if agent_id in parallel_agents
            else str(
                (
                    node.get("step")
                    if node.get("step") is not None
                    else order.index(agent_id)
                )
                + 1
            )
        )
        node_svg.append(
            f"<g class='graph-node {status}{parallel}' data-agent-id='{_h(agent_id)}' data-node-x='{x:.0f}' data-node-y='{y:.0f}' tabindex='0' role='button' aria-label='Inspect agent {_h(node['name'])}' transform='translate({x:.0f} {y:.0f})'>"
            f"<rect width='176' height='68' rx='10'/><circle cx='20' cy='21' r='10'/><text class='node-index' x='20' y='24'>{_h(badge)}</text>"
            f"<text class='node-name' x='38' y='23'>{_h(_truncate(str(node['name']), 20))}</text>"
            f"<text class='node-id' x='14' y='44'>{_h(_truncate(agent_id, 25))}</text>"
            f"<text class='node-meta' x='14' y='59'>{_h(subtitle)}</text><circle class='node-status' cx='161' cy='18' r='4'/></g>"
        )

    changes = ""
    if topology_events:
        items = "".join(
            f"<div class='topology-change'><span>{_h(event['event_type'])}</span><b>{_h((event.get('payload') or {}).get('reason') or 'runtime update')}</b><time>{_time(event['timestamp'])}</time></div>"
            for event in topology_events
        )
        changes = f"<div class='topology-strip'><strong>Dynamic topology</strong>{items}</div>"

    inspectors = _node_inspectors(nodes, order, events, usage_by_agent)
    return f"""<div class='graph-toolbar'><div class='graph-legend'><span><i class='ok'></i>completed</span><span><i class='running'></i>running</span><span><i class='planned'></i>planned</span><span><i class='pruned'></i>pruned</span><span><i class='parallel'></i>parallel</span></div><div class='graph-controls'><button type='button' data-graph-action='zoom-out' title='Zoom out'>−</button><button type='button' data-graph-action='fit' title='Fit graph'>Fit</button><button type='button' data-graph-action='zoom-in' title='Zoom in'>+</button><span class='graph-summary'>{len(nodes)} nodes · {len(edges)} edges</span></div></div>
    <div class='graph-shell'><div class='graph-viewport'><svg class='execution-graph' viewBox='0 0 {width} {height}' style='min-width:{width}px;height:{height}px' role='img' aria-label='gMAS agent execution graph'>
    <defs><marker id='arrow' markerWidth='7' markerHeight='7' refX='6' refY='3.5' orient='auto'><path d='M0,0 L7,3.5 L0,7 z'/></marker></defs>
    <g class='graph-stage'><g class='edges'>{"".join(edges)}</g><g class='nodes'>{"".join(node_svg)}</g></g></svg><div class='graph-hint'>Drag canvas · scroll to zoom · click a node to inspect</div></div>
    <aside class='node-inspector' aria-live='polite'><div class='inspector-empty'><span>◎</span><strong>Select an agent</strong><p>Inspect its prompt, model calls, tools, memory and output.</p></div>{inspectors}</aside></div>{changes}"""


def _node_inspectors(
    nodes: dict[str, dict],
    order: list[str],
    events: list[dict],
    usage_by_agent: dict[str, dict[str, object]],
) -> str:
    cards: list[str] = []
    for agent_id in order:
        node = nodes[agent_id]
        direct = [
            event
            for event in events
            if str((event.get("payload") or {}).get("agent_id") or "") == agent_id
        ]
        start = next(
            (event for event in direct if event["event_type"] == "agent.started"), None
        )
        end = next(
            (
                event
                for event in reversed(direct)
                if event["event_type"] in {"agent.completed", "agent.failed"}
            ),
            None,
        )
        # Some generic LLM callers historically lacked agent_id. Attribute
        # observations occurring inside this agent's lifecycle window.
        if start:
            start_time = _dt(start["timestamp"])
            end_time = (
                _dt(end["timestamp"])
                if end
                else datetime.max.replace(tzinfo=start_time.tzinfo)
            )
            window = [
                event
                for event in events
                if start_time <= _dt(event["timestamp"]) <= end_time
            ]
        else:
            window = direct
        llm_events = [
            event
            for event in window
            if event["event_type"].startswith("llm.")
            and ((event.get("payload") or {}).get("agent_id") in {None, agent_id})
        ]
        tool_events = [
            event for event in window if event["event_type"].startswith("tool.")
        ]
        memory_events = [
            event for event in window if event["event_type"].startswith("memory.")
        ]
        start_payload = (start or {}).get("payload") or {}
        end_payload = (end or {}).get("payload") or {}
        model = next(
            (
                (event.get("payload") or {}).get("model")
                for event in llm_events
                if (event.get("payload") or {}).get("model")
            ),
            None,
        )
        llm_request = next(
            (
                (event.get("payload") or {}).get("request")
                for event in llm_events
                if event["event_type"] == "llm.started"
                and (event.get("payload") or {}).get("request") is not None
            ),
            None,
        )
        provider_usage = usage_by_agent.get(agent_id) or {
            "tokens": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "calls": 0,
            "usage_calls": 0,
            "usage_status": "unavailable",
        }
        activity = (
            "".join(
                f"<details><summary>{_h(event['event_type'])}<time>{_time(event['timestamp'])}</time></summary><pre>{_h(_pretty(event.get('payload') or {}))}</pre></details>"
                for event in [*llm_events, *tool_events, *memory_events]
            )
            or "<p class='inspector-muted'>No nested observations captured.</p>"
        )
        predecessors = start_payload.get("predecessors") or []
        cards.append(f"""<section class='inspector-card' data-inspector='{_h(agent_id)}'>
          <div class='inspector-head'><div><span class='eyebrow'>AGENT NODE</span><h3>{_h(node["name"])}</h3><code>{_h(agent_id)}</code></div><button type='button' data-inspector-close aria-label='Close'>×</button></div>
          <div class='inspector-stats'><div><span>Status</span><b class='{_h(node["status"])}'>{_h(node["status"])}</b></div><div><span>Latency</span><b>{_duration(node.get("duration_ms"))}</b></div><div><span>Provider tokens</span><b>{_provider_tokens(provider_usage["tokens"], provider_usage["usage_calls"])}</b></div><div><span>Model</span><b>{_h(model or "—")}</b></div></div>
          <label>Predecessors</label><div class='inspector-chips'>{"".join(f"<span>{_h(value)}</span>" for value in predecessors) or "<i>entry node</i>"}</div>
          <label>Full LLM request / prompt</label><div class='content-box prompt-box' tabindex='0'>{_h(_pretty(llm_request) if llm_request is not None else start_payload.get("prompt") or "Not captured")}</div>
          <label>Output</label><div class='content-box'>{_h(end_payload.get("output") or end_payload.get("error_message") or "Not captured")}</div>
          <label>Provider usage · {_coverage(provider_usage["usage_calls"], provider_usage["calls"])}</label><pre>{_h(_pretty({"input_tokens": provider_usage["input_tokens"], "output_tokens": provider_usage["output_tokens"], "total_tokens": provider_usage["tokens"], "usage_status": provider_usage["usage_status"]}))}</pre>
          <label>Nested observations · {len(llm_events) + len(tool_events) + len(memory_events)}</label><div class='inspector-activity'>{activity}</div>
        </section>""")
    return "".join(cards)


def _waterfall(observations: list[dict], events: list[dict]) -> str:
    if not observations:
        return "<div class='empty'>No spans captured.</div>"
    origin = min(_dt(event["timestamp"]) for event in events)
    finish = max(_dt(event["timestamp"]) for event in events)
    total = max((finish - origin).total_seconds() * 1000, 1)
    rows = []
    for observation in observations:
        start, end = _dt(observation["start"]), _dt(observation["end"])
        offset = max((start - origin).total_seconds() * 1000 / total * 100, 0)
        duration = max((end - start).total_seconds() * 1000, 1)
        width = max(duration / total * 100, 0.8)
        rows.append(
            f"<div class='water-row'><div class='water-label'><span class='event-dot {observation['kind']}'></span><div><strong>{_h(observation['subject'])}</strong><small>{_h(observation['kind'])}</small></div></div><div class='water-track'><span class='water-bar {observation['kind']}' style='left:{offset:.2f}%;width:{min(width, 100 - offset):.2f}%'></span></div><time>{_duration(duration)}</time></div>"
        )
    return "<div class='waterfall'>" + "".join(rows) + "</div>"


def _h(value: object) -> str:
    return html.escape(str(value), quote=True)


def _truncate(value: str, length: int) -> str:
    return value if len(value) <= length else value[: length - 1] + "…"


def _dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _time(value: str) -> str:
    with_timezone = _dt(value)
    return with_timezone.strftime("%b %d · %H:%M:%S")


def _duration(value: object) -> str:
    if value is None:
        return "—"
    milliseconds = float(value)
    if milliseconds < 1000:
        return f"{milliseconds:.0f} ms"
    return f"{milliseconds / 1000:.2f} s"


def _compact(value: object) -> str:
    number = int(value or 0)
    if number >= 1_000_000:
        return f"{number / 1_000_000:.1f}M"
    if number >= 1_000:
        return f"{number / 1_000:.1f}k"
    return str(number)


def _provider_tokens(value: object, usage_calls: object) -> str:
    return _compact(value) if int(usage_calls or 0) > 0 else "N/A"


def _coverage(usage_calls: object, llm_calls: object) -> str:
    captured, total = int(usage_calls or 0), int(llm_calls or 0)
    if total == 0:
        return "no LLM calls"
    status = (
        "complete" if captured == total else "partial" if captured else "unavailable"
    )
    return f"{captured}/{total} calls · {status}"


def _usage_state(usage_calls: int, llm_calls: int) -> str:
    if usage_calls == 0:
        return "unavailable"
    return "complete" if usage_calls == llm_calls else "partial"


def _percent(value: object) -> str:
    return "—" if value is None else f"{float(value):.1f}%"


def _option(value: str, selected: str | None) -> str:
    flag = " selected" if value == selected else ""
    return f"<option value='{value}'{flag}>{value}</option>"


def _kpi(label: str, value: object, caption: str, tone: str = "") -> str:
    return f"<div class='kpi {tone}'><span>{_h(label)}</span><strong>{_h(value)}</strong><small>{_h(caption)}</small></div>"


def _event_kind(event_type: str) -> str:
    return event_type.split(".")[0]


def _event_subject(event: dict) -> str:
    payload = event.get("payload") or {}
    return _h(
        payload.get("agent_name")
        or payload.get("agent_id")
        or payload.get("tool_name")
        or payload.get("model")
        or ""
    )


def _header() -> str:
    return """<header><a class='brand' href='/'><span class='brand-mark'>g</span><span>gMAS <b>Observability</b></span></a>
    <nav><a class='active' href='/'>Traces</a></nav>
    <div class='live'><i></i> self-hosted</div></header>"""


def _page(title: str, content: str) -> str:
    return f"""<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width'>
    <title>{html.escape(title)}</title><style>
    *{{box-sizing:border-box}}:root{{color-scheme:dark;font:14px Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:#080a0f;color:#e7eaf0;--panel:#10131a;--panel2:#151923;--line:#252a36;--muted:#8b93a5;--cyan:#59d7f2;--violet:#9b8cff;--green:#5ee5a2;--red:#ff758f}}body{{margin:0;background:radial-gradient(circle at 60% -20%,#172039 0,transparent 34%),#080a0f;min-height:100vh}}a{{color:inherit;text-decoration:none}}header{{height:58px;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 28px;gap:36px;background:rgba(8,10,15,.9);backdrop-filter:blur(15px);position:sticky;top:0;z-index:5}}.brand{{display:flex;align-items:center;gap:10px;font-size:15px;white-space:nowrap}}.brand b{{color:var(--muted);font-weight:500}}.brand-mark{{width:27px;height:27px;display:grid;place-items:center;background:linear-gradient(135deg,var(--cyan),var(--violet));border-radius:8px;color:#081017;font-weight:900;font-size:18px}}nav{{display:flex;gap:5px;height:100%;align-items:center}}nav a{{padding:8px 11px;color:#7f8798;font-size:12px;border-radius:7px}}nav .active{{color:#f4f6fa;background:#191e29}}.live{{margin-left:auto;color:#8d95a5;font-size:11px;text-transform:uppercase;letter-spacing:.08em}}.live i{{display:inline-block;width:6px;height:6px;background:var(--green);border-radius:50%;margin-right:7px;box-shadow:0 0 9px var(--green)}}main{{max-width:1440px;margin:0 auto;padding:30px 32px 70px}}.hero{{padding:14px 0 24px}}.eyebrow{{color:var(--cyan);font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}}h1{{font-size:30px;line-height:1.1;margin:8px 0 8px;letter-spacing:-.03em}}h2{{font-size:14px;margin:0 0 4px}}p{{color:var(--muted);margin:0;line-height:1.5}}.kpis{{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:18px}}.kpi{{padding:16px 17px;background:linear-gradient(145deg,#121620,#0f1219);border:1px solid var(--line);border-radius:10px;min-width:0}}.kpi>span{{display:block;color:#8d95a5;font-size:10px;text-transform:uppercase;letter-spacing:.09em}}.kpi strong{{display:block;font-size:22px;letter-spacing:-.03em;margin:7px 0 2px}}.kpi.good strong{{color:var(--green)}}.kpi small,small{{color:#737c8e;font-size:10px}}.panel{{background:rgba(16,19,26,.92);border:1px solid var(--line);border-radius:11px;overflow:hidden;margin-bottom:14px}}.panel-head{{padding:15px 17px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:20px}}.panel-head p{{font-size:11px}}.filters{{display:flex;gap:7px}}input,select,button{{height:32px;background:#0c0f15;color:#cbd1dc;border:1px solid #2b3140;border-radius:7px;padding:0 10px;font:inherit;font-size:11px}}input{{width:180px}}select{{width:140px}}button{{background:#202737;cursor:pointer;color:#fff}}button:hover{{border-color:#4a566d}}.table-wrap{{overflow:auto}}table{{width:100%;border-collapse:collapse;min-width:900px}}th{{padding:10px 14px;text-align:left;color:#697386;text-transform:uppercase;letter-spacing:.08em;font-size:9px;background:#0d1016}}td{{padding:13px 14px;border-top:1px solid #1e2330;color:#cbd0da;font-size:11px;vertical-align:middle}}.trace-row:hover{{background:#141924}}.trace-link strong,.trace-link small{{display:block}}.trace-link strong{{font-size:12px;color:#f0f2f6;margin-bottom:4px}}.trace-link small{{font-family:ui-monospace,monospace}}.status{{display:inline-flex;align-items:center;padding:3px 7px;border:1px solid;border-radius:99px;text-transform:uppercase;font-size:8px;letter-spacing:.08em;font-weight:800}}.status.ok{{color:var(--green);border-color:#24543f;background:#10271e}}.status.error{{color:var(--red);border-color:#5b2934;background:#2a1118}}.status.running{{color:var(--cyan);border-color:#245262;background:#10232a}}.input-preview{{max-width:320px;display:block;color:#aab1bf}}.env{{padding:2px 6px;border-radius:4px;background:#222737;color:#aab3c5;font-size:9px}}.empty{{padding:45px;text-align:center;color:#697386}}.back{{display:inline-block;color:#8e97a9;font-size:11px;margin-bottom:20px}}.back:hover{{color:#fff}}.trace-title{{display:flex;justify-content:space-between;align-items:center;margin-bottom:19px}}.trace-title code{{font-size:10px;color:#737c8e}}.trace-title>.status{{font-size:10px;padding:5px 9px}}.trace-kpis{{grid-template-columns:repeat(4,1fr)}}.trace-grid{{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:14px}}.trace-main{{min-width:0}}aside .sticky{{position:sticky;top:74px;padding:17px}}aside h2{{margin-bottom:18px}}aside label{{display:block;color:#737c8e;text-transform:uppercase;font-size:9px;letter-spacing:.09em;margin:15px 0 7px}}.content-box{{background:#0b0e14;border:1px solid #222835;border-radius:7px;padding:11px;color:#c7cdd8;line-height:1.55;white-space:pre-wrap;max-height:230px;overflow:auto;font-size:11px}}.meta-list{{display:grid;grid-template-columns:70px 1fr;gap:10px 8px;font-size:10px}}.meta-list span{{color:#687183}}.meta-list b,.meta-list code{{overflow:hidden;text-overflow:ellipsis}}.native{{color:var(--cyan);border:1px solid #245262;background:#10232a;padding:4px 7px;border-radius:5px;font-size:9px;text-transform:uppercase;letter-spacing:.08em}}.count{{color:#8f98aa;font-family:ui-monospace,monospace}}.agent-flow{{display:flex;align-items:stretch;gap:10px;padding:18px;overflow:auto}}.agent-node{{min-width:180px;background:#0c1017;border:1px solid #293143;border-radius:9px;padding:12px;display:grid;grid-template-columns:26px 1fr auto;align-items:center;gap:9px}}.agent-node strong,.agent-node small{{display:block}}.agent-index{{width:25px;height:25px;display:grid;place-items:center;border-radius:7px;background:#1c2534;color:var(--cyan);font-size:10px;font-weight:800}}.flow-arrow{{color:#465067;align-self:center}}.waterfall{{padding:10px 16px 16px}}.water-row{{display:grid;grid-template-columns:185px 1fr 62px;align-items:center;gap:10px;min-height:42px;border-bottom:1px solid #1d222d}}.water-label{{display:flex;align-items:center;gap:9px;min-width:0}}.water-label strong,.water-label small{{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}.water-label strong{{font-size:10px}}.water-label small{{text-transform:uppercase;letter-spacing:.09em;font-size:8px}}.event-dot{{width:7px;height:7px;border-radius:2px;background:#7e8799;display:inline-block;flex:none}}.event-dot.run,.water-bar.run{{background:var(--violet)}}.event-dot.agent,.water-bar.agent{{background:var(--cyan)}}.event-dot.llm,.water-bar.llm{{background:#f2b45b}}.event-dot.tool,.water-bar.tool{{background:#ff8fa3}}.event-dot.memory,.water-bar.memory{{background:#68e0b3}}.water-track{{height:18px;background:#0b0e14;border:1px solid #1d2330;border-radius:4px;position:relative;overflow:hidden}}.water-bar{{position:absolute;top:3px;height:10px;border-radius:3px;min-width:3px;opacity:.9}}.water-row time{{font:9px ui-monospace,monospace;color:#737c8e;text-align:right}}.events{{padding:8px 12px 14px}}.event-card{{border-bottom:1px solid #1e2330}}.event-card summary{{list-style:none;cursor:pointer;display:grid;grid-template-columns:9px 130px 1fr 100px;align-items:center;gap:9px;padding:10px 3px;color:#b9c0cd;font-size:10px}}.event-card summary::-webkit-details-marker{{display:none}}.event-card summary>span:nth-of-type(2){{color:#717b8e}}.event-card time{{text-align:right;color:#626c7f}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;color:#aeb7c7;background:#0a0d12;padding:13px;border-radius:7px;font:10px/1.5 ui-monospace,monospace;max-height:420px;overflow:auto}}@media(max-width:1000px){{nav{{display:none}}.kpis{{grid-template-columns:repeat(2,1fr)}}.trace-grid{{grid-template-columns:1fr}}aside .sticky{{position:static}}.filters{{display:none}}}}@media(max-width:600px){{main{{padding:22px 14px}}header{{padding:0 14px}}.kpis{{grid-template-columns:1fr 1fr}}.agent-flow{{flex-direction:column}}.flow-arrow{{transform:rotate(90deg)}}}}
    .graph-toolbar{{display:flex;align-items:center;justify-content:space-between;padding:9px 15px;background:#0c0f15;border-bottom:1px solid #1e2430}}.graph-legend{{display:flex;gap:13px;flex-wrap:wrap}}.graph-legend span{{font-size:8px;color:#778093;text-transform:uppercase;letter-spacing:.07em}}.graph-legend i{{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px}}.graph-legend i.ok{{background:var(--green)}}.graph-legend i.running{{background:var(--cyan)}}.graph-legend i.planned{{background:#697386}}.graph-legend i.pruned{{background:#d99b5e}}.graph-legend i.parallel{{background:var(--violet)}}.graph-controls{{display:flex;align-items:center;gap:4px}}.graph-controls button{{width:30px;padding:0;font-size:12px}}.graph-controls button:nth-child(2){{width:38px;font-size:9px}}.graph-summary{{font:9px ui-monospace,monospace;color:#667084;margin-left:7px}}.graph-shell{{display:grid;grid-template-columns:minmax(0,1fr) 0;transition:grid-template-columns .2s ease;min-height:250px}}.graph-shell:has(.inspector-card.active){{grid-template-columns:minmax(0,1fr) 330px}}.graph-viewport{{overflow:hidden;position:relative;cursor:grab;background-color:#0a0d12;background-image:radial-gradient(#293143 0.7px,transparent 0.7px);background-size:17px 17px;min-height:250px}}.graph-viewport.panning{{cursor:grabbing}}.execution-graph{{display:block;width:100%;touch-action:none;user-select:none}}.graph-stage{{transform-box:fill-box;transform-origin:0 0}}.graph-hint{{position:absolute;bottom:8px;left:10px;padding:4px 7px;border-radius:5px;background:rgba(10,13,18,.82);color:#596478;font-size:8px;pointer-events:none}}.graph-edge{{fill:none;stroke:#3a4559;stroke-width:1.6;opacity:.9;transition:opacity .15s,stroke .15s}}marker path{{fill:#526079}}.edge-pulse{{fill:var(--cyan);opacity:.45}}.graph-edge.dim,.edge-pulse.dim{{opacity:.08}}.graph-edge.selected{{stroke:var(--cyan);stroke-width:2.3;opacity:1}}.graph-node{{cursor:pointer;outline:none;transition:opacity .15s}}.graph-node:hover rect,.graph-node:focus rect,.graph-node.selected rect{{stroke:var(--cyan);stroke-width:2}}.graph-node.dim{{opacity:.25}}.graph-node rect{{fill:#111722;stroke:#344056;stroke-width:1}}.graph-node circle{{fill:#202b3b}}.graph-node .node-status{{fill:#697386}}.graph-node.ok rect{{stroke:#2f7658;fill:#102019}}.graph-node.ok .node-status{{fill:var(--green);filter:drop-shadow(0 0 4px var(--green))}}.graph-node.error rect{{stroke:#7d3443;fill:#241218}}.graph-node.error .node-status{{fill:var(--red)}}.graph-node.running rect{{stroke:#2d7181;fill:#102128}}.graph-node.running .node-status{{fill:var(--cyan)}}.graph-node.pruned rect{{stroke:#725033;fill:#241b12;stroke-dasharray:4 3}}.graph-node.pruned .node-status{{fill:#d99b5e}}.graph-node.planned rect{{stroke-dasharray:4 3;opacity:.75}}.graph-node.parallel rect{{stroke-width:2;filter:drop-shadow(0 0 5px rgba(155,140,255,.25))}}.graph-node text{{font-family:ui-sans-serif,system-ui;pointer-events:none}}.node-index{{fill:var(--cyan);font-size:8px;font-weight:800;text-anchor:middle}}.node-name{{fill:#e8ebf1;font-size:11px;font-weight:700}}.node-id{{fill:#8490a4;font-size:8px;font-family:ui-monospace,monospace!important}}.node-meta{{fill:#657085;font-size:8px}}.node-inspector{{width:auto;min-width:0;overflow:hidden;background:#0d1118;border-left:1px solid #293141}}.inspector-empty{{height:100%;min-height:250px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:25px;color:#677185}}.inspector-empty>span{{font-size:27px;color:#3c4a61}}.inspector-empty strong{{color:#a8b0bf;margin:8px 0 3px}}.inspector-empty p{{font-size:10px}}.inspector-card{{display:none;padding:15px;max-height:570px;overflow:auto}}.inspector-card.active{{display:block}}.inspector-head{{display:flex;justify-content:space-between;gap:10px;margin-bottom:15px}}.inspector-head h3{{margin:5px 0 2px;font-size:17px}}.inspector-head code{{font-size:9px;color:#727d91}}.inspector-head button{{border:0;background:transparent;font-size:20px;color:#6f798c}}.inspector-stats{{display:grid;grid-template-columns:1fr 1fr;gap:6px}}.inspector-stats>div{{padding:8px;background:#111722;border:1px solid #222b39;border-radius:6px}}.inspector-stats span,.node-inspector label{{display:block;color:#687386;text-transform:uppercase;letter-spacing:.08em;font-size:8px}}.inspector-stats b{{display:block;font-size:10px;margin-top:3px}}.inspector-stats b.ok{{color:var(--green)}}.node-inspector label{{margin:14px 0 6px}}.inspector-chips{{display:flex;gap:5px;flex-wrap:wrap}}.inspector-chips span{{padding:3px 6px;background:#1d2635;color:#9cc9dc;border-radius:4px;font-size:9px}}.inspector-chips i,.inspector-muted{{color:#626c7e;font-size:9px}}.inspector-activity details{{border-top:1px solid #202632}}.inspector-activity summary{{display:flex;justify-content:space-between;padding:8px 0;cursor:pointer;font-size:9px;color:#aab2c1}}.inspector-activity time{{color:#5f697b}}.inspector-activity pre{{max-height:220px}}.topology-strip{{padding:10px 14px;border-top:1px solid #242a36;background:#0e1118}}.topology-strip>strong{{display:block;color:var(--violet);font-size:9px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:7px}}.topology-change{{display:grid;grid-template-columns:110px 1fr 120px;gap:8px;padding:6px 0;border-top:1px solid #1e2330;font-size:9px}}.topology-change span{{color:#a092ff}}.topology-change time{{color:#687286;text-align:right}}
    .graph-node{{cursor:grab}}.graph-node:active{{cursor:grabbing}}.prompt-box{{max-height:320px;min-height:120px;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}}.node-inspector{{overscroll-behavior:contain}}.inspector-card{{scrollbar-gutter:stable}}
    .analytics-panel{{position:relative}}.analytics-head{{align-items:flex-start}}.period-controls{{display:flex;align-items:flex-end;gap:9px;flex-wrap:wrap;justify-content:flex-end}}.period-picker{{display:flex;height:auto;gap:4px}}.period-picker .period-link{{padding:7px 9px;border:1px solid #2b3140;border-radius:6px;font:9px ui-monospace,monospace;color:#858fa2;white-space:nowrap}}.period-picker .period-link.active{{color:#081017;background:var(--cyan);border-color:var(--cyan);font-weight:800}}.date-range{{display:flex;align-items:flex-end;gap:5px}}.date-range label{{display:grid;gap:3px;color:#697386;font-size:8px;text-transform:uppercase;letter-spacing:.06em}}.date-range input[type=date]{{width:124px;height:29px;color-scheme:dark}}.date-range button{{height:29px}}.date-range button.active{{border-color:var(--cyan);color:var(--cyan)}}.chart-summary{{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:15px 18px 0}}.chart-summary strong{{font-size:19px}}.chart-summary span{{color:var(--muted);font-size:10px}}.chart-summary .usage-source{{padding:2px 6px;border:1px solid #354052;border-radius:999px;color:#8d98aa;font-size:8px;text-transform:uppercase;letter-spacing:.05em}}.chart-summary .token-split{{display:inline-flex;align-items:center;gap:5px}}.token-split i{{width:7px;height:7px;border-radius:50%;background:var(--cyan)}}.token-split.output i{{background:var(--violet)}}.chart-wrap{{position:relative;overflow-x:auto;padding:0 8px 8px}}.token-chart{{display:block;width:100%;min-width:680px;height:260px}}.chart-grid line{{stroke:#232936;stroke-width:1}}.chart-grid text{{fill:#697386;font:9px ui-monospace,monospace;text-anchor:end}}.chart-bar{{outline:none;cursor:pointer}}.chart-bar rect{{fill:rgba(89,215,242,.38);stroke:rgba(89,215,242,.65);stroke-width:1;transition:fill .14s,stroke .14s,filter .14s}}.chart-bar.partial rect{{opacity:.72}}.chart-bar.unavailable rect{{fill:transparent;stroke:#687386;stroke-dasharray:3 2}}.chart-bar:hover rect,.chart-bar:focus rect{{fill:var(--violet);stroke:#c5bcff;filter:drop-shadow(0 0 6px rgba(155,140,255,.65))}}.chart-labels text{{fill:#697386;font:9px ui-monospace,monospace;text-anchor:middle}}.chart-tooltip{{position:absolute;z-index:4;display:none;pointer-events:none;min-width:165px;padding:10px 11px;border:1px solid #4f5870;border-radius:8px;background:rgba(10,13,19,.97);box-shadow:0 10px 28px rgba(0,0,0,.42);font-size:10px;color:#aeb6c6}}.chart-tooltip.visible{{display:block}}.chart-tooltip strong{{display:block;color:#f1f3f7;font-size:11px;margin-bottom:7px}}.chart-tooltip-grid{{display:grid;grid-template-columns:1fr auto;gap:4px 14px}}.chart-tooltip-grid span{{color:#727d90}}.chart-tooltip-grid b{{color:#dce1e9;text-align:right}}
    .agent-token-chart{{height:270px}}.agent-token-bar{{outline:none;cursor:pointer}}.agent-token-bar rect{{stroke-width:1;transition:filter .14s,opacity .14s,stroke .14s}}.agent-input-bar{{fill:rgba(89,215,242,.62);stroke:rgba(89,215,242,.85)}}.agent-output-bar{{fill:rgba(155,140,255,.72);stroke:#aa9cff}}.agent-missing-bar{{fill:transparent;stroke:#687386!important;stroke-dasharray:3 2}}.agent-token-bar.partial rect{{opacity:.72}}.agent-token-bar:hover rect,.agent-token-bar:focus rect{{filter:brightness(1.35) drop-shadow(0 0 5px rgba(155,140,255,.5));stroke:#eef1f7}}.agent-token-label{{fill:#8993a5;font:9px ui-monospace,monospace;text-anchor:middle}}
    </style></head><body>{content}<script>
    (() => {{
      document.querySelectorAll('.chart-wrap').forEach(wrap => {{
        const tooltip = wrap.querySelector('.chart-tooltip');
        if (!tooltip) return;
        const show = (bar, clientX, clientY) => {{
          const hasUsage = Number(bar.dataset.usageCalls) > 0;
          const tokenValue = value => hasUsage ? Number(value).toLocaleString() : 'N/A';
          const common = `<span>Captured tokens</span><b>${{tokenValue(bar.dataset.tokens)}}</b><span>Input tokens</span><b>${{tokenValue(bar.dataset.inputTokens)}}</b><span>Output tokens</span><b>${{tokenValue(bar.dataset.outputTokens)}}</b><span>Usage coverage</span><b>${{bar.dataset.usageCalls}}/${{bar.dataset.llmCalls || bar.dataset.calls}} · ${{bar.dataset.usageStatus}}</b>`;
          const details = bar.dataset.agent ? `<span>LLM calls</span><b>${{bar.dataset.calls}}</b>` : `<span>Completed runs</span><b>${{bar.dataset.traces}}</b><span>Successful</span><b>${{bar.dataset.successful}}</b><span>Failed</span><b>${{bar.dataset.failed}}</b>`;
          tooltip.innerHTML = `<strong>${{bar.dataset.agent || bar.dataset.date}}</strong><div class='chart-tooltip-grid'>${{common}}${{details}}</div>`;
          const rect = wrap.getBoundingClientRect();
          const x = clientX == null ? rect.width / 2 : clientX - rect.left + wrap.scrollLeft;
          const y = clientY == null ? 65 : clientY - rect.top + wrap.scrollTop;
          tooltip.style.left = `${{Math.min(x + 12, wrap.scrollWidth - 180)}}px`;
          tooltip.style.top = `${{Math.max(8, y - 92)}}px`;
          tooltip.classList.add('visible');
        }};
        wrap.querySelectorAll('.chart-bar,.agent-token-bar').forEach(bar => {{
          bar.addEventListener('mouseenter', event => show(bar, event.clientX, event.clientY));
          bar.addEventListener('mousemove', event => show(bar, event.clientX, event.clientY));
          bar.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
          bar.addEventListener('focus', () => show(bar));
          bar.addEventListener('blur', () => tooltip.classList.remove('visible'));
        }});
      }});
      const shell = document.querySelector('.graph-shell');
      if (!shell) return;
      const viewport = shell.querySelector('.graph-viewport');
      const svg = shell.querySelector('.execution-graph');
      const stage = shell.querySelector('.graph-stage');
      let x = 0, y = 0, scale = 1, dragging = false, startX = 0, startY = 0, nodeDrag = null;
      const apply = () => stage.setAttribute('transform', `translate(${{x}} ${{y}}) scale(${{scale}})`);
      const fit = () => {{ x = 0; y = 0; scale = 1; apply(); }};
      const zoom = (factor, clientX, clientY) => {{
        const next = Math.min(2.8, Math.max(.35, scale * factor));
        const rect = svg.getBoundingClientRect();
        const px = ((clientX ?? rect.left + rect.width / 2) - rect.left) * (svg.viewBox.baseVal.width / rect.width);
        const py = ((clientY ?? rect.top + rect.height / 2) - rect.top) * (svg.viewBox.baseVal.height / rect.height);
        x = px - (px - x) * (next / scale); y = py - (py - y) * (next / scale); scale = next; apply();
      }};
      const nodeById = id => [...shell.querySelectorAll('.graph-node')].find(node => node.dataset.agentId === id);
      const updateEdges = id => shell.querySelectorAll('.graph-edge,.edge-pulse').forEach(edge => {{
        if (edge.dataset.source !== id && edge.dataset.target !== id) return;
        const source = nodeById(edge.dataset.source), target = nodeById(edge.dataset.target);
        if (!source || !target) return;
        const sx=Number(source.dataset.nodeX), sy=Number(source.dataset.nodeY), tx=Number(target.dataset.nodeX), ty=Number(target.dataset.nodeY);
        const x1=sx+176, y1=sy+34, x2=tx, y2=ty+34, bend=Math.max((x2-x1)*.45,30);
        if (edge.tagName.toLowerCase()==='path') edge.setAttribute('d',`M${{x1}},${{y1}} C${{x1+bend}},${{y1}} ${{x2-bend}},${{y2}} ${{x2}},${{y2}}`);
        else {{ edge.setAttribute('cx',(x1+x2)/2); edge.setAttribute('cy',(y1+y2)/2); }}
      }});
      viewport.addEventListener('wheel', event => {{ event.preventDefault(); zoom(event.deltaY < 0 ? 1.12 : .89, event.clientX, event.clientY); }}, {{passive:false}});
      viewport.addEventListener('pointerdown', event => {{ if (event.target.closest('.graph-node')) return; dragging = true; startX = event.clientX; startY = event.clientY; viewport.classList.add('panning'); viewport.setPointerCapture(event.pointerId); }});
      viewport.addEventListener('pointermove', event => {{ if (!dragging) return; const rect = svg.getBoundingClientRect(); const ratio = svg.viewBox.baseVal.width / rect.width; x += (event.clientX-startX)*ratio; y += (event.clientY-startY)*ratio; startX=event.clientX; startY=event.clientY; apply(); }});
      viewport.addEventListener('pointerup', () => {{ dragging=false; viewport.classList.remove('panning'); }});
      shell.querySelectorAll('[data-graph-action]').forEach(button => button.addEventListener('click', () => {{ const action=button.dataset.graphAction; if(action==='fit') fit(); else zoom(action==='zoom-in'?1.2:.83); }}));
      const select = id => {{
        shell.querySelectorAll('.graph-node').forEach(node => {{ const related=node.dataset.agentId===id; node.classList.toggle('selected',related); node.classList.toggle('dim',!related); }});
        shell.querySelectorAll('.graph-edge,.edge-pulse').forEach(edge => {{ const related=edge.dataset.source===id||edge.dataset.target===id; edge.classList.toggle('selected',related); edge.classList.toggle('dim',!related); }});
        shell.querySelectorAll('.inspector-card').forEach(card => card.classList.toggle('active',card.dataset.inspector===id));
        shell.querySelector('.inspector-empty').style.display='none';
      }};
      shell.querySelectorAll('.graph-node').forEach(node => {{
        node.addEventListener('pointerdown', event => {{ event.stopPropagation(); nodeDrag={{node,lastX:event.clientX,lastY:event.clientY,moved:false}}; node.setPointerCapture(event.pointerId); }});
        node.addEventListener('pointermove', event => {{ if(!nodeDrag || nodeDrag.node!==node) return; const rect=svg.getBoundingClientRect(); const ratio=(svg.viewBox.baseVal.width/rect.width)/scale; const dx=(event.clientX-nodeDrag.lastX)*ratio, dy=(event.clientY-nodeDrag.lastY)*ratio; if(Math.abs(dx)+Math.abs(dy)>.2) nodeDrag.moved=true; node.dataset.nodeX=String(Number(node.dataset.nodeX)+dx); node.dataset.nodeY=String(Number(node.dataset.nodeY)+dy); node.setAttribute('transform',`translate(${{node.dataset.nodeX}} ${{node.dataset.nodeY}})`); nodeDrag.lastX=event.clientX; nodeDrag.lastY=event.clientY; updateEdges(node.dataset.agentId); }});
        node.addEventListener('pointerup', event => {{ if(!nodeDrag || nodeDrag.node!==node) return; event.stopPropagation(); const moved=nodeDrag.moved; nodeDrag=null; if(!moved) select(node.dataset.agentId); }});
        node.addEventListener('keydown', event => {{ if(event.key==='Enter'||event.key===' ') select(node.dataset.agentId); }});
      }});
      shell.querySelectorAll('[data-inspector-close]').forEach(button => button.addEventListener('click', () => {{ shell.querySelectorAll('.inspector-card,.graph-node,.graph-edge,.edge-pulse').forEach(el => el.classList.remove('active','selected','dim')); shell.querySelector('.inspector-empty').style.display='flex'; }}));
    }})();
    </script></body></html>"""
