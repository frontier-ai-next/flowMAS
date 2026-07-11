import importlib

from fastapi.testclient import TestClient


def _event(
    event_id="e1",
    trace_id="t1",
    event_type="run.started",
    payload=None,
    timestamp="2026-01-01T00:00:00+00:00",
):
    return {
        "schema_version": "1.0",
        "event_id": event_id,
        "event_type": event_type,
        "trace_id": trace_id,
        "timestamp": timestamp,
        "sequence": 1,
        "project_id": "demo",
        "environment": "test",
        "source": {"framework": "gmas"},
        "attributes": {"graph_id": "g1"},
        "payload": payload if payload is not None else {"query": "hello"},
    }


def test_ingest_is_idempotent_and_trace_is_queryable(tmp_path, monkeypatch):
    monkeypatch.setenv("GMAS_OBSERVABILITY_DATA_DIR", str(tmp_path))
    import backend.config as config
    import backend.main as main

    importlib.reload(config)
    importlib.reload(main)

    with TestClient(main.app) as client:
        first = client.post("/api/v1/events/batch", json={"events": [_event()]})
        second = client.post("/api/v1/events/batch", json={"events": [_event()]})
        cached_traces = client.get("/api/v1/traces").json()
        third = client.post(
            "/api/v1/events/batch",
            json={"events": [_event(event_id="e2", trace_id="t2")]},
        )
        refreshed_traces = client.get("/api/v1/traces").json()
        detail = client.get("/api/v1/traces/t1")

    assert first.status_code == 202
    assert first.json()["accepted"] == 1
    assert second.json()["accepted"] == 0
    assert third.json()["accepted"] == 1
    assert len(cached_traces["items"]) == 1
    assert len(refreshed_traces["items"]) == 2
    assert detail.json()["events"][0]["payload"]["query"] == "hello"


def test_batch_limit_and_validation(tmp_path, monkeypatch):
    monkeypatch.setenv("GMAS_OBSERVABILITY_DATA_DIR", str(tmp_path))
    import backend.config as config
    import backend.main as main

    importlib.reload(config)
    importlib.reload(main)
    with TestClient(main.app) as client:
        response = client.post("/api/v1/events/batch", json={"events": []})
    assert response.status_code == 422


