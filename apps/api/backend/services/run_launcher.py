"""Shared helpers to load a graph and start a run (manual, scheduled, follow-up)."""

from typing import Any

from fastapi import HTTPException

from backend.models.execution import ExecutionRequest, LLMProviderConfig, RunnerConfigSchema
from backend.routers import config as config_router
from backend.services import execution_service
from backend.services.storage_service import storage


def hydrate_graph_agents(graph_data: dict[str, Any]) -> dict[str, Any]:
    """Restore missing agent runtime fields from the agent store."""
    agents_store = {a["agent_id"]: a for a in storage.list_agents()}
    enriched_agents = []

    for agent in graph_data.get("agents", []):
        aid = agent.get("agent_id")
        if aid and aid in agents_store:
            stored_agent = agents_store[aid]
            merged = {**agent}
            graph_llm = merged.get("llm_config")
            stored_llm = stored_agent.get("llm_config")

            if isinstance(stored_llm, dict):
                if not isinstance(graph_llm, dict):
                    merged["llm_config"] = dict(stored_llm)
                elif not graph_llm.get("api_key"):
                    restored_llm = {**stored_llm, **graph_llm}
                    restored_llm["api_key"] = stored_llm.get("api_key")
                    merged["llm_config"] = restored_llm

            for field in ("llm_config", "llm_backbone", "persona", "description"):
                if not merged.get(field) and stored_agent.get(field):
                    merged[field] = stored_agent[field]
            if "tools" not in agent and stored_agent.get("tools"):
                merged["tools"] = stored_agent["tools"]

            enriched_agents.append(merged)
        else:
            enriched_agents.append(agent)

    return {**graph_data, "agents": enriched_agents}


def resolve_run_llm_provider(
    *,
    graph_data: dict[str, Any],
    llm_provider_id: str | None = None,
    llm_model: str | None = None,
    llm_provider: LLMProviderConfig | None = None,
) -> LLMProviderConfig | None:
    """Pick the workflow-level LLM provider for a run."""
    model_override = (llm_model or graph_data.get("llm_model") or "").strip() or None

    if llm_provider is not None:
        if model_override:
            return llm_provider.model_copy(update={"default_model": model_override})
        return llm_provider

    provider_id = llm_provider_id or graph_data.get("llm_provider_id")
    provider = config_router.resolve_llm_provider(provider_id)
    if provider is None and provider_id:
        raise HTTPException(
            status_code=400,
            detail=f"LLM provider '{provider_id}' not found. Add it in Settings → LLM Providers.",
        )
    if provider is not None and model_override:
        provider = provider.model_copy(update={"default_model": model_override})
    return provider


async def launch_graph_run(
    *,
    graph_id: str | None = None,
    graph_data: dict[str, Any] | None = None,
    task_query: str,
    config: RunnerConfigSchema | None = None,
    llm_provider_id: str | None = None,
    llm_model: str | None = None,
    llm_provider: LLMProviderConfig | None = None,
    trigger_source: str = "manual",
    schedule_id: str | None = None,
    schedule_name: str | None = None,
) -> str:
    """Load graph (if needed), hydrate agents, and start execution."""
    if graph_data is None:
        if not graph_id:
            raise HTTPException(status_code=400, detail="graph_id or graph_data is required")
        stored = storage.get_graph(graph_id)
        if stored is None:
            raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found")
        graph_data = stored

    graph_data = hydrate_graph_agents(graph_data)
    if graph_id and not graph_data.get("graph_id"):
        graph_data = {**graph_data, "graph_id": graph_id}

    provider = resolve_run_llm_provider(
        graph_data=graph_data,
        llm_provider_id=llm_provider_id,
        llm_model=llm_model,
        llm_provider=llm_provider,
    )
    if provider is not None and not execution_service._resolve_api_key(provider.api_key):
        raise HTTPException(
            status_code=400,
            detail="LLM provider has no API key. Open Settings → LLM Providers, enter the key, and click Save.",
        )

    return await execution_service.start_execution(
        graph_data=graph_data,
        task_query=task_query,
        config=config,
        llm_provider=provider,
        trigger_source=trigger_source,
        schedule_id=schedule_id,
        schedule_name=schedule_name,
    )


async def launch_from_request(req: ExecutionRequest) -> str:
    """Start a run from an API ExecutionRequest."""
    if req.graph:
        graph_data = req.graph.model_dump()
        graph_id = req.graph_id or graph_data.get("graph_id")
    elif req.graph_id:
        graph_id = req.graph_id
        graph_data = None
    else:
        raise HTTPException(status_code=400, detail="Either graph_id or graph must be provided")

    return await launch_graph_run(
        graph_id=graph_id,
        graph_data=graph_data,
        task_query=req.task_query,
        config=req.config,
        llm_provider_id=req.llm_provider_id,
        llm_model=req.llm_model,
        llm_provider=req.llm_provider,
    )
