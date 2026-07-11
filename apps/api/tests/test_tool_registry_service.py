from backend.models.execution import ToolRuntimeConfig
from backend.services.tool_registry_service import list_registered_tools


def test_disabled_tools_remain_visible_for_reenable():
    config = ToolRuntimeConfig(
        enabled_tools=[],
        web_search={"enabled": False},
        mcp={"enabled": False},
        vector_search={"enabled": False},
        computer_use={"enabled": False},
    )
    names = {item["name"] for item in list_registered_tools(config)}
    assert names == {
        "shell",
        "code_interpreter",
        "file_search",
        "web_search",
        "mcp",
        "vector_search",
        "computer_use",
    }
