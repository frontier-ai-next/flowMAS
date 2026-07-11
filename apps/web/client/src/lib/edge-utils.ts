import type { EdgeDefinition } from "@/lib/api";
import type { GraphEdge, GraphNode } from "@/lib/mock-data";

/** Whether the edge participates in routing (disabled or zero weight = off). */
export function isEdgeEnabled(edge: Pick<GraphEdge, "enabled" | "weight">): boolean {
  if (edge.enabled === false) return false;
  return (edge.weight ?? 1) > 0;
}

export function parseStoredCondition(
  stored?: string | null,
  label?: string | null,
): { condition?: string; label?: string } {
  if (!stored) return { condition: undefined, label: label ?? undefined };
  if (stored.startsWith("contains:")) {
    return { condition: "conditional", label: stored.slice(9) || label || undefined };
  }
  if (stored === "never") return { condition: "skip", label: label ?? undefined };
  return { condition: stored, label: label ?? undefined };
}

export function serializeEdgeForApi(edge: GraphEdge): EdgeDefinition {
  const enabled = isEdgeEnabled(edge);
  return {
    source: edge.source,
    target: edge.target,
    enabled,
    weight: enabled ? (edge.weight ?? 1) : 0,
    condition: edge.condition,
    label: edge.label,
  };
}

export function apiEdgeToGraphEdge(
  e: EdgeDefinition,
  id: string,
  extra?: Partial<GraphEdge>,
): GraphEdge {
  const enabled = e.enabled !== false && (e.weight ?? 1) > 0;
  const parsed = parseStoredCondition(e.condition, e.label);
  return {
    id,
    source: e.source,
    target: e.target,
    condition: parsed.condition,
    label: parsed.label,
    weight: e.weight ?? 1,
    enabled,
    active: false,
    activationCount: 0,
    ...extra,
  };
}

const CANVAS_BOUNDARY = new Set(["__start__", "__end__"]);

/** Agent-to-agent edges that need adaptive scheduler for runtime conditions. */
export function graphEdgesNeedAdaptive(edges: GraphEdge[]): boolean {
  return edges.some(
    (e) =>
      isEdgeEnabled(e)
      && !CANVAS_BOUNDARY.has(e.source)
      && !CANVAS_BOUNDARY.has(e.target)
      && !!e.condition,
  );
}

/** Keyword markers on outgoing conditional/loop edges from one agent. */
export function collectRoutingMarkersForAgent(agentId: string, edges: GraphEdge[]): string[] {
  const markers: string[] = [];
  for (const edge of edges) {
    if (edge.source !== agentId || !isEdgeEnabled(edge)) continue;
    if (edge.condition !== "conditional" && edge.condition !== "loop") continue;
    const label = edge.label?.trim();
    if (label && !markers.includes(label)) markers.push(label);
  }
  return markers;
}

export function routingInstructionForMarkers(markers: string[]): string {
  if (markers.length === 0) return "";
  return `Routing: end your response with exactly one marker from [${markers.join(", ")}] to choose the next step.`;
}

export function roleContainsRoutingHint(role: string | undefined, markers: string[]): boolean {
  const text = (role ?? "").toLowerCase();
  if (text.includes("routing:")) return true;
  return markers.every(m => text.includes(m.toLowerCase()));
}

/** Whether the edge visually goes backward on the canvas (typical review loop). */
export function isBackwardEdge(
  edge: Pick<GraphEdge, "source" | "target">,
  nodes: Pick<GraphNode, "id" | "x">[],
): boolean {
  const src = nodes.find(n => n.id === edge.source);
  const tgt = nodes.find(n => n.id === edge.target);
  if (!src || !tgt) return false;
  return tgt.x < src.x - 20;
}

export function isLoopEdge(edge: Pick<GraphEdge, "condition">): boolean {
  return edge.condition === "loop";
}

/** Human-readable loop edge label for canvas chips. */
export function loopEdgeDisplayLabel(edge: Pick<GraphEdge, "label">): string {
  const label = edge.label?.trim();
  return label ? `↺ ${label}` : "↺ retry";
}

export function loopEdgeNeedsKeywordWarning(edge: Pick<GraphEdge, "condition" | "label">): boolean {
  return isLoopEdge(edge) && !edge.label?.trim();
}

/** Friendly canvas label — never show raw __start__ / internal ids on edges. */
export function nodeDisplayName(nodeId: string, nodes: Pick<GraphNode, "id" | "type" | "agentName" | "label">[]): string {
  if (nodeId === "__start__") return "Start";
  if (nodeId === "__end__") return "Finish";
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return "Unknown";
  if (node.type === "start") return "Start";
  if (node.type === "end") return "Finish";
  return node.agentName || node.label || "Agent";
}

