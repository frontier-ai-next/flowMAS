"""Map demo graph edges to gMAS builder inputs (demo layer only — not the SDK)."""

from typing import Any


def resolve_gmas_condition(condition: str | None, label: str | None = None) -> str | None:
    """Translate UI/storage condition vocabulary to gMAS ConditionEvaluator strings."""
    if not condition or condition in ("always", ""):
        return None
    if condition == "conditional":
        keyword = (label or "").strip()
        return f"contains:{keyword}" if keyword else None
    if condition == "skip":
        return "never"
    if condition == "loop":
        # Loopback: when the target already ran, gMAS insert_chains re-schedules it.
        # If a label is present, use it as the runtime marker that permits the retry.
        keyword = (label or "").strip()
        if keyword:
            return f"contains:{keyword}"
        return "always"
    return condition


def parse_ui_condition(stored: str | None, label: str | None = None) -> tuple[str | None, str | None]:
    """Best-effort reverse mapping when loading persisted edges."""
    if not stored:
        return None, label
    if stored.startswith("contains:"):
        return "conditional", stored[9:] or label
    if stored == "never":
        return "skip", label
    return stored, label


def edge_is_enabled(edge: dict[str, Any]) -> bool:
    if edge.get("enabled") is False:
        return False
    try:
        return float(edge.get("weight", 1.0)) > 0
    except (TypeError, ValueError):
        return True


def add_edge_to_builder(builder: Any, edge: dict[str, Any]) -> None:
    """Add one edge dict to a GraphBuilder, skipping disabled/zero-weight edges."""
    if not edge_is_enabled(edge):
        return

    weight = float(edge.get("weight", 1.0))
    condition = resolve_gmas_condition(edge.get("condition"), edge.get("label"))

    if condition:
        builder.add_conditional_edge(
            edge["source"],
            edge["target"],
            condition=condition,
            weight=weight,
        )
    else:
        builder.add_workflow_edge(edge["source"], edge["target"], weight=weight)
