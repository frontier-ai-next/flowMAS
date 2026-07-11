// gMAS Workflow — Main Graph Editor
// Layout: left panel (assets) + center canvas + right inspector + bottom console
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation, useRoute, useSearch } from "wouter";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import {
  Plus, ZoomIn, ZoomOut, Maximize2, Play, Square, ChevronDown, ChevronUp,
  AlignLeft, CheckCircle, X, Download, Copy, Code2, RefreshCw,
  PauseCircle, Zap, Trash2, Edit3,
  PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, Keyboard, Upload,
  Loader2, Save, ArrowRight, Flag, Sparkles, Layers, Wrench, Settings2, CalendarClock
} from "lucide-react";
import { useHotkey } from "@/hooks/useHotkey";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/AppShell";
import { EdgeInspectorPanel } from "@/components/workflow/EdgeInspectorPanel";
import { InspectorActivitySection, LogEventDetailPanel } from "@/components/workflow/LogEventViews";
import { WorkflowCanvasBackground } from "@/lib/backgrounds";
import { useWorkflowRun } from "@/contexts/WorkflowContext";
import {
  mockGraphNodes, mockGraphEdges,
  type GraphNode, type GraphEdge, type LogEvent, type NodeStatus
} from "@/lib/mock-data";
import {
  graphsApi, agentsApi, toolsApi, executionApi, configApi,
  type AgentResponse, type ToolInfo, type GraphValidationResponse, type AgentCreate,
  type LLMProviderConfig, type ToolRuntimeConfig, type RunnerConfigSchema, type GraphResponse,
  type GraphExportFormat, type GraphImportSource,
} from "@/lib/api";
import {
  apiEdgeToGraphEdge,
  canvasEdgeLabel,
  graphEdgesNeedAdaptive,
  graphHasConditionalJoinBarrier,
  isEdgeEnabled,
  isLoopEdge,
  serializeEdgeForApi,
} from "@/lib/edge-utils";
import { downloadText } from "@/lib/download";
import { toast } from "sonner";

// ---- Status helpers ----
function statusClass(s: NodeStatus) {
  const map: Record<NodeStatus, string> = {
    idle: "status-idle", queued: "status-queued", running: "status-running",
    succeeded: "status-succeeded", failed: "status-failed", skipped: "status-skipped",
    waiting_tool: "status-waiting-tool", waiting_llm: "status-waiting-llm",
  };
  return map[s] ?? "status-idle";
}

function statusDot(s: NodeStatus) {
  const map: Record<NodeStatus, string> = {
    idle: "bg-zinc-600", queued: "bg-zinc-400", running: "bg-blue-500 animate-pulse",
    succeeded: "bg-green-500", failed: "bg-red-500", skipped: "bg-zinc-500",
    waiting_tool: "bg-amber-500", waiting_llm: "bg-violet-500",
  };
  return map[s] ?? "bg-zinc-600";
}

function eventClass(type: string) {
  const map: Record<string, string> = {
    run_start: "event-system", run_end: "event-system",
    agent_start: "event-agent", agent_end: "event-agent", agent_output: "event-agent", agent_error: "event-error",
    tool_call: "event-tool", tool_end: "event-tool", tool_error: "event-error",
    token: "event-token", token_usage: "event-token", memory_event: "event-memory",
    topology_changed: "event-topology", error: "event-error", system: "event-system",
  };
  return map[type] ?? "event-system";
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  }
}

const NATIVE_IMPORT_SOURCES = new Set<GraphImportSource>(["gmas_json", "gmas_python"]);

const IMPORT_SOURCE_OPTIONS: Array<{ value: GraphImportSource; label: string; hint: string }> = [
  { value: "gmas_json", label: "gMAS JSON", hint: "Exact UI round-trip" },
  { value: "gmas_python", label: "gMAS Python SDK", hint: "Generated runnable code" },
  { value: "langflow", label: "LangFlow JSON", hint: "Structural import" },
  { value: "langgraph_mermaid", label: "LangGraph Mermaid", hint: "Topology import" },
];

function importAccept(source: GraphImportSource): string {
  if (source === "gmas_json" || source === "langflow") return ".json,application/json";
  if (source === "gmas_python") return ".py,text/x-python,text/plain";
  return ".mmd,.md,.txt,text/plain";
}

function importUploadLabel(source: GraphImportSource): string {
  if (source === "gmas_python") return "Upload Python";
  if (source === "langgraph_mermaid" || source === "mermaid") return "Upload Mermaid";
  return "Upload JSON";
}

function importPayloadLabel(source: GraphImportSource): string {
  if (source === "gmas_json") return "gMAS GraphSpec JSON";
  if (source === "gmas_python") return "gMAS generated Python";
  if (source === "langflow") return "LangFlow export";
  return "Mermaid topology";
}

function importPlaceholder(source: GraphImportSource): string {
  if (source === "gmas_json") return 'Paste a gMAS GraphSpec JSON export with "format": "gmas.studio.graph".';
  if (source === "gmas_python") return "Paste generated or hand-written GraphBuilder Python with literal builder.add_agent(...) calls.";
  if (source === "langflow") return 'Paste a LangFlow JSON export with "data.nodes" and "data.edges".';
  return "graph TD\n  START --> researcher[Researcher]\n  researcher --> analyst[Analyst]\n  analyst --> END";
}

function importDescription(source: GraphImportSource): string {
  if (source === "gmas_json") {
    return "Native exact import. Restores agents, edges, positions, Start/Finish wiring, task targets, provider/model, and run settings.";
  }
  if (source === "gmas_python") {
    return "Safe native import. Parses literal GraphBuilder calls without executing the file.";
  }
  if (source === "langflow") {
    return "Structural import. LangFlow nodes, edges, positions, and supported tool attachments are adapted into a runnable gMAS graph.";
  }
  return "Topology import. Paste Mermaid produced by LangGraph draw_mermaid; node callables and Python runtime state are not imported.";
}

function exportFormatLabel(format: GraphExportFormat): string {
  return format === "gmas_python" ? "Python SDK" : "GraphSpec JSON";
}

function exportLanguage(format: GraphExportFormat): string {
  return format === "gmas_python" ? "python" : "json";
}

// Canvas geometry shared between layout helpers and the SVG component.
const CANVAS_NODE_W = 232;
const CANVAS_NODE_H = 128;
const CANVAS_NODE_GAP_X = 80;

/**
 * Position __start__ / __end__ relative to agent columns so the Task node
 * never overlaps the first agent and the Result node never overlaps the last.
 * Templates store agent positions but don't always include __start__/__end__,
 * and even when they do they often collide with column 0. We respect any
 * explicitly stored position; otherwise we compute one.
 */
function resolveStartEndPositions(
  agentPositions: Array<{ x: number; y: number }>,
  storedStart: { x: number; y: number } | undefined,
  storedEnd: { x: number; y: number } | undefined,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  if (agentPositions.length === 0) {
    return {
      start: storedStart ?? { x: 40, y: 200 },
      end: storedEnd ?? { x: 360, y: 200 },
    };
  }
  const minX = Math.min(...agentPositions.map((p) => p.x));
  const maxX = Math.max(...agentPositions.map((p) => p.x));
  const avgY = agentPositions.reduce((s, p) => s + p.y, 0) / agentPositions.length;
  const safeStartX = minX - (CANVAS_NODE_W + CANVAS_NODE_GAP_X);
  const safeEndX = maxX + (CANVAS_NODE_W + CANVAS_NODE_GAP_X);
  const overlapsAgent = (p: { x: number; y: number }) =>
    agentPositions.some(
      (a) => Math.abs(a.x - p.x) < CANVAS_NODE_W && Math.abs(a.y - p.y) < CANVAS_NODE_H,
    );
  const startPos = storedStart && !overlapsAgent(storedStart)
    ? storedStart
    : { x: safeStartX, y: avgY };
  const endPos = storedEnd && !overlapsAgent(storedEnd)
    ? storedEnd
    : { x: safeEndX, y: avgY };
  return { start: startPos, end: endPos };
}

function addCanvasBoundaryEdges(graph: Pick<GraphResponse, "agents" | "edges" | "start_node" | "end_node" | "task_targets">, edges: GraphEdge[]): GraphEdge[] {
  const agentIds = new Set((graph.agents ?? []).map((agent) => agent.agent_id));
  if (agentIds.size === 0) return edges;

  const pairs = new Set(edges.map((edge) => `${edge.source}→${edge.target}`));
  const graphEdges = graph.edges ?? [];
  const incoming = new Set<string>();
  const outgoing = new Set<string>();

  graphEdges.forEach((edge) => {
    if (agentIds.has(edge.source) && agentIds.has(edge.target)) {
      outgoing.add(edge.source);
      incoming.add(edge.target);
    }
  });

  const startTargets = (graph.task_targets ?? []).filter((id) => agentIds.has(id));
  if (startTargets.length === 0 && graph.start_node && agentIds.has(graph.start_node)) {
    startTargets.push(graph.start_node);
  }
  if (startTargets.length === 0) {
    startTargets.push(...Array.from(agentIds).filter((id) => !incoming.has(id)));
  }

  const endTargets = Array.from(agentIds).filter((id) => !outgoing.has(id));
  if (endTargets.length === 0 && graph.end_node && agentIds.has(graph.end_node)) {
    endTargets.push(graph.end_node);
  }

  const next = [...edges];
  startTargets.forEach((target, index) => {
    const pair = `__start__→${target}`;
    if (pairs.has(pair)) return;
    pairs.add(pair);
    next.push({
      id: `e-boundary-start-${index}-${target}`,
      source: "__start__",
      target,
      weight: 1,
      enabled: true,
      active: false,
      activationCount: 0,
    });
  });
  endTargets.forEach((source, index) => {
    const pair = `${source}→__end__`;
    if (pairs.has(pair)) return;
    pairs.add(pair);
    next.push({
      id: `e-boundary-end-${index}-${source}`,
      source,
      target: "__end__",
      weight: 1,
      enabled: true,
      active: false,
      activationCount: 0,
    });
  });

  return next;
}

