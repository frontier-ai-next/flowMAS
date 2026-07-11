"""Pydantic schemas for graph API requests and responses."""

from typing import Any, Literal

from pydantic import BaseModel, Field

from .agent import AgentCreateRequest


class Position(BaseModel):
    """Node position on the canvas."""

    x: float = 0.0
    y: float = 0.0


class EdgeDefinition(BaseModel):
    """Definition of a graph edge."""

    source: str
    target: str
    weight: float = 1.0
    enabled: bool = True
    condition: str | None = None  # UI/storage: "always", "source_success", "skip", "loop", "conditional", …
    label: str | None = None


class GraphSaveRequest(BaseModel):
    """Request body for creating/saving a graph."""

    name: str
    description: str = ""
    agents: list[AgentCreateRequest] = Field(default_factory=list)
    edges: list[EdgeDefinition] = Field(default_factory=list)
    positions: dict[str, Position] = Field(default_factory=dict)
    start_node: str | None = None
    end_node: str | None = None
    task_targets: list[str] = Field(default_factory=list)
    task_query: str = ""
    llm_provider_id: str | None = None
    llm_model: str | None = None
    run_config: dict[str, Any] = Field(default_factory=dict)


class GraphResponse(BaseModel):
    """Graph response returned by the API."""

    graph_id: str
    name: str
    description: str = ""
    agents: list[AgentCreateRequest] = Field(default_factory=list)
    edges: list[EdgeDefinition] = Field(default_factory=list)
    positions: dict[str, Position] = Field(default_factory=dict)
    start_node: str | None = None
    end_node: str | None = None
    task_targets: list[str] = Field(default_factory=list)
    task_query: str = ""
    llm_provider_id: str | None = None
    llm_model: str | None = None
    run_config: dict[str, Any] = Field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""
    validation_errors: list[str] = Field(default_factory=list)


class GraphListItem(BaseModel):
    """Minimal graph info for listing."""

    graph_id: str
    name: str
    description: str = ""
    agent_count: int = 0
    edge_count: int = 0
    created_at: str = ""
    updated_at: str = ""


class GraphValidationResponse(BaseModel):
    """Response from graph validation."""

    is_valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    execution_order: list[str] = Field(default_factory=list)


class AutoBuildRequest(BaseModel):
    """Request body for automatic graph assembly from saved agents."""

    name: str = "Auto-Built Workflow"
    description: str = ""
    task_query: str
    agent_ids: list[str] = Field(default_factory=list)
    strategy: str = "embedding_knn"  # embedding_knn | chain | dense
    max_edges_per_agent: int = 2


class GraphTemplate(BaseModel):
    """Predefined ready-to-use graph template (architecture pattern)."""

    template_id: str
    name: str
    description: str
    category: str = "general"  # research | coding | analysis | review | general
    graph: GraphSaveRequest


class AIBuildRequest(BaseModel):
    """LLM-powered full graph assembly — designs agents and topology from scratch."""

    task_query: str
    name: str = "AI-Built Workflow"
    description: str = ""
    max_agents: int = 6
    enabled_tools: list[str] = Field(default_factory=list)


GraphImportSource = Literal["gmas_json", "gmas_python", "langflow", "langgraph_mermaid", "mermaid"]
GraphImportMode = Literal["native_graph", "native_python", "agent_graph", "component_graph", "mermaid_graph"]
GraphExportFormat = Literal["gmas_json", "gmas_python"]


class GraphExportRequest(BaseModel):
    """Export a graph in a portable native gMAS Studio format."""

    graph: GraphSaveRequest
    format: GraphExportFormat = "gmas_json"
    filename_hint: str | None = None
    source_graph_id: str | None = None


class GraphExportResponse(BaseModel):
    """Generated export payload ready for download or copy."""

    format: GraphExportFormat
    filename: str
    mime_type: str
    content: str
    warnings: list[str] = Field(default_factory=list)


class GraphImportRequest(BaseModel):
    """Import a graph from a native or external visual workflow format."""

    source: GraphImportSource
    payload: Any
    name_override: str | None = None


class GraphImportResponse(BaseModel):
    """Result of importing and persisting a native or external graph."""

    source: GraphImportSource
    import_mode: GraphImportMode
    warnings: list[str] = Field(default_factory=list)
    graph: GraphResponse
