"""Execution control endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.models.execution import ExecutionRequest, LLMProviderConfig, RunnerConfigSchema
from backend.routers import config as config_router
from backend.services import execution_service
from backend.services.run_launcher import launch_from_request
from backend.services.storage_service import storage


class FollowupRequest(BaseModel):
    """Continuation request — re-run the same graph with a new task_query.

    Memory from the previous run is intentionally preserved when the runner has
    ``enable_memory=True`` and the same graph_id is used.
    """

    task_query: str
    config: RunnerConfigSchema | None = None

router = APIRouter(prefix="/api/execution", tags=["execution"])


def _hydrate_graph_agents(graph_data: dict) -> dict:
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


def _resolve_run_llm_provider(
    req: ExecutionRequest,
    graph_data: dict,
) -> LLMProviderConfig | None:
    """Pick the workflow-level LLM provider for a run."""
    model_override = (req.llm_model or graph_data.get("llm_model") or "").strip() or None

    if req.llm_provider is not None:
        if model_override:
            return req.llm_provider.model_copy(update={"default_model": model_override})
        return req.llm_provider

    provider_id = req.llm_provider_id or graph_data.get("llm_provider_id")
    provider = config_router.resolve_llm_provider(provider_id)
    if provider is None and provider_id:
        raise HTTPException(
            status_code=400,
            detail=f"LLM provider '{provider_id}' not found. Add it in Settings → LLM Providers.",
        )
    if provider is not None and model_override:
        provider = provider.model_copy(update={"default_model": model_override})
    return provider


@router.post("/run", status_code=201)
async def start_run(req: ExecutionRequest):
    """Start an async workflow execution."""
    run_id = await launch_from_request(req)
    return {"run_id": run_id, "status": "running"}


@router.get("/history/summary")
def run_history_summary():
    """Return lightweight run counters for polling UI chrome."""
    return execution_service.get_run_history_summary()


@router.get("/history/list")
def list_runs():
    """List all past runs."""
    return execution_service.get_run_history()


@router.get("/{run_id}")
def get_run(run_id: str):
    """Get execution status and result."""
    detail = execution_service.get_run_detail(run_id)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")
    return detail


@router.delete("/{run_id}")
def cancel_run(run_id: str):
    """Cancel a running execution."""
    if not execution_service.cancel_execution(run_id):
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found or already completed")
    return {"run_id": run_id, "status": "cancelled"}


@router.post("/{run_id}/followup", status_code=201)
async def followup_run(run_id: str, req: FollowupRequest):
    """Continue a previous run with a new task on the same graph.

    Reuses the original graph (so the canvas keeps showing the same agents) but
    starts a fresh run id. When the runner has memory enabled the new task can
    reference the previous answers — that's the user-facing 'follow-up' loop.
    """
    prior = execution_service.get_run_detail(run_id)
    if prior is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")
    graph_id = prior.get("graph_id")
    if not graph_id:
        raise HTTPException(
            status_code=400,
            detail="Original run has no graph_id; cannot start follow-up.",
        )
    graph_data = storage.get_graph(graph_id)
    if graph_data is None:
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found")
    graph_data = _hydrate_graph_agents(graph_data)
    llm_provider = config_router.resolve_llm_provider(graph_data.get("llm_provider_id"))
    model_override = (graph_data.get("llm_model") or "").strip()
    if llm_provider is not None and model_override:
        llm_provider = llm_provider.model_copy(update={"default_model": model_override})

    # Carry forward the prior run's final answer as context for the new prompt
    # so the new run actually behaves like a continuation instead of a fresh ask.
    prior_answer = ""
    try:
        result = prior.get("result") or {}
        if isinstance(result, dict):
            prior_answer = str(result.get("final_answer") or result.get("answer") or "")
    except Exception:
        prior_answer = ""
    if prior_answer:
        composed_query = (
            f"PREVIOUS CONVERSATION (run {run_id[:8]}):\n{prior_answer[:4000]}\n\n"
            f"FOLLOW-UP TASK:\n{req.task_query}"
        )
    else:
        composed_query = req.task_query

    new_run_id = await execution_service.start_execution(
        graph_data=graph_data,
        task_query=composed_query,
        config=req.config,
        llm_provider=llm_provider,
    )
    return {"run_id": new_run_id, "status": "running", "parent_run_id": run_id}
