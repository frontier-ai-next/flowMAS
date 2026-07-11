"""Pydantic schemas for execution API requests and responses."""

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field

from .graph import GraphSaveRequest


class BudgetConfigSchema(BaseModel):
    """Budget configuration for execution."""

    total_token_limit: int | None = None
    total_request_limit: int | None = None
    total_time_limit_seconds: float | None = None

    node_token_limit: int | None = None
    node_request_limit: int | None = None
    node_time_limit_seconds: float | None = None

    max_prompt_length: int | None = 4000
    max_response_length: int | None = 2000
    warn_at_usage_ratio: float = 0.8


class MemoryConfigSchema(BaseModel):
    """Detailed memory policy (maps to gMAS MemoryConfig)."""

    working_max_entries: int = 20
    working_default_ttl: float | None = 3600.0
    long_term_max_entries: int = 100
    long_term_default_ttl: float | None = None
    auto_compress: bool = True
    promote_after_accesses: int = 3
    demote_inactive_after: float = 7200.0
    cleanup_interval: float = 300.0
    hidden_state_dim: int | None = None


class PruningConfigSchema(BaseModel):
    """Adaptive scheduler pruning configuration."""

    min_weight_threshold: float = 0.1
    min_probability_threshold: float = 0.05
    max_consecutive_errors: int = 3
    skip_on_predecessor_failure: bool = True
    token_budget: int | None = None
    min_quality_threshold: float = 0.3
    enable_fallback: bool = True
    max_fallback_attempts: int = 2


class ErrorActionType(str, Enum):
    SKIP = "skip"
    RETRY = "retry"
    PRUNE = "prune"
    FALLBACK = "fallback"
    ROLLBACK = "rollback"
    ABORT = "abort"


class ErrorPolicySchema(BaseModel):
    """Runner error handling policy."""

    on_timeout: ErrorActionType = ErrorActionType.RETRY
    on_retry_exhausted: ErrorActionType = ErrorActionType.PRUNE
    on_budget_exceeded: ErrorActionType = ErrorActionType.ABORT
    on_agent_not_found: ErrorActionType = ErrorActionType.SKIP
    on_validation_error: ErrorActionType = ErrorActionType.ABORT
    on_unknown_error: ErrorActionType = ErrorActionType.SKIP
    max_skipped_agents: int = 5
    abort_on_critical_path: bool = True


# ---------------------------------------------------------------------------
# Early-stop conditions (declarative schema sent from the UI)
# ---------------------------------------------------------------------------


class EarlyStopType(str, Enum):
    KEYWORD = "keyword"
    TOKEN_LIMIT = "token_limit"
    AGENT_COUNT = "agent_count"
    METADATA = "metadata"
    CUSTOM = "custom"
    COMBINE_ANY = "combine_any"
    COMBINE_ALL = "combine_all"


class MetadataComparator(str, Enum):
    EQ = "eq"
    NE = "ne"
    GT = "gt"
    GTE = "gte"
    LT = "lt"
    LTE = "lte"
    CONTAINS = "contains"


class EarlyStopConditionSchema(BaseModel):
    """One early-stop rule configured in the UI."""

    type: EarlyStopType
    reason: str | None = None

    # KEYWORD
    keyword: str | None = None

    # TOKEN_LIMIT
    max_tokens: int | None = None

    # AGENT_COUNT
    max_agents: int | None = None

    # METADATA
    metadata_key: str | None = None
    metadata_value: Any | None = None
    metadata_comparator: MetadataComparator | None = None

    # CUSTOM (safe built-in predicates only, no raw python eval)
    custom_predicate: Literal[
        "response_contains",
        "response_not_contains",
        "has_any_error",
        "all_steps_success",
    ] | None = None

    # COMBINE_ANY / COMBINE_ALL
    conditions: list["EarlyStopConditionSchema"] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Topology hooks (predefined hook presets selectable from the UI)
# ---------------------------------------------------------------------------


class TopologyHookType(str, Enum):
    STOP_ON_KEYWORD = "stop_on_keyword"
    SKIP_ON_TOKEN_BUDGET = "skip_on_token_budget"
    FORCE_REVIEWER_ON_ERROR = "force_reviewer_on_error"
    INSERT_CHAIN_ON_KEYWORD = "insert_chain_on_keyword"
    ADD_EDGE_ON_KEYWORD = "add_edge_on_keyword"
    REMOVE_EDGE_ON_KEYWORD = "remove_edge_on_keyword"
    REDIRECT_END_ON_KEYWORD = "redirect_end_on_keyword"
    SKIP_AGENT_ON_KEYWORD = "skip_agent_on_keyword"
    CONDITION_SKIP_AGENT_ON_KEYWORD = "condition_skip_agent_on_keyword"
    CONDITION_UNSKIP_AGENT_ON_KEYWORD = "condition_unskip_agent_on_keyword"
    TRIGGER_REBUILD_ON_KEYWORD = "trigger_rebuild_on_keyword"


class TopologyHookSchema(BaseModel):
    """A predefined topology-hook preset."""

    type: TopologyHookType
    keyword: str | None = None
    token_threshold: int | None = None
    reviewer_agent_id: str | None = None
    source_agent: str | None = None
    target_agent: str | None = None
    weight: float = 1.0


class ToolRuntimeWebSearchConfig(BaseModel):
    """Web search runtime configuration for this deployment."""

    enabled: bool = True
    provider: str = "duckduckgo"
    max_results: int = 5
    max_content_length: int = 4000
    fetch_content: bool = False
    max_fetch_pages: int = 3
    timeout: int = 15
    deep_search: str | None = None
    cache_enabled: bool = True
    cache_ttl: float = 300.0


