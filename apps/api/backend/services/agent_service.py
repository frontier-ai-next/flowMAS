"""Agent management: CRUD operations and templates."""

from backend.models.agent import (
    AgentCreateRequest,
    AgentResponse,
    AgentTemplate,
    AgentUpdateRequest,
)
from backend.services.storage_service import storage

# Predefined agent templates
AGENT_TEMPLATES: list[AgentTemplate] = [
    AgentTemplate(
        template_id="researcher",
        name="Researcher",
        description="An agent that researches and gathers information on a given topic.",
        agent=AgentCreateRequest(
            agent_id="researcher",
            display_name="Researcher",
            persona="You are an expert researcher. Gather comprehensive information and provide well-sourced analysis.",
            description="Researches topics and gathers information",
            tools=["web_search"],
        ),
    ),
    AgentTemplate(
        template_id="writer",
        name="Writer",
        description="An agent that writes clear, well-structured content.",
        agent=AgentCreateRequest(
            agent_id="writer",
            display_name="Writer",
            persona="You are a skilled technical writer. Produce clear, well-structured, and engaging content.",
            description="Writes and edits content",
        ),
    ),
    AgentTemplate(
        template_id="coder",
        name="Coder",
        description="An agent that writes and reviews code.",
        agent=AgentCreateRequest(
            agent_id="coder",
            display_name="Coder",
            persona="You are an expert software engineer. Write clean, tested, and efficient code.",
            description="Writes and reviews code",
            tools=["code_interpreter"],
        ),
    ),
    AgentTemplate(
        template_id="reviewer",
        name="Reviewer",
        description="An agent that reviews and validates work from other agents.",
        agent=AgentCreateRequest(
            agent_id="reviewer",
            display_name="Reviewer",
            persona="You are a critical reviewer. Check work for correctness, completeness, and quality.",
            description="Reviews and validates output",
        ),
    ),
    AgentTemplate(
        template_id="mathematician",
        name="Mathematician",
        description="An agent that solves mathematical problems step by step.",
        agent=AgentCreateRequest(
            agent_id="mathematician",
            display_name="Mathematician",
            persona="You are an expert mathematician. Solve problems step by step with clear reasoning and proofs.",
            description="Solves mathematical problems",
            tools=["code_interpreter"],
        ),
    ),
    AgentTemplate(
        template_id="planner",
        name="Planner",
        description="An agent that breaks down tasks and creates execution plans.",
        agent=AgentCreateRequest(
            agent_id="planner",
            display_name="Planner",
            persona="You are a strategic planner. Break complex tasks into clear, actionable steps.",
            description="Plans and decomposes tasks",
        ),
    ),
]


def list_agents() -> list[AgentResponse]:
    """List all saved agents."""
    return [AgentResponse(**_sanitize_agent_response(a)) for a in storage.list_agents()]


def get_agent(agent_id: str) -> AgentResponse | None:
    """Get a single agent by ID."""
    data = storage.get_agent(agent_id)
    if data is None:
        return None
    return AgentResponse(**_sanitize_agent_response(data))


def create_agent(req: AgentCreateRequest) -> AgentResponse:
    """Create a new agent."""
    data = req.model_dump(exclude_none=True)
    storage.save_agent(data)
    return AgentResponse(**_sanitize_agent_response(data))


def update_agent(agent_id: str, req: AgentUpdateRequest) -> AgentResponse | None:
    """Update an existing agent."""
    existing = storage.get_agent(agent_id)
    if existing is None:
        return None
    updates = req.model_dump(exclude_none=True)
    existing.update(updates)
    storage.save_agent(existing)
    return AgentResponse(**_sanitize_agent_response(existing))


def delete_agent(agent_id: str) -> bool:
    """Delete an agent."""
    return storage.delete_agent(agent_id)


def list_templates() -> list[AgentTemplate]:
    """Return predefined agent templates."""
    return AGENT_TEMPLATES


def _sanitize_agent_response(agent_data: dict) -> dict:
    """Hide sensitive fields in API responses while keeping storage intact."""
    out = dict(agent_data)
    llm_cfg = out.get("llm_config")
    if isinstance(llm_cfg, dict) and "api_key" in llm_cfg:
        out["llm_config"] = {**llm_cfg, "api_key": None}
    return out