// ---- Graph Canvas (SVG-based) ----
function GraphCanvas({ nodes, edges, selectedNode, selectedEdgeId, onSelectNode, onSelectEdge, onMoveNode, onAddEdge }: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNode: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  onMoveNode: (id: string, next: { x: number; y: number }) => void;
  onAddEdge: (source: string, target: string) => void;
}) {
  const NODE_W = 232;
  const NODE_H = 128;
  // Theme-aware palette for SVG fills (light/dark)
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const obs = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  const palette = isDark
    ? {
        nodeFill: "oklch(0.13 0.005 285)",
        nodeStroke: "oklch(0.22 0.005 285)",
        nodeTitle: "oklch(0.95 0.003 285)",
        nodeMuted: "oklch(0.6 0.01 285)",
        startTint: "oklch(0.15 0.04 142)",
        endTint: "oklch(0.15 0.06 35)",
        startStroke: "oklch(0.55 0.15 142)",
        endStroke: "oklch(0.6 0.18 35)",
        connectorStroke: "oklch(0.13 0.005 285)",
        gridLine: "oklch(0.22 0.005 285)",
        edgeIdle: "oklch(0.62 0.012 285 / 0.85)",
      }
    : {
        nodeFill: "oklch(0.99 0.002 285)",
        nodeStroke: "oklch(0.82 0.006 285)",
        nodeTitle: "oklch(0.18 0.005 285)",
        nodeMuted: "oklch(0.42 0.012 285)",
        startTint: "oklch(0.95 0.04 142)",
        endTint: "oklch(0.95 0.06 35)",
        startStroke: "oklch(0.5 0.15 142)",
        endStroke: "oklch(0.55 0.18 35)",
        connectorStroke: "oklch(0.99 0.002 285)",
        gridLine: "oklch(0.88 0.006 285)",
        edgeIdle: "oklch(0.55 0.015 285 / 0.9)",
      };
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  // Track whether the user actually moved the node during this mousedown.
  // We only select on mouseup if they didn't drag — otherwise dragging a
  // node opens the inspector, which is the wrong UX.
  const dragMovedRef = useRef(false);
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [edgeFrom, setEdgeFrom] = useState<string | null>(null);
  const [edgeCursor, setEdgeCursor] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const panMomentumRef = useRef({ x: 0, y: 0 });
  const animationFrameRef = useRef<number | null>(null);

  const getMousePos = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;
    return { x, y };
  }, [pan, zoom]);

  const fitToView = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || nodes.length === 0) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
    const minX = Math.min(...nodes.map(n => n.x));
    const minY = Math.min(...nodes.map(n => n.y));
    const maxX = Math.max(...nodes.map(n => n.x + NODE_W));
    const maxY = Math.max(...nodes.map(n => n.y + NODE_H));
    const gw = maxX - minX, gh = maxY - minY;
    const fit = Math.min(rect.width / (gw + 200), rect.height / (gh + 200), 1.2);
    const z = Math.max(0.4, +fit.toFixed(2));
    setZoom(z);
    setPan({
      x: (rect.width - gw * z) / 2 - minX * z,
      y: (rect.height - gh * z) / 2 - minY * z,
    });
  }, [nodes]);

  // Let parent (Workflow) ask us to fit-to-view after auto-layout runs.
  useEffect(() => {
    const handler = () => requestAnimationFrame(fitToView);
    window.addEventListener("gmas:fit-to-view", handler);
    return () => window.removeEventListener("gmas:fit-to-view", handler);
  }, [fitToView]);

  const getNodeCenter = (node: GraphNode) => ({
    x: node.x + NODE_W / 2,
    y: node.y + NODE_H / 2,
  });

  const handleSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 0 || e.button === 1 || e.nativeEvent.getModifierState("Space")) {
      e.preventDefault();
      onSelectNode(null);
      onSelectEdge(null);
      panMomentumRef.current = { x: 0, y: 0 };
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  }, [onSelectNode, onSelectEdge, pan]);

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (edgeFrom) {
      setEdgeCursor(getMousePos(e));
      return;
    }
    if (draggingNode) {
      e.preventDefault();
      const pos = getMousePos(e);
      // Detect real drag motion to distinguish click from drag (4px threshold)
      if (!dragMovedRef.current && mouseDownPosRef.current) {
        const dx = pos.x - mouseDownPosRef.current.x;
        const dy = pos.y - mouseDownPosRef.current.y;
        if (Math.hypot(dx, dy) > 4) dragMovedRef.current = true;
      }
      const next = {
        x: Math.round((pos.x - dragStart.x) / 8) * 8,
        y: Math.round((pos.y - dragStart.y) / 8) * 8,
      };
      onMoveNode(draggingNode, next);
      return;
    }
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    }
  }, [dragStart, draggingNode, edgeFrom, getMousePos, isPanning, onMoveNode, panStart]);

  const handleSvgMouseUp = useCallback(() => {
    // Node-specific click-vs-drag handling lives in handleNodeMouseUp.
    // SvgMouseUp only cleans up pan / edge state.
    setDraggingNode(null);
    setIsPanning(false);
    setEdgeFrom(null);
    dragMovedRef.current = false;
    mouseDownPosRef.current = null;
    applyPanMomentum();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEdge = useCallback((nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEdgeFrom(nodeId);
    setEdgeCursor(getMousePos(e));
  }, [getMousePos]);

  const finishEdge = useCallback((nodeId: string, e: React.MouseEvent) => {
    if (edgeFrom && edgeFrom !== nodeId) {
      e.stopPropagation();
      onAddEdge(edgeFrom, nodeId);
    }
    setEdgeFrom(null);
  }, [edgeFrom, onAddEdge]);

  const handleNodeMouseDown = useCallback((nodeId: string, e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left mouse only
    e.preventDefault();
    e.stopPropagation();
    const pos = getMousePos(e);
    setDraggingNode(nodeId);
    const node = nodes.find(n => n.id === nodeId);
    setDragStart(node ? { x: pos.x - node.x, y: pos.y - node.y } : { x: 0, y: 0 });
    // Reset drag tracking — we'll decide select vs drag on mouseup
    dragMovedRef.current = false;
    mouseDownPosRef.current = pos;
  }, [getMousePos, nodes]);

  const handleNodeMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingNode) return;
    e.preventDefault();
    // Track motion locally on the node too (mousemove may fire here when the
    // pointer stays within the node bounds and never reaches the svg handler)
    if (!dragMovedRef.current && mouseDownPosRef.current) {
      const pos = getMousePos(e);
      const dx = pos.x - mouseDownPosRef.current.x;
      const dy = pos.y - mouseDownPosRef.current.y;
      if (Math.hypot(dx, dy) > 4) dragMovedRef.current = true;
    }
  }, [draggingNode, getMousePos]);

  const handleNodeMouseUp = useCallback((nodeId: string) => {
    // Click (no movement) → select. Drag (moved >4px) → don't open inspector.
    if (!dragMovedRef.current) {
      onSelectNode(nodeId);
    }
    setDraggingNode(null);
    dragMovedRef.current = false;
    mouseDownPosRef.current = null;
  }, [onSelectNode]);

  const applyPanMomentum = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    const animate = () => {
      const vel = panMomentumRef.current;
      if (Math.abs(vel.x) < 0.1 && Math.abs(vel.y) < 0.1) return;

      // Apply friction (0.92 = smooth deceleration)
      panMomentumRef.current = {
        x: vel.x * 0.92,
        y: vel.y * 0.92,
      };

      setPan((prev) => ({
        x: prev.x + panMomentumRef.current.x,
        y: prev.y + panMomentumRef.current.y,
      }));

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    if (!svgRef.current) return;
    e.preventDefault();

    // Ctrl+wheel or trackpad pinch → zoom
    if (e.ctrlKey) {
      const rect = svgRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const rawDelta = e.deltaY || e.deltaX || 0;
      const normalizedDelta = rawDelta > 0 ? -0.06 : 0.06;
      const newZoom = Math.min(3, Math.max(0.2, zoom + normalizedDelta));

      const zoomRatio = newZoom / zoom;
      setPan({
        x: mouseX - zoomRatio * (mouseX - pan.x),
        y: mouseY - zoomRatio * (mouseY - pan.y),
      });
      setZoom(newZoom);
      return;
    }

    // Plain scroll (trackpad two-finger or mouse wheel) → pan
    setPan((prev) => ({
      x: prev.x - e.deltaX,
      y: prev.y - e.deltaY,
    }));
  }, [zoom, pan]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Attach wheel on the SVG element with passive:false so preventDefault works
    svg.addEventListener("wheel", handleWheel, { passive: false });

    // Also intercept at window level to beat Chrome's back/forward swipe detection
    const windowWheel = (e: WheelEvent) => {
      if (svg.contains(e.target as Node)) e.preventDefault();
    };
    window.addEventListener("wheel", windowWheel, { passive: false });

    const preventSwipe = (e: TouchEvent) => { e.preventDefault(); };
    svg.addEventListener("touchstart", preventSwipe, { passive: false });
    svg.addEventListener("touchmove", preventSwipe, { passive: false });

    return () => {
      svg.removeEventListener("wheel", handleWheel);
      window.removeEventListener("wheel", windowWheel);
      svg.removeEventListener("touchstart", preventSwipe);
      svg.removeEventListener("touchmove", preventSwipe);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [handleWheel]);

  // Disable browser back/forward swipe while canvas is mounted
  useEffect(() => {
    const prevBody = document.body.style.overscrollBehaviorX;
    const prevHtml = document.documentElement.style.overscrollBehaviorX;
    document.body.style.overscrollBehaviorX = "none";
    document.documentElement.style.overscrollBehaviorX = "none";
    return () => {
      document.body.style.overscrollBehaviorX = prevBody;
      document.documentElement.style.overscrollBehaviorX = prevHtml;
    };
  }, []);

  const statusFill = (status: NodeStatus) => {
    switch (status) {
      case "running": return "oklch(0.62 0.19 259)";
      case "succeeded": return "oklch(0.72 0.17 142)";
      case "failed": return "oklch(0.62 0.22 25)";
      case "waiting_tool": return "oklch(0.72 0.19 55)";
      case "waiting_llm": return "oklch(0.65 0.18 295)";
      case "queued": return "oklch(0.7 0.01 285)";
      default: return "oklch(0.35 0.005 285)";
    }
  };

  const renderEdge = (edge: GraphEdge) => {
    const src = nodes.find(n => n.id === edge.source);
    const tgt = nodes.find(n => n.id === edge.target);
    if (!src || !tgt) return null;

    const s = { x: src.x + NODE_W, y: src.y + NODE_H / 2 };
    const t = { x: tgt.x, y: tgt.y + NODE_H / 2 };
    const isBackEdge = t.x <= s.x;
    const siblings = edges.filter(e => e.source === edge.source);
    const siblingIndex = Math.max(0, siblings.findIndex(e => e.id === edge.id));
    const siblingOffset = (siblingIndex - (siblings.length - 1) / 2) * 10;
    const dx = isBackEdge
      ? Math.max(Math.abs(t.x - s.x) * 0.35, 156)
      : Math.max(Math.abs(t.x - s.x) * 0.52, 92);
    const lift = isBackEdge
      ? Math.min(320, Math.max(150, Math.abs(t.y - s.y) * 0.38 + 130 + siblingIndex * 12))
      : 0;
    const c1 = { x: s.x + dx, y: isBackEdge ? s.y - lift : s.y + siblingOffset };
    const c2 = { x: t.x - dx, y: isBackEdge ? t.y - lift : t.y + siblingOffset };
    const path = `M ${s.x} ${s.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${t.x} ${t.y}`;

    const labelT = isBackEdge ? 0.48 : 0.52;
    const invT = 1 - labelT;
    const labelAnchor = {
      x: invT ** 3 * s.x + 3 * invT ** 2 * labelT * c1.x + 3 * invT * labelT ** 2 * c2.x + labelT ** 3 * t.x,
      y: invT ** 3 * s.y + 3 * invT ** 2 * labelT * c1.y + 3 * invT * labelT ** 2 * c2.y + labelT ** 3 * t.y,
    };
    const labelYOffset = isBackEdge
      ? -18
      : Math.abs(t.y - s.y) < NODE_H * 0.75
        ? -34
        : -24;
    const labelX = labelAnchor.x;
    const labelY = labelAnchor.y + labelYOffset + siblingOffset;
    const edgeLabelScale = zoom < 0.75 ? Math.min(1.55, 0.75 / Math.max(zoom, 0.42)) : 1;

    const edgeEnabled = isEdgeEnabled(edge);
    const active = edge.active && edgeEnabled;
    const isSelectedEdge = selectedEdgeId === edge.id;
    const isLoop = isLoopEdge(edge);
    const strokeMain = !edgeEnabled
      ? "oklch(0.55 0.012 285 / 0.35)"
      : isSelectedEdge
      ? "oklch(0.72 0.18 259)"
      : active ? "oklch(0.65 0.21 259 / 0.95)"
      : isLoop ? "oklch(0.65 0.18 295 / 0.78)"
      : palette.edgeIdle;

    return (
      <g key={edge.id}>
        {/* Outer glow */}
        {active && (
          <>
            <path d={path} fill="none" stroke="oklch(0.62 0.19 259 / 0.12)" strokeWidth={12} strokeLinecap="round" />
            <path d={path} fill="none" stroke="oklch(0.62 0.19 259 / 0.28)" strokeWidth={6} strokeLinecap="round" />
          </>
        )}
        {/* Selection halo */}
        {isSelectedEdge && (
          <path d={path} fill="none" stroke="oklch(0.62 0.19 259 / 0.22)" strokeWidth={8} strokeLinecap="round" />
        )}
        {/* Wide invisible hit-area so the thin edge is easy to click/select */}
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={16}
          strokeLinecap="round"
          style={{ cursor: "pointer" }}
          onClick={(e) => { e.stopPropagation(); onSelectEdge(edge.id); }}
        />
        {/* Main edge */}
        <path
          d={path}
          fill="none"
          stroke={strokeMain}
          strokeWidth={isSelectedEdge ? 2.5 : active ? 2.25 : isLoop ? 2 : 1.75}
          strokeDasharray={!edgeEnabled ? "4 4" : isLoop ? "8 5" : active || isSelectedEdge ? "none" : "6 4"}
          strokeLinecap="round"
          markerEnd={`url(#arrow-${edgeEnabled && active ? "active" : isLoop ? "loop" : "idle"})`}
          pointerEvents="none"
        >
          {active && (
            <animate attributeName="stroke-opacity" values="0.75;1;0.75" dur="1.2s" repeatCount="1" />
          )}
        </path>
        {/* Animated particle flow on active edges */}
        {active && (
          <>
            <circle r="3.5" fill="oklch(0.92 0.15 259)" filter="url(#particleGlow)">
              <animateMotion dur="1.15s" repeatCount="1" path={path} fill="freeze" />
              <animate attributeName="opacity" values="0;1;1;0" dur="1.15s" repeatCount="1" fill="freeze" />
            </circle>
          </>
        )}
        {/* Label — LangGraph-style condition pill + optional weight pill */}
        {(edge.condition || edge.label || (edge.weight !== undefined && edge.weight !== 1)) && (() => {
          // Map our internal condition vocabulary to LangGraph-style display names
          const langGraphLabel = canvasEdgeLabel(edge) ?? (() => {
            switch (edge.condition) {
              case "source_success": return "On success";
              case "source_failed": return "On failure";
              default: return edge.label ?? null;
            }
          })();
          // Pill color tone: green for success, amber for failure, purple for
          // loop, cyan for conditional, slate otherwise.
          const tone = (() => {
            if (edge.condition === "source_success") return { fill: "oklch(0.32 0.09 142 / 0.18)", stroke: "oklch(0.72 0.17 142 / 0.45)", text: "oklch(0.85 0.18 142)" };
            if (edge.condition === "source_failed")  return { fill: "oklch(0.36 0.12 30 / 0.18)",  stroke: "oklch(0.70 0.20 30 / 0.45)",  text: "oklch(0.85 0.18 30)" };
            if (edge.condition === "skip")           return { fill: "oklch(0.30 0.04 285 / 0.30)", stroke: "oklch(0.55 0.04 285 / 0.45)", text: "oklch(0.80 0.04 285)" };
            if (edge.condition === "loop")           return { fill: "oklch(0.32 0.10 295 / 0.20)", stroke: "oklch(0.65 0.18 295 / 0.45)", text: "oklch(0.82 0.16 295)" };
            if (edge.condition === "conditional")    return { fill: "oklch(0.32 0.08 220 / 0.20)", stroke: "oklch(0.68 0.14 220 / 0.45)", text: "oklch(0.84 0.13 220)" };
            return { fill: palette.nodeFill, stroke: active ? "oklch(0.62 0.19 259 / 0.5)" : palette.nodeStroke, text: active ? "oklch(0.72 0.15 259)" : palette.nodeMuted };
          })();
          // Estimate pill width based on text length (~ 6.4px per glyph)
          const condText = langGraphLabel ?? "";
          const chipH = 20;
          const condW = Math.max(54, Math.min(220, Math.round(condText.length * 7.1) + 22));
          const hasWeight = edge.weight !== undefined && edge.weight !== 1;
          const weightText = hasWeight ? `w ${Number(edge.weight).toFixed(edge.weight !== undefined && edge.weight < 1 ? 2 : 1).replace(/\.0$/, "")}` : "";
          const weightW = hasWeight ? Math.max(38, weightText.length * 7 + 14) : 0;
          const gap = hasWeight && condText ? 5 : 0;
          const totalW = condW + gap + weightW;
          const startX = labelX - totalW / 2;
          const labelTransform = edgeLabelScale > 1
            ? `translate(${labelX} ${labelY}) scale(${edgeLabelScale}) translate(${-labelX} ${-labelY})`
            : undefined;

          return (
            <g pointerEvents="none" transform={labelTransform}>
              {condText && (
                <>
                  <rect
                    x={startX} y={labelY - chipH / 2}
                    width={condW} height={chipH} rx={chipH / 2}
                    fill={tone.fill}
                    stroke={tone.stroke}
                    strokeWidth={1}
                    filter="url(#edgeChipShadow)"
                  />
                  <text
                    x={startX + condW / 2} y={labelY + 4}
                    textAnchor="middle"
                    fill={tone.text}
                    fontSize={11.5}
                    fontFamily="Geist Mono, monospace"
                    fontWeight={500}
                  >
                    {condText}
                  </text>
                </>
              )}
              {hasWeight && (
                <>
                  <rect
                    x={startX + condW + gap} y={labelY - chipH / 2}
                    width={weightW} height={chipH} rx={chipH / 2}
                    fill={palette.nodeFill}
                    stroke={palette.nodeStroke}
                    strokeWidth={1}
                    filter="url(#edgeChipShadow)"
                  />
                  <text
                    x={startX + condW + gap + weightW / 2} y={labelY + 4}
                    textAnchor="middle"
                    fill={palette.nodeMuted}
                    fontSize={11}
                    fontFamily="Geist Mono, monospace"
                  >
                    {weightText}
                  </text>
                </>
              )}
            </g>
          );
        })()}
      </g>
    );
  };

  const renderNode = (node: GraphNode) => {
    const isSelected = selectedNode === node.id;
    const isStart = node.type === 'start';
    const isEnd = node.type === 'end';
    const isRunning = node.status === 'running';
    const accent = statusFill(node.status);

    if (isStart || isEnd) {
      const tint = isStart ? palette.startTint : palette.endTint;
      const stroke = isStart ? palette.startStroke : palette.endStroke;
      return (
        <g
          key={node.id}
          onMouseDown={(e) => handleNodeMouseDown(node.id, e)}
          onMouseUp={(e) => { finishEdge(node.id, e); handleNodeMouseUp(node.id); }}
          style={{ cursor: draggingNode === node.id ? 'grabbing' : 'grab' }}
        >
          <rect
            x={node.x + 30} y={node.y + 36} width={NODE_W - 60} height={44}
            rx={22}
            fill={tint}
            stroke={isSelected ? "oklch(0.62 0.19 259)" : stroke}
            strokeWidth={isSelected ? 2 : 1.5}
          />
          <text x={node.x + NODE_W / 2} y={node.y + 63} textAnchor="middle"
            fill={palette.nodeTitle} fontSize={14}
            fontFamily="Geist Mono, monospace" fontWeight="500">
            {isStart ? "Start" : isEnd ? "Finish" : node.label}
          </text>
          {/* Output connector handle (right side) */}
          {!isEnd && (
            <circle
              cx={node.x + NODE_W - 30} cy={node.y + 58} r={7}
              fill="oklch(0.62 0.19 259)" stroke={palette.connectorStroke} strokeWidth={2}
              style={{ cursor: 'crosshair' }}
              onMouseDown={(e) => startEdge(node.id, e)}
            >
              <title>Drag to connect</title>
            </circle>
          )}
        </g>
      );
    }

    return (
      <g
        key={node.id}
        onMouseDown={(e) => handleNodeMouseDown(node.id, e)}
        onMouseMove={handleNodeMouseMove}
        onMouseUp={(e) => { finishEdge(node.id, e); handleNodeMouseUp(node.id); }}
        style={{ cursor: draggingNode === node.id ? 'grabbing' : 'grab' }}
      >
        {/* Pulse rings for running — double layered for a soft halo */}
        {isRunning && (
          <>
            <rect x={node.x - 8} y={node.y - 8} width={NODE_W + 16} height={NODE_H + 16} rx={13}
              fill="none" stroke="oklch(0.62 0.19 259 / 0.35)" strokeWidth={2}>
              <animate attributeName="stroke-opacity" values="0.45;0;0.45" dur="1.8s" repeatCount="indefinite" />
              <animate attributeName="stroke-width" values="2;9;2" dur="1.8s" repeatCount="indefinite" />
            </rect>
            <rect x={node.x - 2} y={node.y - 2} width={NODE_W + 4} height={NODE_H + 4} rx={10}
              fill="none" stroke="oklch(0.7 0.2 259 / 0.75)" strokeWidth={1.5}>
              <animate attributeName="stroke-opacity" values="0.9;0.4;0.9" dur="1.4s" repeatCount="indefinite" />
            </rect>
          </>
        )}
        {/* Selection halo */}
        {isSelected && !isRunning && (
          <rect x={node.x - 2} y={node.y - 2} width={NODE_W + 4} height={NODE_H + 4} rx={9}
            fill="none" stroke="oklch(0.62 0.19 259 / 0.5)" strokeWidth={2} />
        )}
        {/* Card */}
        <rect
          x={node.x} y={node.y} width={NODE_W} height={NODE_H}
          rx={8}
          fill={palette.nodeFill}
          stroke={isSelected ? "oklch(0.62 0.19 259)" : isRunning ? "oklch(0.62 0.19 259 / 0.55)" : palette.nodeStroke}
          strokeWidth={isSelected ? 1.5 : 1}
        />
        {/* Left accent bar */}
        <rect
          x={node.x} y={node.y} width={4} height={NODE_H}
          rx={4}
          fill={accent}
        />
        {/* Header: agent name + status */}
        <text x={node.x + 16} y={node.y + 22} fill={palette.nodeTitle}
          fontSize={13} fontFamily="Geist Sans, sans-serif" fontWeight="600">
          {(node.agentName || node.label).length > 16
            ? (node.agentName || node.label).slice(0, 16) + '…'
            : (node.agentName || node.label)}
        </text>
        {/* Status pill (top-right) */}
        <g>
          <rect
            x={node.x + NODE_W - 78} y={node.y + 11} width={66} height={15} rx={3}
            fill={`color-mix(in oklch, ${accent} 18%, transparent)`}
            stroke={`color-mix(in oklch, ${accent} 40%, transparent)`}
            strokeWidth={0.8}
          />
          <circle cx={node.x + NODE_W - 68} cy={node.y + 18.5} r={3} fill={accent}>
            {isRunning && <animate attributeName="opacity" values="1;0.35;1" dur="1.4s" repeatCount="indefinite" />}
          </circle>
          <text x={node.x + NODE_W - 60} y={node.y + 22}
            fill={accent} fontSize={10} fontFamily="Geist Mono, monospace">
            {node.status}
          </text>
        </g>
        {/* Role — hard-truncated so it never overflows the card */}
        <text
          x={node.x + 16} y={node.y + 40}
          fill={palette.nodeMuted} fontSize={11} fontFamily="Geist Sans, sans-serif"
        >
          {node.role && node.role.length > 22 ? node.role.slice(0, 22) + '…' : (node.role ?? '')}
        </text>
        {/* Divider */}
        <line x1={node.x + 16} y1={node.y + 50} x2={node.x + NODE_W - 16} y2={node.y + 50}
          stroke={palette.nodeStroke} strokeWidth={0.5} />
        {/* Model */}
        <text x={node.x + 16} y={node.y + 66} fill={isDark ? "oklch(0.7 0.04 259)" : "oklch(0.45 0.12 259)"} fontSize={11} fontFamily="Geist Mono, monospace">
          {node.model}
        </text>
        {/* Metrics row */}
        {node.tokenCount !== undefined && (
          <text x={node.x + 16} y={node.y + 84} fill={palette.nodeMuted} fontSize={10} fontFamily="Geist Mono, monospace">
            {node.tokenCount > 0 ? `${node.tokenCount.toLocaleString()} tok` : "— tok"}
          </text>
        )}
        {node.toolsCount !== undefined && (
          <text x={node.x + 100} y={node.y + 84} fill={palette.nodeMuted} fontSize={10} fontFamily="Geist Mono, monospace">
            {node.toolsCount} tools
          </text>
        )}
        {node.memoryEnabled && (
          <text x={node.x + 160} y={node.y + 84} fill={isDark ? "oklch(0.65 0.15 295)" : "oklch(0.45 0.15 295)"} fontSize={10} fontFamily="Geist Mono, monospace">
            mem
          </text>
        )}
        {edges.some(e => isEdgeEnabled(e) && isLoopEdge(e) && (e.source === node.id || e.target === node.id)) && (
          <g pointerEvents="none">
            <rect
              x={node.x + 12} y={node.y + NODE_H - 21} width={44} height={14} rx={7}
              fill="oklch(0.32 0.10 295 / 0.22)" stroke="oklch(0.65 0.18 295 / 0.45)" strokeWidth={0.8}
            />
            <text x={node.x + 34} y={node.y + NODE_H - 10.5} textAnchor="middle"
              fill="oklch(0.82 0.16 295)" fontSize={9.5} fontFamily="Geist Mono, monospace" fontWeight={600}>
              ↺
            </text>
          </g>
        )}
        {/* Last event */}
        {node.lastEvent && (
          <text x={node.x + 16} y={node.y + 102} fill={palette.nodeMuted} fontSize={10} fontFamily="Geist Sans, sans-serif" fontStyle="italic">
            {node.lastEvent.length > 28 ? node.lastEvent.slice(0, 28) + '…' : node.lastEvent}
          </text>
        )}
        {/* Input connector handle (left side) */}
        <circle
          cx={node.x} cy={node.y + NODE_H / 2} r={6}
          fill={isDark ? "oklch(0.3 0.005 285)" : "oklch(0.85 0.005 285)"} stroke={palette.nodeMuted} strokeWidth={1.5}
        />
        {/* Output connector handle (right side) */}
        <circle
          cx={node.x + NODE_W} cy={node.y + NODE_H / 2} r={7}
          fill="oklch(0.62 0.19 259)" stroke={palette.connectorStroke} strokeWidth={2}
          style={{ cursor: 'crosshair' }}
          onMouseDown={(e) => startEdge(node.id, e)}
        >
          <title>Drag to connect</title>
        </circle>
      </g>
    );
  };

  return (
    <div
      className="w-full h-full relative overflow-hidden"
      style={{ overscrollBehavior: "none", touchAction: "none" }}
    >
      {/* Professional workflow background */}
      <div className="absolute inset-0 pointer-events-none">
        <WorkflowCanvasBackground />
      </div>
      <svg
        ref={svgRef}
        data-graph-canvas="true"
        data-pan-x={pan.x}
        data-pan-y={pan.y}
        data-zoom={zoom}
        width="100%"
        height="100%"
        className={cn(
          "absolute inset-0 select-none",
          draggingNode || isPanning ? "cursor-grabbing" : "cursor-grab"
        )}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
        onMouseLeave={handleSvgMouseUp}
      >
        <defs>
          <marker id="arrow-active" viewBox="0 0 10 10" markerWidth="7" markerHeight="7" refX="9" refY="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="oklch(0.62 0.19 259 / 0.95)" />
          </marker>
          <marker id="arrow-idle" viewBox="0 0 10 10" markerWidth="7" markerHeight="7" refX="8" refY="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={palette.edgeIdle} />
          </marker>
          <marker id="arrow-loop" viewBox="0 0 10 10" markerWidth="7" markerHeight="7" refX="8" refY="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="oklch(0.65 0.18 295 / 0.85)" />
          </marker>
          <filter id="particleGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="nodeRunGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="edgeChipShadow" x="-20%" y="-80%" width="140%" height="260%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.8" floodColor="oklch(0.08 0.01 285)" floodOpacity="0.55" />
          </filter>
        </defs>
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Edges first */}
          <g>{edges.map(renderEdge)}</g>
          {/* Live edge preview while connecting */}
          {edgeFrom && (() => {
            const src = nodes.find(n => n.id === edgeFrom);
            if (!src) return null;
            return (
              <line
                x1={src.x + NODE_W} y1={src.y + NODE_H / 2}
                x2={edgeCursor.x} y2={edgeCursor.y}
                stroke="oklch(0.62 0.19 259)" strokeWidth={2} strokeDasharray="5 4"
                markerEnd="url(#arrow-active)" pointerEvents="none"
              />
            );
          })()}
          {/* Nodes on top */}
          <g>{nodes.map(renderNode)}</g>
        </g>
      </svg>
      {/* Zoom controls */}
      <div className="absolute bottom-4 left-4 flex items-center gap-1 bg-card/80 border border-border/50 rounded-md p-1 backdrop-blur-sm shadow-lg">
        <button
          onClick={() => setZoom(z => Math.min(3, +(z + 0.15).toFixed(2)))}
          className="p-2 hover:bg-accent/60 rounded text-muted-foreground hover:text-foreground transition-colors active:scale-[0.97]"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <span className="text-xs font-mono text-muted-foreground px-1 tabular-nums w-10 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom(z => Math.max(0.5, +(z - 0.15).toFixed(2)))}
          className="p-2 hover:bg-accent/60 rounded text-muted-foreground hover:text-foreground transition-colors active:scale-[0.97]"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-border/50 mx-0.5" />
        <button
          onClick={fitToView}
          className="p-2 hover:bg-accent/60 rounded text-muted-foreground hover:text-foreground transition-colors active:scale-[0.97]"
          title="Fit graph to view"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
      {/* Minimap */}
      {(() => {
        // Compute bounding box around all nodes so minimap fits the actual graph,
        // not a hard-coded 800×500 region — empty/auto-laid graphs always stay visible.
        const PAD = 80;
        const xs = nodes.flatMap(n => [n.x, n.x + NODE_W]);
        const ys = nodes.flatMap(n => [n.y, n.y + NODE_H]);
        const minX = xs.length ? Math.min(...xs) - PAD : 0;
        const minY = ys.length ? Math.min(...ys) - PAD : 0;
        const maxX = xs.length ? Math.max(...xs) + PAD : 800;
        const maxY = ys.length ? Math.max(...ys) + PAD : 500;
        const bbW = Math.max(maxX - minX, 200);
        const bbH = Math.max(maxY - minY, 140);

        // Theme-aware idle node colors so nodes don't vanish on light bg.
        const idleFill = isDark ? "oklch(0.45 0.01 285 / 0.85)" : "oklch(0.78 0.01 285 / 0.95)";
        const idleStroke = isDark ? "oklch(0.65 0.01 285 / 0.7)" : "oklch(0.42 0.01 285 / 0.7)";
        const idleEdge = isDark ? "oklch(0.55 0.01 285 / 0.55)" : "oklch(0.4 0.01 285 / 0.55)";

        // Project canvas viewport (pan/zoom) onto minimap to show what user sees.
        const svgRect = svgRef.current?.getBoundingClientRect();
        const viewW = svgRect ? svgRect.width / zoom : 0;
        const viewH = svgRect ? svgRect.height / zoom : 0;
        const viewX = -pan.x / zoom;
        const viewY = -pan.y / zoom;

        return (
          <div className="absolute bottom-4 right-4 w-44 h-28 bg-card/95 border border-border/60 rounded-md backdrop-blur-sm overflow-hidden shadow-lg">
            <div className="absolute top-1 left-2 text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider z-10">Minimap</div>
            <svg
              width="100%" height="100%"
              viewBox={`${minX} ${minY} ${bbW} ${bbH}`}
              preserveAspectRatio="xMidYMid meet"
              className="absolute inset-0"
            >
              {edges.map(edge => {
                const src = nodes.find(n => n.id === edge.source);
                const tgt = nodes.find(n => n.id === edge.target);
                if (!src || !tgt) return null;
                return <line key={edge.id}
                  x1={src.x + NODE_W / 2} y1={src.y + NODE_H / 2}
                  x2={tgt.x + NODE_W / 2} y2={tgt.y + NODE_H / 2}
                  stroke={edge.active ? "oklch(0.62 0.19 259 / 0.9)" : idleEdge}
                  strokeWidth={edge.active ? 3 : 2}
                />;
              })}
              {nodes.map(node => {
                const fill = node.status === 'running'
                  ? "oklch(0.62 0.19 259 / 0.85)"
                  : node.status === 'succeeded'
                  ? "oklch(0.72 0.17 142 / 0.75)"
                  : node.status === 'failed'
                  ? "oklch(0.62 0.22 25 / 0.75)"
                  : idleFill;
                const stroke = node.status === 'running'
                  ? "oklch(0.75 0.2 259)"
                  : node.status === 'succeeded'
                  ? "oklch(0.78 0.17 142)"
                  : node.status === 'failed'
                  ? "oklch(0.7 0.22 25)"
                  : idleStroke;
                return (
                  <rect key={node.id}
                    x={node.x} y={node.y} width={NODE_W} height={NODE_H} rx={10}
                    fill={fill} stroke={stroke} strokeWidth={3}
                  />
                );
              })}
              {/* Viewport indicator */}
              {svgRect && (
                <rect
                  x={viewX} y={viewY} width={viewW} height={viewH}
                  fill="oklch(0.62 0.19 259 / 0.08)"
                  stroke="oklch(0.62 0.19 259 / 0.9)"
                  strokeWidth={3}
                  strokeDasharray="6 4"
                  rx={6}
                />
              )}
            </svg>
          </div>
        );
      })()}
    </div>
  );
}

