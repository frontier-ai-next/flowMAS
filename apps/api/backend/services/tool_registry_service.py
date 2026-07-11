"""Tool registry initialization and runtime config for web executions."""

from typing import Any

from backend.models.execution import ToolRuntimeConfig
from backend.services.storage_service import storage
from backend.session import get_current_session_id, try_get_current_session_id

_TOOL_CONFIG_STORAGE_KEY = "__tool_runtime_config__"

_runtime_configs: dict[str, ToolRuntimeConfig] = {}


def get_tool_runtime_config() -> ToolRuntimeConfig:
    """Return persisted tool runtime config for the current session (or defaults)."""
    session_id = try_get_current_session_id()
    if session_id is None:
        return ToolRuntimeConfig()

    cached = _runtime_configs.get(session_id)
    if cached is not None:
        return cached

    data = storage.get_graph(_TOOL_CONFIG_STORAGE_KEY)
    if data and "config" in data:
        config = ToolRuntimeConfig(**data["config"])
    else:
        config = ToolRuntimeConfig()
    _runtime_configs[session_id] = config
    return config


def save_tool_runtime_config(config: ToolRuntimeConfig) -> ToolRuntimeConfig:
    """Persist tool runtime config for the current session."""
    session_id = get_current_session_id()
    _runtime_configs[session_id] = config
    storage.save_graph(
        _TOOL_CONFIG_STORAGE_KEY,
        {
            "name": _TOOL_CONFIG_STORAGE_KEY,
            "description": "Tool runtime settings for deployment",
            "config": config.model_dump(),
        },
    )
    return config

def _build_web_search_provider(config: ToolRuntimeConfig):
    from gmas.tools import (
        BraveProvider,
        DuckDuckGoProvider,
        ExaProvider,
        GoogleProvider,
        SearXNGProvider,
        SerperProvider,
        TavilyProvider,
    )

    provider_name = config.web_search.provider.lower().strip()
    timeout = config.web_search.timeout

    if provider_name == "duckduckgo":
        return DuckDuckGoProvider(timeout=timeout, ddgs_backend="duckduckgo")

    if provider_name == "serper":
        from os import environ

        key = environ.get("SERPER_API_KEY", "")
        return SerperProvider(api_key=key, timeout=timeout)

    if provider_name == "tavily":
        from os import environ

        key = environ.get("TAVILY_API_KEY", "")
        return TavilyProvider(api_key=key, timeout=timeout)

    if provider_name == "brave":
        from os import environ

        key = environ.get("BRAVE_API_KEY", "")
        return BraveProvider(api_key=key, timeout=timeout)

    if provider_name == "exa":
        from os import environ

        key = environ.get("EXA_API_KEY", "")
        return ExaProvider(api_key=key, timeout=timeout)

    if provider_name == "google":
        from os import environ

        key = environ.get("GOOGLE_API_KEY", "")
        cse_id = environ.get("GOOGLE_CSE_ID", "")
        return GoogleProvider(api_key=key, cse_id=cse_id, timeout=timeout)

    if provider_name == "searxng":
        from os import environ

        instance = environ.get("SEARXNG_BASE_URL", "")
        return SearXNGProvider(instance_url=instance, timeout=timeout)

    return DuckDuckGoProvider(timeout=timeout, ddgs_backend="duckduckgo")


def _make_bounded_web_search_tool(web_search_cls: Any, *, provider: Any, cfg: ToolRuntimeConfig):
    """Build a WebSearchTool that pins expensive options to deployment policy.

    Reasoning models (e.g. Nemotron) frequently request ``fetch_content=true``
    and ``max_results=10`` in their tool call. Full-page fetching costs ~15s per
    page and bloats the next LLM prompt, which pushed tool-using agents past the
    per-agent timeout. We clamp those arguments to the deployment config so a
    single web_search stays fast and the run completes within budget.
    """

    hard_fetch = bool(cfg.web_search.fetch_content)
    hard_max_results = int(cfg.web_search.max_results)

    class _BoundedWebSearchTool(web_search_cls):  # type: ignore[valid-type, misc]
        def execute(self, query: str = "", url: str = "", **kwargs: Any):  # type: ignore[override]
            kwargs.pop("fetch_content", None)
            requested = kwargs.pop("max_results", None)
            capped = hard_max_results
            if requested is not None:
                try:
                    capped = max(1, min(int(requested), hard_max_results))
                except (TypeError, ValueError):
                    capped = hard_max_results
            return super().execute(
                query,
                url,
                fetch_content=hard_fetch,
                max_results=capped,
                **kwargs,
            )

    return _BoundedWebSearchTool(
        provider=provider,
        max_results=cfg.web_search.max_results,
        max_content_length=cfg.web_search.max_content_length,
        fetch_content=cfg.web_search.fetch_content,
        max_fetch_pages=cfg.web_search.max_fetch_pages,
        timeout=cfg.web_search.timeout,
        deep_search=cfg.web_search.deep_search,
        cache=cfg.web_search.cache_enabled,
        cache_ttl=cfg.web_search.cache_ttl,
    )


