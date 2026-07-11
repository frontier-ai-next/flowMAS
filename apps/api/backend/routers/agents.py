"""Agent CRUD endpoints."""

from fastapi import APIRouter, HTTPException

from backend.models.agent import AgentCreateRequest, AgentResponse, AgentTemplate, AgentUpdateRequest
from backend.services import agent_service

router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("", response_model=list[AgentResponse])
def list_agents():
    return agent_service.list_agents()


@router.get("/templates", response_model=list[AgentTemplate])
def list_templates():
    return agent_service.list_templates()


@router.get("/{agent_id}", response_model=AgentResponse)
def get_agent(agent_id: str):
    agent = agent_service.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    return agent


@router.post("", response_model=AgentResponse, status_code=201)
def create_agent(req: AgentCreateRequest):
    existing = agent_service.get_agent(req.agent_id)
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Agent '{req.agent_id}' already exists")
    return agent_service.create_agent(req)


@router.put("/{agent_id}", response_model=AgentResponse)
def update_agent(agent_id: str, req: AgentUpdateRequest):
    agent = agent_service.update_agent(agent_id, req)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    return agent


@router.delete("/{agent_id}", status_code=204)
def delete_agent(agent_id: str):
    if not agent_service.delete_agent(agent_id):
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
