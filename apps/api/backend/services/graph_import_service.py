"""Import external workflow formats into gMAS graphs."""

import json
import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Literal

from backend.models.agent import AgentCreateRequest, AgentLLMConfigSchema
from backend.models.graph import EdgeDefinition, GraphSaveRequest, Position


INPUT_NODE_TYPES = {"ChatInput", "TextInput", "Input", "FileInput"}
OUTPUT_NODE_TYPES = {"ChatOutput", "Output", "FileOutput"}
PROMPT_NODE_TYPES = {"Prompt"}
IGNORED_NODE_TYPES = {"note"}
SUPPORTED_TOOL_MAP = {
    "tavilysearchcomponent": "web_search",
    "searchcomponent": "web_search",
    "serpapisearchcomponent": "web_search",
    "duckduckgosearchcomponent": "web_search",
    "bravesearchcomponent": "web_search",
    "calculatorcomponent": "code_interpreter",
    "pythonreplcomponent": "code_interpreter",
    "pythoncomponent": "code_interpreter",
    "pythoncodecomponent": "code_interpreter",
    "shellcomponent": "shell",
    "bashcomponent": "shell",
}
GRAPH_IMPORT_SOURCE = Literal["langflow", "langgraph_mermaid", "mermaid"]
GRAPH_IMPORT_MODE = Literal["agent_graph", "component_graph", "mermaid_graph"]
MERMAID_START_IDS = {"start", "__start__", "START", "START_NODE"}
MERMAID_END_IDS = {"end", "__end__", "END", "END_NODE"}

# Defensive limits for the unauthenticated import endpoint.
_MAX_MERMAID_CHARS = 200_000
_MAX_MERMAID_LINES = 5_000


@dataclass(slots=True)
class LangflowNode:
    node_id: str
    node_type: str
    display_name: str
    description: str
    template: dict[str, Any]
    position: Position


@dataclass(slots=True)
class LangflowEdge:
    source: str
    target: str
    source_name: str | None
    source_data_type: str | None
    target_field: str | None
    target_type: str | None


def import_graph(
    *,
    source: GRAPH_IMPORT_SOURCE,
    payload: Any,
    name_override: str | None = None,
) -> tuple[GraphSaveRequest, list[str], GRAPH_IMPORT_MODE]:
    if source == "langflow":
        return import_langflow_graph(payload, name_override=name_override)
    if source in {"langgraph_mermaid", "mermaid"}:
        return import_mermaid_graph(payload, name_override=name_override)
    msg = f"Unsupported graph import source: {source}"
    raise ValueError(msg)


