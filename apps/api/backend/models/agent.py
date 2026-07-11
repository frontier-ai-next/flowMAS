"""Pydantic schemas for agent API requests and responses."""

from typing import Any, Literal

from pydantic import BaseModel, Field


class AgentLLMConfigSchema(BaseModel):
    """API schema mirroring gMAS AgentLLMConfig (without torch tensors)."""

    model_name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    max_tokens: int | None = None
    temperature: float | None = None
    timeout: float | None = None
    top_p: float | None = None
    top_k: int | None = None
    stop_sequences: list[str] | None = None
    tool_calling_enabled: bool | None = None
    tool_choice: Literal["auto", "none", "required"] | None = None
    parallel_tool_calls: bool | None = None
    extra_params: dict[str, Any] = Field(default_factory=dict)


class AgentCreateRequest(BaseModel):
    """Request body for creating an agent."""

    agent_id: str
    display_name: str
    persona: str = ""
    description: str = ""
    llm_backbone: str | None = None
    llm_config: AgentLLMConfigSchema | None = None
    tools: list[str] = Field(default_factory=list)
    input_schema: dict[str, Any] | None = None
    output_schema: dict[str, Any] | None = None


class AgentUpdateRequest(BaseModel):
    """Request body for updating an agent (all fields optional)."""

    display_name: str | None = None
    persona: str | None = None
    description: str | None = None
    llm_backbone: str | None = None
    llm_config: AgentLLMConfigSchema | None = None
    tools: list[str] | None = None
    input_schema: dict[str, Any] | None = None
    output_schema: dict[str, Any] | None = None


class AgentResponse(BaseModel):
    """Agent response returned by the API."""

    agent_id: str
    display_name: str
    persona: str = ""
    description: str = ""
    llm_backbone: str | None = None
    llm_config: AgentLLMConfigSchema | None = None
    tools: list[str] = Field(default_factory=list)
    input_schema: dict[str, Any] | None = None
    output_schema: dict[str, Any] | None = None


class AgentTemplate(BaseModel):
    """Predefined agent template."""

    template_id: str
    name: str
    description: str
    agent: AgentCreateRequest
