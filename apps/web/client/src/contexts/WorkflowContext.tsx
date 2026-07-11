/**
 * WorkflowContext — execution state that survives navigation.
 *
 * Lives at App level so switching pages never destroys the WebSocket or node statuses.
 * Workflow.tsx reads from this context instead of keeping local state.
 */

import { createContext, useContext, useRef, useState, useCallback, useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { executionApi, createExecutionSocket, type RunEvent } from "@/lib/api";
import { buildEventDetails } from "@/components/workflow/LogEventViews";
import { type GraphNode, type GraphEdge, type LogEvent, type NodeStatus } from "@/lib/mock-data";

// ── helpers ──────────────────────────────────────────────────────────────────

function evToRecord(ev: RunEvent): Record<string, unknown> {
  return ev as unknown as Record<string, unknown>;
}

function eventType(ev: RunEvent): string {
  return String(ev.event_type ?? "").toLowerCase();
}

function boolField(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function shouldLogEvent(ev: RunEvent): boolean {
  if (eventType(ev) !== "token") return true;
  // Keep token stream in node output, not in the human-readable event log.
  // agent_output/run_end already mark completion.
  return false;
}

function runEventToLog(ev: RunEvent, idx: number): LogEvent {
  const d = (ev.data as Record<string, unknown> | null) ?? {};
  const r = evToRecord(ev);
  const type = eventType(ev);
  const details = buildEventDetails(type, r, d);
  const content = r.content as string | undefined ?? d.content as string | undefined;
  const token = r.token as string | undefined ?? d.token as string | undefined;
  const isFirstToken = boolField(r.is_first ?? d.is_first);
  const isLastToken = boolField(r.is_last ?? d.is_last);
  const toolName = r.tool_name as string | undefined ?? d.tool_name as string | undefined;
  const tokens = r.tokens_used as number | undefined ?? d.tokens_used as number | undefined;
  const durationMs = r.duration_ms as number | undefined ?? d.duration_ms as number | undefined;
  const agentEntity = ev.agent_id ?? (r.agent_name as string | undefined);

  let message = ev.message ?? "";
  let entity = agentEntity ?? toolName ?? "runtime";
  if (!message) {
    if (type === "run_start") {
      message = details.query ? `Task: ${details.query}` : "Run started";
      entity = "Start";
    } else if (type === "run_end") {
      message = details.output
        ? (details.output.length > 120 ? `${details.output.slice(0, 120)}…` : details.output)
        : "Run finished";
      entity = "Finish";
    } else if (type === "token") {
      message = isLastToken ? "token stream complete" : isFirstToken ? "token stream started" : token ?? "";
    } else if (type === "agent_start") {
      message = details.input
        ? (details.input.length > 120 ? `${details.input.slice(0, 120)}…` : details.input)
        : `Agent ${agentEntity ?? "started"}`;
    } else if (type === "agent_output" && content) {
      message = content.length > 120 ? `${content.slice(0, 120)}…` : content;
    } else if (content) {
      message = content.length > 120 ? `${content.slice(0, 120)}…` : content;
    } else if (toolName) {
      const argsPreview = d.args ? JSON.stringify(d.args).slice(0, 80) : "";
      message = toolName + (durationMs ? ` (${Math.round(durationMs)}ms)` : "") + (argsPreview ? ` · ${argsPreview}` : "");
    } else if (tokens) {
      message = `${tokens} tokens`;
    } else if (type === "agent_error") {
      message = details.error || "Agent error";
    } else if (type === "tool_error") {
      message = details.error || `${toolName ?? "tool"} failed`;
    } else if (Object.keys(d).length) {
      message = JSON.stringify(d).slice(0, 120);
    }
  }

  return {
    id: `ev-${idx}-${Date.now()}`,
    timestamp: ev.timestamp ? new Date(ev.timestamp).toISOString().slice(11, 23) : new Date().toISOString().slice(11, 23),
    type: (type as LogEvent["type"]) ?? "system",
    entity,
    message,
    agentId: ev.agent_id,
    details,
    status: type === "error" || type === "tool_error" || type === "agent_error" ? "error" : "ok",
  };
}

function projectRunEvents(events: RunEvent[], runStatus?: string) {
  const logs: LogEvent[] = [];
  const outputs: Record<string, string> = {};
  const inputs: Record<string, string> = {};
  let lastOut = "";
  let runTaskQuery = "";
  const nodeStatusById = new Map<string, NodeStatus>();
  const nodeTokensById = new Map<string, number>();
  const activeIncomingTargets = new Set<string>();

  events.forEach((ev, i) => {
    if (shouldLogEvent(ev)) {
      logs.push(runEventToLog(ev, i));
    }

    const type = eventType(ev);
    const agentId = ev.agent_id;
    const r = evToRecord(ev);

    if (type === "run_start") {
      runTaskQuery = String(r.query ?? "");
      return;
    }

    if (type === "agent_start" && agentId) {
      nodeStatusById.set(agentId, "running");
      activeIncomingTargets.add(agentId);
      const prompt = r.prompt_preview as string | undefined;
      if (prompt) inputs[agentId] = prompt;
      return;
    }

    if (type === "token" && agentId) {
      const r = evToRecord(ev);
      const token = r.token as string | undefined ?? "";
      if (token) {
        outputs[agentId] = `${outputs[agentId] ?? ""}${token}`;
        lastOut = outputs[agentId];
      }
      return;
    }

    if (type === "agent_output" && agentId) {
      const r = evToRecord(ev);
      const content = r.content as string | undefined;
      const tokens = r.tokens_used as number | undefined;
      // Step finished — show green; a later agent_start on the same id (loops) sets running again.
      nodeStatusById.set(agentId, "succeeded");
      if (tokens != null) nodeTokensById.set(agentId, tokens);
      activeIncomingTargets.delete(agentId);
      if (content) {
        outputs[agentId] = content;
        lastOut = content;
      }
      return;
    }

    if (type === "agent_error" && agentId) {
      nodeStatusById.set(agentId, "failed");
      activeIncomingTargets.delete(agentId);
      return;
    }

    if (type === "run_end") {
      const r = evToRecord(ev);
      const executedAgents = r.executed_agents as string[] | undefined;
      executedAgents?.forEach((id) => {
        if (!nodeStatusById.has(id) || nodeStatusById.get(id) === "running") {
          nodeStatusById.set(id, "succeeded");
        }
        activeIncomingTargets.delete(id);
      });
      const finalAnswer = r.final_answer as string | undefined;
      if (finalAnswer) lastOut = finalAnswer;
    }
  });

  if (runStatus && runStatus !== "running") {
    activeIncomingTargets.clear();
  }

  return { logs, outputs, inputs, lastOut, runTaskQuery, nodeStatusById, nodeTokensById, activeIncomingTargets };
}

// ── context shape ─────────────────────────────────────────────────────────────

interface WorkflowRunState {
  nodes: GraphNode[];
  setNodes: React.Dispatch<React.SetStateAction<GraphNode[]>>;
  edges: GraphEdge[];
  setEdges: React.Dispatch<React.SetStateAction<GraphEdge[]>>;

  // Active graph identity — also lives in context so the canvas (and any live
  // run on it) survives leaving the Workflow page and coming back.
  activeGraphId: string | null;
  setActiveGraphId: (id: string | null) => void;
  graphName: string;
  setGraphName: (name: string) => void;

  isRunning: boolean;
  activeRunId: string | null;
  liveEvents: LogEvent[];
  nodeOutputs: Record<string, string>;
  nodeInputs: Record<string, string>;
  runTaskQuery: string;
  lastRunOutput: string;

  // called by Workflow when it starts a new run
  startRun: (runId: string, resetNodes: () => void) => void;
  stopRun: () => void;
  clearRunState: () => void;
  clearLiveEvents: () => void;
  // Reattach UI to an existing run (replay events, live-connect if still active)
  attachRun: (runId: string) => void;
}

const WorkflowRunContext = createContext<WorkflowRunState | null>(null);

export function useWorkflowRun() {
  const ctx = useContext(WorkflowRunContext);
  if (!ctx) throw new Error("useWorkflowRun must be used inside WorkflowRunProvider");
  return ctx;
}

// ── provider ──────────────────────────────────────────────────────────────────

export function WorkflowRunProvider({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<GraphNode[]>([
    { id: "__start__", type: "start", label: "__start__", x: 40, y: 200, status: "idle" },
  ]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [activeGraphId, setActiveGraphIdState] = useState<string | null>(
    () => sessionStorage.getItem("gmas_active_graph"),
  );
  const [graphName, setGraphName] = useState<string>("");
  const setActiveGraphId = useCallback((id: string | null) => {
    setActiveGraphIdState(id);
    if (id) sessionStorage.setItem("gmas_active_graph", id);
    else sessionStorage.removeItem("gmas_active_graph");
  }, []);

  const [isRunning, setIsRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<LogEvent[]>([]);
  const [nodeOutputs, setNodeOutputs] = useState<Record<string, string>>({});
  const [nodeInputs, setNodeInputs] = useState<Record<string, string>>({});
  const [runTaskQuery, setRunTaskQuery] = useState("");
  const [lastRunOutput, setLastRunOutput] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const eventIdxRef = useRef(0);
  const eventQueueRef = useRef<RunEvent[]>([]);
  const processingRef = useRef(false);
  const lastEventTimeRef = useRef(0);
  const donePendingRef = useRef(false);
  const doneRunIdRef = useRef<string | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const isRunningRef = useRef(false);
  const tokenBufferRef = useRef<Record<string, string>>({});
  const tokenFlushTimerRef = useRef<number | null>(null);
  const edgePulseTimersRef = useRef<number[]>([]);
  const edgePulseIdsRef = useRef<Record<string, string>>({});
  const agentWaitTimersRef = useRef<Record<string, number>>({});

  const setActiveRunIdPersisted = useCallback((id: string | null) => {
    setActiveRunId(id);
    if (id) sessionStorage.setItem("gmas_active_run", id);
    else sessionStorage.removeItem("gmas_active_run");
  }, []);

  const clearEdgePulses = useCallback(() => {
    edgePulseTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    edgePulseTimersRef.current = [];
    edgePulseIdsRef.current = {};
    setEdges(prev => prev.map(e => e.active ? { ...e, active: false } : e));
  }, []);

  const clearAgentWaitTimers = useCallback(() => {
    Object.values(agentWaitTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    agentWaitTimersRef.current = {};
  }, []);

  const clearAgentWaitTimer = useCallback((agentId: string) => {
    const timer = agentWaitTimersRef.current[agentId];
    if (timer != null) {
      window.clearTimeout(timer);
      delete agentWaitTimersRef.current[agentId];
    }
  }, []);

  const pulseEdges = useCallback((
    predicate: (edge: GraphEdge) => boolean,
    durationMs = 900,
  ) => {
    const pulseId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setEdges(prev => prev.map(e => {
      if (!predicate(e)) return e;
      edgePulseIdsRef.current[e.id] = pulseId;
      return { ...e, active: true };
    }));
    const timer = window.setTimeout(() => {
      setEdges(prev => prev.map(e => {
        if (edgePulseIdsRef.current[e.id] !== pulseId) return e;
        delete edgePulseIdsRef.current[e.id];
        return { ...e, active: false };
      }));
      edgePulseTimersRef.current = edgePulseTimersRef.current.filter(t => t !== timer);
    }, durationMs);
    edgePulseTimersRef.current.push(timer);
  }, []);

  const clearEdgePulsesSoon = useCallback((delayMs = 1400) => {
    const timer = window.setTimeout(() => {
      clearEdgePulses();
      edgePulseTimersRef.current = edgePulseTimersRef.current.filter(t => t !== timer);
    }, delayMs);
    edgePulseTimersRef.current.push(timer);
  }, [clearEdgePulses]);

  const flushTokenBuffer = useCallback(() => {
    if (tokenFlushTimerRef.current != null) {
      window.clearTimeout(tokenFlushTimerRef.current);
      tokenFlushTimerRef.current = null;
    }
    const buffered = tokenBufferRef.current;
    tokenBufferRef.current = {};
    const entries = Object.entries(buffered).filter(([, text]) => text.length > 0);
    if (entries.length === 0) return;

    setNodeOutputs(prev => {
      const next = { ...prev };
      let lastOutput = "";
      for (const [agentId, text] of entries) {
        next[agentId] = `${next[agentId] ?? ""}${text}`;
        lastOutput = next[agentId];
      }
      if (lastOutput) setLastRunOutput(lastOutput);
      return next;
    });
  }, []);

  const clearTokenBuffer = useCallback(() => {
    if (tokenFlushTimerRef.current != null) {
      window.clearTimeout(tokenFlushTimerRef.current);
      tokenFlushTimerRef.current = null;
    }
    tokenBufferRef.current = {};
  }, []);

  const scheduleTokenFlush = useCallback(() => {
    if (tokenFlushTimerRef.current != null) return;
    tokenFlushTimerRef.current = window.setTimeout(flushTokenBuffer, 50);
  }, [flushTokenBuffer]);

  const hydrateRunSnapshot = useCallback(async (runId: string) => {
    const run = await executionApi.get(runId);
    const projection = projectRunEvents(run.events, run.status);

    setNodes(prev => prev.map(n => {
      const status = projection.nodeStatusById.get(n.id);
      if (!status) return { ...n, status: n.type === "agent" ? "idle" : n.status };
      return { ...n, status, tokenCount: projection.nodeTokensById.get(n.id) ?? n.tokenCount };
    }));
    setEdges(prev => prev.map(e => ({
      ...e,
      active: run.status === "running" && projection.activeIncomingTargets.has(e.target),
    })));
    setLiveEvents(projection.logs);
    setNodeOutputs(projection.outputs);
    setNodeInputs(projection.inputs);
    setRunTaskQuery(projection.runTaskQuery);
    if (projection.lastOut) setLastRunOutput(projection.lastOut);
    eventIdxRef.current = run.events.length;

    return run;
  }, []);

  const finalizeRun = useCallback((runId?: string | null) => {
    flushTokenBuffer();
    clearAgentWaitTimers();
    isRunningRef.current = false;
    setIsRunning(false);
    setActiveRunIdPersisted(null);
    clearEdgePulsesSoon();
    const snapshotRunId = runId ?? currentRunIdRef.current;
    if (snapshotRunId) {
      void hydrateRunSnapshot(snapshotRunId)
        .then((run) => {
          toast.success(`Execution ${run.status}`);
        })
        .catch(() => {
          setNodes(prev => prev.map(n => n.status === "running" ? { ...n, status: "succeeded" } : n));
          toast.success("Execution complete");
        });
    } else {
      setNodes(prev => prev.map(n => n.status === "running" ? { ...n, status: "succeeded" } : n));
      toast.success("Execution complete");
    }
  }, [clearAgentWaitTimers, clearEdgePulsesSoon, flushTokenBuffer, hydrateRunSnapshot, setActiveRunIdPersisted]);

  const applyEvent = useCallback((ev: RunEvent) => {
    const type = eventType(ev);
    const agentId = ev.agent_id;
    const r = evToRecord(ev);
    const toolName = r.tool_name as string | undefined;

    if (type === "run_start") {
      const query = String(r.query ?? "");
      if (query) setRunTaskQuery(query);
      return;
    }

    if (type === "run_end") {
      const finalAnswer = r.final_answer as string | undefined;
      if (finalAnswer) setLastRunOutput(finalAnswer);
      return;
    }

    if (type === "tool_call" && agentId) {
      clearAgentWaitTimer(agentId);
      setNodes(prev => prev.map(n => n.id === agentId
        ? { ...n, status: "waiting_tool" as NodeStatus, lastEvent: toolName ? `tool: ${toolName}` : "tool call" }
        : n));
      return;
    }

    if ((type === "tool_end" || type === "tool_error") && agentId) {
      setNodes(prev => prev.map(n => n.id === agentId
        ? {
          ...n,
          status: type === "tool_error" ? "failed" as NodeStatus : "running" as NodeStatus,
          lastEvent: type === "tool_error" ? "tool error" : "processing tool result",
        }
        : n));
      return;
    }

    if (!agentId) return;

    if (type === "agent_start") {
      const prompt = r.prompt_preview as string | undefined;
      if (prompt) setNodeInputs(prev => ({ ...prev, [agentId]: prompt }));
      setNodes(prev => prev.map(n => n.id === agentId ? { ...n, status: "running" as NodeStatus, lastEvent: "starting" } : n));
      clearAgentWaitTimer(agentId);
      agentWaitTimersRef.current[agentId] = window.setTimeout(() => {
        setNodes(prev => prev.map(n => (
          n.id === agentId && n.status === "running"
            ? { ...n, lastEvent: "waiting for LLM" }
            : n
        )));
        delete agentWaitTimersRef.current[agentId];
      }, 3000);
      pulseEdges(e => e.target === agentId, 1300);
      setEdges(prev => prev.map(e => {
        if (e.source !== agentId) return e;
        delete edgePulseIdsRef.current[e.id];
        return { ...e, active: false };
      }));
    } else if (type === "token") {
      const r = evToRecord(ev);
      const token = r.token as string | undefined ?? "";
      const d = (ev.data as Record<string, unknown> | null) ?? {};
      const isLast = boolField(r.is_last ?? d.is_last);
      const index = r.token_index as number | undefined;
      if (isLast || index == null || index === 0 || index % 25 === 0) {
        setNodes(prev => prev.map(n => n.id === agentId ? {
          ...n,
          lastEvent: isLast ? "stream complete" : `streaming token ${index ?? ""}`.trim(),
        } : n));
      }
      if (token) {
        tokenBufferRef.current[agentId] = `${tokenBufferRef.current[agentId] ?? ""}${token}`;
        scheduleTokenFlush();
      }
    } else if (type === "agent_output") {
      const content = r.content as string | undefined;
      const tokens = r.tokens_used as number | undefined;
      clearAgentWaitTimer(agentId);
      setNodes(prev => prev.map(n => n.id === agentId
        ? {
          ...n,
          status: "succeeded" as NodeStatus,
          tokenCount: tokens ?? n.tokenCount,
          lastEvent: isRunningRef.current ? "step complete" : "completed",
        } : n
      ));
      setEdges(prev => prev.map(e => {
        if (e.target !== agentId) return e;
        delete edgePulseIdsRef.current[e.id];
        return { ...e, active: false };
      }));
      pulseEdges(e => e.source === agentId, 1300);
      if (content) {
        setNodeOutputs(prev => ({ ...prev, [agentId]: content }));
        setLastRunOutput(content);
      }
    } else if (type === "agent_error") {
      clearAgentWaitTimer(agentId);
      setNodes(prev => prev.map(n => n.id === agentId ? { ...n, status: "failed" as NodeStatus, lastEvent: "error" } : n));
      setEdges(prev => prev.map(e => {
        if (e.target !== agentId && e.source !== agentId) return e;
        delete edgePulseIdsRef.current[e.id];
        return { ...e, active: false };
      }));
    }
  }, [clearAgentWaitTimer, pulseEdges, scheduleTokenFlush]);

  // Drain queued events with a small visual delay between bursts so the canvas
  // can animate node/edge transitions instead of all events landing in one frame.
  const drainQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    while (eventQueueRef.current.length > 0) {
      const ev = eventQueueRef.current.shift()!;
      if (shouldLogEvent(ev)) {
        const log = runEventToLog(ev, eventIdxRef.current++);
        setLiveEvents(prev => [...prev, log]);
      }
      applyEvent(ev);

      // Throttle bursts: if events come in rapidly (≤30 ms apart),
      // hold each visible step for ~120 ms so the UI can paint the
      // running pulse and active edges before the next state change.
      // Token streams can contain thousands of events; never delay those or
      // later agent_start/agent_output events will appear "stuck" behind them.
      if (eventType(ev) === "token") {
        lastEventTimeRef.current = performance.now();
        continue;
      }
      flushTokenBuffer();
      const now = performance.now();
      const burst = now - lastEventTimeRef.current < 30;
      lastEventTimeRef.current = now;
      const nextEvent = eventQueueRef.current[0];
      if (burst && eventQueueRef.current.length > 0 && eventType(nextEvent) !== "token") {
        await new Promise(res => setTimeout(res, 120));
      }
    }
    processingRef.current = false;
    if (donePendingRef.current) {
      donePendingRef.current = false;
      finalizeRun(doneRunIdRef.current);
      doneRunIdRef.current = null;
    }
  }, [applyEvent, finalizeRun, flushTokenBuffer]);

  const connectWebSocket = useCallback((runId: string) => {
    wsRef.current?.close();
    eventQueueRef.current = [];
    processingRef.current = false;
    lastEventTimeRef.current = 0;
    wsRef.current = createExecutionSocket(runId, {
      onEvent: (ev) => {
        eventQueueRef.current.push(ev);
        void drainQueue();
      },
      onDone: () => {
        if (donePendingRef.current) return;
        donePendingRef.current = true;
        doneRunIdRef.current = runId;
        if (eventQueueRef.current.length === 0 && !processingRef.current) {
          donePendingRef.current = false;
          finalizeRun(doneRunIdRef.current);
          doneRunIdRef.current = null;
        }
      },
      onError: (err) => {
        donePendingRef.current = false;
        doneRunIdRef.current = null;
        flushTokenBuffer();
        clearAgentWaitTimers();
        isRunningRef.current = false;
        setIsRunning(false);
        setActiveRunIdPersisted(null);
        clearEdgePulses();
        setNodes(prev => prev.map(n => (
          n.status === "running" || n.status === "queued" || n.status === "waiting_llm" || n.status === "waiting_tool"
            ? { ...n, status: "failed" as NodeStatus, lastEvent: "connection error" }
            : n
        )));
        toast.error("Execution error", { description: err });
      },
    });
  }, [clearAgentWaitTimers, drainQueue, finalizeRun, flushTokenBuffer, setActiveRunIdPersisted, clearEdgePulses]);

  const startRun = useCallback((runId: string, resetNodes: () => void) => {
    clearEdgePulses();
    clearTokenBuffer();
    donePendingRef.current = false;
    doneRunIdRef.current = null;
    currentRunIdRef.current = runId;
    isRunningRef.current = true;
    setIsRunning(true);
    setActiveRunIdPersisted(runId);
    setLiveEvents([]);
    setNodeOutputs({});
    setNodeInputs({});
    setRunTaskQuery("");
    setLastRunOutput("");
    eventIdxRef.current = 0;
    resetNodes();
    connectWebSocket(runId);
  }, [clearEdgePulses, clearTokenBuffer, connectWebSocket, setActiveRunIdPersisted]);

  const stopRun = useCallback(() => {
    wsRef.current?.close();
    donePendingRef.current = false;
    doneRunIdRef.current = null;
    currentRunIdRef.current = null;
    clearAgentWaitTimers();
    clearTokenBuffer();
    setIsRunning(false);
    setActiveRunIdPersisted(null);
    clearEdgePulses();
    setNodes(prev => prev.map(n => (
      n.status === "running" || n.status === "queued" || n.status === "waiting_llm" || n.status === "waiting_tool"
        ? { ...n, status: "idle" as NodeStatus, lastEvent: "stopped" }
        : n
    )));
  }, [setActiveRunIdPersisted, clearAgentWaitTimers, clearEdgePulses, clearTokenBuffer]);

  const clearRunState = useCallback(() => {
    wsRef.current?.close();
    donePendingRef.current = false;
    doneRunIdRef.current = null;
    currentRunIdRef.current = null;
    clearAgentWaitTimers();
    clearTokenBuffer();
    setLiveEvents([]);
    setNodeOutputs({});
    setNodeInputs({});
    setRunTaskQuery("");
    setLastRunOutput("");
    setIsRunning(false);
    setActiveRunIdPersisted(null);
    eventQueueRef.current = [];
    processingRef.current = false;
    clearEdgePulses();
  }, [setActiveRunIdPersisted, clearAgentWaitTimers, clearEdgePulses, clearTokenBuffer]);

  const clearLiveEvents = useCallback(() => setLiveEvents([]), []);

  /**
   * Attach to an existing run by its ID — repaints node/edge state from the
   * run's full event history. If the run is still running, opens a WebSocket
   * to receive new events; otherwise leaves nodes in their final state
   * (succeeded/failed) so the user can see what happened.
   */
  const attachRun = useCallback((runId: string) => {
    wsRef.current?.close();
    setLiveEvents([]);
    setNodeOutputs({});
    setNodeInputs({});
    setRunTaskQuery("");
    setLastRunOutput("");
    eventIdxRef.current = 0;
    eventQueueRef.current = [];
    processingRef.current = false;

    executionApi.get(runId).then((run) => {
      const projection = projectRunEvents(run.events, run.status);

      setNodes(prev => prev.map(n => {
        const status = projection.nodeStatusById.get(n.id);
        if (!status) return { ...n, status: n.type === "agent" ? "idle" : n.status };
        return { ...n, status, tokenCount: projection.nodeTokensById.get(n.id) ?? n.tokenCount };
      }));
      setEdges(prev => prev.map(e => ({
        ...e,
        active: run.status === "running" && projection.activeIncomingTargets.has(e.target),
      })));
      setLiveEvents(projection.logs);
      setNodeOutputs(projection.outputs);
      setNodeInputs(projection.inputs);
      setRunTaskQuery(projection.runTaskQuery);
      if (projection.lastOut) setLastRunOutput(projection.lastOut);
      eventIdxRef.current = run.events.length;

      if (run.status === "running") {
        setIsRunning(true);
        setActiveRunIdPersisted(runId);
        currentRunIdRef.current = runId;
        connectWebSocket(runId);
        toast.info("Watching live run", { description: runId.slice(0, 8) });
      } else {
        setIsRunning(false);
        setActiveRunIdPersisted(null);
        currentRunIdRef.current = null;
        toast.success(`Run ${runId.slice(0, 8)} — ${run.status}`, {
          description: `${run.events.length} events replayed`,
        });
      }
    }).catch(() => toast.error("Failed to load run"));
  }, [connectWebSocket, setActiveRunIdPersisted]);

  // On app start: reconnect to any run that was active before a page reload/navigation
  useEffect(() => {
    const savedRunId = sessionStorage.getItem("gmas_active_run");
    if (!savedRunId) return;

    executionApi.get(savedRunId).then((run) => {
      const projection = projectRunEvents(run.events, run.status);
      setNodes(prev => prev.map(n => {
        const status = projection.nodeStatusById.get(n.id);
        if (!status) return { ...n, status: n.type === "agent" ? "idle" : n.status };
        return { ...n, status, tokenCount: projection.nodeTokensById.get(n.id) ?? n.tokenCount };
      }));
      setEdges(prev => prev.map(e => ({
        ...e,
        active: run.status === "running" && projection.activeIncomingTargets.has(e.target),
      })));
      setLiveEvents(projection.logs);
      setNodeOutputs(projection.outputs);
      setNodeInputs(projection.inputs);
      setRunTaskQuery(projection.runTaskQuery);
      if (projection.lastOut) setLastRunOutput(projection.lastOut);
      eventIdxRef.current = run.events.length;

      if (run.status === "running") {
        setIsRunning(true);
        setActiveRunIdPersisted(savedRunId);
        currentRunIdRef.current = savedRunId;
        connectWebSocket(savedRunId);
        toast.info("Reconnected to active run", { description: savedRunId.slice(0, 8) });
      } else {
        setIsRunning(false);
        setActiveRunIdPersisted(null);
        currentRunIdRef.current = null;
        edgePulseIdsRef.current = {};
        setEdges(prev => prev.map(e => e.active ? { ...e, active: false } : e));
      }
    }).catch(() => {
      sessionStorage.removeItem("gmas_active_run");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // Clean up WebSocket when app unmounts (e.g. page close)
  useEffect(() => () => {
    wsRef.current?.close();
    if (tokenFlushTimerRef.current != null) {
      window.clearTimeout(tokenFlushTimerRef.current);
      tokenFlushTimerRef.current = null;
    }
    tokenBufferRef.current = {};
    edgePulseTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    edgePulseTimersRef.current = [];
    edgePulseIdsRef.current = {};
  }, []);

  return (
    <WorkflowRunContext.Provider value={{
      nodes, setNodes,
      edges, setEdges,
      activeGraphId, setActiveGraphId,
      graphName, setGraphName,
      isRunning, activeRunId,
      liveEvents, nodeOutputs, nodeInputs, runTaskQuery, lastRunOutput,
      startRun, stopRun, clearRunState, clearLiveEvents, attachRun,
    }}>
      {children}
    </WorkflowRunContext.Provider>
  );
}