def import_langflow_graph(
    payload: Any,
    *,
    name_override: str | None = None,
) -> tuple[GraphSaveRequest, list[str], Literal["agent_graph", "component_graph"]]:
    document = _coerce_json(payload)
    flow, meta = _unwrap_langflow_document(document)
    nodes = _parse_nodes(flow.get("nodes", []))
    edges = _parse_edges(flow.get("edges", []))
    if not nodes:
        raise ValueError("LangFlow import payload contains no nodes.")

    warnings: list[str] = [
        "LangFlow import preserves graph structure and node intent, but not exact component runtime semantics.",
    ]
    outgoing_by_source: dict[str, list[LangflowEdge]] = defaultdict(list)
    incoming_by_target: dict[str, list[LangflowEdge]] = defaultdict(list)
    for edge in edges:
        outgoing_by_source[edge.source].append(edge)
        incoming_by_target[edge.target].append(edge)

    tool_only_nodes = {
        node_id
        for node_id, node in nodes.items()
        if _is_tool_only_node(node, outgoing_by_source.get(node_id, []), incoming_by_target.get(node_id, []))
    }
    agent_like_ids = [node_id for node_id, node in nodes.items() if _is_agent_like_node(node)]
    import_mode: Literal["agent_graph", "component_graph"] = "agent_graph" if agent_like_ids else "component_graph"

    executable_ids: list[str] = []
    prompt_ids: set[str] = set()
    input_ids: set[str] = set()
    output_ids: set[str] = set()
    for node_id, node in nodes.items():
        if node.node_type in INPUT_NODE_TYPES:
            input_ids.add(node_id)
            continue
        if node.node_type in OUTPUT_NODE_TYPES:
            output_ids.add(node_id)
            continue
        if node.node_type in PROMPT_NODE_TYPES:
            prompt_ids.add(node_id)
            continue
        if node.node_type in IGNORED_NODE_TYPES:
            continue
        if node_id in tool_only_nodes:
            continue
        if import_mode == "agent_graph" and node_id in agent_like_ids:
            executable_ids.append(node_id)
            continue
        if import_mode == "agent_graph" and _looks_like_intermediate_runtime_node(node):
            executable_ids.append(node_id)
            continue
        if import_mode == "component_graph":
            executable_ids.append(node_id)

    executable_order = {node_id: index for index, node_id in enumerate(executable_ids)}
    if not executable_ids:
        raise ValueError("No runnable LangFlow nodes could be converted into gMAS agents.")
    normalized_positions = _normalize_positions({
        node_id: nodes[node_id].position for node_id in executable_ids
    })

    attached_tools: dict[str, set[str]] = defaultdict(set)
    direct_edges: set[tuple[str, str]] = set()
    prompt_targets: dict[str, set[str]] = defaultdict(set)
    prompt_sources_exec: dict[str, set[str]] = defaultdict(set)
    prompt_sources_input: dict[str, bool] = defaultdict(bool)
    start_candidates: set[str] = set()
    end_candidates: set[str] = set()

    for edge in edges:
        source_exec = edge.source in executable_order
        target_exec = edge.target in executable_order
        target_field = (edge.target_field or "").strip()

        if edge.source in tool_only_nodes and target_exec and target_field == "tools":
            tool_name = _map_langflow_tool(nodes[edge.source])
            if tool_name:
                attached_tools[edge.target].add(tool_name)
            else:
                warnings.append(
                    f"Unsupported LangFlow tool '{nodes[edge.source].display_name}' on '{nodes[edge.target].display_name}' was skipped.",
                )
            continue

        if edge.source in input_ids and target_exec:
            start_candidates.add(edge.target)
            continue

        if source_exec and edge.target in output_ids:
            end_candidates.add(edge.source)
            continue

        if edge.source in prompt_ids and target_exec:
            prompt_targets[edge.source].add(edge.target)
            continue

        if source_exec and edge.target in prompt_ids:
            prompt_sources_exec[edge.target].add(edge.source)
            continue

        if edge.source in input_ids and edge.target in prompt_ids:
            prompt_sources_input[edge.target] = True
            continue

        if source_exec and target_exec and edge.source != edge.target:
            direct_edges.add((edge.source, edge.target))

    for prompt_id, targets in prompt_targets.items():
        for target in targets:
            if prompt_sources_input.get(prompt_id):
                start_candidates.add(target)
            for source in prompt_sources_exec.get(prompt_id, set()):
                if source != target:
                    direct_edges.add((source, target))

    if not start_candidates:
        for node_id in executable_ids:
            if not any(edge.source in executable_order for edge in incoming_by_target.get(node_id, [])):
                start_candidates.add(node_id)
    if not end_candidates:
        for node_id in executable_ids:
            if not any(edge.target in executable_order for edge in outgoing_by_source.get(node_id, [])):
                end_candidates.add(node_id)

    imported_agents: list[AgentCreateRequest] = []
    positions: dict[str, Position] = {}
    for node_id in executable_ids:
        node = nodes[node_id]
        prompt_contexts = [
            _prompt_text(nodes[source_prompt])
            for source_prompt, targets in prompt_targets.items()
            if node_id in targets
        ]
        persona = _join_texts([
            _template_value(node.template, "system_prompt"),
            _template_value(node.template, "instructions"),
            _template_value(node.template, "agent_description"),
            *prompt_contexts,
        ])
        description = _join_texts([
            node.description,
            f"Imported from LangFlow component type: {node.node_type}.",
        ])
        llm_cfg = _build_llm_config(node.template)
        agent = AgentCreateRequest(
            agent_id=node_id,
            display_name=_display_name(node),
            persona=persona,
            description=description,
            llm_backbone=_template_value(node.template, "model") or _template_value(node.template, "model_name"),
            llm_config=llm_cfg,
            tools=sorted(attached_tools.get(node_id, set())),
        )
        imported_agents.append(agent)
        positions[node_id] = normalized_positions[node_id]

    edge_models = [
        EdgeDefinition(source=source, target=target, weight=1.0)
        for source, target in sorted(
            direct_edges,
            key=lambda pair: (
                executable_order.get(pair[0], 10_000),
                executable_order.get(pair[1], 10_000),
                pair[0],
                pair[1],
            ),
        )
    ]
    if not edge_models and len(imported_agents) > 1:
        for source, target in zip(imported_agents, imported_agents[1:], strict=False):
            edge_models.append(EdgeDefinition(source=source.agent_id, target=target.agent_id, weight=1.0))
        warnings.append("No explicit runnable edges were found, so the imported nodes were chained in canvas order.")

    task_query = _first_non_empty(
        _template_value(nodes[node_id].template, "input_value")
        for node_id in nodes
        if node_id in input_ids
    ) or ""
    ordered_starts = _ordered_ids(start_candidates, executable_order)
    ordered_ends = _ordered_ids(end_candidates, executable_order)
    if len(ordered_starts) > 1:
        warnings.append("Multiple start candidates were found; the first one was set as start_node.")
    if len(ordered_ends) > 1:
        warnings.append("Multiple end candidates were found; the first one was set as end_node.")

    graph = GraphSaveRequest(
        name=(name_override or meta.get("name") or "Imported LangFlow Graph").strip(),
        description=_join_texts([
            str(meta.get("description") or "").strip(),
            "Imported from LangFlow.",
        ]),
        agents=imported_agents,
        edges=edge_models,
        positions=positions,
        start_node=ordered_starts[0] if ordered_starts else None,
        end_node=ordered_ends[0] if ordered_ends else None,
        task_targets=ordered_starts,
        task_query=task_query,
    )
    return graph, _dedupe(warnings), import_mode