class ToolRuntimeMCPConfig(BaseModel):
    """MCP (Model Context Protocol) client tool configuration."""

    enabled: bool = False
    url: str | None = None
    headers: dict[str, str] = Field(default_factory=dict)
    timeout: float = 30.0


class ToolRuntimeVectorSearchConfig(BaseModel):
    """Vector search tool configuration."""

    enabled: bool = False
    store_type: str = "in_memory"
    top_k: int = 5
    score_threshold: float = 0.0
    max_context_tokens: int = 4096
    citation_mode: str = "numbered"


class ToolRuntimeComputerUseConfig(BaseModel):
    """Computer-use tool configuration."""

    enabled: bool = False
    runtime_name: str = "mock"


class ToolRuntimeConfig(BaseModel):
    """Tool runtime registry configuration for this deployment."""

    enabled_tools: list[str] = Field(
        default_factory=lambda: [
            "shell",
            "code_interpreter",
            "file_search",
            "web_search",
            "mcp",
            "vector_search",
            "computer_use",
        ]
    )
    shell_timeout: int = 30
    shell_max_output_size: int = 8192
    shell_allowed_commands: list[str] | None = None
    file_search_base_directory: str = "."
    file_search_max_results: int = 50
    file_search_max_depth: int = 10
    file_search_max_file_size: int = 100_000
    file_search_max_read_size: int = 10_000
    web_search: ToolRuntimeWebSearchConfig = Field(default_factory=ToolRuntimeWebSearchConfig)
    mcp: ToolRuntimeMCPConfig = Field(default_factory=ToolRuntimeMCPConfig)
    vector_search: ToolRuntimeVectorSearchConfig = Field(default_factory=ToolRuntimeVectorSearchConfig)
    computer_use: ToolRuntimeComputerUseConfig = Field(default_factory=ToolRuntimeComputerUseConfig)


class RunnerConfigSchema(BaseModel):
    """Runner configuration mirroring gMAS RunnerConfig."""

    # Per-agent execution timeout. Reasoning models (e.g. Nemotron) routinely
    # take 20-30s for a single completion, and tool-using agents need several
    # round-trips, so a tight 60s budget caused spurious TimeoutErrors. Match
    # the LLM client timeout (180s) by default.
    timeout: float = 180.0
    adaptive: bool = False
    enable_parallel: bool = True
    max_parallel_size: int = 5
    max_retries: int = 2
    retry_delay: float = 1.0
    retry_backoff: float = 2.0

    update_states: bool = True
    routing_policy: str = "topological"
    pruning_config: PruningConfigSchema | None = None

    enable_hidden_channels: bool = False
    hidden_combine_strategy: str = "mean"
    pass_embeddings: bool = True

    error_policy: ErrorPolicySchema | None = None
    budget_config: BudgetConfigSchema | None = None

    enable_memory: bool = False
    memory_context_limit: int = 5
    memory_config: MemoryConfigSchema | None = None

    enable_token_streaming: bool = False
    broadcast_task_to_all: bool = True

    enable_dynamic_topology: bool = False
    early_stop_conditions: list[EarlyStopConditionSchema] = Field(default_factory=list)
    topology_hooks: list[TopologyHookSchema] = Field(default_factory=list)

    max_tool_iterations: int = 3
    max_loop_iterations: int = 5
    callback_modes: list[Literal["stdout", "metrics", "file"]] = Field(default_factory=list)

    # Execution mode in the web runner:
    # - "round": keep arun_round behavior
    # - "stream": use astream() and forward full stream events (including token events)
    execution_mode: Literal["round", "stream"] = "round"


class LLMProviderConfig(BaseModel):
    """LLM provider configuration."""

    provider_id: str
    provider_type: str | None = None
    display_name: str | None = None
    base_url: str | None = None
    api_key: str | None = None  # Can use $ENV_VAR format
    default_model: str | None = None


class ExecutionRequest(BaseModel):
    """Request to start a workflow execution."""

    graph_id: str | None = None
    graph: GraphSaveRequest | None = None
    task_query: str
    config: RunnerConfigSchema | None = None
    llm_provider: LLMProviderConfig | None = None
    llm_provider_id: str | None = None
    llm_model: str | None = None


class StreamEventResponse(BaseModel):
    """A streaming event sent over WebSocket."""

    event_type: str
    timestamp: str
    run_id: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class AgentStatusEntry(BaseModel):
    """Status of a single agent during execution."""

    agent_id: str
    status: str  # "pending", "running", "completed", "error"
    response: str | None = None
    tokens_used: int = 0
    duration_ms: float = 0.0
    error: str | None = None


class ExecutionStatusResponse(BaseModel):
    """Response for execution status query."""

    run_id: str
    status: str  # "running", "completed", "error", "cancelled"
    agent_statuses: list[AgentStatusEntry] = Field(default_factory=list)
    events: list[StreamEventResponse] = Field(default_factory=list)
    result: dict[str, Any] | None = None
    started_at: str = ""
    completed_at: str | None = None


class RunHistoryEntry(BaseModel):
    """Summary entry for run history."""

    run_id: str
    graph_id: str | None = None
    graph_name: str = ""
    task_query: str = ""
    status: str
    total_tokens: int = 0
    total_time: float = 0.0
    agent_count: int = 0
    started_at: str = ""
    completed_at: str | None = None


EarlyStopConditionSchema.model_rebuild()
