import asyncio
from uuid import uuid4
from types import SimpleNamespace

import pytest

from gmas_observability import (
    GMASObservabilityCallback,
    ObservabilityClient,
    ObservabilityConfig,
)
from gmas_observability.redaction import redact


def test_callback_builds_one_trace_and_parented_agent_span():
    batches = []
    client = ObservabilityClient(
        ObservabilityConfig(endpoint="http://unused", project_id="test"),
        transport=batches.extend,
        background=False,
    )
    callback = GMASObservabilityCallback(client, trace_id="platform-run")
    run_id = uuid4()

    callback.on_run_start(
        run_id=run_id, query="hello", num_agents=1, execution_order=["a"]
    )
    callback.on_agent_start(run_id=run_id, agent_id="a", prompt="prompt")
    callback.on_agent_end(run_id=run_id, agent_id="a", output="answer", tokens_used=7)
    callback.on_run_end(run_id=run_id, output="answer", total_tokens=7)
    client.flush()

    assert [event["event_type"] for event in batches] == [
        "run.started",
        "agent.started",
        "agent.completed",
        "run.completed",
    ]
    assert {event["trace_id"] for event in batches} == {"platform-run"}
    assert batches[1]["parent_span_id"] == batches[0]["span_id"]
    assert batches[2]["span_id"] == batches[1]["span_id"]


def test_redaction_happens_before_transport():
    sent = []
    client = ObservabilityClient(
        ObservabilityConfig(endpoint="http://unused", project_id="test"),
        transport=sent.extend,
        background=False,
    )
    callback = GMASObservabilityCallback(client)
    callback.on_run_start(
        run_id="r", query="Bearer abc.secret", metadata={"api_key": "bad"}
    )
    client.flush()

    assert sent[0]["payload"]["query"] == "Bearer [REDACTED]"


@pytest.mark.asyncio
async def test_async_transport_is_awaited_from_async_caller():
    sent = []

    async def transport(batch):
        await asyncio.sleep(0)
        sent.extend(batch)

    client = ObservabilityClient(
        ObservabilityConfig(endpoint="http://unused", project_id="test"),
        transport=transport,
        background=False,
    )
    callback = GMASObservabilityCallback(client)
    callback.on_run_start(run_id="r", query="hello")
    await client.flush_async()

    assert [event["event_type"] for event in sent] == ["run.started"]


@pytest.mark.asyncio
async def test_background_delivery_uses_one_async_queue_and_worker():
    sent = []

    async def transport(batch):
        sent.extend(batch)

    client = ObservabilityClient(
        ObservabilityConfig(endpoint="http://unused", project_id="test"),
        transport=transport,
        background=False,
    )
    await client.start()
    callback = GMASObservabilityCallback(client)
    callback.on_run_start(run_id="r1", query="one")
    callback.on_run_start(run_id="r2", query="two")

    await client.flush_async()

    assert isinstance(client._queue, asyncio.Queue)
    assert client._worker_task is not None
    assert client._worker_task.get_name() == "gmas-observability"
    assert [event["trace_id"] for event in sent] == ["r1", "r2"]
    await client.aclose()
    assert client._worker_task is None


@pytest.mark.asyncio
async def test_background_delivery_reuses_one_http_client(monkeypatch):
    created = []

    class Response:
        def raise_for_status(self):
            return None

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            self.posts = []
            self.closed = False
            created.append(self)

        async def post(self, url, **kwargs):
            self.posts.append((url, kwargs))
            return Response()

        async def aclose(self):
            self.closed = True

    monkeypatch.setattr("gmas_observability.client.httpx.AsyncClient", FakeAsyncClient)
    client = ObservabilityClient(
        ObservabilityConfig(
            endpoint="http://observability", project_id="test", batch_size=1
        ),
        background=False,
    )
    await client.start()
    callback = GMASObservabilityCallback(client)
    callback.on_run_start(run_id="r1", query="one")
    callback.on_run_start(run_id="r2", query="two")

    await client.flush_async()

    assert len(created) == 1
    assert len(created[0].posts) == 2
    await client.aclose()
    assert created[0].closed is True


def test_recursive_sensitive_key_redaction():
    assert redact({"config": {"api_key": "secret", "safe": 1}}) == {
        "config": {"api_key": "[REDACTED]", "safe": 1}
    }


def test_non_agent_gmas_events_are_captured():
    sent = []
    client = ObservabilityClient(
        ObservabilityConfig(endpoint="http://unused", project_id="test"),
        transport=sent.extend,
        background=False,
    )
    callback = GMASObservabilityCallback(client)
    callback.on_memory_read(run_id="r", agent_id="a", entries_count=2, keys=["x"])
    callback.on_topology_changed(
        run_id="r",
        reason="hook",
        old_remaining=["a"],
        new_remaining=["b"],
        change_count=1,
    )
    client.flush()
    assert [event["event_type"] for event in sent] == [
        "memory.read",
        "topology.changed",
    ]


@pytest.mark.asyncio
async def test_async_llm_wrapper_preserves_result_and_emits_span():
    sent = []
    client = ObservabilityClient(
        ObservabilityConfig(endpoint="http://unused", project_id="test"),
        transport=sent.extend,
        background=False,
    )
    callback = GMASObservabilityCallback(client, trace_id="trace")

    async def caller(prompt, tools=None):
        return f"answer:{prompt}:{len(tools or [])}"

    observed = callback.wrap_async_llm(caller, agent_id="a", model="model")
    result = await observed("hello", tools=[{"name": "search"}])
    await client.flush_async()

    assert result == "answer:hello:1"
    assert [event["event_type"] for event in sent] == ["llm.started", "llm.completed"]
    assert sent[0]["span_id"] == sent[1]["span_id"]


