"""Graph building and validation using the gMAS framework."""

import contextlib
import json
import logging
from types import SimpleNamespace
import uuid
from typing import Any

from backend.models.graph import (
    GraphListItem,
    GraphResponse,
    GraphSaveRequest,
    GraphValidationResponse,
)
from backend.services.edge_helpers import add_edge_to_builder, edge_is_enabled
from backend.services.storage_service import storage

logger = logging.getLogger(__name__)


def list_graphs() -> list[GraphListItem]:
    """List all saved graphs."""
    items = []
    for g in storage.list_graphs():
        graph_id = str(g.get("graph_id", ""))
        if graph_id.startswith("__"):
            continue
        items.append(
            GraphListItem(
                graph_id=graph_id,
                name=g.get("name", ""),
                description=g.get("description", ""),
                agent_count=len(g.get("agents", [])),
                edge_count=len(g.get("edges", [])),
                created_at=g.get("created_at", ""),
                updated_at=g.get("updated_at", ""),
            )
        )
    return items


def get_graph(graph_id: str) -> GraphResponse | None:
    """Get a single graph by ID."""
    data = storage.get_graph(graph_id)
    if data is None:
        return None
    return GraphResponse(**_sanitize_graph_response(data))


def create_graph(req: GraphSaveRequest) -> GraphResponse:
    """Create a new graph."""
    graph_id = str(uuid.uuid4())[:8]
    data = req.model_dump()
    saved = storage.save_graph(graph_id, data)
    return GraphResponse(**_sanitize_graph_response(saved))


def update_graph(graph_id: str, req: GraphSaveRequest) -> GraphResponse | None:
    """Update an existing graph."""
    existing = storage.get_graph(graph_id)
    if existing is None:
        return None
    data = req.model_dump()
    saved = storage.save_graph(graph_id, data)
    return GraphResponse(**_sanitize_graph_response(saved))


def delete_graph(graph_id: str) -> bool:
    """Delete a graph."""
    return storage.delete_graph(graph_id)


def validate_graph(graph_id: str) -> GraphValidationResponse | None:
    """Validate a graph using the gMAS framework."""
    data = storage.get_graph(graph_id)
    if data is None:
        return None

    return _validate_graph_data(data)


def validate_graph_inline(req: GraphSaveRequest) -> GraphValidationResponse:
    """Validate graph data without saving."""
    return _validate_graph_data(req.model_dump())


def _validate_graph_data(data: dict[str, Any]) -> GraphValidationResponse:
    """Validate graph data and return execution order."""
    errors: list[str] = []
    warnings: list[str] = []
    execution_order: list[str] = []

    agents = data.get("agents", [])
    edges = data.get("edges", [])
    agent_ids = {a["agent_id"] for a in agents}

    if not agents:
        errors.append("Graph has no agents.")
        return GraphValidationResponse(is_valid=False, errors=errors)

    # Check for duplicate agent IDs
    seen_ids: set[str] = set()
    for a in agents:
        aid = a["agent_id"]
        if aid in seen_ids:
            errors.append(f"Duplicate agent ID: {aid}")
        seen_ids.add(aid)

    # Validate edges reference existing agents
    for e in edges:
        src = e.get("source", "")
        tgt = e.get("target", "")
        if src not in agent_ids:
            errors.append(f"Edge source '{src}' not found in agents.")
        if tgt not in agent_ids:
            errors.append(f"Edge target '{tgt}' not found in agents.")
        if src == tgt:
            warnings.append(f"Self-loop on agent '{src}'.")

    # Validate start/end nodes
    start_node = data.get("start_node")
    end_node = data.get("end_node")
    if start_node and start_node not in agent_ids:
        errors.append(f"Start node '{start_node}' not found in agents.")
    if end_node and end_node not in agent_ids:
        errors.append(f"End node '{end_node}' not found in agents.")

    # Build adjacency for topological sort
    if not errors:
        try:
            execution_order = _compute_execution_order(agents, edges, start_node)
            if len(execution_order) < len(agents):
                active_edges = [edge for edge in edges if edge_is_enabled(edge)]
                if any(edge.get("condition") == "loop" for edge in active_edges):
                    warnings.append(
                        "Graph contains an active loop; execution order preview is partial and runtime is bounded by max_loop_iterations."
                    )
                else:
                    errors.append("Graph contains an active cycle.")
        except Exception as exc:
            warnings.append(f"Could not compute execution order: {exc}")

    # Try gMAS framework validation if available
    try:
        from gmas.builder import GraphBuilder

        builder = GraphBuilder()
        for a in agents:
            llm_config_data = a.get("llm_config")
            builder.add_agent(
                agent_id=a["agent_id"],
                display_name=a.get("display_name", a["agent_id"]),
                persona=a.get("persona", ""),
                description=a.get("description", ""),
                llm_backbone=a.get("llm_backbone"),
                tools=a.get("tools"),
                input_schema=a.get("input_schema"),
                output_schema=a.get("output_schema"),
                base_url=llm_config_data.get("base_url") if isinstance(llm_config_data, dict) else None,
                api_key=llm_config_data.get("api_key") if isinstance(llm_config_data, dict) else None,
                max_tokens=llm_config_data.get("max_tokens") if isinstance(llm_config_data, dict) else None,
                temperature=llm_config_data.get("temperature") if isinstance(llm_config_data, dict) else None,
                timeout=llm_config_data.get("timeout") if isinstance(llm_config_data, dict) else None,
                top_p=llm_config_data.get("top_p") if isinstance(llm_config_data, dict) else None,
                stop_sequences=llm_config_data.get("stop_sequences") if isinstance(llm_config_data, dict) else None,
            )
        for e in edges:
            add_edge_to_builder(builder, e)
        if start_node:
            builder.set_start_node(start_node)
        if end_node:
            builder.set_end_node(end_node)

        graph = builder.build()
        framework_errors = graph.verify_integrity(raise_on_error=False)
        if framework_errors:
            for fe in framework_errors:
                if fe not in errors:
                    errors.append(fe)
    except ImportError:
        warnings.append("gMAS framework not available for deep validation.")
    except Exception as exc:
        warnings.append(f"Framework validation error: {exc}")

    return GraphValidationResponse(
        is_valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
        execution_order=execution_order,
    )


