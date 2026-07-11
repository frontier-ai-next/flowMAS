"""Tests for optional observability integration."""

from types import SimpleNamespace

from backend.services import observability_service
from backend.services.observability_service import create_observability_callback
from backend.services.execution_service import _ProviderTextResult


def test_observability_disabled_by_default():
    state = SimpleNamespace(
        run_id="r1",
        graph_data={},
        trigger_source="manual",
        schedule_id=None,
        session_id="a" * 32,
    )
    assert create_observability_callback(state) is None


def test_callbacks_share_the_application_client(monkeypatch):
    shared_client = SimpleNamespace(
        config=SimpleNamespace(project_id="test", environment="test")
    )
    monkeypatch.setattr(observability_service.settings, "observability_enabled", True)
    monkeypatch.setattr(observability_service, "_client", shared_client)
    first = create_observability_callback(
        SimpleNamespace(
            run_id="r1", graph_data={}, trigger_source="manual", schedule_id=None
        )
    )
    second = create_observability_callback(
        SimpleNamespace(
            run_id="r2", graph_data={}, trigger_source="manual", schedule_id=None
        )
    )

    assert first.client is shared_client
    assert second.client is shared_client


def test_provider_text_result_preserves_usage_without_changing_string_contract():
    usage = {"prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10}
    result = _ProviderTextResult("answer", usage)

    assert isinstance(result, str)
    assert result == "answer"
    assert result.usage == usage


def test_callback_close_does_not_close_shared_client(monkeypatch):
    calls = {"flush": 0, "close": 0}

    class SharedClient:
        config = SimpleNamespace(project_id="test", environment="test")

        def flush(self):
            calls["flush"] += 1

        def close(self):
            calls["close"] += 1

    monkeypatch.setattr(observability_service.settings, "observability_enabled", True)
    monkeypatch.setattr(observability_service, "_client", SharedClient())
    callback = create_observability_callback(
        SimpleNamespace(
            run_id="r-close", graph_data={}, trigger_source="manual", schedule_id=None
        )
    )

    callback.close()

    assert calls == {"flush": 1, "close": 0}