def import_mermaid_graph(
    payload: Any,
    *,
    name_override: str | None = None,
) -> tuple[GraphSaveRequest, list[str], Literal["mermaid_graph"]]:
    text = _coerce_mermaid_text(payload)
    nodes, edges = _parse_mermaid_graph(text)
    if not nodes:
        raise ValueError("Mermaid import payload contains no runnable nodes.")

    executable_ids = [node_id for node_id in nodes if not _is_mermaid_boundary(node_id, nodes[node_id])]
    if not executable_ids:
        raise ValueError("Mermaid import payload contains only START/END nodes.")

    executable_set = set(executable_ids)
    direct_edges: list[tuple[str, str, str | None]] = []
    start_candidates: set[str] = set()
    end_candidates: set[str] = set()
    for source, target, label in edges:
        source_boundary = _is_mermaid_boundary(source, nodes.get(source, source))
        target_boundary = _is_mermaid_boundary(target, nodes.get(target, target))
        if source_boundary and target in executable_set:
            start_candidates.add(target)
            continue
        if source in executable_set and target_boundary:
            end_candidates.add(source)
            continue
        if source in executable_set and target in executable_set and source != target:
            direct_edges.append((source, target, label))

    if not start_candidates:
        inbound = {target for _, target, _ in direct_edges}
        start_candidates = {node_id for node_id in executable_ids if node_id not in inbound}
    if not end_candidates:
        outbound = {source for source, _, _ in direct_edges}
        end_candidates = {node_id for node_id in executable_ids if node_id not in outbound}

    positions = _layout_mermaid_positions(executable_ids, direct_edges)
    agents = [
        AgentCreateRequest(
            agent_id=node_id,
            display_name=nodes[node_id],
            persona=f"Execute the '{nodes[node_id]}' step imported from a Mermaid/LangGraph topology.",
            description="Imported from Mermaid/LangGraph graph topology.",
        )
        for node_id in executable_ids
    ]
    edge_models = [
        EdgeDefinition(source=source, target=target, weight=1.0, label=label)
        for source, target, label in direct_edges
    ]

    ordered_starts = _ordered_ids(start_candidates, {node_id: idx for idx, node_id in enumerate(executable_ids)})
    ordered_ends = _ordered_ids(end_candidates, {node_id: idx for idx, node_id in enumerate(executable_ids)})
    warnings = [
        "Mermaid/LangGraph import preserves topology, but does not import Python node callables or runtime state.",
    ]
    graph = GraphSaveRequest(
        name=name_override or "Imported Mermaid Graph",
        description="Imported from Mermaid/LangGraph topology.",
        agents=agents,
        edges=edge_models,
        positions=positions,
        start_node=ordered_starts[0] if ordered_starts else None,
        end_node=ordered_ends[0] if ordered_ends else None,
        task_targets=ordered_starts,
    )
    return graph, warnings, "mermaid_graph"