def _compute_execution_order(agents: list[dict], edges: list[dict], start_node: str | None) -> list[str]:
    """Simple topological sort using Kahn's algorithm."""
    agent_ids = [a["agent_id"] for a in agents]
    adj: dict[str, list[str]] = {aid: [] for aid in agent_ids}
    in_degree: dict[str, int] = dict.fromkeys(agent_ids, 0)

    for e in edges:
        if not edge_is_enabled(e):
            continue
        src = e.get("source", "")
        tgt = e.get("target", "")
        if src in adj and tgt in in_degree:
            adj[src].append(tgt)
            in_degree[tgt] += 1

    queue = [aid for aid in agent_ids if in_degree[aid] == 0]
    if start_node and start_node in queue:
        queue.remove(start_node)
        queue.insert(0, start_node)

    order: list[str] = []
    while queue:
        node = queue.pop(0)
        order.append(node)
        for neighbor in adj[node]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    return order


def _sanitize_graph_response(graph_data: dict[str, Any]) -> dict[str, Any]:
    """Hide sensitive fields in API responses while keeping storage intact."""
    out = dict(graph_data)
    agents = []
    for agent in out.get("agents", []) or []:
        a = dict(agent)
        llm_cfg = a.get("llm_config")
        if isinstance(llm_cfg, dict) and "api_key" in llm_cfg:
            a["llm_config"] = {**llm_cfg, "api_key": None}
        agents.append(a)
    out["agents"] = agents
    return out