def test_dashboard_metrics_search_and_gmas_trace_view(tmp_path, monkeypatch):
    monkeypatch.setenv("GMAS_OBSERVABILITY_DATA_DIR", str(tmp_path))
    import backend.config as config
    import backend.main as main

    importlib.reload(config)
    importlib.reload(main)
    events = [
        _event(),
        _event(
            "e2",
            event_type="agent.started",
            payload={"agent_id": "critic", "agent_name": "Critic", "predecessors": []},
        ),
        _event(
            "e3",
            event_type="agent.completed",
            payload={"agent_id": "critic", "agent_name": "Critic", "duration_ms": 25},
        ),
        _event(
            "e4",
            event_type="llm.completed",
            payload={
                "agent_id": "critic",
                "model": "test",
                "duration_ms": 20,
                "usage": {
                    "prompt_tokens": 9,
                    "completion_tokens": 3,
                    "total_tokens": 12,
                },
            },
        ),
        _event(
            "e5",
            event_type="run.completed",
            payload={
                "success": True,
                "duration_ms": 30,
                "total_tokens": 12,
                "output": "ok",
            },
        ),
        _event(
            "e4b",
            event_type="llm.completed",
            payload={"agent_id": "critic", "model": "test", "response": "legacy"},
        ),
        _event(
            "e6",
            trace_id="t2",
            payload={"query": "second"},
            timestamp="2026-01-02T00:00:00+00:00",
        ),
        _event(
            "e7",
            trace_id="t2",
            event_type="run.completed",
            payload={"success": False, "duration_ms": 10, "total_tokens": 8},
            timestamp="2026-01-02T00:01:00+00:00",
        ),
        _event(
            "e8",
            trace_id="t2",
            event_type="agent.started",
            payload={"agent_id": "writer", "agent_name": "Writer"},
            timestamp="2026-01-02T00:00:10+00:00",
        ),
        _event(
            "e9",
            trace_id="t2",
            event_type="llm.completed",
            payload={"agent_id": "writer", "model": "test", "response": "legacy"},
            timestamp="2026-01-02T00:00:20+00:00",
        ),
    ]
    with TestClient(main.app) as client:
        assert (
            client.post("/api/v1/events/batch", json={"events": events}).status_code
            == 202
        )
        metrics = client.get("/api/v1/metrics/overview").json()
        tokens = client.get("/api/v1/metrics/tokens", params={"days": 0}).json()
        custom_tokens = client.get(
            "/api/v1/metrics/tokens",
            params={"start_date": "2026-01-02", "end_date": "2026-01-02"},
        ).json()
        invalid_range = client.get(
            "/api/v1/metrics/tokens", params={"start_date": "2026-01-02"}
        )
        search = client.get("/api/v1/traces", params={"search": "hello"}).json()
        dashboard = client.get(
            "/",
            params={
                "period": "custom",
                "start_date": "2026-01-01",
                "end_date": "2026-01-02",
            },
        )
        detail = client.get("/traces/t1")
        missing_detail = client.get("/traces/t2")

    assert main._agent_token_usage(
        [
            {
                "event_type": "llm.completed",
                "payload": {"agent_id": "legacy", "response": "plain text"},
            }
        ]
    ) == [
        {
            "agent_id": "legacy",
            "input_tokens": 0,
            "output_tokens": 0,
            "calls": 1,
            "usage_calls": 0,
            "agent_name": "legacy",
            "tokens": 0,
            "usage_status": "unavailable",
        }
    ]
    assert main._agent_token_usage(
        [
            {
                "event_type": "llm.completed",
                "payload": {
                    "usage": {"input_tokens": 4, "output_tokens": 2},
                },
            }
        ]
    ) == [
        {
            "agent_id": "[unattributed]",
            "input_tokens": 4,
            "output_tokens": 2,
            "calls": 1,
            "usage_calls": 1,
            "agent_name": "Unattributed",
            "tokens": 6,
            "usage_status": "complete",
        }
    ]

    assert metrics["trace_count"] == 2
    assert metrics["success_rate"] == 50.0
    assert metrics["llm_calls"] == 3
    assert metrics["usage_calls"] == 1
    assert metrics["total_tokens"] == 12
    assert tokens["points"] == [
        {
            "date": "2026-01-01",
            "tokens": 12,
            "input_tokens": 9,
            "output_tokens": 3,
            "llm_calls": 2,
            "usage_calls": 1,
            "traces": 1,
            "successful_traces": 1,
        },
        {
            "date": "2026-01-02",
            "tokens": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "llm_calls": 1,
            "usage_calls": 0,
            "traces": 1,
            "successful_traces": 0,
        },
    ]
    assert custom_tokens["points"] == [
        {
            "date": "2026-01-02",
            "tokens": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "llm_calls": 1,
            "usage_calls": 0,
            "traces": 1,
            "successful_traces": 0,
        }
    ]
    assert invalid_range.status_code == 422
    assert len(search["items"]) == 1
    assert "Multi-agent observability" in dashboard.text
    assert "<nav><a class='active' href='/'>Traces</a></nav>" in dashboard.text
    assert all(
        placeholder not in dashboard.text
        for placeholder in ("Sessions", "Scores", "Datasets")
    )
    assert "Provider token usage over time" in dashboard.text
    assert "provider usage" in dashboard.text
    assert "Daily token usage chart" in dashboard.text
    assert "class='chart-bar " in dashboard.text
    assert "class='chart-tooltip'" in dashboard.text
    assert "bar.dataset.tokens" in dashboard.text
    assert "bar.dataset.inputTokens" in dashboard.text
    assert "9 input" in dashboard.text
    assert "3 output" in dashboard.text
    assert "1/3 calls · partial" in dashboard.text
    assert "12 tokens" in dashboard.text
    assert "Last 7 days" in dashboard.text
    assert "Last 30 days" in dashboard.text
    assert "type='date'" in dashboard.text
    assert "gMAS execution graph" in detail.text
    assert "<nav><a class='active' href='/'>Traces</a></nav>" in detail.text
    assert "execution-graph" in detail.text
    assert "Critic" in detail.text
    assert "data-graph-action='fit'" in detail.text
    assert "data-inspector='critic'" in detail.text
    assert "Drag canvas" in detail.text
    assert "Full LLM request / prompt" in detail.text
    assert "data-node-x=" in detail.text
    assert "Span waterfall" in detail.text
    assert "Provider token usage by agent" in detail.text
    assert "aria-label='Provider token usage by agent'" in detail.text
    assert "data-agent='Critic'" in detail.text
    assert "data-input-tokens='9'" in detail.text
    assert "data-output-tokens='3'" in detail.text
    assert "data-usage-status='partial'" in detail.text
    assert "1/2 calls · partial" in detail.text
    assert "bar.dataset.calls" in detail.text
    assert "data-agent='Writer'" in missing_detail.text
    assert "data-usage-status='unavailable'" in missing_detail.text
    assert "N/A provider tok" in missing_detail.text
