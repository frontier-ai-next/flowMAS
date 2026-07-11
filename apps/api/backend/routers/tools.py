"""Tool registry and runtime configuration endpoints."""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from backend.models.execution import ToolRuntimeConfig
from backend.services.tool_registry_service import (
    get_tool_runtime_config,
    list_registered_tools,
    save_tool_runtime_config,
    test_registered_tool,
)

router = APIRouter(prefix="/api/tools", tags=["tools"])


class ToolInfo(BaseModel):
    """Tool information returned by the API."""

    name: str
    description: str = ""
    parameters_schema: dict[str, Any] = Field(default_factory=dict)


class ToolTestRequest(BaseModel):
    """Request body for manually testing a registered tool."""

    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolTestResponse(BaseModel):
    """Result of a manual tool test run."""

    tool_name: str
    success: bool
    output: str = ""
    structured_output: dict[str, Any] | None = None
    error: str | None = None


@router.get("", response_model=list[ToolInfo])
def list_tools():
    """List effective tools configured for this deployment."""
    try:
        return [ToolInfo(**item) for item in list_registered_tools()]
    except Exception:
        return []


@router.get("/config", response_model=ToolRuntimeConfig)
def get_tools_config():
    """Get deployment runtime tool config."""
    return get_tool_runtime_config()


@router.put("/config", response_model=ToolRuntimeConfig)
def update_tools_config(config: ToolRuntimeConfig):
    """Update deployment runtime tool config."""
    return save_tool_runtime_config(config)


@router.post("/{tool_name}/test", response_model=ToolTestResponse)
def test_tool(tool_name: str, req: ToolTestRequest):
    """Execute a tool once from the UI to verify deployment config."""
    return ToolTestResponse(**test_registered_tool(tool_name, req.arguments))