def _extract_json_object(text: str) -> str:
    """Return the first balanced JSON object from an LLM response."""
    stripped = text.strip()
    if not stripped:
        return stripped

    # Fast path: already valid JSON, optionally inside a Markdown fence.
    if stripped.startswith("```"):
        stripped = stripped.removeprefix("```json").removeprefix("```").strip()
        if stripped.endswith("```"):
            stripped = stripped[:-3].strip()
    with contextlib.suppress(json.JSONDecodeError):
        json.loads(stripped)
        return stripped

    start = stripped.find("{")
    if start < 0:
        return stripped

    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(stripped)):
        char = stripped[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                candidate = stripped[start:index + 1]
                with contextlib.suppress(json.JSONDecodeError):
                    json.loads(candidate)
                    return candidate
                break

    return stripped


def build_gmas_graph(data: dict[str, Any]) -> Any:
    """Build a gMAS RoleGraph from graph save data. Returns RoleGraph or raises."""
    from gmas.builder import GraphBuilder

    agents = data.get("agents", [])
    edges = data.get("edges", [])

    builder = GraphBuilder()
    for a in agents:
        llm_config_data = a.get("llm_config")
        builder.add_agent(
            agent_id=a["agent_id"],
            display_name=a.get("display_name", a["agent_id"]),
            persona=a.get("persona", ""),
            description=a.get("description", ""),
            llm_backbone=a.get("llm_backbone"),
            tools=a.get("tools"),
            input_schema=a.get("input_schema"),
            output_schema=a.get("output_schema"),
            base_url=llm_config_data.get("base_url") if llm_config_data else None,
            api_key=llm_config_data.get("api_key") if llm_config_data else None,
            max_tokens=llm_config_data.get("max_tokens") if llm_config_data else None,
            temperature=llm_config_data.get("temperature") if llm_config_data else None,
            timeout=llm_config_data.get("timeout") if llm_config_data else None,
            top_p=llm_config_data.get("top_p") if llm_config_data else None,
            stop_sequences=llm_config_data.get("stop_sequences") if llm_config_data else None,
        )

    for e in edges:
        add_edge_to_builder(builder, e)

    start = data.get("start_node")
    end = data.get("end_node")
    if start:
        builder.set_start_node(start)
    if end:
        builder.set_end_node(end)

    task_query = data.get("task_query", "")
    if task_query:
        builder.add_task(query=task_query)

        task_targets = data.get("task_targets")
        if isinstance(task_targets, list) and task_targets:
            builder.connect_task_to_agents(agent_ids=task_targets, bidirectional=True)
        else:
            builder.connect_task_to_agents(bidirectional=True)

    return builder.build()


def auto_build_graph(
    *,
    name: str,
    description: str,
    task_query: str,
    agent_ids: list[str] | None = None,
    strategy: str = "embedding_knn",
    max_edges_per_agent: int = 2,
) -> GraphSaveRequest:
    """Auto-build a graph from stored agents."""
    all_agents = storage.list_agents()
    if agent_ids:
        allowed = set(agent_ids)
        selected_agents = [a for a in all_agents if a.get("agent_id") in allowed]
    else:
        selected_agents = all_agents

    if len(selected_agents) < 2:
        msg = "At least two agents are required for auto-build."
        raise ValueError(msg)

    safe_k = max(1, min(max_edges_per_agent, len(selected_agents) - 1))

    edges: list[dict[str, Any]] = []
    if strategy == "dense":
        for i, src in enumerate(selected_agents):
            for j, tgt in enumerate(selected_agents):
                if i != j:
                    edges.append({"source": src["agent_id"], "target": tgt["agent_id"], "weight": 1.0})
    elif strategy == "chain":
        for i in range(len(selected_agents) - 1):
            edges.append(
                {
                    "source": selected_agents[i]["agent_id"],
                    "target": selected_agents[i + 1]["agent_id"],
                    "weight": 1.0,
                }
            )
    else:
        edges = _build_embedding_knn_edges(selected_agents, safe_k)

    positions = {}
    for idx, agent in enumerate(selected_agents):
        positions[agent["agent_id"]] = {"x": 120 + (idx % 4) * 260, "y": 120 + (idx // 4) * 170}

    sanitized_agents = []
    for agent in selected_agents:
        a = dict(agent)
        llm_cfg = a.get("llm_config")
        if isinstance(llm_cfg, dict) and "api_key" in llm_cfg:
            a["llm_config"] = {**llm_cfg, "api_key": None}
        sanitized_agents.append(a)

    return GraphSaveRequest(
        name=name,
        description=description,
        agents=sanitized_agents,
        edges=edges,
        positions=positions,
        start_node=selected_agents[0]["agent_id"],
        end_node=selected_agents[-1]["agent_id"],
        task_targets=[a["agent_id"] for a in selected_agents],
        task_query=task_query,
    )


def _build_embedding_knn_edges(agents: list[dict[str, Any]], k: int) -> list[dict[str, Any]]:
    """Build KNN edges using gMAS NodeEncoder (hash fallback when transformers unavailable)."""
    try:
        import torch
        from gmas.core import NodeEncoder

        texts = [
            " ".join(
                [
                    str(a.get("display_name", "")),
                    str(a.get("persona", "")),
                    str(a.get("description", "")),
                    " ".join(a.get("tools", []) or []),
                ]
            ).strip()
            for a in agents
        ]
        enc = NodeEncoder(model_name="hash:384")
        emb = enc.encode(texts)

        if emb.ndim != 2 or emb.shape[0] != len(agents):
            raise ValueError("Invalid embedding matrix")

        sim = emb @ emb.T
        edges: list[dict[str, Any]] = []
        for i, src in enumerate(agents):
            row = sim[i].clone()
            row[i] = -1.0
            top_vals, top_idx = torch.topk(row, k=min(k, len(agents) - 1))
            for score, j in zip(top_vals.tolist(), top_idx.tolist(), strict=False):
                if score <= 0:
                    continue
                tgt = agents[j]
                edges.append(
                    {
                        "source": src["agent_id"],
                        "target": tgt["agent_id"],
                        "weight": float(max(min(score, 1.0), 0.1)),
                    }
                )
        if edges:
            return edges
    except Exception:
        pass

    fallback_edges: list[dict[str, Any]] = []
    for i in range(len(agents) - 1):
        fallback_edges.append({"source": agents[i]["agent_id"], "target": agents[i + 1]["agent_id"], "weight": 1.0})
    return fallback_edges


def _agent_text(agent: dict[str, Any]) -> str:
    return " ".join(
        str(agent.get(key, ""))
        for key in ("agent_id", "display_name", "persona", "description")
    ).lower()


def _agent_identity_text(agent: dict[str, Any]) -> str:
    return " ".join(str(agent.get(key, "")) for key in ("agent_id", "display_name")).lower()


def _find_agent_by_keywords(agents: list[dict[str, Any]], keywords: tuple[str, ...]) -> str | None:
    for agent in agents:
        text = _agent_identity_text(agent)
        if any(keyword in text for keyword in keywords):
            return str(agent["agent_id"])

    for agent in agents:
        text = _agent_text(agent)
        if any(keyword in text for keyword in keywords):
            return str(agent["agent_id"])
    return None


AI_BUILD_AGENTS_SYSTEM = """\
You are an expert multi-agent system designer for a visual workflow builder.
Design useful worker agents only. Routing is represented by graph edges, not by agents.

Hard rules:
- Do NOT create control-only agents such as Loop Controller, Router, Flow Controller,
  Condition Manager, Edge Manager, Branch Controller, or Cycle Controller.
- If the task needs a loop, create a real worker/reviewer pair instead
  (for example solver + verifier). The application will express the loop as an edge.
- If the task needs a branch, create a real deciding agent
  (for example verifier, ingredient_checker, quality_reviewer) that can output routing markers.
- Validator/reviewer/checker agents must mention exact routing markers in their description,
  for example: output exactly one of approved or needs_revision.
- Keep agents domain-specific and executable: each agent should produce, check, retrieve,
  transform, synthesize, or present useful work.
- Use 2-{max_agents} agents. Prefer the smallest team that still models the workflow.
- Only assign tools from the available list below.
{tools_section}

Good examples:
- Math: problem_analyzer, solver, verifier, final_answer. Verifier outputs approved or needs_revision.
- Recipe: dish_classifier, recipe_designer, ingredient_checker, substitution_expert, chef.
  Ingredient checker outputs all_on_hand or missing_items.
- Writing: researcher, drafter, reviewer, finalizer. Reviewer outputs approved or needs_revision.

Respond with ONLY a JSON object (no markdown, no chain-of-thought):
{{
  "agents": [
    {{
      "agent_id": "unique_snake_case_id",
      "persona": "role in 3-10 words",
      "description": "what this agent does; include routing markers when this agent decides a branch",
      "tools": ["tool_name"]
    }}
  ],
  "reasoning": "Short design summary, no hidden reasoning"
}}"""


AI_BUILD_TOPOLOGY_SYSTEM = """\
You are an expert workflow architect for multi-agent systems.
Design the executable DAG skeleton for the given agents.

Important:
- The underlying builder accepts a DAG skeleton. Do not add cycles here.
- Do NOT model loops/branches with control-only agents. Use the real domain agents.
- If a task asks for a review loop, connect the main worker to the reviewer and the
  reviewer toward the final/output agent. The application will add conditional loop-back
  edges such as reviewer -> worker with needs_revision.
- If a task asks for conditional routing, put the deciding agent before the alternative
  worker/final path. The application will add labels such as approved, needs_revision,
  all_on_hand, or missing_items.
- Prefer readable mixed topologies: chain for sequential work, fan-out/fan-in for
  independent analysis, and review gates before final output.
- Every agent must participate. Choose one start and one end node.

Examples:
- Math skeleton: problem_analyzer -> solver -> verifier -> final_answer.
  Runtime edges may add verifier -> solver needs_revision and verifier -> final_answer approved.
- Recipe skeleton: dish_classifier -> recipe_designer -> ingredient_checker -> chef,
  with substitution_expert after ingredient_checker when ingredients may be missing.
- Writing skeleton: researcher -> drafter -> reviewer -> finalizer.

Respond with ONLY a JSON object (no markdown, no chain-of-thought):
{
  "edges": [["source_agent_id", "target_agent_id"], ...],
  "start_node": "agent_id",
  "end_node": "agent_id",
  "reasoning": "Brief topology summary"
}"""


def _is_control_only_agent(agent: dict[str, Any]) -> bool:
    identity = _agent_identity_text(agent)
    text = _agent_text(agent)
    control_identity_terms = (
        "loop controller",
        "cycle controller",
        "flow controller",
        "route controller",
        "routing controller",
        "router",
        "condition controller",
        "condition manager",
        "edge manager",
        "branch controller",
        "topology controller",
        "workflow controller",
    )
    if any(term in identity for term in control_identity_terms):
        return True

    control_terms = ("route", "routing", "loop", "cycle", "branch", "condition")
    work_terms = (
        "solve",
        "solver",
        "analy",
        "research",
        "write",
        "draft",
        "review",
        "valid",
        "check",
        "verify",
        "final",
        "present",
        "recipe",
        "ingredient",
        "chef",
        "substitut",
        "search",
        "synth",
        "summar",
        "реш",
        "анализ",
        "провер",
        "валид",
        "сценар",
        "рецепт",
        "ингреди",
        "ответ",
    )
    return any(term in text for term in control_terms) and not any(term in text for term in work_terms)


def _dedupe_edges(edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str | None, str | None]] = set()
    for edge in edges:
        src = edge.get("source")
        tgt = edge.get("target")
        if not isinstance(src, str) or not isinstance(tgt, str) or src == tgt:
            continue
        key = (src, tgt, edge.get("condition"), edge.get("label"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(edge)
    return deduped


def _remove_control_agents(
    agents: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    control_ids = {str(agent["agent_id"]) for agent in agents if _is_control_only_agent(agent)}
    if not control_ids:
        return agents, edges

    kept_agents = [agent for agent in agents if agent["agent_id"] not in control_ids]
    rewritten_edges: list[dict[str, Any]] = [
        edge for edge in edges
        if edge.get("source") not in control_ids and edge.get("target") not in control_ids
    ]

    for control_id in control_ids:
        incoming = [edge for edge in edges if edge.get("target") == control_id and edge.get("source") not in control_ids]
        outgoing = [edge for edge in edges if edge.get("source") == control_id and edge.get("target") not in control_ids]
        for src_edge in incoming:
            for tgt_edge in outgoing:
                src = src_edge.get("source")
                tgt = tgt_edge.get("target")
                if not isinstance(src, str) or not isinstance(tgt, str) or src == tgt:
                    continue
                rewritten: dict[str, Any] = {
                    "source": src,
                    "target": tgt,
                    "weight": float(tgt_edge.get("weight") or src_edge.get("weight") or 1.0),
                }
                condition = tgt_edge.get("condition") or src_edge.get("condition")
                label = tgt_edge.get("label") or src_edge.get("label")
                if condition:
                    rewritten["condition"] = condition
                if label:
                    rewritten["label"] = label
                rewritten_edges.append(rewritten)

    return kept_agents, _dedupe_edges(rewritten_edges)


def _set_or_add_edge(
    edges: list[dict[str, Any]],
    seen_pairs: set[tuple[str, str]],
    source: str,
    target: str,
    *,
    condition: str | None = None,
    label: str | None = None,
    weight: float = 1.0,
) -> None:
    for edge in edges:
        if edge.get("source") == source and edge.get("target") == target:
            if condition:
                edge["condition"] = condition
            if label:
                edge["label"] = label
            edge["weight"] = float(edge.get("weight", weight) or weight)
            return
    edges.append({
        "source": source,
        "target": target,
        "weight": weight,
        **({"condition": condition} if condition else {}),
        **({"label": label} if label else {}),
    })
    seen_pairs.add((source, target))


def _apply_inventory_branch_hints(
    *,
    agents: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    seen_pairs: set[tuple[str, str]],
) -> bool:
    checker = _find_agent_by_keywords(
        agents,
        ("ingredient", "pantry", "inventory", "shopping", "ингреди", "продукт", "запас"),
    )
    substitute = _find_agent_by_keywords(
        agents,
        ("substitut", "alternative", "replacement", "замен", "альтернатив"),
    )
    chef = _find_agent_by_keywords(
        agents,
        ("chef", "cook", "cooking", "final", "present", "serve", "повар", "готов", "финал", "подач"),
    )
    if not checker or not chef or checker == chef:
        return False

    if substitute and substitute not in (checker, chef):
        _set_or_add_edge(
            edges,
            seen_pairs,
            checker,
            substitute,
            condition="conditional",
            label="missing_items",
        )
        _set_or_add_edge(edges, seen_pairs, substitute, chef)

    _set_or_add_edge(
        edges,
        seen_pairs,
        checker,
        chef,
        condition="conditional",
        label="all_on_hand",
    )
    return True


def _ensure_routing_marker_instructions(
    agents: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> None:
    labels_by_source: dict[str, list[str]] = {}
    for edge in edges:
        source = edge.get("source")
        label = edge.get("label")
        condition = edge.get("condition")
        if not isinstance(source, str) or not isinstance(label, str) or not label.strip():
            continue
        if condition not in ("conditional", "loop", "source_success", "source_failed"):
            continue
        labels_by_source.setdefault(source, [])
        if label not in labels_by_source[source]:
            labels_by_source[source].append(label)

    for agent in agents:
        agent_id = str(agent.get("agent_id", ""))
        labels = labels_by_source.get(agent_id)
        if not labels:
            continue
        marker_text = ", ".join(labels)
        instruction = f" Routing: end with exactly one marker from [{marker_text}] when choosing the next branch."
        current_desc = str(agent.get("description") or agent.get("persona") or "")
        if "Routing:" not in current_desc and "routing marker" not in current_desc.lower():
            agent["description"] = (current_desc.rstrip() + instruction).strip()


def _sanitize_ai_agent_tools(task_query: str, agents: list[dict[str, Any]]) -> None:
    """Keep AI-built demo graphs from entering fragile tool loops by default."""
    lowered = task_query.lower()
    allow_code_tools = any(
        keyword in lowered
        for keyword in (
            "python",
            "code",
            "код",
            "скрипт",
            "запусти",
            "execute",
            "run code",
            "program",
            "программ",
        )
    )
    blocked = {"shell", "mcp", "vector_search", "computer_use"}
    if not allow_code_tools:
        blocked.add("code_interpreter")

    for agent in agents:
        tools = agent.get("tools")
        if not isinstance(tools, list):
            continue
        agent["tools"] = [tool for tool in tools if tool not in blocked]


def _apply_review_loop_hints(
    *,
    task_query: str,
    agents: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    seen_pairs: set[tuple[str, str]],
) -> None:
    """Turn natural-language review/approval hints into explicit demo edges."""
    lowered = task_query.lower()
    wants_review_loop = any(
        keyword in lowered
        for keyword in (
            "approved",
            "approve",
            "not approved",
            "needs revision",
            "revise",
            "rewrite",
            "condition",
            "conditional",
            "branch",
            "loop",
            "cycle",
            "услов",
            "ветк",
            "доработ",
            "перепис",
            "верн",
            "если плохо",
            "если хорошо",
            "одобр",
            "провер",
            "цикл",
        )
    )
    if not wants_review_loop or len(agents) < 2:
        return

    writer = _find_agent_by_keywords(
        agents,
        (
            "writer",
            "script",
            "author",
            "draft",
            "solver",
            "solve",
            "worker",
            "producer",
            "executor",
            "сценар",
            "автор",
            "реш",
            "математ",
            "исполн",
        ),
    )
    reviewer = _find_agent_by_keywords(
        agents,
        (
            "validator",
            "validate",
            "verifier",
            "review",
            "reviewer",
            "editor",
            "critic",
            "check",
            "checker",
            "controller",
            "quality",
            "peer",
            "редактор",
            "валид",
            "провер",
            "контрол",
            "критик",
            "качест",
        ),
    )
    finalizer = _find_agent_by_keywords(
        agents,
        (
            "final",
            "finalizer",
            "presenter",
            "presentation",
            "result",
            "answer",
            "publish",
            "seo",
            "optimizer",
            "финал",
            "публик",
            "презент",
            "результ",
            "ответ",
        ),
    )
    if not writer or not reviewer or writer == reviewer:
        return

    if _apply_inventory_branch_hints(agents=agents, edges=edges, seen_pairs=seen_pairs):
        return

    if finalizer and finalizer != reviewer:
        _set_or_add_edge(
            edges,
            seen_pairs,
            reviewer,
            finalizer,
            condition="conditional",
            label="approved",
        )

    if (reviewer, writer) not in seen_pairs:
        edges.append({
            "source": reviewer,
            "target": writer,
            "weight": 1.0,
            "condition": "loop",
            "label": "needs_revision",
        })
        seen_pairs.add((reviewer, writer))


async def ai_build_graph(
    *,
    task_query: str,
    name: str = "AI-Built Workflow",
    description: str = "",
    max_agents: int = 6,
    enabled_tools: list[str] | None = None,
) -> GraphSaveRequest:
    """LLM-powered full graph assembly via gmas.builder.AutoGraphBuilder.

    Asks the configured default LLM provider to design both the agents and the
    topology from scratch given the user's task description.
    """
    from backend.routers import config as config_router
    from backend.services import execution_service

    providers = config_router.get_llm_providers_internal()
    if not providers:
        raise ValueError(
            "No LLM provider configured. Add one in Settings → LLM Providers before using AI Build."
        )
    # Prefer providers with an API key set; fall back to first if none qualifies.
    provider = next((p for p in providers if p.api_key), providers[0])

    # Reuse execution_service's caller construction so we hit the same provider
    # routing logic that production runs use.
    async_caller = execution_service._build_async_text_caller(provider, None)
    structured_caller = execution_service._build_async_structured_caller(provider, None)

    # AutoGraphBuilder expects a callable that takes prompt|messages and returns a string.
    async def _caller(prompt: Any) -> str:
        try:
            if structured_caller is not None:
                return _extract_json_object(await structured_caller(prompt))
        except Exception:
            pass
        # Fall back to the text caller; it accepts either str or list[dict]
        return _extract_json_object(await async_caller(prompt))

    try:
        from gmas.builder import AutoBuilderConfig, AutoGraphBuilder
    except Exception as exc:
        raise ValueError(f"gmas.builder not importable: {exc}") from exc

    cfg = AutoBuilderConfig(
        max_agents=max(2, min(max_agents, 12)),
        available_tools=list(enabled_tools) if enabled_tools else None,
    )
    builder = AutoGraphBuilder(async_llm_caller=_caller, config=cfg)
    agents_resp = await builder._generate_agents_async(  # noqa: SLF001
        task_query,
        system_prompt=AI_BUILD_AGENTS_SYSTEM,
    )
    agents = builder._specs_to_profiles(agents_resp.agents)  # noqa: SLF001
    try:
        topology = await builder._generate_topology_async(  # noqa: SLF001
            agents,
            task_query,
            system_prompt=AI_BUILD_TOPOLOGY_SYSTEM,
        )
    except ValueError as exc:
        agent_ids = [agent.agent_id for agent in agents]
        logger.warning("AI Build topology generation failed, using chain fallback: %s", exc)
        topology = SimpleNamespace(
            edges=[[agent_ids[i], agent_ids[i + 1]] for i in range(len(agent_ids) - 1)],
            start_node=agent_ids[0] if agent_ids else None,
            end_node=agent_ids[-1] if agent_ids else None,
            reasoning=f"Fallback chain topology because LLM returned invalid topology JSON: {exc}",
        )
    role_graph = builder._build_graph(agents, topology, task_query, None)  # noqa: SLF001

    # Convert RoleGraph → GraphSaveRequest for storage / UI.
    # AutoGraphBuilder injects a synthetic "__task__" node that represents the
    # task source. On the canvas we already render that as the __start__ node,
    # so we strip it from the agent list and rewrite its edges to come from
    # __start__ instead.
    SYNTHETIC_TASK_ID = "__task__"

    agents_out: list[dict[str, Any]] = []
    positions: dict[str, dict[str, float]] = {}
    real_agent_ids: list[str] = []
    for idx, profile in enumerate(role_graph.agents):
        agent_id = getattr(profile, "agent_id", None) or getattr(profile, "name", f"a{idx}")
        if agent_id == SYNTHETIC_TASK_ID:
            continue
        real_agent_ids.append(agent_id)
        agents_out.append({
            "agent_id": agent_id,
            "display_name": getattr(profile, "display_name", None) or agent_id,
            "persona": getattr(profile, "persona", "") or "",
            "description": getattr(profile, "description", "") or "",
            "tools": list(getattr(profile, "tools", []) or []),
        })

    cond_names = getattr(role_graph, "edge_condition_names", None) or {}

    edges_out: list[dict[str, Any]] = []
    seen_pairs: set[tuple[str, str]] = set()
    for edge in role_graph.edges:
        src = edge.get("source")
        tgt = edge.get("target")
        if not src or not tgt or src == tgt:
            continue
        # Drop edges involving the synthetic task node — the UI's __start__
        # node owns that role and we'll create those edges separately.
        if src == SYNTHETIC_TASK_ID or tgt == SYNTHETIC_TASK_ID:
            continue
        if (src, tgt) in seen_pairs:
            continue
        seen_pairs.add((src, tgt))
        weight = edge.get("weight")
        out_edge: dict[str, Any] = {
            "source": src,
            "target": tgt,
            "weight": float(weight) if isinstance(weight, (int, float)) else 1.0,
        }
        cond = cond_names.get((src, tgt)) if isinstance(cond_names, dict) else None
        if cond:
            out_edge["condition"] = cond
        edges_out.append(out_edge)

    _apply_review_loop_hints(
        task_query=task_query,
        agents=agents_out,
        edges=edges_out,
        seen_pairs=seen_pairs,
    )
    agents_out, edges_out = _remove_control_agents(agents_out, edges_out)
    real_agent_ids = [agent["agent_id"] for agent in agents_out]

    seen_pairs = {
        (edge["source"], edge["target"])
        for edge in edges_out
        if isinstance(edge.get("source"), str) and isinstance(edge.get("target"), str)
    }
    _apply_inventory_branch_hints(
        agents=agents_out,
        edges=edges_out,
        seen_pairs=seen_pairs,
    )
    _apply_review_loop_hints(
        task_query=task_query,
        agents=agents_out,
        edges=edges_out,
        seen_pairs=seen_pairs,
    )
    edges_out = _dedupe_edges(edges_out)
    _ensure_routing_marker_instructions(agents_out, edges_out)
    _sanitize_ai_agent_tools(task_query, agents_out)

    # Lay agents out in columns by topological depth so the canvas looks like a
    # pipeline rather than a row. Depth ignores explicit loop-back edges so a
    # review cycle doesn't collapse all agents into the same layer.
    incoming: dict[str, set[str]] = {a: set() for a in real_agent_ids}
    outgoing: dict[str, set[str]] = {a: set() for a in real_agent_ids}
    for edge in edges_out:
        src = edge.get("source")
        tgt = edge.get("target")
        if edge.get("condition") == "loop":
            continue
        if src in outgoing and isinstance(tgt, str):
            outgoing[src].add(tgt)
        if tgt in incoming and isinstance(src, str):
            incoming[tgt].add(src)

    # Layered layout: longest-path layering (cycle-safe).
    depth: dict[str, int] = {}
    def _depth(aid: str, visiting: set[str] | None = None) -> int:
        if aid in depth:
            return depth[aid]
        if visiting is None:
            visiting = set()
        if aid in visiting:
            return 0
        visiting.add(aid)
        preds = incoming.get(aid, set())
        d = 0 if not preds else 1 + max(_depth(p, visiting) for p in preds)
        visiting.discard(aid)
        depth[aid] = d
        return d

    for aid in real_agent_ids:
        _depth(aid)

    layers: dict[int, list[str]] = {}
    for aid in real_agent_ids:
        layers.setdefault(depth.get(aid, 0), []).append(aid)

    COL_W = 290.0
    ROW_H = 170.0
    X0 = 320.0  # leave room for __start__ (which lives at x ~ 40)
    Y_CENTER = 360.0
    max_layer = max(layers.keys()) if layers else 0
    for layer_idx in sorted(layers.keys()):
        col = layers[layer_idx]
        layer_x = X0 + layer_idx * COL_W
        # Centre the column vertically
        start_y = Y_CENTER - ((len(col) - 1) * ROW_H) / 2
        for row_idx, aid in enumerate(col):
            positions[aid] = {"x": layer_x, "y": start_y + row_idx * ROW_H}

    # Anchor __start__ left of the first column and __end__ right of the last.
    positions["__start__"] = {"x": X0 - COL_W, "y": Y_CENTER}
    positions["__end__"] = {"x": X0 + (max_layer + 1) * COL_W, "y": Y_CENTER}

    start_agents = [a for a in real_agent_ids if not incoming.get(a)] or real_agent_ids[:1]
    end_agents = [a for a in real_agent_ids if not outgoing.get(a)] or real_agent_ids[-1:]

    return GraphSaveRequest(
        name=name,
        description=description or f"AI-built workflow for: {task_query[:80]}",
        agents=agents_out,
        edges=edges_out,
        positions=positions,
        start_node=start_agents[0] if start_agents else None,
        end_node=end_agents[-1] if end_agents else None,
        task_targets=start_agents,
        task_query=task_query,
    )