def build_tool_registry(config: ToolRuntimeConfig | None = None):
    """Create and return a ToolRegistry configured for this deployment."""
    from gmas.tools import (
        CodeInterpreterTool,
        FileSearchTool,
        ShellTool,
        ToolRegistry,
        WebSearchTool,
    )

    cfg = config or get_tool_runtime_config()

    registry = ToolRegistry()
    enabled = set(cfg.enabled_tools)

    if "shell" in enabled:
        registry.register(
            ShellTool(
                timeout=cfg.shell_timeout,
                max_output_size=cfg.shell_max_output_size,
                allowed_commands=cfg.shell_allowed_commands,
            )
        )

    if "code_interpreter" in enabled:
        registry.register(CodeInterpreterTool())

    if "file_search" in enabled:
        registry.register(
            FileSearchTool(
                base_directory=cfg.file_search_base_directory,
                max_results=cfg.file_search_max_results,
                max_depth=cfg.file_search_max_depth,
                max_file_size=cfg.file_search_max_file_size,
                max_read_size=cfg.file_search_max_read_size,
            )
        )

    if "web_search" in enabled and cfg.web_search.enabled:
        try:
            provider = _build_web_search_provider(cfg)
        except Exception:
            from gmas.tools import DuckDuckGoProvider

            provider = DuckDuckGoProvider(timeout=cfg.web_search.timeout)
        registry.register(
            _make_bounded_web_search_tool(
                WebSearchTool,
                provider=provider,
                cfg=cfg,
            )
        )

    if "vector_search" in enabled and cfg.vector_search.enabled:
        try:
            from gmas.tools import VectorSearchTool

            registry.register(
                VectorSearchTool(
                    store_type=cfg.vector_search.store_type,
                    top_k=cfg.vector_search.top_k,
                    score_threshold=cfg.vector_search.score_threshold,
                    max_context_tokens=cfg.vector_search.max_context_tokens,
                    citation_mode=cfg.vector_search.citation_mode,
                )
            )
        except Exception:
            # Embedding provider or vector store may be unavailable in this
            # deployment. Skip silently so the rest of the registry still works.
            pass

    if "computer_use" in enabled and cfg.computer_use.enabled:
        try:
            from gmas.tools import ComputerUseTool

            registry.register(ComputerUseTool(runtime_name=cfg.computer_use.runtime_name))
        except Exception:
            # Native desktop deps (pyautogui / pywin32) may be missing.
            pass

    if "mcp" in enabled and cfg.mcp.enabled and cfg.mcp.url:
        try:
            from gmas.tools import MCPClient

            client = MCPClient(
                url=cfg.mcp.url,
                headers=cfg.mcp.headers or None,
                timeout=cfg.mcp.timeout,
            )
            client.connect()
            for mcp_tool in client.tools():
                registry.register(mcp_tool)
        except Exception:
            # Remote MCP server may be unreachable; skip without breaking startup.
            pass

    return registry


def test_registered_tool(name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    """Execute one registered tool with explicit arguments for UI onboarding."""
    from gmas.tools import ToolCall

    cfg = get_tool_runtime_config()
    registry = build_tool_registry(cfg)
    result = registry.execute(ToolCall(name=name, arguments=arguments or {}))
    return {
        "tool_name": result.tool_name,
        "success": result.success,
        "output": (result.output or "")[:4000],
        "structured_output": result.structured_output,
        "error": result.error,
    }


_TOOL_PLACEHOLDERS = {
    "shell": "Run allowlisted shell commands with bounded output and timeout.",
    "code_interpreter": "Execute Python snippets in the API runtime.",
    "file_search": "Search and read files under the configured base directory.",
    "web_search": "Search the web through the configured provider.",
    "mcp": (
        "MCP client — proxies tools from a remote Model Context Protocol server. "
        "Enable and provide a server URL in Runtime config to connect."
    ),
    "vector_search": (
        "Vector search over an embedding store (in-memory, Faiss, Qdrant, Pinecone, Milvus). "
        "Enable to index and retrieve documents for RAG."
    ),
    "computer_use": (
        "Computer-use controller — screenshots, clicks, keyboard input. "
        "Enable and pick a runtime (mock / linux / macos / windows)."
    ),
}


def list_registered_tools(config: ToolRuntimeConfig | None = None) -> list[dict[str, Any]]:
    cfg = config or get_tool_runtime_config()
    registry = build_tool_registry(cfg)
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for name in registry.list_tools():
        tool = registry.get(name)
        if tool is None:
            continue
        seen.add(tool.name)
        items.append(
            {
                "name": tool.name,
                "description": tool.description,
                "parameters_schema": getattr(tool, "parameters_schema", {}) or {},
            }
        )

    for placeholder_name, description in _TOOL_PLACEHOLDERS.items():
        if placeholder_name in seen:
            continue
        items.append(
            {
                "name": placeholder_name,
                "description": description,
                "parameters_schema": {},
            }
        )
    return items
