from types import SimpleNamespace

import pytest

from backend.models.execution import LLMProviderConfig
from backend.routers import config as config_router
from backend.services import execution_service, graph_service


@pytest.mark.asyncio
async def test_ai_build_uses_session_provider_api(monkeypatch):
    provider = LLMProviderConfig(
        provider_id="test",
        provider_type="openai",
        api_key="secret",
        default_model="model",
    )
    monkeypatch.setattr(config_router, "get_llm_providers_internal", lambda: [provider])

    async def unused_caller(_prompt, **_kwargs):
        return "{}"

    monkeypatch.setattr(execution_service, "_build_async_text_caller", lambda *_: unused_caller)
    monkeypatch.setattr(execution_service, "_build_async_structured_caller", lambda *_: unused_caller)

    profiles = [
        SimpleNamespace(agent_id="researcher", display_name="Researcher", persona="", description="", tools=[]),
        SimpleNamespace(agent_id="writer", display_name="Writer", persona="", description="", tools=[]),
    ]

    class FakeConfig:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class FakeBuilder:
        def __init__(self, **_kwargs):
            pass

        async def _generate_agents_async(self, *_args, **_kwargs):
            return SimpleNamespace(agents=["unused"])

        def _specs_to_profiles(self, _specs):
            return profiles

        async def _generate_topology_async(self, *_args, **_kwargs):
            return SimpleNamespace()

        def _build_graph(self, *_args, **_kwargs):
            return SimpleNamespace(
                agents=profiles,
                edges=[{"source": "researcher", "target": "writer", "weight": 1.0}],
                edge_condition_names={},
            )

    import gmas.builder

    monkeypatch.setattr(gmas.builder, "AutoBuilderConfig", FakeConfig)
    monkeypatch.setattr(gmas.builder, "AutoGraphBuilder", FakeBuilder)

    graph = await graph_service.ai_build_graph(task_query="Research and write")

    assert [agent.agent_id for agent in graph.agents] == ["researcher", "writer"]
    assert graph.start_node == "researcher"
    assert graph.end_node == "writer"