@pytest.mark.asyncio
async def test_string_llm_result_can_preserve_provider_usage():
    sent = []
    client = ObservabilityClient(
        ObservabilityConfig(endpoint="http://unused", project_id="test"),
        transport=sent.extend,
        background=False,
    )
    callback = GMASObservabilityCallback(client, trace_id="trace")

    class ProviderText(str):
        usage = {"prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10}

    async def caller(prompt):
        return ProviderText("answer")

    result = await callback.wrap_async_llm(caller, agent_id="a")("prompt")
    await client.flush_async()

    assert result == "answer"
    completed = next(event for event in sent if event["event_type"] == "llm.completed")
    assert completed["payload"]["usage"] == ProviderText.usage


def test_stream_events_get_the_same_span_model():
    sent = []
    client = ObservabilityClient(
        ObservabilityConfig(endpoint="http://unused", project_id="test"),
        transport=sent.extend,
        background=False,
    )
    callback = GMASObservabilityCallback(client, trace_id="platform")
    callback.capture_stream_event(
        {"event_type": "run_start", "run_id": "platform", "query": "q"}
    )
    callback.capture_stream_event(
        {"event_type": "agent_start", "run_id": "platform", "agent_id": "a"}
    )
    callback.capture_stream_event(
        {
            "event_type": "agent_output",
            "run_id": "platform",
            "agent_id": "a",
            "content": "ok",
        }
    )
    client.flush()
    assert sent[1]["parent_span_id"] == sent[0]["span_id"]
    assert sent[2]["span_id"] == sent[1]["span_id"]


@pytest.mark.asyncio
async def test_infers_active_agent_preserves_step_and_drops_raw_reasoning():
    sent = []
    client = ObservabilityClient(
        ObservabilityConfig(endpoint="http://unused", project_id="test"),
        transport=sent.extend,
        background=False,
    )
    callback = GMASObservabilityCallback(client, trace_id="trace")
    callback.on_run_start(run_id="internal", query="q")
    callback.on_agent_start(run_id="internal", agent_id="critic", step_index=2)

    class Usage:
        def model_dump(self, mode="json"):
            return {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12}

    async def caller(prompt):
        return SimpleNamespace(
            content="safe answer",
            tool_calls=[],
            raw_response=SimpleNamespace(
                model="safe-model", usage=Usage(), reasoning_content="must not escape"
            ),
        )

    result = await callback.wrap_async_llm(caller, model="safe-model")("prompt")
    callback.on_agent_end(
        run_id="internal", agent_id="critic", output=result.content, step_index=0
    )
    await client.flush_async()

    started = next(event for event in sent if event["event_type"] == "llm.started")
    completed = next(event for event in sent if event["event_type"] == "llm.completed")
    agent_end = next(
        event for event in sent if event["event_type"] == "agent.completed"
    )
    assert started["payload"]["agent_id"] == "critic"
    assert completed["payload"]["response"] == {
        "content": "safe answer",
        "tool_calls": [],
        "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
        "model": "safe-model",
    }
    assert completed["payload"]["usage"] == {
        "prompt_tokens": 10,
        "completion_tokens": 2,
        "total_tokens": 12,
    }
    assert "reasoning" not in str(completed)
    assert agent_end["payload"]["step_index"] == 2


@pytest.mark.asyncio
async def test_llm_usage_is_captured_when_content_capture_is_disabled():
    sent = []
    client = ObservabilityClient(
        ObservabilityConfig(
            endpoint="http://unused", project_id="test", capture_content=False
        ),
        transport=sent.extend,
        background=False,
    )
    callback = GMASObservabilityCallback(client, trace_id="trace")

    async def caller(prompt):
        return SimpleNamespace(
            content="private answer",
            raw_response=SimpleNamespace(
                usage={"input_tokens": 7, "output_tokens": 4, "total_tokens": 11}
            ),
        )

    await callback.wrap_async_llm(caller, model="safe-model")("private prompt")
    await client.flush_async()

    completed = next(event for event in sent if event["event_type"] == "llm.completed")
    assert completed["payload"]["response"] is None
    assert completed["payload"]["usage"] == {
        "input_tokens": 7,
        "output_tokens": 4,
        "total_tokens": 11,
    }


def test_stream_tool_registry_proxy_emits_agent_scoped_tool_span():
    sent = []
    client = ObservabilityClient(
        ObservabilityConfig(endpoint="http://unused", project_id="test"),
        transport=sent.extend,
        background=False,
    )
    callback = GMASObservabilityCallback(client, trace_id="trace")
    callback.on_run_start(run_id="internal", query="q")
    callback.on_agent_start(run_id="internal", agent_id="coder", step_index=0)

    class Registry:
        def execute(self, call):
            return SimpleNamespace(success=True, output="tool output", error=None)

        def get_schemas(self):
            return ["schema"]

    proxy = callback.wrap_tool_registry(Registry())
    result = proxy.execute(
        SimpleNamespace(name="code_interpreter", arguments={"code": "1+1"})
    )
    client.flush()

    assert result.output == "tool output"
    assert proxy.get_schemas() == ["schema"]
    tools = [event for event in sent if event["event_type"].startswith("tool.")]
    assert [event["event_type"] for event in tools] == [
        "tool.started",
        "tool.completed",
    ]
    assert {event["payload"]["agent_id"] for event in tools} == {"coder"}
    assert tools[0]["span_id"] == tools[1]["span_id"]