def _coerce_json(payload: Any) -> Any:
    if isinstance(payload, str):
        text = payload.strip()
        if not text:
            raise ValueError("Import payload is empty.")
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Import payload is not valid JSON: {exc.msg}") from exc
    return payload


def _coerce_mermaid_text(payload: Any) -> str:
    if isinstance(payload, str):
        text = payload.strip()
    elif isinstance(payload, dict):
        raw = payload.get("mermaid") or payload.get("text") or payload.get("graph") or payload.get("payload")
        text = str(raw or "").strip()
    else:
        text = ""
    if not text:
        raise ValueError("Mermaid import payload is empty.")
    # Bound input so a hostile payload can't exhaust CPU/memory in the
    # per-line regex parser and O(n^2) layout pass (no auth on this endpoint).
    if len(text) > _MAX_MERMAID_CHARS:
        raise ValueError("Mermaid import payload is too large.")
    if text.count("\n") + 1 > _MAX_MERMAID_LINES:
        raise ValueError("Mermaid import payload has too many lines.")
    return text


def _parse_mermaid_graph(text: str) -> tuple[dict[str, str], list[tuple[str, str, str | None]]]:
    nodes: dict[str, str] = {}
    edges: list[tuple[str, str, str | None]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("%%"):
            continue
        if line.endswith(";"):
            line = line[:-1].strip()
        if re.match(r"^(graph|flowchart)\s+", line, flags=re.IGNORECASE):
            continue
        if re.match(r"^(classDef|class|style|linkStyle|subgraph|end)\b", line, flags=re.IGNORECASE):
            continue
        parsed = _parse_mermaid_edge(line)
        if parsed is None:
            node_id, label = _parse_mermaid_endpoint(line)
            if node_id:
                nodes.setdefault(node_id, label)
            continue
        source_id, source_label, target_id, target_label, edge_label = parsed
        nodes.setdefault(source_id, source_label)
        nodes.setdefault(target_id, target_label)
        edges.append((source_id, target_id, edge_label))
    return nodes, edges


def _parse_mermaid_edge(line: str) -> tuple[str, str, str, str, str | None] | None:
    patterns = [
        r"^(?P<src>.+?)\s*-->\|(?P<label>.*?)\|\s*(?P<tgt>.+)$",
        r"^(?P<src>.+?)\s*--\s*(?P<label>.*?)\s*-->\s*(?P<tgt>.+)$",
        r"^(?P<src>.+?)\s*==>\|(?P<label>.*?)\|\s*(?P<tgt>.+)$",
        r"^(?P<src>.+?)\s*==>\s*(?P<tgt>.+)$",
        r"^(?P<src>.+?)\s*-\.->\|(?P<label>.*?)\|\s*(?P<tgt>.+)$",
        r"^(?P<src>.+?)\s*-\.->\s*(?P<tgt>.+)$",
        r"^(?P<src>.+?)\s*-->\s*(?P<tgt>.+)$",
        r"^(?P<src>.+?)\s*---\s*(?P<tgt>.+)$",
    ]
    for pattern in patterns:
        match = re.match(pattern, line)
        if not match:
            continue
        source_id, source_label = _parse_mermaid_endpoint(match.group("src"))
        target_id, target_label = _parse_mermaid_endpoint(match.group("tgt"))
        if not source_id or not target_id:
            return None
        label = match.groupdict().get("label")
        return source_id, source_label, target_id, target_label, label.strip() if label else None
    return None


def _parse_mermaid_endpoint(raw: str) -> tuple[str, str]:
    value = raw.strip().strip(";")
    value = re.sub(r":::[A-Za-z0-9_-]+$", "", value).strip()
    match = re.match(r"^(?P<id>[A-Za-z0-9_.:-]+)\s*(?P<label>.*)$", value)
    if not match:
        return "", ""
    node_id = _sanitize_mermaid_node_id(match.group("id"))
    label_raw = match.group("label").strip()
    label = _extract_mermaid_label(label_raw) or _humanize_identifier(node_id)
    return node_id, label


def _extract_mermaid_label(raw: str) -> str | None:
    if not raw:
        return None
    stripped = raw.strip()
    bracket_match = re.search(r"[\[{(]+[\"']?(?P<label>.*?)[\"']?[\]})]+$", stripped)
    if bracket_match:
        return _clean_mermaid_label(bracket_match.group("label"))
    quoted = re.match(r"^[\"'](?P<label>.*?)[\"']$", stripped)
    if quoted:
        return _clean_mermaid_label(quoted.group("label"))
    return None


def _clean_mermaid_label(label: str) -> str:
    cleaned = re.sub(r"<br\s*/?>", " ", label, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip() or label.strip()


def _sanitize_mermaid_node_id(node_id: str) -> str:
    sanitized = re.sub(r"[^A-Za-z0-9_.:-]+", "_", node_id.strip())
    return sanitized.strip("_") or "node"


def _humanize_identifier(node_id: str) -> str:
    cleaned = re.sub(r"[_:-]+", " ", node_id).strip()
    return cleaned.title() if cleaned else node_id


def _is_mermaid_boundary(node_id: str, label: str) -> bool:
    normalized_id = node_id.strip()
    normalized_label = label.strip().upper()
    return normalized_id in MERMAID_START_IDS or normalized_id in MERMAID_END_IDS or normalized_label in {"START", "END", "__START__", "__END__"}


def _layout_mermaid_positions(
    node_ids: list[str],
    edges: list[tuple[str, str, str | None]],
) -> dict[str, Position]:
    order = {node_id: index for index, node_id in enumerate(node_ids)}
    depth = dict.fromkeys(node_ids, 0)
    for _ in range(len(node_ids)):
        changed = False
        for source, target, _ in edges:
            if source not in depth or target not in depth:
                continue
            next_depth = min(depth[source] + 1, len(node_ids) - 1)
            if next_depth > depth[target]:
                depth[target] = next_depth
                changed = True
        if not changed:
            break
    lanes: dict[int, list[str]] = defaultdict(list)
    for node_id in sorted(node_ids, key=lambda nid: (depth.get(nid, 0), order[nid])):
        lanes[depth.get(node_id, 0)].append(node_id)
    positions: dict[str, Position] = {}
    for lane, lane_nodes in lanes.items():
        for row, node_id in enumerate(lane_nodes):
            positions[node_id] = Position(x=280 + lane * 300, y=180 + row * 170)
    return positions


def _unwrap_langflow_document(document: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    if isinstance(document, list):
        if len(document) != 1 or not isinstance(document[0], dict):
            raise ValueError("LangFlow import expects a single exported flow JSON document.")
        document = document[0]
    if not isinstance(document, dict):
        raise ValueError("LangFlow import payload must be a JSON object.")
    if isinstance(document.get("data"), dict) and "nodes" in document["data"] and "edges" in document["data"]:
        return document["data"], document
    if "nodes" in document and "edges" in document:
        return document, document
    raise ValueError("Unsupported LangFlow JSON format: expected data.nodes and data.edges.")


def _parse_nodes(raw_nodes: list[dict[str, Any]]) -> dict[str, LangflowNode]:
    parsed: dict[str, LangflowNode] = {}
    for raw in raw_nodes:
        node_id = str(raw.get("id") or "").strip()
        if not node_id:
            continue
        data = raw.get("data") or {}
        node_meta = data.get("node") or {}
        node_type = str(data.get("type") or node_meta.get("display_name") or "Component").strip()
        display_name = str(node_meta.get("display_name") or data.get("display_name") or node_type or node_id).strip()
        description = str(node_meta.get("description") or data.get("description") or "").strip()
        template = node_meta.get("template") if isinstance(node_meta.get("template"), dict) else {}
        position = raw.get("position") or {}
        parsed[node_id] = LangflowNode(
            node_id=node_id,
            node_type=node_type,
            display_name=display_name or node_id,
            description=description,
            template=template,
            position=Position(
                x=float(position.get("x", 0.0) or 0.0),
                y=float(position.get("y", 0.0) or 0.0),
            ),
        )
    return parsed


def _parse_edges(raw_edges: list[dict[str, Any]]) -> list[LangflowEdge]:
    parsed: list[LangflowEdge] = []
    for raw in raw_edges:
        source = str(raw.get("source") or "").strip()
        target = str(raw.get("target") or "").strip()
        if not source or not target:
            continue
        edge_data = raw.get("data") or {}
        source_handle = edge_data.get("sourceHandle") or {}
        target_handle = edge_data.get("targetHandle") or {}
        parsed.append(
            LangflowEdge(
                source=source,
                target=target,
                source_name=_as_string(source_handle.get("name")),
                source_data_type=_as_string(source_handle.get("dataType")),
                target_field=_as_string(target_handle.get("fieldName")),
                target_type=_as_string(target_handle.get("type")),
            ),
        )
    return parsed


def _is_tool_only_node(node: LangflowNode, outgoing: list[LangflowEdge], incoming: list[LangflowEdge]) -> bool:
    if not outgoing:
        return False
    outputs_tool = any((edge.target_field or "") == "tools" for edge in outgoing)
    if not outputs_tool:
        return False
    return all((edge.target_field or "") == "tools" for edge in outgoing) and not incoming


def _is_agent_like_node(node: LangflowNode) -> bool:
    node_type = node.node_type.lower()
    return node_type == "agent" or node_type.endswith("agentcomponent")


def _looks_like_intermediate_runtime_node(node: LangflowNode) -> bool:
    node_type = node.node_type.lower()
    if node_type in {name.lower() for name in INPUT_NODE_TYPES | OUTPUT_NODE_TYPES | PROMPT_NODE_TYPES | IGNORED_NODE_TYPES}:
        return False
    return any(token in node_type for token in ("parser", "structured", "model", "chain", "retriever", "memory"))


def _map_langflow_tool(node: LangflowNode) -> str | None:
    return SUPPORTED_TOOL_MAP.get(node.node_type.lower())


def _build_llm_config(template: dict[str, Any]) -> AgentLLMConfigSchema | None:
    model_name = _template_value(template, "model") or _template_value(template, "model_name")
    max_tokens = _template_int_value(template, "max_tokens")
    temperature = _template_float_value(template, "temperature")
    top_p = _template_float_value(template, "top_p")
    if model_name is None and max_tokens is None and temperature is None and top_p is None:
        return None
    return AgentLLMConfigSchema(
        model_name=model_name,
        max_tokens=max_tokens,
        temperature=temperature,
        top_p=top_p,
    )


def _display_name(node: LangflowNode) -> str:
    if node.display_name and node.display_name != node.node_type:
        return node.display_name
    suffix = node.node_id.rsplit("-", 1)[-1]
    if node.node_type == "Agent":
        return f"Agent {suffix}"
    return f"{node.display_name} {suffix}".strip()


def _prompt_text(node: LangflowNode) -> str:
    return _join_texts([
        _template_value(node.template, "template"),
        _template_value(node.template, "input_value"),
        _template_value(node.template, "text"),
    ])


def _template_value(template: dict[str, Any], key: str) -> str | None:
    value = template.get(key)
    if isinstance(value, dict):
        value = value.get("value")
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def _template_int_value(template: dict[str, Any], key: str) -> int | None:
    value = template.get(key)
    if isinstance(value, dict):
        value = value.get("value")
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value or None
    if isinstance(value, float):
        return int(value) or None
    if isinstance(value, str) and value.strip():
        try:
            coerced = int(float(value))
        except ValueError:
            return None
        return coerced or None
    return None


def _template_float_value(template: dict[str, Any], key: str) -> float | None:
    value = template.get(key)
    if isinstance(value, dict):
        value = value.get("value")
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _join_texts(parts: list[str | None]) -> str:
    cleaned = [_clean_text(part) for part in parts if part]
    deduped: list[str] = []
    for part in cleaned:
        if part and part not in deduped:
            deduped.append(part)
    return "\n\n".join(deduped)


def _clean_text(value: str) -> str:
    return re.sub(r"\s+\n", "\n", value.strip())


def _first_non_empty(values: Any) -> str | None:
    for value in values:
        if isinstance(value, str):
            cleaned = value.strip()
            if cleaned:
                return cleaned
    return None


def _ordered_ids(node_ids: set[str], order: dict[str, int]) -> list[str]:
    return sorted(node_ids, key=lambda node_id: (order.get(node_id, 10_000), node_id))


def _normalize_positions(positions: dict[str, Position]) -> dict[str, Position]:
    if not positions:
        return {}
    min_x = min(position.x for position in positions.values())
    min_y = min(position.y for position in positions.values())
    offset_x = 280.0 - min_x
    offset_y = 180.0 - min_y
    return {
        node_id: Position(x=position.x + offset_x, y=position.y + offset_y)
        for node_id, position in positions.items()
    }


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def _as_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return str(value)