export type EdgeConditionKind = "always" | "source_success" | "source_failed" | "skip" | "conditional" | "loop";

export interface EdgeConditionMeta {
  kind: EdgeConditionKind;
  label: string;
  shortLabel: string;
  description: string;
  example: string | null;
  accent: "neutral" | "green" | "amber" | "cyan" | "violet";
}

export const EDGE_CONDITION_OPTIONS: EdgeConditionMeta[] = [
  {
    kind: "always",
    label: "Always follow",
    shortLabel: "Always",
    description: "This path runs every time the source agent completes.",
    example: "Writer → Editor (always runs after writing)",
    accent: "neutral",
  },
  {
    kind: "source_success",
    label: "When agent succeeds",
    shortLabel: "On success",
    description: "Runs only if the source agent finished without errors.",
    example: "Ingredient check → Chef when pantry has everything (ALL_OK)",
    accent: "green",
  },
  {
    kind: "source_failed",
    label: "When agent fails",
    shortLabel: "On failure",
    description: "Runs only if the source agent returned an error.",
    example: "Researcher → Fallback agent on timeout",
    accent: "amber",
  },
  {
    kind: "skip",
    label: "Skip this path",
    shortLabel: "Skip",
    description: "Advanced: dynamically skip the target unless other rules apply.",
    example: "Rarely needed — prefer keyword branches for clarity",
    accent: "neutral",
  },
  {
    kind: "conditional",
    label: "If output contains keyword",
    shortLabel: "If keyword",
    description: "Like Langflow If-Else: the source agent must write a keyword in its reply. We scan the text (case-insensitive).",
    example: 'Reviewer writes "...needs_revision" → loop back; "...approved" → publish',
    accent: "cyan",
  },
  {
    kind: "loop",
    label: "Send back for retry ↺",
    shortLabel: "Retry loop",
    description: "Review cycle: when the keyword appears, the target agent runs again (capped by Max Loop Iterations).",
    example: "Reviewer → Writer with keyword needs_revision",
    accent: "violet",
  },
];

export const KEYWORD_PRESETS = [
  { value: "approved", hint: "Forward / done" },
  { value: "needs_revision", hint: "Send back" },
  { value: "rejected", hint: "Stop branch" },
  { value: "ALL_OK", hint: "Success path" },
] as const;

export function getEdgeConditionMeta(condition?: string | null): EdgeConditionMeta {
  const kind = (condition || "always") as EdgeConditionKind;
  return EDGE_CONDITION_OPTIONS.find(o => o.kind === kind) ?? EDGE_CONDITION_OPTIONS[0];
}

/** Pill text on the canvas — human-readable, no internal ids. */
export function canvasEdgeLabel(edge: Pick<GraphEdge, "condition" | "label">): string | null {
  const meta = getEdgeConditionMeta(edge.condition);
  if (meta.kind === "always" && !edge.label) return null;
  if (meta.kind === "conditional") {
    return edge.label?.trim() ? `If «${edge.label.trim()}»` : "If keyword…";
  }
  if (meta.kind === "loop") return loopEdgeDisplayLabel(edge);
  if (edge.label?.trim()) return edge.label.trim();
  return meta.shortLabel;
}

export function conditionalEdgeNeedsKeyword(edge: Pick<GraphEdge, "condition" | "label">): boolean {
  return edge.condition === "conditional" && !edge.label?.trim();
}

/** Warn when a conditional fork later merges into a multi-input join (AND barrier). */
export function graphHasConditionalJoinBarrier(
  edges: GraphEdge[],
  nodes: Pick<GraphNode, "id" | "type">[],
): boolean {
  const agentIds = new Set(nodes.filter(n => n.type === "agent").map(n => n.id));
  const routingConditions = new Set(["source_success", "source_failed", "conditional", "loop", "skip"]);
  const forkSources = new Set(
    edges
      .filter(e =>
        isEdgeEnabled(e)
        && agentIds.has(e.source)
        && agentIds.has(e.target)
        && e.condition
        && routingConditions.has(e.condition),
      )
      .map(e => e.source),
  );
  if (forkSources.size === 0) return false;

  return edges.some(e => {
    if (!isEdgeEnabled(e) || !agentIds.has(e.target)) return false;
    const incoming = edges.filter(
      inc => isEdgeEnabled(inc) && inc.target === e.target && agentIds.has(inc.source),
    );
    if (incoming.length < 2) return false;
    return incoming.some(inc => forkSources.has(inc.source) || [...forkSources].some(f => {
      const branches = edges.filter(out => out.source === f && isEdgeEnabled(out) && out.condition);
      return branches.some(b => b.target === inc.source);
    }));
  });
}