// ---- Agent card (left panel item) ----
function AgentCard({
  agent,
  onEdit,
  onDelete,
  canManage = true,
}: {
  agent: AgentResponse;
  onEdit: () => void;
  onDelete: () => void;
  canManage?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const persona = agent.persona || agent.description || "";
  const model = agent.llm_backbone ?? agent.llm_config?.model_name ?? "";
  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData("application/gmas-agent-id", agent.agent_id);
        e.dataTransfer.setData("application/gmas-agent-name", agent.display_name);
        e.dataTransfer.setData("application/gmas-agent-model", agent.llm_backbone ?? "");
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => setExpanded(v => !v)}
      className="p-2.5 rounded border border-border/40 bg-card/30 hover:bg-card/60 transition-all duration-150 hover:border-blue-500/30 group cursor-pointer w-full min-w-0 overflow-hidden"
    >
      <div className="flex items-center gap-2 mb-1 min-w-0">
        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
        <span className="text-xs font-medium truncate flex-1 min-w-0" title={agent.display_name}>
          {agent.display_name}
        </span>
        <ChevronDown className={cn(
          "w-3 h-3 text-muted-foreground/50 shrink-0 transition-transform",
          expanded && "rotate-180",
        )} />
        {canManage && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={e => { e.stopPropagation(); onEdit(); }}
              className="p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
              title="Edit agent"
            >
              <Edit3 className="w-3 h-3" />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors"
              title="Delete agent"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
      <div className="text-[10px] font-mono text-blue-400/60 truncate" title={agent.agent_id}>
        {agent.agent_id}
      </div>
      {persona && !expanded && (
        <div className="text-[10px] text-muted-foreground/60 truncate mt-0.5">
          {persona}
        </div>
      )}
      {persona && expanded && (
        <div className="text-[10px] text-muted-foreground/75 mt-1 leading-relaxed whitespace-pre-wrap break-words">
          {persona}
        </div>
      )}
      {model && (
        <div className="text-[10px] font-mono text-muted-foreground/40 mt-1 truncate" title={model}>
          {model}
        </div>
      )}
      {expanded && (agent.tools?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {agent.tools!.map(t => (
            <span key={t} className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300/80 text-[9px] font-mono border border-amber-500/20">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Left Panel ----
function LeftPanel({ onAiBuild, onAutoLayout, onCollapse, graphNodes }: {
  onAiBuild: () => void;
  onAutoLayout: () => void;
  onCollapse: () => void;
  graphNodes: GraphNode[];
}) {
  const [agents, setAgents] = useState<AgentResponse[]>([]);
  // Agents come from the global store and accumulate across every graph, so
  // the raw list grows unbounded. Scope to the current graph by default and
  // let the user search / switch to all so the panel never overflows.
  const [agentScope, setAgentScope] = useState<"graph" | "all">("graph");
  const [agentQuery, setAgentQuery] = useState("");
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [templates, setTemplates] = useState<{ template_id: string; name: string; description: string; agent: AgentCreate }[]>([]);
  const [graphTemplates, setGraphTemplates] = useState<{ template_id: string; name: string; description: string; category: string }[]>([]);
  const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  const refreshAgents = () => agentsApi.list().then(setAgents).catch(() => {});
  const refreshTools = () => toolsApi.list().then(setTools).catch(() => {});
  const refreshTemplates = () => agentsApi.templates().then(setTemplates).catch(() => {});
  const refreshGraphTemplates = () => graphsApi.templates().then((d) => setGraphTemplates(d.map((t) => ({
    template_id: t.template_id,
    name: t.name,
    description: t.description,
    category: t.category,
  })))).catch(() => {});

  useEffect(() => {
    refreshAgents();
    refreshTools();
    refreshTemplates();
    refreshGraphTemplates();
  }, []);

  const handleTemplateClick = async (tpl: { template_id: string; agent: AgentCreate }) => {
    try {
      const newId = `${tpl.agent.agent_id}-${Date.now().toString(36)}`;
      const created = await agentsApi.create({ ...tpl.agent, agent_id: newId });
      setAgents(prev => [...prev, created]);
      toast.success(`Created "${created.display_name}" from template`);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to create from template";
      toast.error(msg);
    }
  };

  const handleGraphTemplateClick = async (templateId: string, name: string) => {
    try {
      const created = await graphsApi.createFromTemplate(templateId);
      toast.success(`Created "${name}" graph from template`);
      // Navigate to the new graph in the same page (Workflow refreshes from query param)
      setLocation(`/workflow?graph=${created.graph_id}`);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to create graph from template";
      toast.error(msg);
    }
  };

  const confirmDeleteAgent = async () => {
    if (!deleteAgentId) return;
    try {
      await agentsApi.delete(deleteAgentId);
      setAgents(prev => prev.filter(a => a.agent_id !== deleteAgentId));
      toast.success("Agent deleted");
    } catch {
      toast.error("Failed to delete agent");
    } finally {
      setDeleteAgentId(null);
    }
  };

  const agentMap = new Map(agents.map(a => [a.agent_id, a]));
  const embeddedGraphAgents = graphNodes
    .filter(n => n.type === "agent")
    .map<AgentResponse>(n => agentMap.get(n.id) ?? {
      agent_id: n.id,
      display_name: n.agentName || n.label,
      persona: n.role,
      description: n.lastEvent,
      llm_backbone: n.model,
      llm_config: n.llmBaseUrl ? { base_url: n.llmBaseUrl, model_name: n.model } : undefined,
      tools: n.tools ?? [],
    });
  const graphAgents = embeddedGraphAgents;
  const scopedAgents = agentScope === "graph" ? graphAgents : agents;
  const q = agentQuery.trim().toLowerCase();
  const visibleAgents = q
    ? scopedAgents.filter(a =>
        a.display_name.toLowerCase().includes(q) || a.agent_id.toLowerCase().includes(q))
    : scopedAgents;

  return (
    <div className="w-full h-full border-r border-border flex flex-col bg-sidebar/50">
      <Tabs defaultValue="agents" className="flex flex-col h-full">
        <div className="border-b border-border px-2 pt-2 pb-2 space-y-2">
          <div className="flex items-center gap-1.5">
            <TabsList className="flex-1 grid grid-cols-3 h-8 bg-muted/30 text-[11px]">
              <TabsTrigger value="agents" className="text-[11px] px-1">Agents</TabsTrigger>
              <TabsTrigger value="tools" className="text-[11px] px-1">Tools</TabsTrigger>
              <TabsTrigger value="templates" className="text-[11px] px-1">Tmpl</TabsTrigger>
            </TabsList>
            <button
              type="button"
              onClick={onCollapse}
              title="Hide asset panel"
              className="h-8 w-8 rounded border border-border/50 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors flex items-center justify-center"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <TabsContent value="agents" className="flex-1 overflow-hidden m-0 flex flex-col">
          <div className="p-2 border-b border-border/50 space-y-2">
            <Button size="sm" className="w-full h-7 text-xs bg-blue-600 hover:bg-blue-500 text-white"
              onClick={() => setLocation("/agents")}>
              <Plus className="w-3 h-3 mr-1" /> Manage Agents
            </Button>
            {/* Scope toggle: current graph vs every saved agent. Counts make the
                size of each set obvious so a big global list isn't a surprise. */}
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => setAgentScope("graph")}
                className={`h-6 rounded text-[10px] font-medium transition-colors ${
                  agentScope === "graph"
                    ? "bg-blue-600/15 text-blue-400 border border-blue-600/30"
                    : "text-muted-foreground hover:bg-muted/40 border border-transparent"
                }`}
              >
                This graph ({graphAgents.length})
              </button>
              <button
                onClick={() => setAgentScope("all")}
                className={`h-6 rounded text-[10px] font-medium transition-colors ${
                  agentScope === "all"
                    ? "bg-blue-600/15 text-blue-400 border border-blue-600/30"
                    : "text-muted-foreground hover:bg-muted/40 border border-transparent"
                }`}
              >
                All ({agents.length})
              </button>
            </div>
            <input
              value={agentQuery}
              onChange={(e) => setAgentQuery(e.target.value)}
              placeholder="Filter agents…"
              className="w-full h-7 px-2 text-[11px] rounded bg-muted/30 border border-border/50 focus:outline-none focus:border-blue-600/40 placeholder:text-muted-foreground/50"
            />
          </div>
          <ScrollArea
            // Force the inner Radix viewport wrapper to be a block — by default
            // it's display:table which lets long words / long tool chip rows
            // expand the viewport horizontally and break `truncate`. With
            // display:block child widths follow the panel so ellipsis works.
            className="flex-1 min-h-0 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]]:!w-full"
          >
            <div className="p-2 space-y-1 w-full min-w-0">
              {agents.length === 0 && (
                <div className="text-[10px] text-muted-foreground/50 text-center py-4">
                  No agents yet — create them in the Agents page
                </div>
              )}
              {agents.length > 0 && visibleAgents.length === 0 && (
                <div className="text-[10px] text-muted-foreground/50 text-center py-4">
                  {agentScope === "graph"
                    ? "No agents on this graph yet"
                    : "No agents match your filter"}
                </div>
              )}
              {visibleAgents.map(agent => (
                <AgentCard
                  key={agent.agent_id}
                  agent={agent}
                  onEdit={() => setLocation(`/agents`)}
                  onDelete={() => setDeleteAgentId(agent.agent_id)}
                  canManage={agents.some(a => a.agent_id === agent.agent_id)}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="tools" className="flex-1 overflow-hidden m-0 flex flex-col">
          <div className="p-2 border-b border-border/50">
            <Button size="sm" variant="outline" className="w-full h-7 text-xs border-border/60"
              onClick={() => setLocation("/tools")}>
              <Plus className="w-3 h-3 mr-1" /> Manage Tools
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {tools.length === 0 && (
                <div className="text-[10px] text-muted-foreground/50 text-center py-4">
                  No tools registered
                </div>
              )}
              {tools.map(tool => (
                <div key={tool.name} className="p-2.5 rounded border border-border/40 bg-card/30 hover:bg-card/60 cursor-grab transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    <span className="text-xs font-mono truncate">{tool.name}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">{tool.description}</div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="templates" className="flex-1 overflow-hidden m-0">
          <ScrollArea className="h-full">
            <div className="p-2 space-y-3">
              {/* Graph templates — ready-to-use architecture patterns */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold px-1 mb-1.5">
                  Graph templates ({graphTemplates.length})
                </div>
                <div className="space-y-1">
                  {graphTemplates.length === 0 && (
                    <div className="text-[10px] text-muted-foreground/50 text-center py-3">No graph templates</div>
                  )}
                  {graphTemplates.map(tpl => (
                    <button
                      key={tpl.template_id}
                      onClick={() => handleGraphTemplateClick(tpl.template_id, tpl.name)}
                      className="w-full text-left p-2.5 rounded border border-border/40 bg-card/30 hover:bg-card/60 hover:border-blue-500/30 transition-all group"
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs font-medium truncate flex-1">{tpl.name}</span>
                        <span className="text-[9px] uppercase font-mono tracking-wider text-blue-500/70 group-hover:text-blue-500">
                          {tpl.category}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">{tpl.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Agent templates — single-agent starter blueprints */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold px-1 mb-1.5">
                  Agent templates ({templates.length})
                </div>
                <div className="space-y-1">
                  {templates.length === 0 && (
                    <div className="text-[10px] text-muted-foreground/50 text-center py-3">No agent templates</div>
                  )}
                  {templates.map(tpl => (
                    <button
                      key={tpl.template_id}
                      onClick={() => handleTemplateClick(tpl)}
                      className="w-full text-left p-2.5 rounded border border-border/40 bg-card/30 hover:bg-card/60 hover:border-blue-500/30 transition-all"
                    >
                      <div className="text-xs font-medium truncate">{tpl.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate mt-0.5">{tpl.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Bottom actions */}
      <div className="border-t border-border p-2 space-y-1">
        {[
          { icon: Sparkles, label: "AI Build (LLM)", handler: onAiBuild },
          { icon: AlignLeft, label: "Auto Layout", handler: onAutoLayout },
        ].map(({ icon: Icon, label, handler }) => (
          <button
            key={label}
            onClick={handler}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      <AlertDialog open={deleteAgentId !== null} onOpenChange={o => { if (!o) setDeleteAgentId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete agent <span className="font-mono text-foreground">{deleteAgentId}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-500 text-white" onClick={confirmDeleteAgent}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---- Right Inspector ----
interface EarlyStopRule {
  type: "keyword" | "token_limit" | "agent_count" | "metadata" | "custom" | "combine_any" | "combine_all";
  keyword?: string;
  maxTokens?: number;
  maxAgents?: number;
  metadataKey?: string;
  metadataValue?: string;
  metadataComparator?: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains";
  customPredicate?: "response_contains" | "response_not_contains" | "has_any_error" | "all_steps_success";
  conditions?: EarlyStopRule[];
}

interface TopologyHookRule {
  type:
    | "stop_on_keyword"
    | "skip_on_token_budget"
    | "force_reviewer_on_error"
    | "insert_chain_on_keyword"
    | "add_edge_on_keyword"
    | "remove_edge_on_keyword"
    | "redirect_end_on_keyword"
    | "skip_agent_on_keyword"
    | "condition_skip_agent_on_keyword"
    | "condition_unskip_agent_on_keyword"
    | "trigger_rebuild_on_keyword";
  keyword?: string;
  tokenThreshold?: number;
  reviewerAgentId?: string;
  sourceAgent?: string;
  targetAgent?: string;
  weight?: number;
}

interface InspectorRunConfig {
  enableMemory: boolean;
  enableParallel: boolean;
  broadcastTask: boolean;
  enableDynamicTopology: boolean;
  adaptive: boolean;
  // Graph-level routing strategy. These are the real RoutingPolicy enum values
  // the scheduler supports. (GNN routing is a manual Python-API workflow and is
  // not selectable here.) "adaptive" is a separate boolean flag, not a policy.
  routingPolicy: "topological" | "weighted_topo" | "greedy" | "beam_search" | "k_shortest";
  maxLoopIterations: number;
  maxToolIterations: number;
  maxRetries: number;
  maxParallelSize: number;
  retryDelay: number;
  retryBackoff: number;
  timeout: number;
  memoryContextLimit: number;
  enableHiddenChannels: boolean;
  hiddenCombineStrategy: "mean" | "sum" | "max" | "concat";
  passEmbeddings: boolean;
  updateStates: boolean;
  budgetTotalTokens: number;
  budgetTotalTimeSecs: number;
  errorOnTimeout: "retry" | "prune" | "skip" | "abort";
  errorOnRetryExhausted: "prune" | "skip" | "abort" | "fallback";
  // Pruning (only relevant with adaptive scheduler)
  pruneMinWeight: number;
  pruneMinProbability: number;
  pruneSkipOnPredecessorFailure: boolean;
  // Detailed memory policy
  memoryWorkingMaxEntries: number;
  memoryLongTermMaxEntries: number;
  memoryAutoCompress: boolean;
  memoryPromoteAfterAccesses: number;
  earlyStop: EarlyStopRule[];
  topoHooks: TopologyHookRule[];
  callbackStdout: boolean;
  callbackMetrics: boolean;
  callbackFile: boolean;
}

const DEFAULT_RUN_CONFIG: InspectorRunConfig = {
  enableMemory: false,
  enableParallel: false,
  broadcastTask: true,
  enableDynamicTopology: false,
  adaptive: false,
  routingPolicy: "topological",
  maxLoopIterations: 5,
  maxToolIterations: 3,
  maxRetries: 2,
  maxParallelSize: 5,
  retryDelay: 1,
  retryBackoff: 2,
  timeout: 180,
  memoryContextLimit: 5,
  enableHiddenChannels: false,
  hiddenCombineStrategy: "mean",
  passEmbeddings: true,
  updateStates: true,
  budgetTotalTokens: 0,
  budgetTotalTimeSecs: 0,
  errorOnTimeout: "retry",
  errorOnRetryExhausted: "prune",
  pruneMinWeight: 0.1,
  pruneMinProbability: 0.05,
  pruneSkipOnPredecessorFailure: true,
  memoryWorkingMaxEntries: 20,
  memoryLongTermMaxEntries: 100,
  memoryAutoCompress: true,
  memoryPromoteAfterAccesses: 3,
  earlyStop: [],
  topoHooks: [],
  callbackStdout: true,
  callbackMetrics: false,
  callbackFile: false,
};

function toRunnerConfigPayload(runConfig: InspectorRunConfig, runAdaptive?: boolean): RunnerConfigSchema {
  return {
    execution_mode: "stream",
    enable_token_streaming: true,
    enable_memory: runConfig.enableMemory,
    enable_parallel: runConfig.enableParallel,
    broadcast_task_to_all: runConfig.broadcastTask,
    enable_dynamic_topology: runConfig.enableDynamicTopology,
    adaptive: runAdaptive ?? runConfig.adaptive,
    routing_policy: runConfig.routingPolicy,
    max_loop_iterations: runConfig.maxLoopIterations,
    max_tool_iterations: runConfig.maxToolIterations,
    max_retries: runConfig.maxRetries,
    max_parallel_size: runConfig.maxParallelSize,
    retry_delay: runConfig.retryDelay,
    retry_backoff: runConfig.retryBackoff,
    timeout: runConfig.timeout,
    memory_context_limit: runConfig.memoryContextLimit,
    enable_hidden_channels: runConfig.enableHiddenChannels,
    hidden_combine_strategy: runConfig.hiddenCombineStrategy,
    pass_embeddings: runConfig.passEmbeddings,
    update_states: runConfig.updateStates,
    ...(runConfig.enableMemory ? {
      memory_config: {
        working_max_entries: runConfig.memoryWorkingMaxEntries,
        long_term_max_entries: runConfig.memoryLongTermMaxEntries,
        auto_compress: runConfig.memoryAutoCompress,
        promote_after_accesses: runConfig.memoryPromoteAfterAccesses,
      },
    } : {}),
    ...(runConfig.adaptive ? {
      pruning_config: {
        min_weight_threshold: runConfig.pruneMinWeight,
        min_probability_threshold: runConfig.pruneMinProbability,
        skip_on_predecessor_failure: runConfig.pruneSkipOnPredecessorFailure,
      },
    } : {}),
    ...(runConfig.budgetTotalTokens > 0 || runConfig.budgetTotalTimeSecs > 0 ? {
      budget_config: {
        total_token_limit: runConfig.budgetTotalTokens > 0 ? runConfig.budgetTotalTokens : null,
        total_time_limit_seconds: runConfig.budgetTotalTimeSecs > 0 ? runConfig.budgetTotalTimeSecs : null,
      },
    } : {}),
    error_policy: {
      on_timeout: runConfig.errorOnTimeout,
      on_retry_exhausted: runConfig.errorOnRetryExhausted,
    },
    early_stop_conditions: runConfig.earlyStop.map((rule): Record<string, unknown> => ({
      type: rule.type,
      keyword: rule.keyword,
      max_tokens: rule.maxTokens,
      max_agents: rule.maxAgents,
      metadata_key: rule.metadataKey,
      metadata_value: rule.metadataValue,
      metadata_comparator: rule.metadataComparator,
      custom_predicate: rule.customPredicate,
      conditions: rule.conditions?.map((nested): Record<string, unknown> => ({
        type: nested.type,
        keyword: nested.keyword,
        max_tokens: nested.maxTokens,
        max_agents: nested.maxAgents,
        metadata_key: nested.metadataKey,
        metadata_value: nested.metadataValue,
        metadata_comparator: nested.metadataComparator,
        custom_predicate: nested.customPredicate,
      })) ?? [],
    })),
    callback_modes: [
      ...(runConfig.callbackStdout ? ["stdout"] : []),
      ...(runConfig.callbackMetrics ? ["metrics"] : []),
      ...(runConfig.callbackFile ? ["file"] : []),
    ] as Array<"stdout" | "metrics" | "file">,
    topology_hooks: runConfig.topoHooks.map(h => ({
      type: h.type,
      keyword: h.keyword,
      token_threshold: h.tokenThreshold,
      reviewer_agent_id: h.reviewerAgentId,
      source_agent: h.sourceAgent,
      target_agent: h.targetAgent,
      weight: h.weight,
    })),
  };
}

function RunSettingsPanel({
  onClose,
  nodes,
  edges,
  graphName,
  graphId,
  graphStartNode,
  graphEndNode,
  onSetStartNode,
  onSetEndNode,
  runConfig,
  onRunConfigChange,
  llmProviders,
  llmProviderId,
  onLlmProviderChange,
  llmModel,
  onLlmModelChange,
  registeredTools,
  toolConfig,
  onEnableWebSearchForAgents,
}: {
  onClose: () => void;
  nodes: GraphNode[];
  edges: GraphEdge[];
  graphName: string;
  graphId?: string;
  graphStartNode: string;
  graphEndNode: string;
  onSetStartNode: (id: string) => void;
  onSetEndNode: (id: string) => void;
  runConfig: InspectorRunConfig;
  onRunConfigChange: (cfg: InspectorRunConfig) => void;
  llmProviders: LLMProviderConfig[];
  llmProviderId: string;
  onLlmProviderChange: (providerId: string) => void;
  llmModel: string;
  onLlmModelChange: (model: string) => void;
  registeredTools: ToolInfo[];
  toolConfig: ToolRuntimeConfig | null;
  onEnableWebSearchForAgents: () => Promise<void>;
}) {
  const [, navigate] = useLocation();
  const selectedProvider = llmProviders.find(p => p.provider_id === llmProviderId);
  const effectiveModel = llmModel || selectedProvider?.default_model || "";
  const agentNodes = nodes.filter(n => n.type === "agent");
  const agentsWithTools = agentNodes.filter(n => (n.toolsCount ?? 0) > 0).length;
  const registeredToolNames = new Set(registeredTools.map(t => t.name));
  const enabledTools = new Set(toolConfig?.enabled_tools ?? registeredTools.map(t => t.name));
  const webSearchReady = enabledTools.has("web_search") && registeredToolNames.has("web_search") && (toolConfig?.web_search?.enabled ?? true);
  const hasAgentTools = agentNodes.some(n => (n.toolsCount ?? 0) > 0 || (n.tools?.length ?? 0) > 0);
  const hasLoopEdge = edges.some(e => isEdgeEnabled(e) && e.condition === "loop");
  const hasConditionalEdge = edges.some(e => isEdgeEnabled(e) && e.condition === "conditional");
  const hasJoinBarrier = graphHasConditionalJoinBarrier(edges, nodes);
  const showLoopLimit = runConfig.adaptive || hasLoopEdge;
  const activeLimitControls = [
    showLoopLimit ? { key: "maxLoopIterations", label: "Max Loop Iterations", min: 1, max: 20, desc: "Caps loop/cycle retries so the run cannot repeat forever" } : null,
    hasAgentTools ? { key: "maxToolIterations", label: "Max Tool Iterations",  min: 1, max: 10, desc: "Max tool calls per agent per round" } : null,
    { key: "maxRetries", label: "Max Retries", min: 0, max: 5, desc: "Retry count on agent error" },
    runConfig.enableParallel ? { key: "maxParallelSize", label: "Max Parallel Size", min: 1, max: 20, desc: "Max agents running in parallel" } : null,
    runConfig.enableMemory ? { key: "memoryContextLimit", label: "Memory Context Limit", min: 1, max: 20, desc: "Max prior outputs kept in agent context" } : null,
  ].filter(Boolean) as { key: keyof InspectorRunConfig; label: string; min: number; max: number; desc: string }[];
  const healthItems = [
    { label: "Provider", ok: Boolean(selectedProvider), value: selectedProvider?.display_name || selectedProvider?.provider_id || "missing" },
    { label: "Model", ok: Boolean(effectiveModel), value: effectiveModel || "missing" },
    { label: "Tools", ok: agentsWithTools === 0 || registeredTools.length > 0, value: `${agentsWithTools}/${agentNodes.length} agents · ${registeredTools.length} registered` },
  ];

  const updateEarlyStop = (index: number, patch: Partial<EarlyStopRule>) => {
    const next = [...runConfig.earlyStop];
    next[index] = { ...next[index], ...patch };
    onRunConfigChange({ ...runConfig, earlyStop: next });
  };

  const updateNestedEarlyStop = (parentIndex: number, childIndex: number, patch: Partial<EarlyStopRule>) => {
    const next = [...runConfig.earlyStop];
    const parent = next[parentIndex];
    const conditions = [...(parent.conditions ?? [])];
    conditions[childIndex] = { ...conditions[childIndex], ...patch };
    next[parentIndex] = { ...parent, conditions };
    onRunConfigChange({ ...runConfig, earlyStop: next });
  };

  const removeNestedEarlyStop = (parentIndex: number, childIndex: number) => {
    const next = [...runConfig.earlyStop];
    const parent = next[parentIndex];
    next[parentIndex] = { ...parent, conditions: (parent.conditions ?? []).filter((_, i) => i !== childIndex) };
    onRunConfigChange({ ...runConfig, earlyStop: next });
  };

  const addNestedEarlyStop = (parentIndex: number, type: EarlyStopRule["type"]) => {
    const next = [...runConfig.earlyStop];
    const parent = next[parentIndex];
    const condition: EarlyStopRule = type === "token_limit"
      ? { type, maxTokens: 10000 }
      : type === "agent_count"
        ? { type, maxAgents: 3 }
        : type === "metadata"
          ? { type, metadataComparator: "eq" }
          : type === "custom"
            ? { type, customPredicate: "has_any_error" }
            : { type: "keyword", keyword: "" };
    next[parentIndex] = { ...parent, conditions: [...(parent.conditions ?? []), condition] };
    onRunConfigChange({ ...runConfig, earlyStop: next });
  };

  return (
    <div className="w-full h-full flex flex-col bg-sidebar/50 border-l border-border">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Run Settings</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {hasJoinBarrier && (
        <div className="mx-3 mt-2 mb-1 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2 shrink-0">
          <div className="text-[11px] font-medium text-amber-100/90">Conditional fork → shared join</div>
          <div className="text-[10px] text-muted-foreground/75 mt-1 leading-snug">
            A node with several incoming paths waits for <strong>all</strong> of them. After On success / On failure,
            connect the merge node only from the branch that actually runs — or keep both parallel branches without conditions.
          </div>
        </div>
      )}
      {hasConditionalEdge && (
        <div className="mx-3 mt-2 mb-1 rounded-lg border border-cyan-500/30 bg-cyan-500/[0.08] px-3 py-2 shrink-0">
          <div className="text-[11px] font-medium text-cyan-100/90">Keyword branches on canvas</div>
          <div className="text-[10px] text-muted-foreground/75 mt-1 leading-snug">
            Cyan edges route by keyword in the source agent&apos;s reply (like Langflow If-Else).
            Teach each branching agent to end with one marker — e.g.{" "}
            <span className="font-mono text-foreground/75">approved</span> or{" "}
            <span className="font-mono text-foreground/75">needs_revision</span>.
          </div>
        </div>
      )}
      {hasLoopEdge && (
        <div className="mx-3 mt-2 mb-1 rounded-lg border border-violet-500/30 bg-violet-500/[0.08] px-3 py-2 shrink-0">
          <div className="text-[11px] font-medium text-violet-200/90">Review loops on canvas</div>
          <div className="text-[10px] text-muted-foreground/75 mt-1 leading-snug">
            Purple dashed ↺ edges send work backward (e.g. Reviewer → Writer). Cap retries with{" "}
            <span className="font-mono text-foreground/75">Max Loop Iterations</span> below — currently{" "}
            <span className="font-mono text-violet-200/90">{runConfig.maxLoopIterations}</span>.
          </div>
        </div>
      )}
      <div className="mx-3 mt-2 mb-1 rounded-lg border border-violet-500/25 bg-violet-500/[0.06] px-3 py-2 shrink-0">
        <div className="flex items-start gap-2">
          <CalendarClock className="w-3.5 h-3.5 text-violet-300 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-violet-100/90">Scheduled runs (Background Agents)</div>
            <div className="text-[10px] text-muted-foreground/75 mt-1 leading-snug">
              Re-run this whole workflow on cron, interval, or a one-shot time — not a delay on an edge.
              Save the graph first, then open Schedules.
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] mt-2"
              onClick={() => navigate(graphId ? `/schedules?graph=${graphId}` : "/schedules")}
            >
              Open Schedules
            </Button>
          </div>
        </div>
      </div>
          <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]]:!overflow-x-hidden [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full">
            <div className="p-3 space-y-4 min-w-0 overflow-x-hidden">

              {/* ── Graph Routing (moved from old "graph" tab) ── */}
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Graph Routing</div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs gap-2">
                    <span className="text-muted-foreground shrink-0">Name</span>
                    <span className="font-medium truncate text-right">{graphName || "—"}</span>
                  </div>
                  <div className="flex justify-between text-xs gap-2">
                    <span className="text-muted-foreground shrink-0">Agents / Edges</span>
                    <span className="font-mono">{nodes.filter(n => n.type === "agent").length} / {edges.length}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Start Node</label>
                    <select
                      value={graphStartNode}
                      onChange={e => onSetStartNode(e.target.value)}
                      className="w-full text-xs bg-card border border-border/60 rounded px-2 py-1.5 text-foreground focus:outline-none focus:border-blue-500/50"
                    >
                      <option value="">— not set —</option>
                      {nodes.filter(n => n.type === "agent").map(n => (
                        <option key={n.id} value={n.id}>{n.agentName || n.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">End Node</label>
                    <select
                      value={graphEndNode}
                      onChange={e => onSetEndNode(e.target.value)}
                      className="w-full text-xs bg-card border border-border/60 rounded px-2 py-1.5 text-foreground focus:outline-none focus:border-blue-500/50"
                    >
                      <option value="">— not set —</option>
                      {nodes.filter(n => n.type === "agent").map(n => (
                        <option key={n.id} value={n.id}>{n.agentName || n.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* ── Pre-run health ── */}
              <div className="border-t border-border/40 pt-3 space-y-2">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Pre-run Check</div>
                <div className="rounded-lg border border-border/50 bg-card/25 p-2 space-y-1.5">
                  {healthItems.map(item => (
                    <div key={item.label} className="flex items-center gap-2 text-[11px]">
                      <span className={cn("w-1.5 h-1.5 rounded-full", item.ok ? "bg-green-500" : "bg-amber-500")} />
                      <span className="text-muted-foreground shrink-0">{item.label}</span>
                      <span className={cn("font-mono truncate text-right ml-auto", item.ok ? "text-foreground/80" : "text-amber-500")}>{item.value}</span>
                    </div>
                  ))}
                </div>
                {agentNodes.length > 0 && agentsWithTools === 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full h-7 text-[11px] border-border/60"
                    onClick={() => { void onEnableWebSearchForAgents(); }}
                    disabled={!webSearchReady}
                  >
                    <Wrench className="w-3 h-3 mr-1.5" />
                    Add web_search to all agents
                  </Button>
                )}
                {!webSearchReady && (
                  <div className="text-[10px] text-muted-foreground/60 leading-snug">
                    To onboard tools: enable <span className="font-mono">web_search</span> in Tools, save runtime config, then test it there.
                  </div>
                )}
              </div>

              {/* ── Workflow LLM Provider ── */}
              <div className="border-t border-border/40 pt-3">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">LLM Provider</div>
                <select
                  value={llmProviderId}
                  onChange={e => onLlmProviderChange(e.target.value)}
                  className="w-full h-8 px-2 text-xs rounded border border-border/60 bg-background font-mono"
                >
                  <option value="">— select provider —</option>
                  {llmProviders.map(p => (
                    <option key={p.provider_id} value={p.provider_id}>
                      {p.display_name || p.provider_id}
                      {p.default_model ? ` · ${p.default_model}` : ""}
                    </option>
                  ))}
                </select>
                <div className="text-[10px] text-muted-foreground/60 leading-snug mt-1.5">
                  One provider for the whole workflow — all agents use it at run time.
                  Configure providers in Settings → LLM Providers. Save the graph to keep this choice.
                </div>
                <div className="mt-2 space-y-1">
                  <label className="text-[10px] text-muted-foreground block">Default model</label>
                  <Input
                    value={llmModel}
                    onChange={e => onLlmModelChange(e.target.value)}
                    placeholder={selectedProvider?.default_model || "provider default model"}
                    className="h-7 text-[11px] font-mono px-2"
                  />
                  <div className="text-[10px] text-muted-foreground/50 leading-snug">
                    Agents can still override the model; empty means use provider default.
                  </div>
                </div>
                {llmProviders.length === 0 && (
                  <div className="text-[10px] text-amber-600/90 mt-1">
                    No providers configured yet. Add one in Settings first.
                  </div>
                )}
              </div>

              {/* ── Core Toggles ── */}
              <div className="border-t border-border/40 pt-3">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Execution</div>
                <div className="space-y-2.5">
                  {([
                    { key: "enableMemory",         label: "Task Memory",       desc: "Agents remember the original task query" },
                    { key: "enableParallel",        label: "Parallel Mode",     desc: "Run independent agents simultaneously" },
                    { key: "broadcastTask",         label: "Broadcast Task",    desc: "Send task to all agents, not just first" },
                    { key: "enableDynamicTopology", label: "Dynamic Topology",  desc: "Runtime hooks: add/remove edges, skip agents by keyword" },
                    { key: "adaptive",              label: "Adaptive Scheduler",desc: "Required for edge conditions (success/fail/skip/loop/keyword)" },
                    { key: "enableHiddenChannels",  label: "Hidden Channels",   desc: "Pass embedding state between agents" },
                  ] as { key: keyof InspectorRunConfig; label: string; desc: string }[]).map(({ key, label, desc }) => (
                    <div key={key} className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-foreground/80">{label}</div>
                        <div className="text-[10px] text-muted-foreground/50 leading-tight mt-0.5">{desc}</div>
                      </div>
                      <Switch
                        checked={runConfig[key] as boolean}
                        onCheckedChange={v => onRunConfigChange({ ...runConfig, [key]: v })}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Hidden channels detail ── */}
              {runConfig.enableHiddenChannels && (
                <div className="border-t border-border/40 pt-3 space-y-2">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Hidden Channels</div>
                  <div className="grid grid-cols-2 gap-2 min-w-0">
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground/60">Combine strategy</div>
                      <select
                        value={runConfig.hiddenCombineStrategy}
                        onChange={e => onRunConfigChange({ ...runConfig, hiddenCombineStrategy: e.target.value as InspectorRunConfig["hiddenCombineStrategy"] })}
                        className="w-full h-7 px-2 text-[11px] rounded border border-border/60 bg-background font-mono"
                      >
                        <option value="mean">mean</option>
                        <option value="sum">sum</option>
                        <option value="max">max</option>
                        <option value="concat">concat</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between pt-4">
                      <span className="text-[11px] text-muted-foreground/70">Pass embeddings</span>
                      <Switch
                        checked={runConfig.passEmbeddings}
                        onCheckedChange={v => onRunConfigChange({ ...runConfig, passEmbeddings: v })}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground/70">Update agent states</span>
                    <Switch
                      checked={runConfig.updateStates}
                      onCheckedChange={v => onRunConfigChange({ ...runConfig, updateStates: v })}
                    />
                  </div>
                </div>
              )}

              {/* ── Pruning (only when adaptive) ── */}
              {runConfig.adaptive && (
                <div className="border-t border-border/40 pt-3 space-y-2">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Pruning</div>
                  <div className="grid grid-cols-2 gap-2 min-w-0">
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground/60">Min weight</div>
                      <Input
                        type="number" min={0} max={1} step={0.05}
                        value={runConfig.pruneMinWeight}
                        onChange={e => onRunConfigChange({ ...runConfig, pruneMinWeight: parseFloat(e.target.value) || 0 })}
                        className="h-7 text-xs font-mono px-2"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground/60">Min probability</div>
                      <Input
                        type="number" min={0} max={1} step={0.01}
                        value={runConfig.pruneMinProbability}
                        onChange={e => onRunConfigChange({ ...runConfig, pruneMinProbability: parseFloat(e.target.value) || 0 })}
                        className="h-7 text-xs font-mono px-2"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground/70">Skip on predecessor failure</span>
                    <Switch
                      checked={runConfig.pruneSkipOnPredecessorFailure}
                      onCheckedChange={v => onRunConfigChange({ ...runConfig, pruneSkipOnPredecessorFailure: v })}
                    />
                  </div>
                </div>
              )}

              {/* ── Memory detail (only when memory enabled) ── */}
              {runConfig.enableMemory && (
                <div className="border-t border-border/40 pt-3 space-y-2">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Memory Policy</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground/60">Working max entries</div>
                      <Input
                        type="number" min={1}
                        value={runConfig.memoryWorkingMaxEntries}
                        onChange={e => onRunConfigChange({ ...runConfig, memoryWorkingMaxEntries: parseInt(e.target.value) || 20 })}
                        className="h-7 text-xs font-mono px-2"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground/60">Long-term max entries</div>
                      <Input
                        type="number" min={1}
                        value={runConfig.memoryLongTermMaxEntries}
                        onChange={e => onRunConfigChange({ ...runConfig, memoryLongTermMaxEntries: parseInt(e.target.value) || 100 })}
                        className="h-7 text-xs font-mono px-2"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground/70">Auto-compress</span>
                      <Switch
                        checked={runConfig.memoryAutoCompress}
                        onCheckedChange={v => onRunConfigChange({ ...runConfig, memoryAutoCompress: v })}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground/60">Promote after</div>
                      <Input
                        type="number" min={1}
                        value={runConfig.memoryPromoteAfterAccesses}
                        onChange={e => onRunConfigChange({ ...runConfig, memoryPromoteAfterAccesses: parseInt(e.target.value) || 3 })}
                        className="h-7 text-xs font-mono px-2"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Limits ── */}
              <div className="border-t border-border/40 pt-3 space-y-3">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Limits</div>
                {activeLimitControls.length === 1 && (
                  <div className="text-[10px] text-muted-foreground/50 leading-snug">
                    More limits appear when you enable Parallel Mode, Task Memory, Adaptive Scheduler, loop edges, or tools.
                  </div>
                )}
                {activeLimitControls.map(({ key, label, min, max, desc }) => (
                  <div key={key}>
                    <div className="flex justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground/70">{label}</span>
                      <span className="text-xs font-mono text-foreground/70">{runConfig[key] as number}</span>
                    </div>
                    <Slider value={[runConfig[key] as number]} onValueChange={([v]) => onRunConfigChange({ ...runConfig, [key]: v })} min={min} max={max} step={1} />
                    <div className="text-[10px] text-muted-foreground/40 mt-1">{desc}</div>
                  </div>
                ))}
              </div>

              {/* ── Timing ── */}
              <div className="border-t border-border/40 pt-3">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Timing</div>
                <div className="grid grid-cols-3 gap-2 min-w-0">
                  {([
                    { key: "timeout",     label: "Timeout (s)", placeholder: "180" },
                    { key: "retryDelay",  label: "Retry Delay", placeholder: "1" },
                    { key: "retryBackoff",label: "Backoff Mul", placeholder: "2" },
                  ] as { key: keyof InspectorRunConfig; label: string; placeholder: string }[]).map(({ key, label, placeholder }) => (
                    <div key={key} className="space-y-1">
                      <div className="text-[10px] text-muted-foreground/60">{label}</div>
                      <Input
                        type="number" min={0} step={0.1}
                        value={runConfig[key] as number}
                        onChange={e => onRunConfigChange({ ...runConfig, [key]: parseFloat(e.target.value) || 0 })}
                        placeholder={placeholder}
                        className="h-7 text-xs font-mono px-2"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Budget ── */}
              <div className="border-t border-border/40 pt-3">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Budget (0 = unlimited)</div>
                <div className="grid grid-cols-2 gap-2 min-w-0">
                  <div className="space-y-1">
                    <div className="text-[10px] text-muted-foreground/60">Total Tokens</div>
                    <Input
                      type="number" min={0} step={1000}
                      value={runConfig.budgetTotalTokens}
                      onChange={e => onRunConfigChange({ ...runConfig, budgetTotalTokens: parseInt(e.target.value) || 0 })}
                      placeholder="0"
                      className="h-7 text-xs font-mono px-2"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] text-muted-foreground/60">Time Limit (s)</div>
                    <Input
                      type="number" min={0} step={10}
                      value={runConfig.budgetTotalTimeSecs}
                      onChange={e => onRunConfigChange({ ...runConfig, budgetTotalTimeSecs: parseFloat(e.target.value) || 0 })}
                      placeholder="0"
                      className="h-7 text-xs font-mono px-2"
                    />
                  </div>
                </div>
              </div>

              {/* ── Error Policy ── */}
              <div className="border-t border-border/40 pt-3">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Error Policy</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <div className="text-[10px] text-muted-foreground/60">On Timeout</div>
                    <select
                      value={runConfig.errorOnTimeout}
                      onChange={e => onRunConfigChange({ ...runConfig, errorOnTimeout: e.target.value as InspectorRunConfig["errorOnTimeout"] })}
                      className="w-full h-7 px-1.5 text-[10px] font-mono rounded border border-border/60 bg-background"
                    >
                      <option value="retry">retry</option>
                      <option value="prune">prune</option>
                      <option value="skip">skip</option>
                      <option value="abort">abort</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] text-muted-foreground/60">On Retry Exhausted</div>
                    <select
                      value={runConfig.errorOnRetryExhausted}
                      onChange={e => onRunConfigChange({ ...runConfig, errorOnRetryExhausted: e.target.value as InspectorRunConfig["errorOnRetryExhausted"] })}
                      className="w-full h-7 px-1.5 text-[10px] font-mono rounded border border-border/60 bg-background"
                    >
                      <option value="prune">prune</option>
                      <option value="skip">skip</option>
                      <option value="abort">abort</option>
                      <option value="fallback">fallback</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* ── Early Stop ── */}
              <div className="border-t border-border/40 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Early Stop</div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="text-[10px] text-blue-400 hover:text-blue-300 font-mono transition-colors">+ add</button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onClick={() => onRunConfigChange({ ...runConfig, earlyStop: [...runConfig.earlyStop, { type: "keyword", keyword: "" }] })}>
                        keyword match
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onRunConfigChange({ ...runConfig, earlyStop: [...runConfig.earlyStop, { type: "token_limit", maxTokens: 10000 }] })}>
                        token limit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onRunConfigChange({ ...runConfig, earlyStop: [...runConfig.earlyStop, { type: "agent_count", maxAgents: 3 }] })}>
                        agent count
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onRunConfigChange({ ...runConfig, earlyStop: [...runConfig.earlyStop, { type: "metadata", metadataComparator: "eq" }] })}>
                        metadata rule
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onRunConfigChange({ ...runConfig, earlyStop: [...runConfig.earlyStop, { type: "custom", customPredicate: "has_any_error" }] })}>
                        custom preset
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onRunConfigChange({ ...runConfig, earlyStop: [...runConfig.earlyStop, { type: "combine_any", conditions: [{ type: "keyword", keyword: "" }, { type: "token_limit", maxTokens: 10000 }] }] })}>
                        combine any
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onRunConfigChange({ ...runConfig, earlyStop: [...runConfig.earlyStop, { type: "combine_all", conditions: [{ type: "keyword", keyword: "" }, { type: "agent_count", maxAgents: 3 }] }] })}>
                        combine all
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {runConfig.earlyStop.length === 0 ? (
                  <div className="text-[10px] text-muted-foreground/30 text-center py-2">No stop conditions</div>
                ) : (
                  <div className="space-y-1.5">
                    {runConfig.earlyStop.map((rule, i) => (
                      <div key={i} className={cn(
                        "p-1.5 rounded border border-border/40 bg-card/20",
                        rule.type === "combine_any" || rule.type === "combine_all" ? "space-y-1.5" : "flex items-center gap-1.5"
                      )}>
                        <div className={cn("flex items-center gap-1.5", (rule.type === "combine_any" || rule.type === "combine_all") && "w-full")}>
                          <span className="text-[9px] font-mono text-violet-400/80 shrink-0 w-16 truncate">{rule.type}</span>
                        {rule.type === "keyword" && (
                          <Input
                            value={rule.keyword ?? ""}
                            onChange={e => {
                              updateEarlyStop(i, { keyword: e.target.value });
                            }}
                            placeholder="stop keyword"
                            className="h-5 text-[10px] font-mono flex-1 px-1.5"
                          />
                        )}
                        {rule.type === "token_limit" && (
                          <Input
                            type="number" min={100}
                            value={rule.maxTokens ?? 10000}
                            onChange={e => {
                              updateEarlyStop(i, { maxTokens: parseInt(e.target.value) || 10000 });
                            }}
                            className="h-5 text-[10px] font-mono flex-1 px-1.5"
                          />
                        )}
                        {rule.type === "agent_count" && (
                          <Input
                            type="number" min={1}
                            value={rule.maxAgents ?? 3}
                            onChange={e => {
                              updateEarlyStop(i, { maxAgents: parseInt(e.target.value) || 3 });
                            }}
                            className="h-5 text-[10px] font-mono flex-1 px-1.5"
                          />
                        )}
                        {rule.type === "metadata" && (
                          <div className="grid grid-cols-3 gap-1 flex-1">
                            <Input value={rule.metadataKey ?? ""} onChange={e => updateEarlyStop(i, { metadataKey: e.target.value })} placeholder="key" className="h-5 text-[10px] font-mono px-1.5" />
                            <select value={rule.metadataComparator ?? "eq"} onChange={e => updateEarlyStop(i, { metadataComparator: e.target.value as EarlyStopRule["metadataComparator"] })} className="h-5 rounded border border-border bg-background px-1 text-[10px] font-mono">
                              {["eq", "ne", "gt", "gte", "lt", "lte", "contains"].map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                            <Input value={rule.metadataValue ?? ""} onChange={e => updateEarlyStop(i, { metadataValue: e.target.value })} placeholder="value" className="h-5 text-[10px] font-mono px-1.5" />
                          </div>
                        )}
                        {rule.type === "custom" && (
                          <select value={rule.customPredicate ?? "has_any_error"} onChange={e => updateEarlyStop(i, { customPredicate: e.target.value as EarlyStopRule["customPredicate"] })} className="h-5 flex-1 rounded border border-border bg-background px-1.5 text-[10px] font-mono">
                            <option value="response_contains">response_contains</option>
                            <option value="response_not_contains">response_not_contains</option>
                            <option value="has_any_error">has_any_error</option>
                            <option value="all_steps_success">all_steps_success</option>
                          </select>
                        )}
                        {(rule.type === "combine_any" || rule.type === "combine_all") && (
                          <span className="flex-1 text-[10px] text-muted-foreground/60">{(rule.conditions ?? []).length} nested</span>
                        )}
                        <button
                          onClick={() => onRunConfigChange({ ...runConfig, earlyStop: runConfig.earlyStop.filter((_, j) => j !== i) })}
                          className="text-muted-foreground/40 hover:text-red-400 transition-colors shrink-0"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        </div>
                        {(rule.type === "combine_any" || rule.type === "combine_all") && (
                          <div className="pl-[4.35rem] space-y-1">
                            {(rule.conditions ?? []).map((child, childIndex) => (
                              <div key={childIndex} className="flex items-center gap-1">
                                <select
                                  value={child.type}
                                  onChange={e => updateNestedEarlyStop(i, childIndex, {
                                    type: e.target.value as EarlyStopRule["type"],
                                    keyword: "",
                                    maxTokens: e.target.value === "token_limit" ? 10000 : undefined,
                                    maxAgents: e.target.value === "agent_count" ? 3 : undefined,
                                    metadataComparator: e.target.value === "metadata" ? "eq" : undefined,
                                    customPredicate: e.target.value === "custom" ? "has_any_error" : undefined,
                                  })}
                                  className="h-5 w-24 rounded border border-border bg-background px-1 text-[10px] font-mono"
                                >
                                  <option value="keyword">keyword</option>
                                  <option value="token_limit">token_limit</option>
                                  <option value="agent_count">agent_count</option>
                                  <option value="metadata">metadata</option>
                                  <option value="custom">custom</option>
                                </select>
                                {child.type === "keyword" && (
                                  <Input value={child.keyword ?? ""} onChange={e => updateNestedEarlyStop(i, childIndex, { keyword: e.target.value })} placeholder="keyword" className="h-5 text-[10px] font-mono flex-1 px-1.5" />
                                )}
                                {child.type === "token_limit" && (
                                  <Input type="number" min={100} value={child.maxTokens ?? 10000} onChange={e => updateNestedEarlyStop(i, childIndex, { maxTokens: parseInt(e.target.value) || 10000 })} className="h-5 text-[10px] font-mono flex-1 px-1.5" />
                                )}
                                {child.type === "agent_count" && (
                                  <Input type="number" min={1} value={child.maxAgents ?? 3} onChange={e => updateNestedEarlyStop(i, childIndex, { maxAgents: parseInt(e.target.value) || 3 })} className="h-5 text-[10px] font-mono flex-1 px-1.5" />
                                )}
                                {child.type === "metadata" && (
                                  <div className="grid grid-cols-3 gap-1 flex-1">
                                    <Input value={child.metadataKey ?? ""} onChange={e => updateNestedEarlyStop(i, childIndex, { metadataKey: e.target.value })} placeholder="key" className="h-5 text-[10px] font-mono px-1.5" />
                                    <select value={child.metadataComparator ?? "eq"} onChange={e => updateNestedEarlyStop(i, childIndex, { metadataComparator: e.target.value as EarlyStopRule["metadataComparator"] })} className="h-5 rounded border border-border bg-background px-1 text-[10px] font-mono">
                                      {["eq", "ne", "gt", "gte", "lt", "lte", "contains"].map(v => <option key={v} value={v}>{v}</option>)}
                                    </select>
                                    <Input value={child.metadataValue ?? ""} onChange={e => updateNestedEarlyStop(i, childIndex, { metadataValue: e.target.value })} placeholder="value" className="h-5 text-[10px] font-mono px-1.5" />
                                  </div>
                                )}
                                {child.type === "custom" && (
                                  <select value={child.customPredicate ?? "has_any_error"} onChange={e => updateNestedEarlyStop(i, childIndex, { customPredicate: e.target.value as EarlyStopRule["customPredicate"] })} className="h-5 flex-1 rounded border border-border bg-background px-1.5 text-[10px] font-mono">
                                    <option value="response_contains">response_contains</option>
                                    <option value="response_not_contains">response_not_contains</option>
                                    <option value="has_any_error">has_any_error</option>
                                    <option value="all_steps_success">all_steps_success</option>
                                  </select>
                                )}
                                <button onClick={() => removeNestedEarlyStop(i, childIndex)} className="text-muted-foreground/40 hover:text-red-400 transition-colors shrink-0">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                            <div className="flex items-center gap-1">
                              {(["keyword", "token_limit", "agent_count", "metadata", "custom"] as EarlyStopRule["type"][]).map(type => (
                                <button key={type} onClick={() => addNestedEarlyStop(i, type)} className="text-[9px] text-blue-400/80 hover:text-blue-300 font-mono">
                                  + {type}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Topology Hooks ── */}
              {runConfig.enableDynamicTopology ? (
              <div className="border-t border-border/40 pt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Topology Hooks</div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="text-[10px] text-blue-400 hover:text-blue-300 font-mono transition-colors">+ add</button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      {([
                        ["stop_on_keyword",           "Stop on keyword"],
                        ["skip_on_token_budget",      "Skip on token budget"],
                        ["force_reviewer_on_error",   "Force reviewer on error"],
                        ["insert_chain_on_keyword",   "Insert chain on keyword"],
                        ["add_edge_on_keyword",       "Add edge on keyword"],
                        ["remove_edge_on_keyword",    "Remove edge on keyword"],
                        ["redirect_end_on_keyword",   "Redirect end on keyword"],
                        ["skip_agent_on_keyword",     "Skip agent on keyword"],
                        ["condition_skip_agent_on_keyword",   "Cond-skip agent"],
                        ["condition_unskip_agent_on_keyword", "Cond-unskip agent"],
                        ["trigger_rebuild_on_keyword", "Trigger rebuild"],
                      ] as [TopologyHookRule["type"], string][]).map(([type, label]) => (
                        <DropdownMenuItem key={type} onClick={() => onRunConfigChange({ ...runConfig, topoHooks: [...runConfig.topoHooks, { type }] })}>
                          {label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="text-[10px] text-muted-foreground/60 leading-snug mb-2">
                  Runtime rules that reshape the graph as it runs — skip / force / reroute / insert nodes by keyword or budget.
                  <span className="text-amber-400/80"> Edge conditions use “Adaptive routing”.</span>
                </div>
                {runConfig.topoHooks.length === 0 ? (
                  <div className="text-[10px] text-muted-foreground/30 text-center py-2">No hooks</div>
                ) : (
                  <div className="space-y-2">
                    {runConfig.topoHooks.map((hook, i) => (
                      <div key={i} className="p-2 rounded border border-border/40 bg-card/20 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-mono text-amber-400/80">{hook.type}</span>
                          <button
                            onClick={() => onRunConfigChange({ ...runConfig, topoHooks: runConfig.topoHooks.filter((_, j) => j !== i) })}
                            className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        {hook.type !== "skip_on_token_budget" && hook.type !== "force_reviewer_on_error" && (
                          <Input
                            value={hook.keyword ?? ""}
                            onChange={e => { const n = [...runConfig.topoHooks]; n[i] = { ...hook, keyword: e.target.value }; onRunConfigChange({ ...runConfig, topoHooks: n }); }}
                            placeholder="keyword"
                            className="h-5 text-[10px] font-mono px-1.5"
                          />
                        )}
                        {hook.type === "skip_on_token_budget" && (
                          <Input
                            type="number" min={100}
                            value={hook.tokenThreshold ?? 5000}
                            onChange={e => { const n = [...runConfig.topoHooks]; n[i] = { ...hook, tokenThreshold: parseInt(e.target.value) || 5000 }; onRunConfigChange({ ...runConfig, topoHooks: n }); }}
                            placeholder="token threshold"
                            className="h-5 text-[10px] font-mono px-1.5"
                          />
                        )}
                        {hook.type === "force_reviewer_on_error" && (
                          <Input
                            value={hook.reviewerAgentId ?? ""}
                            onChange={e => { const n = [...runConfig.topoHooks]; n[i] = { ...hook, reviewerAgentId: e.target.value }; onRunConfigChange({ ...runConfig, topoHooks: n }); }}
                            placeholder="reviewer agent id"
                            className="h-5 text-[10px] font-mono px-1.5"
                          />
                        )}
                        {(hook.type === "insert_chain_on_keyword" || hook.type === "add_edge_on_keyword" || hook.type === "remove_edge_on_keyword") && (
                          <div className="grid grid-cols-2 gap-1">
                            <Input value={hook.sourceAgent ?? ""} onChange={e => { const n = [...runConfig.topoHooks]; n[i] = { ...hook, sourceAgent: e.target.value }; onRunConfigChange({ ...runConfig, topoHooks: n }); }} placeholder="source agent" className="h-5 text-[10px] font-mono px-1.5" />
                            <Input value={hook.targetAgent ?? ""} onChange={e => { const n = [...runConfig.topoHooks]; n[i] = { ...hook, targetAgent: e.target.value }; onRunConfigChange({ ...runConfig, topoHooks: n }); }} placeholder="target agent" className="h-5 text-[10px] font-mono px-1.5" />
                          </div>
                        )}
                        {hook.type === "add_edge_on_keyword" && (
                          <Input
                            type="number"
                            step="0.1"
                            min={0}
                            value={hook.weight ?? 1}
                            onChange={e => { const n = [...runConfig.topoHooks]; n[i] = { ...hook, weight: parseFloat(e.target.value) || 1 }; onRunConfigChange({ ...runConfig, topoHooks: n }); }}
                            placeholder="weight"
                            className="h-5 text-[10px] font-mono px-1.5"
                          />
                        )}
                        {(hook.type === "condition_skip_agent_on_keyword" || hook.type === "condition_unskip_agent_on_keyword" || hook.type === "skip_agent_on_keyword") && (
                          <Input value={hook.targetAgent ?? ""} onChange={e => { const n = [...runConfig.topoHooks]; n[i] = { ...hook, targetAgent: e.target.value }; onRunConfigChange({ ...runConfig, topoHooks: n }); }} placeholder="target agent" className="h-5 text-[10px] font-mono px-1.5" />
                        )}
                        {hook.type === "redirect_end_on_keyword" && (
                          <Input value={hook.targetAgent ?? ""} onChange={e => { const n = [...runConfig.topoHooks]; n[i] = { ...hook, targetAgent: e.target.value }; onRunConfigChange({ ...runConfig, topoHooks: n }); }} placeholder="new end agent" className="h-5 text-[10px] font-mono px-1.5" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              ) : (
                <div className="border-t border-border/40 pt-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Topology Hooks</div>
                  <div className="rounded-md border border-border/40 bg-muted/15 px-2 py-2 text-[10px] text-muted-foreground/60 leading-snug">
                    Enable <span className="font-mono text-foreground/70">Dynamic Topology</span> to add runtime rules that skip, force, reroute, or insert agents by keyword.
                  </div>
                </div>
              )}

              {/* ── Callbacks (T14) ── */}
              <div className="border-t border-border/40 pt-3">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Callbacks</div>
                <div className="space-y-2.5">
                  {([
                    { key: "callbackStdout",  label: "Stdout Logger",   desc: "Print events to server stdout" },
                    { key: "callbackMetrics", label: "Metrics Collector",desc: "Track token/latency/success metrics" },
                    { key: "callbackFile",    label: "File Logger",     desc: "Write event log to disk" },
                  ] as { key: keyof InspectorRunConfig; label: string; desc: string }[]).map(({ key, label, desc }) => (
                    <div key={key} className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-foreground/80">{label}</div>
                        <div className="text-[10px] text-muted-foreground/50 leading-tight mt-0.5">{desc}</div>
                      </div>
                      <Switch
                        checked={runConfig[key] as boolean}
                        onCheckedChange={v => onRunConfigChange({ ...runConfig, [key]: v })}
                      />
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </ScrollArea>

    </div>
  );
}


function RightInspector({
  selectedNode,
  selectedEdgeId,
  nodes,
  edges,
  onUpdateEdge,
  onEdgeDelete,
  onOpenRunSettings,
  maxLoopIterations,
  onClose,
  floating,
  onToggleFloating,
  onStartDrag,
  onNodeDelete,
  onUpdateNode,
  registeredTools,
  liveEvents,
  nodeOutputs,
  nodeInputs,
  runTaskQuery,
  lastRunOutput,
}: {
  selectedNode: string | null;
  selectedEdgeId: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onUpdateEdge: (edgeId: string, patch: Partial<GraphEdge>) => void;
  onEdgeDelete: (edgeId: string) => void;
  onOpenRunSettings?: () => void;
  maxLoopIterations?: number;
  onClose: () => void;
  floating: boolean;
  onToggleFloating: () => void;
  onStartDrag: (event: React.PointerEvent) => void;
  onNodeDelete: (nodeId: string) => void;
  onUpdateNode: (nodeId: string, patch: Partial<GraphNode>) => void;
  registeredTools: ToolInfo[];
  liveEvents: LogEvent[];
  nodeOutputs?: Record<string, string>;
  nodeInputs?: Record<string, string>;
  runTaskQuery?: string;
  lastRunOutput?: string;
}) {
  const node = nodes.find(n => n.id === selectedNode);
  const selectedEdge = selectedEdgeId ? edges.find(e => e.id === selectedEdgeId) : null;
  const [agentDetail, setAgentDetail] = useState<AgentResponse | null>(null);

  useEffect(() => {
    if (node?.type !== "agent") { setAgentDetail(null); return; }
    agentsApi.get(node.id).then(setAgentDetail).catch(() => setAgentDetail(null));
  }, [node?.id, node?.type]);

  const startEvents = liveEvents.filter(ev => ev.type === "run_start");
  const finishEvents = liveEvents.filter(ev => ev.type === "run_end");

  return (
    <div className={cn(
      "w-full h-full min-h-0 flex flex-col overflow-hidden bg-sidebar/50",
      floating ? "border border-border/70 rounded-xl shadow-2xl bg-sidebar/90 backdrop-blur-sm" : "border-l border-border"
    )}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0 cursor-grab active:cursor-grabbing touch-none" onPointerDown={onStartDrag}>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Inspector</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px] border-border/60"
            onClick={onToggleFloating}
          >
            {floating ? "Dock" : "Float"}
          </Button>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-border text-[11px] font-medium text-muted-foreground uppercase tracking-wider shrink-0">
        {selectedEdge ? "Connection" : node ? (node.type === "agent" ? "Agent" : node.type === "start" ? "Start" : node.type === "end" ? "Finish" : node.type) : "Selection"}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain">
            {selectedEdge ? (
              <EdgeInspectorPanel
                edge={selectedEdge}
                nodes={nodes}
                edges={edges}
                onUpdateEdge={onUpdateEdge}
                onEdgeDelete={onEdgeDelete}
                onUpdateNode={onUpdateNode}
                onOpenRunSettings={onOpenRunSettings}
                maxLoopIterations={maxLoopIterations}
              />
            ) : node && node.type === "start" ? (
              <div className="p-4 space-y-3 pb-6">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Entry point</div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  Your task starts here and flows to the first connected agent.
                </div>
                <div className="text-[10px] text-muted-foreground/60">
                  {edges.filter(e => e.source === "__start__").length > 0
                    ? `${edges.filter(e => e.source === "__start__").length} agent(s) connected`
                    : "Connect an agent to begin the workflow"}
                </div>
                <div className="pt-2 border-t border-border/40 space-y-2">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Task input</div>
                  {runTaskQuery ? (
                    <div className="rounded border border-cyan-500/25 bg-cyan-500/[0.06] p-2.5 text-[11px] text-foreground/85 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                      {runTaskQuery}
                    </div>
                  ) : (
                    <div className="text-[10px] text-muted-foreground/50">Run the graph to see the task query here.</div>
                  )}
                  {startEvents.slice(-1).map(ev => (
                    <LogEventDetailPanel key={ev.id} event={ev} compact />
                  ))}
                </div>
              </div>
            ) : node && node.type === "end" ? (
              <div className="p-4 space-y-3 pb-6">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Finish</div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  The workflow completes when an agent connects here.
                </div>
                <div className="text-[10px] text-muted-foreground/60">
                  {edges.filter(e => e.target === "__end__").length > 0
                    ? `${edges.filter(e => e.target === "__end__").length} incoming path(s)`
                    : "Connect at least one agent to Finish"}
                </div>
                <div className="pt-2 border-t border-border/40 space-y-2">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Final output</div>
                  {lastRunOutput ? (
                    <div className="rounded border border-emerald-500/25 bg-emerald-500/[0.06] p-2.5 text-[11px] text-foreground/85 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                      {lastRunOutput}
                    </div>
                  ) : (
                    <div className="text-[10px] text-muted-foreground/50">Run the graph to see the final answer here.</div>
                  )}
                  {finishEvents.slice(-1).map(ev => (
                    <LogEventDetailPanel key={ev.id} event={ev} compact />
                  ))}
                </div>
              </div>
            ) : node ? (
              <div className="p-3 space-y-4 pb-6">
                <div>
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Identity</div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs gap-2">
                      <span className="text-muted-foreground shrink-0">ID</span>
                      <span className="font-mono truncate text-right">{node.id}</span>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="agent-name" className="text-[11px] text-muted-foreground">Name</Label>
                      <Input
                        id="agent-name"
                        value={node.agentName || node.label}
                        onChange={e => onUpdateNode(node.id, { agentName: e.target.value, label: e.target.value })}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="flex justify-between text-xs items-center gap-2">
                      <span className="text-muted-foreground shrink-0">Status</span>
                      <span className={statusClass(node.status)}>{node.status}</span>
                    </div>
                    <div className="flex justify-between text-xs gap-2">
                      <span className="text-muted-foreground shrink-0">Type</span>
                      <span className="font-mono">{node.type}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <Label htmlFor="agent-role" className="text-[11px] text-muted-foreground">Role / Persona</Label>
                  <Textarea
                    id="agent-role"
                    value={node.role ?? ""}
                    onChange={e => onUpdateNode(node.id, { role: e.target.value || undefined })}
                    placeholder="Describe how this agent should behave"
                    className="mt-1 min-h-20 text-xs"
                  />
                </div>

                <div>
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">LLM Config</div>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="agent-model" className="text-[11px] text-muted-foreground">Model</Label>
                      <Input
                        id="agent-model"
                        value={node.model ?? ""}
                        onChange={e => onUpdateNode(node.id, { model: e.target.value || undefined })}
                        placeholder="Use workflow default"
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="agent-base-url" className="text-[11px] text-muted-foreground">Base URL</Label>
                      <Input
                        id="agent-base-url"
                        value={node.llmBaseUrl ?? ""}
                        onChange={e => onUpdateNode(node.id, { llmBaseUrl: e.target.value || undefined })}
                        placeholder="Use provider default"
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">Tools</Label>
                      {registeredTools.length === 0 ? (
                        <div className="rounded-md border border-border/40 bg-muted/15 px-2 py-2 text-[10px] text-muted-foreground/60 leading-snug">
                          No tools are registered yet. Add runtime tools on the Tools page first.
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {registeredTools.map(tool => {
                            const selectedTools = node.tools ?? agentDetail?.tools ?? [];
                            const isSelected = selectedTools.includes(tool.name);
                            return (
                              <button
                                key={tool.name}
                                type="button"
                                onClick={() => {
                                  const next = isSelected
                                    ? selectedTools.filter(t => t !== tool.name)
                                    : [...selectedTools, tool.name];
                                  onUpdateNode(node.id, { tools: next, toolsCount: next.length });
                                }}
                                className={cn(
                                  "w-full rounded-md border px-2 py-1.5 text-left transition-colors",
                                  isSelected
                                    ? "border-blue-500/40 bg-blue-500/[0.08]"
                                    : "border-border/40 bg-card/20 hover:bg-accent/30"
                                )}
                              >
                                <div className="flex items-center gap-2">
                                  <span className={cn("h-1.5 w-1.5 rounded-full", isSelected ? "bg-blue-400" : "bg-muted-foreground/40")} />
                                  <span className="font-mono text-[11px] text-foreground/85">{tool.name}</span>
                                  <span className="ml-auto text-[9px] font-mono text-muted-foreground/55">
                                    {isSelected ? "on" : "off"}
                                  </span>
                                </div>
                                {tool.description && (
                                  <div className="mt-0.5 truncate pl-3.5 text-[10px] text-muted-foreground/55">
                                    {tool.description}
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div className="text-[10px] text-muted-foreground/50 leading-snug">
                        Tools are selected per node from registered tools only; no manual names are accepted here.
                      </div>
                    </div>
                    {agentDetail?.llm_config && (
                      <div className="space-y-1.5 pt-1">
                      {agentDetail?.llm_config?.temperature != null && (
                        <div className="flex justify-between text-xs gap-2">
                          <span className="text-muted-foreground shrink-0">Temperature</span>
                          <span className="font-mono">{agentDetail.llm_config.temperature}</span>
                        </div>
                      )}
                      {agentDetail?.llm_config?.top_p != null && (
                        <div className="flex justify-between text-xs gap-2">
                          <span className="text-muted-foreground shrink-0">top_p</span>
                          <span className="font-mono">{agentDetail.llm_config.top_p}</span>
                        </div>
                      )}
                      {agentDetail?.llm_config?.top_k != null && (
                        <div className="flex justify-between text-xs gap-2">
                          <span className="text-muted-foreground shrink-0">top_k</span>
                          <span className="font-mono">{agentDetail.llm_config.top_k}</span>
                        </div>
                      )}
                      {agentDetail?.llm_config?.max_tokens != null && (
                        <div className="flex justify-between text-xs gap-2">
                          <span className="text-muted-foreground shrink-0">Max tokens</span>
                          <span className="font-mono">{agentDetail.llm_config.max_tokens}</span>
                        </div>
                      )}
                      {agentDetail?.llm_config?.timeout != null && (
                        <div className="flex justify-between text-xs gap-2">
                          <span className="text-muted-foreground shrink-0">Timeout</span>
                          <span className="font-mono">{agentDetail.llm_config.timeout}s</span>
                        </div>
                      )}
                      {agentDetail?.llm_config?.tool_choice && (
                        <div className="flex justify-between text-xs gap-2">
                          <span className="text-muted-foreground shrink-0">Tool choice</span>
                          <span className="font-mono">{agentDetail.llm_config.tool_choice}</span>
                        </div>
                      )}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Stats</div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs gap-2">
                      <span className="text-muted-foreground shrink-0">Tokens used</span>
                      <span className="font-mono">{node.tokenCount != null ? node.tokenCount.toLocaleString() : "—"}</span>
                    </div>
                    <div className="flex justify-between text-xs gap-2">
                      <span className="text-muted-foreground shrink-0">Tools</span>
                      <span className="font-mono">{node.toolsCount ?? "—"}</span>
                    </div>
                    <div className="flex justify-between text-xs gap-2">
                      <span className="text-muted-foreground shrink-0">Task Memory</span>
                      <span className={node.memoryEnabled ? "text-green-400 font-mono text-[10px]" : "text-zinc-500 font-mono text-[10px]"}>
                        {node.memoryEnabled ? "on" : "off"}
                      </span>
                    </div>
                  </div>
                </div>

                {node.lastEvent && (
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Last Event</div>
                    <div className="text-[11px] text-muted-foreground bg-muted/20 rounded p-2 font-mono leading-relaxed break-all">{node.lastEvent}</div>
                  </div>
                )}

                {node.type === "agent" && (
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Run activity</div>
                    <InspectorActivitySection
                      node={node}
                      liveEvents={liveEvents}
                      nodeOutputs={nodeOutputs}
                      nodeInputs={nodeInputs}
                      eventClass={eventClass}
                    />
                  </div>
                )}

                {node.type === "agent" && (
                  <div className="flex gap-2 pt-1 border-t border-border/40">
                    <Button size="sm" variant="outline" className="h-7 text-xs border-border/60 text-red-400 hover:text-red-300"
                      onClick={() => { onNodeDelete(node.id); toast.success(`${node.agentName || node.label} removed`); }}>
                      <Trash2 className="w-3 h-3 mr-1.5" />
                      Delete agent
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 pb-6 text-xs text-muted-foreground/60 text-center mt-8">Click a node or connection to inspect it</div>
            )}
      </div>
    </div>
  );
}

// ---- Bottom Console ----
function BottomConsole({ events, collapsed, onToggle, onClear }: {
  events: LogEvent[];
  collapsed: boolean;
  onToggle: () => void;
  onClear: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [paused, setPaused] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filters = [
    { id: "all", label: "All" },
    { id: "agents", label: "Agents" },
    { id: "tools", label: "Tools" },
    { id: "run", label: "Run" },
    { id: "errors", label: "Errors" },
  ];

  const filterMap: Record<string, string[]> = {
    all: [],
    agents: ["agent_start", "agent_output", "agent_error", "agent_end"],
    tools: ["tool_call", "tool_end", "tool_error"],
    run: ["run_start", "run_end", "token_usage"],
    errors: ["error", "tool_error", "agent_error"],
  };

  const visibleEvents = events.filter(e => e.type !== "token");
  const filtered = filter === "all"
    ? visibleEvents
    : visibleEvents.filter(e => filterMap[filter]?.includes(e.type));
  const selected = filtered.find(e => e.id === selectedId) ?? visibleEvents.find(e => e.id === selectedId) ?? null;

  useEffect(() => {
    if (!paused && scrollRef.current && !selectedId) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, paused, selectedId]);

  useEffect(() => {
    if (selectedId && !filtered.some(e => e.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filtered, selectedId]);

  return (
    <div className="border-t border-border bg-sidebar/30 flex flex-col w-full h-full min-h-0">
      <div className="shrink-0 border-b border-border/50">
        <div className="flex items-center gap-2 px-3 h-9 min-w-0">
          <button onClick={onToggle} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
            {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span className="font-mono">Console</span>
          </button>
          {!collapsed && (
            <div className="flex items-center gap-1.5 ml-auto shrink-0">
              <div className={cn("w-1.5 h-1.5 rounded-full", paused ? "bg-amber-500" : "bg-green-500 animate-pulse")} />
              <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">{filtered.length} events</span>
              <button
                onClick={() => setPaused(p => !p)}
                className="flex items-center gap-1 px-2 py-0.5 rounded border border-border/50 text-[11px] text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
              >
                {paused ? <Play className="w-3 h-3" /> : <PauseCircle className="w-3 h-3" />}
                {paused ? "Resume" : "Pause"}
              </button>
              <button
                onClick={() => { onClear(); setSelectedId(null); }}
                className="px-2 py-0.5 rounded border border-border/50 text-[11px] text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
              >
                Clear
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([events.map(e => `${e.timestamp} [${e.type}] ${e.entity}: ${e.message}`).join("\n")], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = "gmas-events.log"; a.click();
                  URL.revokeObjectURL(url);
                }}
                className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded border border-border/50 text-[11px] text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
              >
                <Download className="w-3 h-3" /> Export
              </button>
              <button
                onClick={() => {
                  copyText(JSON.stringify(events, null, 2)).then(ok => ok ? toast.success("Copied JSON") : toast.error("Copy failed"));
                }}
                className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded border border-border/50 text-[11px] text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
              >
                <Copy className="w-3 h-3" /> JSON
              </button>
            </div>
          )}
        </div>
        {!collapsed && (
          <div className="flex items-center gap-1 px-3 pb-2 overflow-x-auto scrollbar-none">
            {filters.map(f => (
              <Chip
                key={f.id}
                onClick={() => setFilter(f.id)}
                active={filter === f.id}
                className="capitalize shrink-0"
              >
                {f.label}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="flex flex-col flex-1 min-h-0">
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-[5.5rem_7rem_7rem_minmax(0,1fr)_1.25rem] gap-2 px-3 py-1 border-b border-border/30 bg-muted/10 sticky top-0 z-[1]">
                <span className="text-[10px] font-mono text-muted-foreground/50">TIME</span>
                <span className="text-[10px] font-mono text-muted-foreground/50">EVENT</span>
                <span className="text-[10px] font-mono text-muted-foreground/50">ENTITY</span>
                <span className="text-[10px] font-mono text-muted-foreground/50">MESSAGE</span>
                <span className="text-[10px] font-mono text-muted-foreground/50 text-right">ST</span>
              </div>
              {filtered.map((ev, i) => (
                <motion.button
                  type="button"
                  key={ev.id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.01 }}
                  onClick={() => setSelectedId(prev => prev === ev.id ? null : ev.id)}
                  className={cn(
                    "w-full grid grid-cols-[5.5rem_7rem_7rem_minmax(0,1fr)_1.25rem] gap-2 px-3 py-1.5 border-b border-border/20 hover:bg-accent/20 transition-colors text-left",
                    ev.status === "error" && "bg-red-500/5",
                    selectedId === ev.id && "bg-accent/30 ring-1 ring-inset ring-blue-500/30",
                  )}
                >
                  <span className="text-[11px] font-mono text-muted-foreground/60 truncate">{ev.timestamp}</span>
                  <span className={cn(eventClass(ev.type), "truncate text-[10px]")}>{ev.type}</span>
                  <span className="text-[11px] font-mono text-muted-foreground truncate">{ev.entity}</span>
                  <span className="text-[11px] text-muted-foreground truncate">{ev.message}</span>
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full mt-1 justify-self-end",
                    ev.status === "ok" ? "bg-green-500" :
                    ev.status === "error" ? "bg-red-500" : "bg-amber-500",
                  )} />
                </motion.button>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground/50">No events yet — run the graph to see logs</div>
              )}
            </div>
          </div>
          {selected && (
            <LogEventDetailPanel
              event={selected}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---- Resize handle ----
function ResizeHandle({ side, onResize }: { side: "left" | "right" | "top"; onResize: (delta: number) => void }) {
  const start = useRef<number | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    start.current = side === "top" ? e.clientY : e.clientX;
    const onMove = (ev: MouseEvent) => {
      if (start.current === null) return;
      const cur = side === "top" ? ev.clientY : ev.clientX;
      const delta = cur - start.current;
      // For left handle the cursor moves left → panel grows right; invert for right side
      const adjusted = side === "right" ? -delta : delta;
      onResize(side === "top" ? -delta : adjusted);
      start.current = cur;
    };
    const onUp = () => {
      start.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = side === "top" ? "ns-resize" : "ew-resize";
    document.body.style.userSelect = "none";
  }, [side, onResize]);

  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        "shrink-0 group z-10 transition-colors",
        side === "top"
          ? "h-1 w-full cursor-ns-resize hover:bg-blue-500/40"
          : "w-1 h-full cursor-ew-resize hover:bg-blue-500/40"
      )}
    />
  );
}

// ---- Keyboard shortcuts hint overlay ----
function ShortcutsHint({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  const items = [
    { keys: ["⌘", "B"], label: "Toggle Assets panel" },
    { keys: ["⌘", "I"], label: "Toggle Inspector panel" },
    { keys: ["⌘", "J"], label: "Toggle Console" },
    { keys: ["⌘", "K"], label: "Command palette" },
    { keys: ["⌘", "Enter"], label: "Run / Stop graph" },
    { keys: ["Esc"], label: "Clear selection" },
    { keys: ["Delete"], label: "Delete selected node or edge" },
    { keys: ["?"], label: "Show this help" },
  ];
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] rounded-lg border border-border bg-card shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-medium">Keyboard shortcuts</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent/60 text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
        </div>
        <div className="px-4 py-3 space-y-2">
          {items.map((s) => (
            <div key={s.label} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{s.label}</span>
              <div className="flex items-center gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-border/60 bg-muted/40 text-foreground min-w-[18px] text-center">{k}</kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

function SdkPreviewPanel({
  format,
  content,
  filename,
  warnings,
  updatedAt,
  loading,
  error,
  onFormatChange,
  onRefresh,
  onCopy,
  onDownload,
  onClose,
}: {
  format: GraphExportFormat;
  content: string;
  filename: string;
  warnings: string[];
  updatedAt: string | null;
  loading: boolean;
  error: string | null;
  onFormatChange: (format: GraphExportFormat) => void;
  onRefresh: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  return (
    <div className="w-full h-full min-h-0 flex flex-col overflow-hidden bg-sidebar/95 border-l border-border shadow-2xl">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Code2 className="w-3.5 h-3.5 text-cyan-300" />
            <span className="text-xs font-semibold uppercase tracking-wider text-foreground">SDK code</span>
          </div>
          <div className="text-[10px] text-muted-foreground truncate mt-0.5">
            Langflow-style API/code access · generated from current canvas
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-border/60 space-y-2 shrink-0">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/25 p-1">
          {(["gmas_python", "gmas_json"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onFormatChange(value)}
              className={cn(
                "rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                format === value ? "bg-cyan-500/15 text-cyan-100 border border-cyan-400/30" : "text-muted-foreground hover:text-foreground hover:bg-accent/40 border border-transparent",
              )}
            >
              {exportFormatLabel(value)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] border-border/60" onClick={onRefresh} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] border-border/60" onClick={onCopy} disabled={!content || loading}>
            <Copy className="w-3.5 h-3.5" /> Copy
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] border-border/60" onClick={onDownload} disabled={!content || loading}>
            <Download className="w-3.5 h-3.5" /> Download
          </Button>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-border/50 bg-cyan-500/[0.035] text-[11px] text-muted-foreground leading-relaxed shrink-0">
        {format === "gmas_python"
          ? "Code-first GraphBuilder SDK, similar to OpenAI/LangGraph style: edit agents and edges directly. Import back parses literal builder calls without executing Python."
          : "Portable canonical GraphSpec JSON. This is the exact UI round-trip artifact used to restore layout and runtime settings."}
      </div>

      {(filename || updatedAt || warnings.length > 0 || error) && (
        <div className="px-3 py-2 border-b border-border/50 space-y-1.5 shrink-0">
          {filename && <div className="text-[10px] font-mono text-muted-foreground truncate">{filename}</div>}
          {updatedAt && <div className="text-[10px] text-muted-foreground/70">Generated at {updatedAt}</div>}
          {warnings.map((warning, idx) => (
            <div key={`${idx}-${warning}`} className="rounded border border-amber-500/30 bg-amber-500/[0.08] px-2 py-1 text-[10.5px] text-amber-100/90">
              {warning}
            </div>
          ))}
          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/[0.08] px-2 py-1 text-[10.5px] text-red-100/90">
              {error}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto bg-black/35">
        {loading && !content ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating {exportFormatLabel(format)}…
          </div>
        ) : content ? (
          <pre className="min-w-max p-3 text-[11px] leading-relaxed font-mono whitespace-pre text-cyan-50/90 tab-size-2">
            <code data-language={exportLanguage(format)}>{content}</code>
          </pre>
        ) : (
          <div className="p-4 text-xs text-muted-foreground leading-relaxed">
            Open the preview or press Refresh to generate code for the current graph.
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Main Workflow Page ----
export default function Workflow() {
  const layoutRef = useRef<HTMLDivElement>(null);

  // Execution state lives in context — survives navigation
  const {
    nodes, setNodes, edges, setEdges,
    isRunning, activeRunId,
    liveEvents, nodeOutputs, nodeInputs, runTaskQuery, lastRunOutput,
    startRun, stopRun, clearRunState, clearLiveEvents, attachRun,
    activeGraphId, setActiveGraphId,
    graphName, setGraphName,
  } = useWorkflowRun();

  // (activeGraphId + graphName now live in WorkflowRunContext so the canvas
  //  survives navigating away from this page and back.)
  const [validationResult, setValidationResult] = useState<GraphValidationResponse | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  // Currently selected edge (for the edge inspector). Mutually exclusive with
  // node selection — selecting one clears the other.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // (execution state is in WorkflowRunContext)

  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [runPanelOpen, setRunPanelOpen] = useState(false);
  const [sdkPreviewOpen, setSdkPreviewOpen] = useState(false);
  const [inspectorFloating, setInspectorFloating] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(true);
  const [consoleCollapsed, setConsoleCollapsed] = useState(true);
  const [showHelp, setShowHelp] = useState(false);

  // Resizable panel sizes
  const [assetsWidth, setAssetsWidth] = useState(224);
  const [inspectorWidth, setInspectorWidth] = useState(368);
  const [runPanelWidth, setRunPanelWidth] = useState(340);
  const [sdkPreviewWidth, setSdkPreviewWidth] = useState(520);
  const [consoleHeight, setConsoleHeight] = useState(280);
  const inspectorDragControls = useDragControls();

  // Dialog state
  const [newGraphOpen, setNewGraphOpen] = useState(false);
  const [newGraphMode, setNewGraphMode] = useState<"scratch" | "template" | "ai" | "import">("scratch");
  const [newGraphTemplates, setNewGraphTemplates] = useState<{ template_id: string; name: string; description: string; category: string }[]>([]);
  const [newGraphSelectedTemplate, setNewGraphSelectedTemplate] = useState<string | null>(null);
  const [newGraphName, setNewGraphName] = useState("");
  const [newGraphDesc, setNewGraphDesc] = useState("");
  const [newGraphImportText, setNewGraphImportText] = useState("");
  const [newGraphImportFileName, setNewGraphImportFileName] = useState("");
  const [newGraphImporting, setNewGraphImporting] = useState(false);
  const [newGraphImportSource, setNewGraphImportSource] = useState<GraphImportSource>("gmas_json");
  const [aiBuildOpen, setAiBuildOpen] = useState(false);
  const [aiBuildPrompt, setAiBuildPrompt] = useState("");
  const [aiBuildMaxAgents, setAiBuildMaxAgents] = useState(6);
  const [aiBuildBuilding, setAiBuildBuilding] = useState(false);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runTask, setRunTask] = useState("");
  const [defaultTaskQuery, setDefaultTaskQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState<GraphExportFormat | null>(null);
  const [sdkPreviewFormat, setSdkPreviewFormat] = useState<GraphExportFormat>("gmas_python");
  const [sdkPreviewContent, setSdkPreviewContent] = useState("");
  const [sdkPreviewFilename, setSdkPreviewFilename] = useState("");
  const [sdkPreviewWarnings, setSdkPreviewWarnings] = useState<string[]>([]);
  const [sdkPreviewUpdatedAt, setSdkPreviewUpdatedAt] = useState<string | null>(null);
  const [sdkPreviewError, setSdkPreviewError] = useState<string | null>(null);
  const [isSdkPreviewLoading, setIsSdkPreviewLoading] = useState(false);
  const [graphStartNode, setGraphStartNode] = useState<string>("");
  const [graphEndNode, setGraphEndNode] = useState<string>("");
  const [runConfig, setRunConfig] = useState<InspectorRunConfig>(DEFAULT_RUN_CONFIG);
  const [llmProviders, setLlmProviders] = useState<LLMProviderConfig[]>([]);
  const [llmProviderId, setLlmProviderId] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [registeredTools, setRegisteredTools] = useState<ToolInfo[]>([]);
  const [toolConfig, setToolConfig] = useState<ToolRuntimeConfig | null>(null);

  useEffect(() => {
    Promise.all([
      configApi.listProviders(),
      toolsApi.list().catch(() => [] as ToolInfo[]),
      toolsApi.getConfig().catch(() => null),
    ])
      .then(([providers, toolInfos, cfg]) => {
        setLlmProviders(providers);
        setRegisteredTools(toolInfos);
        setToolConfig(cfg);
      })
      .catch(() => setLlmProviders([]));
  }, []);

  useEffect(() => {
    if (llmProviderId || llmProviders.length === 0) return;
    setLlmProviderId(llmProviders[0].provider_id);
  }, [llmProviders, llmProviderId]);
  const [allGraphs, setAllGraphs] = useState<{ graph_id: string; name: string }[]>([]);
  // AutoBuild dialog (T11)
  const [autoBuildOpen, setAutoBuildOpen] = useState(false);
  const [autoBuildStrategy, setAutoBuildStrategy] = useState<"embedding_knn" | "chain" | "dense">("embedding_knn");
  const [autoBuildAgentIds, setAutoBuildAgentIds] = useState<string[]>([]);
  const [autoBuildAllAgents, setAutoBuildAllAgents] = useState<AgentResponse[]>([]);
  const [autoBuildBuilding, setAutoBuildBuilding] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const refitCanvasSoon = useCallback(() => {
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("gmas:fit-to-view")), 360);
  }, []);

  // Auto-open inspector when a node or edge is selected; switch to selection-only view.
  useEffect(() => {
    if (!inspectorFloating) {
      setInspectorOpen(selectedNode !== null || selectedEdgeId !== null);
    }
  }, [selectedNode, selectedEdgeId, inspectorFloating]);

  const handleUpdateEdge = useCallback((edgeId: string, patch: Partial<GraphEdge>) => {
    setEdges(prev => {
      const next = prev.map(e => e.id === edgeId ? { ...e, ...patch } : e);
      const updated = next.find(e => e.id === edgeId);
      if (updated && patch.condition && graphEdgesNeedAdaptive([updated]) && !runConfig.adaptive) {
        setRunConfig(cfg => ({ ...cfg, adaptive: true }));
        toast.info("Adaptive routing enabled", { description: "Conditional and loop edges need the adaptive scheduler." });
      }
      if (updated && patch.condition === "conditional") {
        toast.info("Keyword branch", {
          description: "Pick a keyword and add a routing hint to the source agent so it knows what to write.",
        });
      }
      if (updated && patch.condition === "loop") {
        toast.info("Review loop edge", {
          description: "Set keyword label, add routing hint to reviewer, check Max Loop Iterations in Run Settings.",
        });
      }
      return next;
    });
  }, [runConfig.adaptive]);

  const handleDeleteEdge = useCallback((edgeId: string) => {
    setEdges(prev => prev.filter(e => e.id !== edgeId));
    setSelectedEdgeId(prev => (prev === edgeId ? null : prev));
    toast.success("Edge removed");
  }, [setEdges]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node || node.type === "start" || node.type === "end") return;
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(prev => (prev === nodeId ? null : prev));
    setSelectedEdgeId(prev => {
      const edge = edges.find(e => e.id === prev);
      if (edge && (edge.source === nodeId || edge.target === nodeId)) return null;
      return prev;
    });
    toast.success(`${node.agentName || node.label || "Agent"} removed`);
  }, [nodes, edges, setNodes, setEdges]);

  // Persist active graph id across navigation
  const [locationPath] = useLocation();
  const [, routeParams] = useRoute<{ graphId: string }>("/workflow/:graphId");
  const urlSearch = useSearch();
  const setActiveGraphIdAndUrl = useCallback((id: string | null) => {
    setActiveGraphId(id);
    if (id) {
      const url = new URL(window.location.href);
      url.searchParams.set("graph", id);
      window.history.replaceState(null, "", url.toString());
    }
  }, [setActiveGraphId]);

  // Load first available graph from backend on mount, or graph from ?graph=<id>.
  // Skip reload if the context already has the right graph on canvas — that
  // way navigating Runs → Workflow doesn't clobber an in-flight run's
  // node statuses / active edges.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedGraphId = routeParams?.graphId
      || params.get("graph")
      || sessionStorage.getItem("gmas_active_graph");
    const requestedTask = params.get("task");
    if (requestedTask) setRunTask(requestedTask);

    graphsApi.list().then((graphs) => {
      setAllGraphs(graphs.map(g => ({ graph_id: g.graph_id, name: g.name })));
      if (graphs.length === 0) return;
      const target = (requestedGraphId && graphs.find(g => g.graph_id === requestedGraphId)) || graphs[0];
      const first = target;
      // If the canvas already has this graph hydrated (we're returning to
      // Workflow from another page), keep current node statuses / edges —
      // a live run might be painting them right now.
      if (
        activeGraphId === first.graph_id
        && nodes.some((n) => n.type === "agent")
      ) {
        setActiveGraphIdAndUrl(first.graph_id);
        return;
      }
      setGraphName(first.name);
      setActiveGraphIdAndUrl(first.graph_id);
      // Fetch full graph and map to canvas nodes/edges
      graphsApi.get(first.graph_id).then((g) => {
        setLlmProviderId(g.llm_provider_id ?? "");
        setLlmModel(g.llm_model ?? "");
        setDefaultTaskQuery(g.task_query ?? "");
        if (g.run_config) setRunConfig({ ...DEFAULT_RUN_CONFIG, ...(g.run_config as Partial<InspectorRunConfig>) });
        const positions = g.positions ?? {};
        const agents = g.agents ?? [];
        const agentPositions = agents.map((a, i) => ({
          x: positions[a.agent_id]?.x ?? (320 + i * 260),
          y: positions[a.agent_id]?.y ?? (160 + (i % 2) * 160),
        }));
        const { start: startPos, end: endPos } = resolveStartEndPositions(
          agentPositions,
          positions["__start__"],
          positions["__end__"],
        );
        const newNodes: GraphNode[] = [
          { id: "__start__", type: "start", label: "Start",
            x: startPos.x, y: startPos.y, status: "idle" },
          ...agents.map((a, i) => ({
            id: a.agent_id,
            type: "agent" as const,
            label: a.display_name,
            x: agentPositions[i].x,
            y: agentPositions[i].y,
            status: "idle" as NodeStatus,
            agentName: a.display_name,
            role: a.persona,
            description: a.description,
            model: a.llm_backbone ?? a.llm_config?.model_name ?? undefined,
            llmBaseUrl: a.llm_config?.base_url ?? undefined,
            llmConfig: a.llm_config as Record<string, unknown> | undefined,
            inputSchema: a.input_schema,
            outputSchema: a.output_schema,
            tools: a.tools ?? [],
            toolsCount: (a.tools ?? []).length,
            memoryEnabled: false,
          })),
          { id: "__end__", type: "end", label: "Finish", x: endPos.x, y: endPos.y, status: "idle" },
        ];
        const graphEdges: GraphEdge[] = g.edges?.map((e, i) =>
          apiEdgeToGraphEdge(e, `e${i}`),
        ) ?? [];
        const newEdges = addCanvasBoundaryEdges(g, graphEdges);
        setNodes(newNodes);
        setEdges(newEdges);
        setGraphStartNode(g.start_node ?? "");
        setGraphEndNode(g.end_node ?? "");
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  // Re-sync canvas when URL query ?graph= changes (e.g. user creates a new
  // graph from a template — same /workflow page, only query updates).
  useEffect(() => {
    const params = new URLSearchParams(urlSearch);
    const urlGraph = routeParams?.graphId || params.get("graph");
    if (!urlGraph || urlGraph === activeGraphId) return;
    graphsApi.list().then((graphs) => {
      if (!graphs.some((g) => g.graph_id === urlGraph)) return;
      loadGraphRef.current?.(urlGraph);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationPath, urlSearch]);

  // Attach to a specific run when navigating from Runs page (?run=<id>).
  // Runs after the graph is loaded so node IDs exist on canvas.
  // If the WebSocket is already streaming this run (e.g. user just came back
  // from another page), don't re-attach — that would close the live socket
  // and replay everything from scratch.
  useEffect(() => {
    const params = new URLSearchParams(urlSearch);
    const urlRun = params.get("run");
    if (!urlRun) return;
    if (urlRun === activeRunId) return;
    if (!activeGraphId) return;
    if (!nodes.some((n) => n.type === "agent")) return;
    attachRun(urlRun);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearch, activeGraphId, nodes.length, activeRunId]);

  // Sidebar deep-link: /workflow?new=1 opens the "Create graph" dialog
  // and strips the query so reloads/back don't re-open it.
  useEffect(() => {
    const params = new URLSearchParams(urlSearch);
    if (params.get("new") !== "1") return;
    setNewGraphName("");
    setNewGraphDesc("");
    setNewGraphMode("scratch");
    setNewGraphSelectedTemplate(null);
    setNewGraphImportText("");
    setNewGraphImportFileName("");
    setNewGraphImportSource("gmas_json");
    setNewGraphOpen(true);
    // Lazy-load templates if not yet fetched (matches openNewGraph behavior)
    setNewGraphTemplates(prev => {
      if (prev.length === 0) {
        graphsApi.templates()
          .then(list => setNewGraphTemplates(list as { template_id: string; name: string; description: string; category: string }[]))
          .catch(() => {});
      }
      return prev;
    });
    params.delete("new");
    const next = params.toString();
    window.history.replaceState(null, "", `/workflow${next ? `?${next}` : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearch]);

  // Ref so the URL effect above can call loadGraph without re-creating it
  const loadGraphRef = useRef<((id: string) => void) | null>(null);

  const loadGraph = useCallback((graphId: string) => {
    graphsApi.get(graphId).then((g) => {
      setGraphName(g.name);
      const sameGraph = graphId === activeGraphId;
      // If we're switching to a *different* graph, dump any prior run state.
      // If reopening the same graph (e.g. navigating Runs → Workflow), keep the
      // live node statuses / events so the canvas keeps showing the active run.
      if (!sameGraph) {
        clearRunState();
      }
      setActiveGraphIdAndUrl(g.graph_id);
      setSelectedNode(null);
      // Snapshot current run-touched nodes so we can preserve their status/tokens
      // when reloading the same graph during an in-flight execution.
      const priorStatus = new Map<string, { status: NodeStatus; tokenCount?: number }>();
      if (sameGraph) {
        nodes.forEach((n) => {
          if (n.status && n.status !== "idle") {
            priorStatus.set(n.id, { status: n.status, tokenCount: n.tokenCount });
          }
        });
      }
      const priorActiveEdges = new Set<string>();
      if (sameGraph) {
        edges.forEach((e) => {
          if (e.active) priorActiveEdges.add(`${e.source}→${e.target}`);
        });
      }
      const positions = g.positions ?? {};
      const agents2 = g.agents ?? [];
      const agentPositions = agents2.map((a, i) => ({
        x: positions[a.agent_id]?.x ?? (320 + i * 260),
        y: positions[a.agent_id]?.y ?? (160 + (i % 2) * 160),
      }));
      const { start: startPos, end: endPos } = resolveStartEndPositions(
        agentPositions,
        positions["__start__"],
        positions["__end__"],
      );
      const newNodes: GraphNode[] = [
        { id: "__start__", type: "start", label: "Start",
          x: startPos.x, y: startPos.y, status: "idle" },
        ...agents2.map((a, i) => {
          const prev = priorStatus.get(a.agent_id);
          return {
            id: a.agent_id, type: "agent" as const, label: a.display_name,
            x: agentPositions[i].x,
            y: agentPositions[i].y,
            status: (prev?.status ?? "idle") as NodeStatus,
            tokenCount: prev?.tokenCount,
            agentName: a.display_name, role: a.persona,
            description: a.description,
            model: a.llm_backbone ?? a.llm_config?.model_name ?? undefined,
            llmBaseUrl: a.llm_config?.base_url ?? undefined,
            llmConfig: a.llm_config as Record<string, unknown> | undefined,
            inputSchema: a.input_schema,
            outputSchema: a.output_schema,
            tools: a.tools ?? [],
            toolsCount: (a.tools ?? []).length, memoryEnabled: false,
          };
        }),
        { id: "__end__", type: "end", label: "Finish", x: endPos.x, y: endPos.y, status: "idle" },
      ];
      const graphEdges: GraphEdge[] = g.edges?.map((e, i) =>
        apiEdgeToGraphEdge(e, `e${i}`, {
          active: priorActiveEdges.has(`${e.source}→${e.target}`),
        }),
      ) ?? [];
      const newEdges = addCanvasBoundaryEdges(g, graphEdges);
      setNodes(newNodes);
      setEdges(newEdges);
      setGraphStartNode(g.start_node ?? "");
      setGraphEndNode(g.end_node ?? "");
      setLlmProviderId(g.llm_provider_id ?? "");
      setLlmModel(g.llm_model ?? "");
      setDefaultTaskQuery(g.task_query ?? "");
      if (g.run_config) setRunConfig({ ...DEFAULT_RUN_CONFIG, ...(g.run_config as Partial<InspectorRunConfig>) });
    }).catch(() => toast.error("Failed to load graph"));
  }, [setActiveGraphIdAndUrl, clearRunState, activeGraphId, nodes, edges, setNodes, setEdges]);

  // Expose loadGraph through ref so URL effect can call it
  useEffect(() => {
    loadGraphRef.current = loadGraph;
  }, [loadGraph]);

  const handleMoveNode = useCallback((id: string, next: { x: number; y: number }) => {
    setNodes((current) => current.map((node) => (
      node.id === id ? { ...node, x: next.x, y: next.y } : node
    )));
  }, []);

  const handleAddEdge = useCallback((source: string, target: string) => {
    if (source === target) return;
    setEdges((current) => {
      if (current.some(e => e.source === source && e.target === target)) {
        toast.info("Edge already exists");
        return current;
      }
      toast.success("Edge added");
      return [...current, {
        id: `e-${source}-${target}`,
        source,
        target,
        weight: 1,
        enabled: true,
        active: false,
        activationCount: 0,
      }];
    });
  }, []);

  const enableWebSearchForAgents = useCallback(async () => {
    const agentNodes = nodes.filter(n => n.type === "agent");
    if (agentNodes.length === 0) {
      toast.error("No agents in graph");
      return;
    }

    const baseConfig = toolConfig ?? { enabled_tools: registeredTools.map(t => t.name) };
    const enabledTools = new Set(baseConfig.enabled_tools ?? registeredTools.map(t => t.name));
    enabledTools.add("web_search");
    const nextConfig: ToolRuntimeConfig = {
      ...baseConfig,
      enabled_tools: Array.from(enabledTools),
      web_search: { ...baseConfig.web_search, enabled: true } as ToolRuntimeConfig["web_search"],
    };

    try {
      const savedConfig = await toolsApi.updateConfig(nextConfig);
      setToolConfig(savedConfig);

      const allAgents = await agentsApi.list();
      const byId = new Map(allAgents.map(a => [a.agent_id, a]));
      await Promise.all(agentNodes.filter((node) => byId.has(node.id)).map((node) => {
        const existing = byId.get(node.id);
        const tools = Array.from(new Set([...(existing?.tools ?? []), "web_search"]));
        return agentsApi.update(node.id, { tools });
      }));

      setNodes(prev => prev.map(n => {
        if (n.type !== "agent") return n;
        const tools = Array.from(new Set([...(n.tools ?? byId.get(n.id)?.tools ?? []), "web_search"]));
        return { ...n, tools, toolsCount: tools.length };
      }));
      const refreshedTools = await toolsApi.list().catch(() => registeredTools);
      setRegisteredTools(refreshedTools);
      toast.success("web_search added", { description: `${agentNodes.length} agent${agentNodes.length === 1 ? "" : "s"} updated` });
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to configure web_search";
      toast.error(msg);
    }
  }, [nodes, registeredTools, setNodes, toolConfig]);

  const handleStop = useCallback(() => {
    if (activeRunId) {
      executionApi.cancel(activeRunId).catch(() => {});
    }
    stopRun();
    toast.info("Execution stopped");
  }, [activeRunId, stopRun]);

  const openNewGraph = useCallback(() => {
    setNewGraphName("");
    setNewGraphDesc("");
    setNewGraphMode("scratch");
    setNewGraphSelectedTemplate(null);
    setNewGraphImportText("");
    setNewGraphImportFileName("");
    setNewGraphImportSource("gmas_json");
    setNewGraphOpen(true);
    // Lazy-load templates on demand
    if (newGraphTemplates.length === 0) {
      graphsApi.templates()
        .then(list => setNewGraphTemplates(list as { template_id: string; name: string; description: string; category: string }[]))
        .catch(() => {});
    }
  }, [newGraphTemplates.length]);

  const submitNewGraph = useCallback(async () => {
    if (!newGraphName.trim()) { toast.error("Graph name is required"); return; }
    try {
      const newGraph = await graphsApi.create({
        name: newGraphName.trim(),
        description: newGraphDesc || undefined,
        agents: [],
        edges: [],
      });
      setGraphName(newGraph.name);
      setActiveGraphIdAndUrl(newGraph.graph_id);
      setNodes([
        { id: "__start__", type: "start", label: "Start", x: 120, y: 200, status: "idle" },
        { id: "__end__", type: "end", label: "Finish", x: 560, y: 200, status: "idle" },
      ]);
      setDefaultTaskQuery("");
      setEdges([]);
      setSelectedNode(null);
      setNewGraphOpen(false);
      toast.success("Graph created", { description: newGraph.graph_id });
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to create graph";
      toast.error(msg);
    }
  }, [newGraphName, newGraphDesc]);

  const submitImportedGraph = useCallback(async () => {
    if (!newGraphImportText.trim()) {
      toast.error(`Paste ${importPayloadLabel(newGraphImportSource)} or upload a file`);
      return;
    }
    setNewGraphImporting(true);
    try {
      const imported = await graphsApi.importGraph({
        source: newGraphImportSource,
        payload: newGraphImportText,
        name_override: newGraphName.trim() || undefined,
      });
      setNewGraphOpen(false);
      loadGraphRef.current?.(imported.graph.graph_id);
      const warningCount = imported.warnings.length;
      toast.success("Graph imported", {
        description: warningCount
          ? `${imported.import_mode} · ${warningCount} warning${warningCount === 1 ? "" : "s"}`
          : imported.import_mode,
      });
      if (warningCount > 0) {
        toast.info("Import notes", { description: imported.warnings[0] });
      }
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to import graph";
      toast.error(msg);
    } finally {
      setNewGraphImporting(false);
    }
  }, [newGraphImportText, newGraphName, newGraphImportSource]);

  const buildGraphPayload = useCallback(async () => {
    const allAgents = await agentsApi.list();
    const agentMap = new Map(allAgents.map(a => [a.agent_id, a]));
    const canvasAgents = nodes
      .filter(n => n.type === "agent")
      .map(n => {
        const ag = agentMap.get(n.id);
        const tools = n.tools ?? ag?.tools ?? [];
        const llmConfig = {
          ...(ag?.llm_config ?? {}),
          ...(n.llmConfig ?? {}),
          ...(n.model ? { model_name: n.model } : {}),
          ...(n.llmBaseUrl ? { base_url: n.llmBaseUrl } : {}),
        };
        return {
          ...(ag ?? {}),
          agent_id: n.id,
          display_name: n.agentName ?? n.label,
          persona: n.role ?? ag?.persona,
          description: ag?.description ?? n.description,
          llm_backbone: n.model ?? ag?.llm_backbone,
          llm_config: Object.keys(llmConfig).length > 0 ? llmConfig : undefined,
          tools,
          input_schema: ag?.input_schema ?? n.inputSchema,
          output_schema: ag?.output_schema ?? n.outputSchema,
        };
      });
    const positions: Record<string, { x: number; y: number }> = {};
    nodes.forEach(n => { positions[n.id] = { x: n.x, y: n.y }; });
    const agentIds = new Set(canvasAgents.map(a => a.agent_id));
    const startTargets = edges
      .filter(e => e.source === "__start__" && isEdgeEnabled(e) && agentIds.has(e.target))
      .map(e => e.target);
    const startEdge = edges.find(e => e.source === "__start__" && isEdgeEnabled(e) && agentIds.has(e.target));
    const derivedStartNode = graphStartNode || startEdge?.target || startTargets[0] || "";
    const endEdge = edges.find(e => e.target === "__end__" && isEdgeEnabled(e) && agentIds.has(e.source));
    const derivedEndNode = endEdge?.source ?? graphEndNode;
    const edgesPayload = edges
      .filter(e => e.source !== "__start__" && e.target !== "__start__" && e.target !== "__end__" && e.source !== "__end__")
      .map(serializeEdgeForApi);
    return {
      name: graphName || "Untitled workflow",
      agents: canvasAgents,
      edges: edgesPayload,
      positions,
      ...(derivedStartNode ? { start_node: derivedStartNode } : {}),
      ...(derivedEndNode ? { end_node: derivedEndNode } : {}),
      ...(startTargets.length > 0
        ? { task_targets: startTargets }
        : derivedStartNode
          ? { task_targets: [derivedStartNode] }
          : {}),
      ...(llmProviderId ? { llm_provider_id: llmProviderId } : {}),
      ...(llmModel.trim() ? { llm_model: llmModel.trim() } : {}),
      ...(defaultTaskQuery.trim() ? { task_query: defaultTaskQuery.trim() } : {}),
      run_config: runConfig as unknown as Record<string, unknown>,
    };
  }, [graphName, nodes, edges, graphStartNode, graphEndNode, llmProviderId, llmModel, defaultTaskQuery, runConfig]);

  const handleRun = useCallback(async (task?: string) => {
    const taskQuery = task || "Run graph";
    const routingEdges = edges.filter(
      e => e.source !== "__start__" && e.target !== "__start__" && e.target !== "__end__" && e.source !== "__end__",
    );
    const needsAdaptive = graphEdgesNeedAdaptive(routingEdges);
    const runAdaptive = runConfig.adaptive || needsAdaptive;
    if (needsAdaptive && !runConfig.adaptive) {
      setRunConfig(cfg => ({ ...cfg, adaptive: true }));
      toast.info("Adaptive routing enabled", { description: "Edge conditions require the adaptive scheduler." });
    }
    if (!llmProviderId) {
      toast.error("Select an LLM provider", {
        description: "Open Run Settings (gear icon) → LLM Provider, or add one in Settings.",
      });
      return;
    }
    try {
      const graphPayload = await buildGraphPayload();
      const res = await executionApi.run({
        ...(activeGraphId ? { graph_id: activeGraphId } : {}),
        graph: graphPayload,
        task_query: taskQuery,
        llm_provider_id: llmProviderId,
        ...(llmModel.trim() ? { llm_model: llmModel.trim() } : {}),
        config: toRunnerConfigPayload(runConfig, runAdaptive),
      });
      startRun(res.run_id, () =>
        setNodes(prev => prev.map(n => n.type === "agent" ? { ...n, status: "queued" } : n))
      );
      toast.success("Execution started", { description: `Run ${res.run_id}` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to start execution", { description: msg });
    }
  }, [activeGraphId, startRun, runConfig, setNodes, edges, llmProviderId, llmModel, buildGraphPayload, setRunConfig]);

  const handleSaveGraph = useCallback(async () => {
    setIsSaving(true);
    try {
      const body = await buildGraphPayload();
      if (activeGraphId) {
        await graphsApi.update(activeGraphId, body);
        toast.success("Graph saved", { description: graphName });
      } else {
        const created = await graphsApi.create(body);
        setActiveGraphIdAndUrl(created.graph_id);
        toast.success("Graph created", { description: created.graph_id });
      }
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to save graph";
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  }, [activeGraphId, graphName, buildGraphPayload, setActiveGraphIdAndUrl]);

  const handleExportGraph = useCallback(async (format: GraphExportFormat, action: "download" | "copy") => {
    setIsExporting(format);
    try {
      const graph = await buildGraphPayload();
      const exported = await graphsApi.exportGraph({
        graph,
        format,
        filename_hint: graphName,
        source_graph_id: activeGraphId ?? undefined,
      });
      if (action === "download") {
        downloadText(exported.filename, exported.content, exported.mime_type);
        toast.success(format === "gmas_python" ? "Python SDK exported" : "GraphSpec JSON exported", {
          description: exported.filename,
        });
      } else {
        const copied = await copyText(exported.content);
        if (copied) {
          toast.success(format === "gmas_python" ? "Python SDK copied" : "GraphSpec JSON copied");
        } else {
          toast.error("Copy failed");
        }
      }
      if (exported.warnings.length > 0) {
        toast.info("Export notes", { description: exported.warnings[0] });
      }
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to export graph";
      toast.error(msg);
    } finally {
      setIsExporting(null);
    }
  }, [activeGraphId, graphName, buildGraphPayload]);

  const loadSdkPreview = useCallback(async (format: GraphExportFormat = sdkPreviewFormat) => {
    setIsSdkPreviewLoading(true);
    setSdkPreviewError(null);
    try {
      const graph = await buildGraphPayload();
      const exported = await graphsApi.exportGraph({
        graph,
        format,
        filename_hint: graphName,
        source_graph_id: activeGraphId ?? undefined,
      });
      setSdkPreviewFormat(format);
      setSdkPreviewContent(exported.content);
      setSdkPreviewFilename(exported.filename);
      setSdkPreviewWarnings(exported.warnings);
      setSdkPreviewUpdatedAt(new Date().toLocaleTimeString());
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to generate SDK preview";
      setSdkPreviewError(msg);
      setSdkPreviewContent("");
      setSdkPreviewFilename("");
      setSdkPreviewWarnings([]);
      toast.error(msg);
    } finally {
      setIsSdkPreviewLoading(false);
    }
  }, [activeGraphId, graphName, buildGraphPayload, sdkPreviewFormat]);

  const openSdkPreview = useCallback((format: GraphExportFormat = "gmas_python") => {
    setSdkPreviewOpen(true);
    setSdkPreviewFormat(format);
    void loadSdkPreview(format);
  }, [loadSdkPreview]);

  const handleSdkPreviewCopy = useCallback(async () => {
    if (!sdkPreviewContent) return;
    const copied = await copyText(sdkPreviewContent);
    if (copied) {
      toast.success(`${exportFormatLabel(sdkPreviewFormat)} copied`);
    } else {
      toast.error("Copy failed");
    }
  }, [sdkPreviewContent, sdkPreviewFormat]);

  const handleSdkPreviewDownload = useCallback(() => {
    if (!sdkPreviewContent || !sdkPreviewFilename) return;
    downloadText(
      sdkPreviewFilename,
      sdkPreviewContent,
      sdkPreviewFormat === "gmas_python" ? "text/x-python" : "application/json",
    );
  }, [sdkPreviewContent, sdkPreviewFilename, sdkPreviewFormat]);

  const handleAutoLayout = useCallback(() => {
    // Layered topological layout (Sugiyama-lite):
    //   - longest-path layering so every edge goes left→right;
    //   - per-layer ordering biased by upstream-neighbour barycenter to
    //     reduce edge crossings;
    //   - layers vertically centred around 0 so the diagram looks balanced.
    if (nodes.length === 0) return;

    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    nodes.forEach((n) => { incoming.set(n.id, []); outgoing.set(n.id, []); });
    edges.forEach((e) => {
      incoming.get(e.target)?.push(e.source);
      outgoing.get(e.source)?.push(e.target);
    });

    // Longest-path layering: layer = 1 + max(layer of predecessors)
    const layer = new Map<string, number>();
    const computeLayer = (id: string, visiting = new Set<string>()): number => {
      if (layer.has(id)) return layer.get(id)!;
      if (visiting.has(id)) return 0; // cycle guard
      visiting.add(id);
      const preds = incoming.get(id) ?? [];
      const l = preds.length === 0
        ? 0
        : 1 + Math.max(...preds.map((p) => computeLayer(p, visiting)));
      layer.set(id, l);
      visiting.delete(id);
      return l;
    };
    nodes.forEach((n) => computeLayer(n.id));

    // Force __start__ to layer 0 and __end__ to the rightmost layer
    if (nodes.some((n) => n.id === "__start__")) layer.set("__start__", 0);
    if (nodes.some((n) => n.id === "__end__")) {
      const maxAgent = Math.max(
        ...nodes.filter((n) => n.type === "agent").map((n) => layer.get(n.id) ?? 0),
        0,
      );
      layer.set("__end__", maxAgent + 1);
    }

    // Group by layer
    const layers: Record<number, string[]> = {};
    nodes.forEach((n) => {
      const l = layer.get(n.id) ?? 0;
      (layers[l] ??= []).push(n.id);
    });
    const layerKeys = Object.keys(layers).map(Number).sort((a, b) => a - b);

    // Barycenter ordering — for each layer (after the first) sort by mean
    // y-index of predecessors in the previous layer.
    const orderInLayer = new Map<string, number>();
    layerKeys.forEach((l) => {
      const ids = layers[l];
      if (l === layerKeys[0]) {
        ids.forEach((id, i) => orderInLayer.set(id, i));
        return;
      }
      const scored = ids.map((id) => {
        const preds = incoming.get(id) ?? [];
        const predOrders = preds.map((p) => orderInLayer.get(p) ?? 0);
        const bc = predOrders.length ? predOrders.reduce((s, v) => s + v, 0) / predOrders.length : ids.indexOf(id);
        return { id, bc };
      });
      scored.sort((a, b) => a.bc - b.bc);
      scored.forEach((s, i) => orderInLayer.set(s.id, i));
    });

    const COL_W = 430;
    const ROW_H = 210;
    const X0 = 120;
    const Y_CENTER = 420;

    const maxLayerSize = Math.max(...layerKeys.map((l) => layers[l].length));

    const updated = nodes.map((n) => {
      const l = layer.get(n.id) ?? 0;
      const layerIds = layers[l];
      // Re-sort layer ids by computed order
      const ordered = [...layerIds].sort(
        (a, b) => (orderInLayer.get(a) ?? 0) - (orderInLayer.get(b) ?? 0),
      );
      const idxInLayer = ordered.indexOf(n.id);
      const layerSize = ordered.length;
      // Center each column vertically
      const laneSkew = l % 2 === 0 ? 0 : 28;
      const colY = Y_CENTER - ((layerSize - 1) * ROW_H) / 2 + idxInLayer * ROW_H + laneSkew;
      return { ...n, x: X0 + l * COL_W, y: colY };
    });
    setNodes(updated);

    // Ask the canvas to fit the new layout into view (handled inside GraphCanvas).
    window.dispatchEvent(new CustomEvent("gmas:fit-to-view"));

    toast.success("Layout applied", {
      description: `${layerKeys.length} layers · max ${maxLayerSize} per column · auto-fitted`,
    });
  }, [nodes, edges]);

  const openRunDialog = useCallback(() => {
    setRunTask(defaultTaskQuery);
    setRunDialogOpen(true);
  }, [defaultTaskQuery]);

  const submitRun = useCallback(() => {
    if (!runTask.trim()) { toast.error("Task query is required"); return; }
    setDefaultTaskQuery(runTask.trim());
    setRunDialogOpen(false);
    handleRun(runTask.trim());
  }, [runTask, handleRun]);

  const handleValidate = useCallback(async () => {
    setIsValidating(true);
    const warnings: string[] = [];
    const endNode = nodes.find(n => n.id === "__end__");
    if (endNode) {
      const endConnected = edges.some(e => e.target === "__end__" && isEdgeEnabled(e));
      if (!endConnected) warnings.push("Finish is not connected — no agent leads to the end of the workflow");
    }
    const agentNodes = nodes.filter(n => n.type === "agent");
    if (agentNodes.length === 0) warnings.push("Graph has no agent nodes");
    try {
      const body = await buildGraphPayload();
      const result = await graphsApi.validateInline(body);
      const mergedErrors = [...(result.errors ?? []), ...warnings];
      const mergedResult = { ...result, errors: mergedErrors, is_valid: result.is_valid && warnings.length === 0 };
      setValidationResult(mergedResult);
      if (mergedResult.is_valid) {
        toast.success("Graph is valid", {
          description: `${result.execution_order.length || body.agents?.length || 0} agent(s) in order`,
        });
      } else {
        toast.error("Validation failed", { description: mergedErrors.join("; ") });
      }
    } catch {
      toast.error("Validation request failed");
    } finally {
      setIsValidating(false);
    }
  }, [nodes, edges, buildGraphPayload]);

  const handleAutoBuild = useCallback(async () => {
    // Open dialog — fetch all available agents for selection
    agentsApi.list().then(all => {
      setAutoBuildAllAgents(all);
      const canvasIds = nodes.filter(n => n.type === "agent").map(n => n.id);
      setAutoBuildAgentIds(canvasIds.length > 0 ? canvasIds : all.map(a => a.agent_id));
    }).catch(() => {
      setAutoBuildAllAgents([]);
      setAutoBuildAgentIds(nodes.filter(n => n.type === "agent").map(n => n.id));
    });
    setAutoBuildOpen(true);
  }, [nodes]);

  const handleAiBuild = useCallback(() => {
    setAiBuildPrompt("");
    setAiBuildMaxAgents(6);
    setAiBuildOpen(true);
  }, []);

  const submitAiBuild = useCallback(async () => {
    const prompt = aiBuildPrompt.trim();
    if (prompt.length < 5) { toast.error("Describe the task in at least a few words"); return; }
    setAiBuildBuilding(true);
    try {
      const enabledTools = (await toolsApi.list().catch(() => []))
        .map(t => t.name)
        .filter(n => !["code_interpreter", "shell", "mcp", "vector_search", "computer_use"].includes(n));
      const built = await graphsApi.aiBuild({
        task_query: prompt,
        name: `AI-built: ${prompt.slice(0, 40)}`,
        description: `Designed by the LLM for: ${prompt}`,
        max_agents: aiBuildMaxAgents,
        enabled_tools: enabledTools,
      });
      // Persist it so the user gets a real graph_id to run
      const saved = await graphsApi.create(built);
      toast.success("AI built your graph", {
        description: `${built.agents?.length ?? 0} agents, ${built.edges?.length ?? 0} edges`,
      });
      setAiBuildOpen(false);
      setActiveGraphIdAndUrl(saved.graph_id);
      loadGraphRef.current?.(saved.graph_id);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "AI Build failed";
      toast.error(msg);
    } finally {
      setAiBuildBuilding(false);
    }
  }, [aiBuildPrompt, aiBuildMaxAgents, setActiveGraphIdAndUrl]);

  const submitAutoBuild = useCallback(async () => {
    if (autoBuildAgentIds.length < 2) { toast.error("Select at least 2 agents"); return; }
    setAutoBuildBuilding(true);
    try {
      const built = await graphsApi.autoBuild({
        name: graphName,
        task_query: "Multi-agent workflow",
        agent_ids: autoBuildAgentIds,
        strategy: autoBuildStrategy,
      });
      if (built.edges && built.edges.length > 0) {
        const newEdges: GraphEdge[] = built.edges.map((e, i) =>
          apiEdgeToGraphEdge(e, `e-auto-${i}`),
        );
        setEdges(newEdges);
        toast.success("Graph auto-built", { description: `${newEdges.length} edges via ${autoBuildStrategy}` });
        setAutoBuildOpen(false);
      } else {
        toast.info("Auto-build produced no edges");
      }
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Auto-build failed";
      toast.error(msg);
    } finally {
      setAutoBuildBuilding(false);
    }
  }, [autoBuildAgentIds, autoBuildStrategy, graphName, setEdges]);

  const canvasWrapRef = useRef<HTMLDivElement>(null);

  const handleCanvasDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const agentId = e.dataTransfer.getData("application/gmas-agent-id");
    const agentName = e.dataTransfer.getData("application/gmas-agent-name");
    const agentModel = e.dataTransfer.getData("application/gmas-agent-model");
    if (!agentId) return;
    if (nodes.some(n => n.id === agentId)) {
      toast.info(`${agentName} is already on the canvas`);
      return;
    }
    // Find OUR canvas SVG (lucide icons inside left panel are also <svg>),
    // identified by data-graph-canvas="true". Read pan/zoom from data attrs.
    const svgEl = canvasWrapRef.current?.querySelector('svg[data-graph-canvas="true"]') as SVGSVGElement | null;
    const svgRect = svgEl?.getBoundingClientRect() ?? canvasWrapRef.current?.getBoundingClientRect();
    const panX = svgEl ? parseFloat(svgEl.dataset.panX ?? "0") : 0;
    const panY = svgEl ? parseFloat(svgEl.dataset.panY ?? "0") : 0;
    const zoom = svgEl ? parseFloat(svgEl.dataset.zoom ?? "1") : 1;

    const NODE_W = 232;
    const NODE_H = 128;
    const left = svgRect?.left ?? 0;
    const top = svgRect?.top ?? 0;
    // (clientX - svgLeft - pan) / zoom gives canvas-space coord under the cursor.
    // Subtract half node size so the node centers under the cursor.
    const rawX = (e.clientX - left - panX) / zoom - NODE_W / 2;
    const rawY = (e.clientY - top - panY) / zoom - NODE_H / 2;
    const x = Math.round(rawX / 8) * 8;
    const y = Math.round(rawY / 8) * 8;
    const newNode: GraphNode = {
      id: agentId,
      label: agentName,
      type: "agent",
      x: Math.max(20, x),
      y: Math.max(20, y),
      model: agentModel || undefined,
      status: "idle",
    };
    setNodes(prev => [...prev, newNode]);
    setSelectedNode(agentId);
    toast.success(`Added ${agentName} to canvas`);
  }, [nodes, setNodes, setSelectedNode]);

  // Listen for inspector panel run/stop events
  useEffect(() => {
    const onRun = (e: Event) => handleRun((e as CustomEvent).detail?.task);
    const onStop = () => handleStop();
    document.addEventListener("workflow:run", onRun);
    document.addEventListener("workflow:stop", onStop);
    return () => {
      document.removeEventListener("workflow:run", onRun);
      document.removeEventListener("workflow:stop", onStop);
    };
  }, [handleRun, handleStop]);


  const hotkeys = useMemo(() => [
    { key: "n", mod: true, handler: () => {
      setNewGraphName("");
      setNewGraphDesc("");
      setNewGraphMode("scratch");
      setNewGraphOpen(true);
    } },
    { key: "b", mod: true, handler: () => { setAssetsOpen(o => !o); refitCanvasSoon(); } },
    { key: "i", mod: true, handler: () => { setInspectorOpen(o => !o); refitCanvasSoon(); } },
    { key: "j", mod: true, handler: () => { setConsoleCollapsed(c => !c); refitCanvasSoon(); } },
    { key: "Enter", mod: true, handler: () => isRunning ? handleStop() : handleRun() },
    { key: "Escape", handler: () => { setSelectedNode(null); setSelectedEdgeId(null); } },
    { key: "Delete", handler: () => {
      if (selectedEdgeId) handleDeleteEdge(selectedEdgeId);
      else if (selectedNode) handleDeleteNode(selectedNode);
    } },
    { key: "Backspace", handler: () => {
      if (selectedEdgeId) handleDeleteEdge(selectedEdgeId);
      else if (selectedNode) handleDeleteNode(selectedNode);
    } },
    { key: "?", handler: () => setShowHelp(s => !s) },
  ], [isRunning, handleStop, handleRun, selectedEdgeId, selectedNode, handleDeleteEdge, handleDeleteNode]);

  useHotkey(hotkeys);

  const validationBadge = validationResult
    ? validationResult.is_valid
      ? { dot: "bg-green-500", label: "Validated" }
      : { dot: "bg-red-500", label: `${validationResult.errors.length} errors` }
    : { dot: "bg-zinc-500", label: "Not validated" };

  const graphSwitcher = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors group">
          <span>{graphName || "No graph"}</span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 max-h-80 overflow-y-auto">
        <DropdownMenuLabel className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">All Graphs</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {allGraphs.length === 0 && (
          <div className="px-2 py-4 text-xs text-muted-foreground text-center">No graphs yet</div>
        )}
        {allGraphs.map(g => (
          <DropdownMenuItem
            key={g.graph_id}
            onClick={() => loadGraph(g.graph_id)}
            className={cn("flex flex-col items-start gap-0.5 cursor-pointer", g.graph_id === activeGraphId && "bg-accent")}
          >
            <span className="text-sm font-medium truncate w-full">{g.name}</span>
            <span className="text-[10px] font-mono text-muted-foreground/60">{g.graph_id}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <AppShell
      breadcrumb={[
        { label: "Workflow", path: "/workflow" },
      ]}
      breadcrumbExtra={graphSwitcher}
      runStatus={isRunning ? "running" : "idle"}
      actions={
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground bg-muted/40 px-2 py-1 rounded border border-border/40">
            <span className={cn("w-1.5 h-1.5 rounded-full", validationBadge.dot)} />
            {validationBadge.label}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-sm border-border/60"
            onClick={handleSaveGraph}
            disabled={isSaving}
            title="Save graph"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
            Save
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-sm border-border/60"
                disabled={isExporting !== null}
                title="Export graph as GraphSpec JSON or clean Python SDK"
              >
                {isExporting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
                Export
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">
                Native round-trip
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void handleExportGraph("gmas_json", "download")}>
                <Download className="w-3.5 h-3.5 mr-2" /> Download GraphSpec JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleExportGraph("gmas_python", "download")}>
                <Download className="w-3.5 h-3.5 mr-2" /> Download Python SDK
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void handleExportGraph("gmas_json", "copy")}>
                <Copy className="w-3.5 h-3.5 mr-2" /> Copy GraphSpec JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleExportGraph("gmas_python", "copy")}>
                <Copy className="w-3.5 h-3.5 mr-2" /> Copy Python SDK
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => openSdkPreview("gmas_python")}>
                <Code2 className="w-3.5 h-3.5 mr-2" /> Open code preview
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-sm border-border/60"
            onClick={handleValidate}
            disabled={isValidating}
          >
            {isValidating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5 mr-1.5" />}
            Validate
          </Button>
          <Button
            size="sm"
            className={cn("h-8 text-sm", isRunning ? "bg-red-600 hover:bg-red-500" : "bg-green-600 hover:bg-green-500", "text-white")}
            onClick={isRunning ? handleStop : openRunDialog}
            title={isRunning ? "Stop (⌘Enter)" : "Run (⌘Enter)"}
          >
            {isRunning ? <><Square className="w-3.5 h-3.5 mr-1.5" /> Stop</> : <><Play className="w-3.5 h-3.5 mr-1.5" /> Run</>}
          </Button>
          <div className="w-px h-5 bg-border/40 mx-0.5" />
          <button
            onClick={() => { setAssetsOpen(o => !o); refitCanvasSoon(); }}
            title={`${assetsOpen ? "Hide" : "Show"} assets (⌘B)`}
            className={cn(
              "p-1.5 rounded border transition-colors",
              assetsOpen ? "border-border/60 text-foreground bg-accent/30" : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40"
            )}
          >
            {assetsOpen ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => { setConsoleCollapsed(c => !c); refitCanvasSoon(); }}
            title={`${consoleCollapsed ? "Show" : "Hide"} console (⌘J)`}
            className={cn(
              "p-1.5 rounded border transition-colors",
              !consoleCollapsed ? "border-border/60 text-foreground bg-accent/30" : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40"
            )}
          >
            {consoleCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => { sdkPreviewOpen ? setSdkPreviewOpen(false) : openSdkPreview("gmas_python"); refitCanvasSoon(); }}
            title={`${sdkPreviewOpen ? "Hide" : "Show"} SDK code preview`}
            className={cn(
              "p-1.5 rounded border transition-colors",
              sdkPreviewOpen ? "border-cyan-400/50 text-cyan-100 bg-cyan-500/[0.10]" : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40"
            )}
          >
            <Code2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setRunPanelOpen(o => !o); refitCanvasSoon(); }}
            title={`${runPanelOpen ? "Hide" : "Show"} run settings`}
            className={cn(
              "p-1.5 rounded border transition-colors",
              runPanelOpen ? "border-border/60 text-foreground bg-accent/30" : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40"
            )}
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setInspectorOpen(o => !o); refitCanvasSoon(); }}
            title={`${inspectorOpen ? "Hide" : "Show"} inspector (⌘I)`}
            className={cn(
              "p-1.5 rounded border transition-colors",
              inspectorOpen ? "border-border/60 text-foreground bg-accent/30" : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40"
            )}
          >
            {inspectorOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setShowHelp(true)}
            title="Keyboard shortcuts (?)"
            className="p-1.5 rounded border border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>
        </div>
      }
    >
      <div ref={layoutRef} className="relative flex h-full overflow-hidden">
        {/* Left panel */}
        <AnimatePresence initial={false}>
          {assetsOpen && (
            <motion.div
              key="assets"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: assetsWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden shrink-0 flex"
            >
              <div style={{ width: assetsWidth }} className="shrink-0 h-full">
                <LeftPanel
                  onAiBuild={handleAiBuild}
                  onAutoLayout={handleAutoLayout}
                  onCollapse={() => setAssetsOpen(false)}
                  graphNodes={nodes}
                />
              </div>
              <ResizeHandle side="left" onResize={(d) => setAssetsWidth(w => clamp(w + d, 180, 420))} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Center: canvas + console */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div
            ref={canvasWrapRef}
            className="flex-1 overflow-hidden relative"
            onDrop={handleCanvasDrop}
            onDragOver={e => e.preventDefault()}
          >
            {!assetsOpen && (
              <button
                type="button"
                onClick={() => setAssetsOpen(true)}
                className="absolute top-3 left-3 z-30 h-8 px-2.5 rounded-md border border-border/50 bg-card/80 backdrop-blur-sm text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors flex items-center gap-1.5 shadow-sm"
                title="Show asset panel"
              >
                <PanelLeftOpen className="w-3.5 h-3.5" />
                Assets
              </button>
            )}
            <GraphCanvas
              nodes={nodes}
              edges={edges}
              selectedNode={selectedNode}
              selectedEdgeId={selectedEdgeId}
              onSelectNode={(id) => { setSelectedNode(id); if (id) setSelectedEdgeId(null); }}
              onSelectEdge={(id) => { setSelectedEdgeId(id); if (id) setSelectedNode(null); }}
              onMoveNode={handleMoveNode}
              onAddEdge={handleAddEdge}
            />
            {!activeGraphId && nodes.length === 1 && nodes[0].id === "__start__" && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-sm z-40">
                <div className="text-center">
                  <div className="text-sm text-muted-foreground mb-4">No graph loaded</div>
                  <Button
                    size="lg"
                    className="bg-blue-600 hover:bg-blue-500 text-white"
                    onClick={openNewGraph}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Create New Graph
                  </Button>
                </div>
              </div>
            )}
            {activeGraphId && nodes.filter(n => n.type === "agent").length === 0 && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
                <div className="text-xs text-muted-foreground/70 bg-card/70 border border-border/40 rounded-md px-3 py-1.5 backdrop-blur-sm">
                  Drag agents from the left panel onto the canvas
                </div>
              </div>
            )}
          </div>
          <ResizeHandle side="top" onResize={(d) => setConsoleHeight(h => clamp(h + d, 80, 500))} />
          <div style={{ height: consoleCollapsed ? 36 : consoleHeight }} className="shrink-0 transition-[height] duration-200">
            <BottomConsole
              events={liveEvents}
              collapsed={consoleCollapsed}
              onToggle={() => { setConsoleCollapsed(c => !c); refitCanvasSoon(); }}
              onClear={() => clearLiveEvents()}
            />
          </div>
        </div>

        {/* SDK code preview panel */}
        <AnimatePresence initial={false}>
          {sdkPreviewOpen && (
            <motion.div
              key="sdk-preview"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: sdkPreviewWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden shrink-0 flex h-full min-h-0"
            >
              <ResizeHandle side="right" onResize={(d) => setSdkPreviewWidth(w => clamp(w + d, 420, 760))} />
              <div style={{ width: sdkPreviewWidth }} className="shrink-0 h-full min-h-0 flex flex-col">
                <SdkPreviewPanel
                  format={sdkPreviewFormat}
                  content={sdkPreviewContent}
                  filename={sdkPreviewFilename}
                  warnings={sdkPreviewWarnings}
                  updatedAt={sdkPreviewUpdatedAt}
                  loading={isSdkPreviewLoading}
                  error={sdkPreviewError}
                  onFormatChange={(format) => void loadSdkPreview(format)}
                  onRefresh={() => void loadSdkPreview(sdkPreviewFormat)}
                  onCopy={() => void handleSdkPreviewCopy()}
                  onDownload={handleSdkPreviewDownload}
                  onClose={() => setSdkPreviewOpen(false)}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Run settings panel */}
        <AnimatePresence initial={false}>
          {runPanelOpen && (
            <motion.div
              key="run-settings"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: runPanelWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden shrink-0 flex"
            >
              <ResizeHandle side="right" onResize={(d) => setRunPanelWidth(w => clamp(w + d, 300, 520))} />
              <div style={{ width: runPanelWidth }} className="shrink-0 h-full">
                <RunSettingsPanel
                  onClose={() => setRunPanelOpen(false)}
                  nodes={nodes}
                  edges={edges}
                  graphName={graphName}
                  graphId={activeGraphId ?? undefined}
                  graphStartNode={graphStartNode}
                  graphEndNode={graphEndNode}
                  onSetStartNode={setGraphStartNode}
                  onSetEndNode={setGraphEndNode}
                  runConfig={runConfig}
                  onRunConfigChange={setRunConfig}
                  llmProviders={llmProviders}
                  llmProviderId={llmProviderId}
                  onLlmProviderChange={setLlmProviderId}
                  llmModel={llmModel}
                  onLlmModelChange={setLlmModel}
                  registeredTools={registeredTools}
                  toolConfig={toolConfig}
                  onEnableWebSearchForAgents={enableWebSearchForAgents}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Right inspector */}
        <AnimatePresence initial={false}>
          {inspectorOpen && !inspectorFloating && (
            <motion.div
              key="inspector"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: inspectorWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden shrink-0 flex h-full min-h-0"
            >
              <ResizeHandle side="right" onResize={(d) => setInspectorWidth(w => clamp(w + d, 320, 560))} />
              <div style={{ width: inspectorWidth }} className="shrink-0 h-full min-h-0 flex flex-col">
                <RightInspector
                  selectedNode={selectedNode}
                  selectedEdgeId={selectedEdgeId}
                  nodes={nodes}
                  edges={edges}
                  onUpdateEdge={handleUpdateEdge}
                  onEdgeDelete={handleDeleteEdge}
                  onOpenRunSettings={() => setRunPanelOpen(true)}
                  maxLoopIterations={runConfig.maxLoopIterations}
                  floating={false}
                  onToggleFloating={() => setInspectorFloating(true)}
                  onStartDrag={() => {}}
                  onClose={() => setInspectorOpen(false)}
                  onNodeDelete={handleDeleteNode}
                  onUpdateNode={(id, patch) => setNodes(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n))}
                  registeredTools={registeredTools}
                  liveEvents={liveEvents}
                  nodeOutputs={nodeOutputs}
                  nodeInputs={nodeInputs}
                  runTaskQuery={runTaskQuery}
                  lastRunOutput={lastRunOutput}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {inspectorOpen && inspectorFloating && (
            <motion.div
              key="inspector-floating"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
              className="absolute z-30 right-4 top-4"
              style={{ width: inspectorWidth, height: "min(84%, 760px)" }}
              drag
              dragMomentum={false}
              dragElastic={0.05}
              dragListener={false}
              dragControls={inspectorDragControls}
              dragConstraints={layoutRef}
            >
              <RightInspector
                selectedNode={selectedNode}
                selectedEdgeId={selectedEdgeId}
                nodes={nodes}
                edges={edges}
                onUpdateEdge={handleUpdateEdge}
                onEdgeDelete={handleDeleteEdge}
                onOpenRunSettings={() => setRunPanelOpen(true)}
                maxLoopIterations={runConfig.maxLoopIterations}
                floating
                onToggleFloating={() => setInspectorFloating(false)}
                onStartDrag={(event) => inspectorDragControls.start(event)}
                onClose={() => setInspectorOpen(false)}
                onNodeDelete={handleDeleteNode}
                onUpdateNode={(id, patch) => setNodes(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n))}
                registeredTools={registeredTools}
                liveEvents={liveEvents}
                nodeOutputs={nodeOutputs}
                nodeInputs={nodeInputs}
                runTaskQuery={runTaskQuery}
                lastRunOutput={lastRunOutput}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showHelp && <ShortcutsHint open={showHelp} onClose={() => setShowHelp(false)} />}
      </AnimatePresence>

      {/* New Graph dialog */}
      <Dialog open={newGraphOpen} onOpenChange={setNewGraphOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Create a new graph</DialogTitle>
            <DialogDescription>Pick how you want to start.</DialogDescription>
          </DialogHeader>

          {/* Mode picker */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              { id: "scratch",  icon: Plus,      title: "From scratch", desc: "Empty canvas. Add agents and edges manually.", accent: "oklch(0.62 0.19 259)" },
              { id: "template", icon: Layers,    title: "Template",     desc: "Start from a curated graph pattern.",           accent: "oklch(0.66 0.18 305)" },
              { id: "ai",       icon: Sparkles,  title: "AI Build",     desc: "Describe an outcome — generate a graph.",       accent: "oklch(0.78 0.13 80)" },
              { id: "import",   icon: Upload,    title: "Import",       desc: "Bring in gMAS JSON/Python, LangFlow, or Mermaid.", accent: "oklch(0.73 0.12 195)" },
            ].map(({ id, icon: Icon, title, desc, accent }) => {
              const active = newGraphMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setNewGraphMode(id as "scratch" | "template" | "ai" | "import")}
                  className={cn(
                    "group relative text-left rounded-lg p-3.5 border transition-all overflow-hidden",
                    "bg-card",
                    active
                      ? "border-foreground/30 shadow-[0_0_0_1px_oklch(1_0_0/0.04)_inset,0_8px_24px_-12px_oklch(0_0_0/0.4)]"
                      : "border-foreground/10 hover:border-foreground/22",
                  )}
                  style={active ? { borderColor: `color-mix(in oklch, ${accent} 45%, var(--border))` } : undefined}
                >
                  <div
                    className="flex items-center justify-center w-8 h-8 rounded-md mb-2"
                    style={{
                      backgroundColor: `color-mix(in oklch, ${accent} 18%, transparent)`,
                      color: accent,
                    }}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="text-[13px] font-semibold text-foreground">{title}</div>
                  <div className="text-[11px] text-muted-foreground mt-1 leading-snug">{desc}</div>
                </button>
              );
            })}
          </div>

          {/* Mode body */}
          {newGraphMode === "scratch" && (
            <div className="space-y-3 pt-1">
              <div className="space-y-1.5">
                <Label htmlFor="ng-name" className="text-xs">Graph name *</Label>
                <Input id="ng-name" value={newGraphName} onChange={e => setNewGraphName(e.target.value)} placeholder="my-pipeline" className="h-8 text-sm" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ng-desc" className="text-xs">Description</Label>
                <Textarea id="ng-desc" value={newGraphDesc} onChange={e => setNewGraphDesc(e.target.value)} placeholder="What does this graph do?" rows={3} className="text-sm resize-none" />
              </div>
            </div>
          )}

          {newGraphMode === "template" && (
            <div className="space-y-2 pt-1 max-h-[320px] overflow-y-auto pr-1">
              {newGraphTemplates.length === 0 ? (
                <div className="text-[12px] text-muted-foreground/60 text-center py-8">
                  Loading templates…
                </div>
              ) : (
                newGraphTemplates.map(tpl => {
                  const active = newGraphSelectedTemplate === tpl.template_id;
                  return (
                    <button
                      key={tpl.template_id}
                      type="button"
                      onClick={() => setNewGraphSelectedTemplate(tpl.template_id)}
                      className={cn(
                        "w-full text-left rounded-md p-3 border transition-colors bg-card",
                        active
                          ? "border-foreground/30 bg-accent/30"
                          : "border-foreground/10 hover:border-foreground/22 hover:bg-accent/20",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-purple-500/15 text-purple-400 shrink-0 mt-0.5">
                          <Layers className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-semibold text-foreground truncate">{tpl.name}</span>
                            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 px-1.5 py-0.5 rounded bg-muted/40">{tpl.category}</span>
                          </div>
                          <div className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">{tpl.description}</div>
                        </div>
                        {active && <CheckCircle className="w-4 h-4 text-foreground/70 shrink-0 mt-0.5" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {newGraphMode === "ai" && (
            <div className="rounded-md border border-foreground/10 bg-amber-500/[0.04] p-3.5 text-[12.5px] text-foreground/80 leading-relaxed">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-semibold">AI Build</span>
              </div>
              Describe the outcome you want — gMAS will compose agents, tools, and edges into a runnable graph. You'll be able to edit before running.
            </div>
          )}

          {newGraphMode === "import" && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-2">
                {IMPORT_SOURCE_OPTIONS.map(option => {
                  const active = newGraphImportSource === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setNewGraphImportSource(option.value);
                        setNewGraphImportFileName("");
                        setNewGraphImportText("");
                      }}
                      className={cn(
                        "text-left rounded-md border px-3 py-2 transition-colors",
                        active
                          ? "border-cyan-400/50 bg-cyan-500/[0.08]"
                          : "border-border/60 bg-card hover:bg-accent/20",
                      )}
                    >
                      <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                        {option.label}
                        {NATIVE_IMPORT_SOURCES.has(option.value) && (
                          <span className="text-[9px] font-mono uppercase tracking-wider text-cyan-200 bg-cyan-500/15 rounded px-1 py-0.5">
                            exact
                          </span>
                        )}
                      </div>
                      <div className="text-[10.5px] text-muted-foreground mt-0.5">{option.hint}</div>
                    </button>
                  );
                })}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ng-import-name" className="text-xs">Graph name override</Label>
                <Input
                  id="ng-import-name"
                  value={newGraphName}
                  onChange={e => setNewGraphName(e.target.value)}
                  placeholder="Optional. Leave empty to use the exported flow name."
                  className="h-8 text-sm"
                />
              </div>
              <div className="rounded-md border border-foreground/10 bg-cyan-500/[0.05] p-3 text-[12px] text-foreground/80 leading-relaxed">
                {importDescription(newGraphImportSource)}
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={importFileInputRef}
                  type="file"
                  accept={importAccept(newGraphImportSource)}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setNewGraphImportFileName(file.name);
                    void file.text().then((text) => setNewGraphImportText(text)).catch(() => {
                      toast.error("Failed to read file");
                    });
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => importFileInputRef.current?.click()}
                >
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  {importUploadLabel(newGraphImportSource)}
                </Button>
                <span className="text-[11px] text-muted-foreground truncate">
                  {newGraphImportFileName || `Or paste ${importPayloadLabel(newGraphImportSource)} below`}
                </span>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ng-import-payload" className="text-xs">
                  {importPayloadLabel(newGraphImportSource)}
                </Label>
                <Textarea
                  id="ng-import-payload"
                  value={newGraphImportText}
                  onChange={e => setNewGraphImportText(e.target.value)}
                  placeholder={importPlaceholder(newGraphImportSource)}
                  rows={12}
                  className="text-[12px] font-mono resize-none"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNewGraphOpen(false)}>Cancel</Button>
            {newGraphMode === "scratch" && (
              <Button size="sm" onClick={submitNewGraph} className="bg-blue-600 hover:bg-blue-500 text-white">
                Create graph
              </Button>
            )}
            {newGraphMode === "template" && (
              <Button
                size="sm"
                disabled={!newGraphSelectedTemplate}
                onClick={async () => {
                  if (!newGraphSelectedTemplate) return;
                  try {
                    const created = await graphsApi.createFromTemplate(newGraphSelectedTemplate);
                    setNewGraphOpen(false);
                    setGraphName(created.name);
                    setActiveGraphIdAndUrl(created.graph_id);
                    toast.success("Graph created from template", { description: created.name });
                  } catch (err) {
                    toast.error("Failed to create from template", { description: err instanceof Error ? err.message : String(err) });
                  }
                }}
                className="bg-purple-600 hover:bg-purple-500 text-white"
              >
                Use template
              </Button>
            )}
            {newGraphMode === "ai" && (
              <Button
                size="sm"
                onClick={() => {
                  setNewGraphOpen(false);
                  setAiBuildOpen(true);
                }}
                className="bg-amber-500 hover:bg-amber-400 text-black"
              >
                Continue
              </Button>
            )}
            {newGraphMode === "import" && (
              <Button
                size="sm"
                disabled={newGraphImporting || !newGraphImportText.trim()}
                onClick={submitImportedGraph}
                className="bg-cyan-500 hover:bg-cyan-400 text-black"
              >
                {newGraphImporting ? "Importing…" : "Import graph"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run dialog */}
      <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Run Graph</DialogTitle>
            <DialogDescription>Task query for this run. Open Run Settings (gear icon) for provider, limits, and routing options.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Task query */}
            <div className="space-y-1.5">
              <Label htmlFor="run-task" className="text-xs">Task query *</Label>
              <Textarea
                id="run-task"
                value={runTask}
                onChange={e => setRunTask(e.target.value)}
                placeholder="What should the agents do?"
                rows={4}
                className="text-sm resize-none"
                autoFocus
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submitRun();
                  }
                }}
              />
              <div className="text-[10px] text-muted-foreground">
                ⌘+Enter to run · this task becomes the graph default for Save/Export.
              </div>
            </div>

            {/* Mode toggles — most-changed per-run flags */}
            <div>
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Mode</div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { key: "enableParallel",         label: "Parallel",         desc: "Runs parallel-eligible nodes together (≤ max parallel)" },
                  { key: "enableMemory",           label: "Task Memory",      desc: "Per-task memory across agents" },
                  { key: "enableDynamicTopology",  label: "Dynamic topology", desc: "Runtime hooks: add/remove edges, skip agents by keyword" },
                  { key: "adaptive",               label: "Adaptive routing", desc: "Required for edge conditions; weighted routing policies" },
                ] as { key: keyof InspectorRunConfig; label: string; desc: string }[]).map(({ key, label, desc }) => {
                  const active = runConfig[key] as boolean;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setRunConfig({ ...runConfig, [key]: !active })}
                      className={cn(
                        "group text-left rounded-md p-2.5 border transition-colors",
                        active
                          ? "border-blue-500/40 bg-blue-500/[0.06]"
                          : "border-border/60 bg-card hover:border-border hover:bg-accent/20"
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={cn("w-1.5 h-1.5 rounded-full", active ? "bg-blue-400" : "bg-muted-foreground/40")} />
                        <span className={cn("text-[12.5px] font-medium", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
                        <span className="ml-auto text-[10px] font-mono text-muted-foreground/60">{active ? "on" : "off"}</span>
                      </div>
                      <div className="text-[10.5px] text-muted-foreground/70 mt-0.5 leading-snug">{desc}</div>
                    </button>
                  );
                })}
              </div>
              {/* Max parallel — only relevant when Parallel is on. It caps how
                  many parallel-eligible nodes run together, not the whole graph. */}
              {runConfig.enableParallel && (
                <div className="mt-2 flex items-center gap-2 rounded-md border border-blue-500/20 bg-blue-500/[0.04] px-3 py-2">
                  <Label htmlFor="run-max-parallel" className="text-[11px] text-muted-foreground whitespace-nowrap">
                    Max parallel
                  </Label>
                  <Input
                    id="run-max-parallel"
                    type="number"
                    min={1}
                    max={64}
                    step={1}
                    value={runConfig.maxParallelSize}
                    onChange={e => setRunConfig({ ...runConfig, maxParallelSize: Math.min(64, Math.max(1, Number(e.target.value) || 1)) })}
                    className="h-7 w-20 text-sm font-mono"
                  />
                  <span className="text-[10px] text-muted-foreground/70 leading-snug">
                    nodes that are ready at the same time run in batches of this size
                  </span>
                </div>
              )}
            </div>

            {/* Budgets — two inputs side by side */}
            <div>
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Budget</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="run-tokens" className="text-[11px] text-muted-foreground">Token budget</Label>
                  <Input
                    id="run-tokens"
                    type="number"
                    min={0}
                    step={1000}
                    value={runConfig.budgetTotalTokens}
                    onChange={e => setRunConfig({ ...runConfig, budgetTotalTokens: Math.max(0, Number(e.target.value) || 0) })}
                    className="h-8 text-sm font-mono"
                  />
                  <div className="text-[10px] text-muted-foreground/60">{runConfig.budgetTotalTokens.toLocaleString()} max</div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="run-time" className="text-[11px] text-muted-foreground">Time budget (sec)</Label>
                  <Input
                    id="run-time"
                    type="number"
                    min={0}
                    step={10}
                    value={runConfig.budgetTotalTimeSecs}
                    onChange={e => setRunConfig({ ...runConfig, budgetTotalTimeSecs: Math.max(0, Number(e.target.value) || 0) })}
                    className="h-8 text-sm font-mono"
                  />
                  <div className="text-[10px] text-muted-foreground/60">{runConfig.budgetTotalTimeSecs}s max</div>
                </div>
              </div>
            </div>

            {/* Summary line */}
            <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">Summary</span>
              <span className="text-[11px] font-mono text-muted-foreground">
                {runConfig.enableParallel ? `parallel ≤${runConfig.maxParallelSize}` : "sequential"}
              </span>
              <span className="text-border/60">·</span>
              <span className="text-[11px] font-mono text-muted-foreground">
                retries {runConfig.maxRetries}
              </span>
              {runConfig.callbackStdout || runConfig.callbackMetrics || runConfig.callbackFile ? (
                <>
                  <span className="text-border/60">·</span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    callbacks {[runConfig.callbackStdout && "stdout", runConfig.callbackMetrics && "metrics", runConfig.callbackFile && "file"].filter(Boolean).join(",")}
                  </span>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => { setRunDialogOpen(false); setSelectedNode(null); }}
                className="ml-auto text-[11px] text-blue-400 hover:text-blue-300 font-medium"
              >
                Advanced →
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRunDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={submitRun} className="bg-green-600 hover:bg-green-500 text-white">
              <Play className="w-3 h-3 mr-1.5" /> Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AutoBuild Dialog (T11) */}
      <Dialog open={autoBuildOpen} onOpenChange={setAutoBuildOpen}>
        <DialogContent className="sm:max-w-[520px] flex flex-col gap-0 p-0 max-h-[80vh]">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border shrink-0">
            <DialogTitle className="text-base">Auto-Build Graph</DialogTitle>
            <DialogDescription className="text-xs">Select agents and a linking strategy to auto-generate edges.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
            <div className="space-y-1.5">
              <Label className="text-xs">Strategy</Label>
              <select
                value={autoBuildStrategy}
                onChange={e => setAutoBuildStrategy(e.target.value as typeof autoBuildStrategy)}
                className="w-full h-9 px-2 text-sm rounded border border-border bg-background font-mono"
              >
                <option value="embedding_knn">embedding_knn — semantic KNN (recommended)</option>
                <option value="chain">chain — sequential A → B → C</option>
                <option value="dense">dense — fully connected mesh</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Agents ({autoBuildAgentIds.length} selected)</Label>
              <div className="border border-border rounded-md bg-muted/20 divide-y divide-border/40 max-h-56 overflow-y-auto">
                {autoBuildAllAgents.length === 0 ? (
                  <div className="text-xs text-muted-foreground px-3 py-3">No agents found.</div>
                ) : autoBuildAllAgents.map(a => (
                  <label key={a.agent_id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent/30 transition-colors">
                    <input
                      type="checkbox"
                      checked={autoBuildAgentIds.includes(a.agent_id)}
                      onChange={() => setAutoBuildAgentIds(prev =>
                        prev.includes(a.agent_id) ? prev.filter(id => id !== a.agent_id) : [...prev, a.agent_id]
                      )}
                      className="rounded shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{a.display_name}</div>
                      <div className="text-[10px] font-mono text-muted-foreground/60">{a.agent_id}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="px-6 py-4 border-t border-border shrink-0">
            <Button variant="outline" size="sm" onClick={() => setAutoBuildOpen(false)} disabled={autoBuildBuilding}>Cancel</Button>
            <Button size="sm" onClick={submitAutoBuild} disabled={autoBuildBuilding || autoBuildAgentIds.length < 2} className="bg-blue-600 hover:bg-blue-500 text-white">
              {autoBuildBuilding ? "Building…" : "Build Graph"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Build dialog — LLM designs agents AND topology from scratch */}
      <Dialog open={aiBuildOpen} onOpenChange={setAiBuildOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              AI Build — design a graph from natural language
            </DialogTitle>
            <DialogDescription>
              The configured default LLM provider will design the agents, their
              roles, and the topology. You describe the task — the model picks
              the team.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-4 space-y-4">
            <div>
              <label className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5 block">
                Task description
              </label>
              <textarea
                value={aiBuildPrompt}
                onChange={e => setAiBuildPrompt(e.target.value)}
                placeholder="e.g. How to bake a sourdough loaf at home — guide a beginner step by step, check their kitchen tools, and end with troubleshooting tips."
                rows={5}
                className="w-full px-3 py-2 text-sm rounded border border-border/60 bg-background resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                disabled={aiBuildBuilding}
              />
              <div className="text-[10px] text-muted-foreground/60 mt-1">
                Tip: name a goal, the audience, and any branches you want
                (e.g. "skip the substitution step when the user has all ingredients").
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
                Max agents
              </label>
              <input
                type="number"
                min={2}
                max={12}
                value={aiBuildMaxAgents}
                onChange={e => setAiBuildMaxAgents(Math.max(2, Math.min(12, +e.target.value || 6)))}
                className="w-20 px-2 py-1 text-sm rounded border border-border/60 bg-background"
                disabled={aiBuildBuilding}
              />
              <span className="text-[10px] text-muted-foreground/60">Between 2 and 12</span>
            </div>
          </div>
          <DialogFooter className="px-6 py-4 border-t border-border shrink-0">
            <Button variant="outline" size="sm" onClick={() => setAiBuildOpen(false)} disabled={aiBuildBuilding}>Cancel</Button>
            <Button
              size="sm"
              onClick={submitAiBuild}
              disabled={aiBuildBuilding || aiBuildPrompt.trim().length < 5}
              className="bg-violet-600 hover:bg-violet-500 text-white"
            >
              {aiBuildBuilding ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> LLM designing…</>
              ) : (
                <><Sparkles className="w-3.5 h-3.5 mr-1.5" /> Build with AI</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
