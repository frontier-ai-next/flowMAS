// gMAS Runs / Observability Page
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import {
  Play, Square, RefreshCw, Download, Copy, Search, Filter, X,
  ChevronRight, Clock, Activity, TrendingUp, AlertTriangle,
  CheckCircle2, XCircle, MoreHorizontal, Eye, GitBranch,
  Cpu, Database, Zap, BarChart3, ArrowRight, ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Chip } from "@/components/ui/chip";
import { StatusLozenge } from "@/components/ui/status-lozenge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/AppShell";
import { ResizeRail } from "@/components/layout/ResizeRail";
import { executionApi, type RunDetail as RunDetailDto } from "@/lib/api";
import { toast } from "sonner";
import { useLocation } from "wouter";

type RunStatus = "running" | "succeeded" | "failed" | "stopped" | "queued";

interface Run {
  id: string;
  status: RunStatus;
  graphId: string;
  graphName: string;
  task: string;
  duration: string;
  durationMs: number | null;
  tokens: number;
  toolCalls: number;
  errors: number;
  steps: number;
  memoryOps: number;
  strategy: string;
  startedAt: string;
  startedAtIso: string;
  endedAt?: string;
  output?: string;
  agentBreakdown: { name: string; tokens: number; status: string }[];
}

function extractFinalAnswer(result: unknown): string | undefined {
  if (result == null) return undefined;
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    const fa = r.final_answer ?? r.answer ?? r.output;
    if (typeof fa === "string") return fa;
    return JSON.stringify(result, null, 2);
  }
  return String(result);
}

function toRun(d: RunDetailDto): Run {
  const statusMap: Record<string, RunStatus> = {
    running: "running",
    completed: "succeeded",
    error: "failed",
    cancelled: "stopped",
  };
  const runEndTokens = d.events.reduce((acc, e) => {
    const ev = e as unknown as Record<string, unknown>;
    const data = (e.data as Record<string, unknown> | null) ?? {};
    const t = typeof ev.total_tokens === "number" ? ev.total_tokens
      : typeof data.total_tokens === "number" ? data.total_tokens : 0;
    return Math.max(acc, t);
  }, 0);
  const tokens = runEndTokens || d.events.reduce((s, e) => {
    const ev = e as unknown as Record<string, unknown>;
    return s + (typeof ev.tokens_used === "number" ? ev.tokens_used : 0);
  }, 0);
  const toolCalls = d.events.filter(e => e.event_type === "tool_call" || e.event_type === "tool_start").length;
  const errors = d.events.filter(e => ["error", "agent_error", "tool_error"].includes(e.event_type)).length;
  const steps = d.events.filter(e => e.event_type === "agent_start").length;
  const endTs = d.ended_at ?? d.completed_at;
  let duration = "—";
  let durationMs: number | null = null;
  if (d.started_at && endTs) {
    const ms = new Date(endTs).getTime() - new Date(d.started_at).getTime();
    if (Number.isFinite(ms) && ms >= 0) {
      durationMs = ms;
      const secs = Math.floor(ms / 1000);
      duration = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
    }
  }
  return {
    id: d.run_id,
    status: statusMap[d.status] ?? "queued",
    graphId: d.graph_id ?? "",
    graphName: d.graph_id ?? "—",
    task: d.task_query ?? "",
    duration,
    durationMs,
    tokens,
    toolCalls,
    errors,
    steps,
    memoryOps: 0,
    strategy: "sequential",
    startedAt: d.started_at ? new Date(d.started_at).toLocaleString() : "—",
    startedAtIso: d.started_at ?? "",
    endedAt: endTs ? new Date(endTs).toLocaleString() : undefined,
    output: extractFinalAnswer(d.result),
    agentBreakdown: [],
  };
}

function runStatusTone(status: Run["status"]): "info" | "success" | "danger" | "neutral" {
  const map: Record<Run["status"], "info" | "success" | "danger" | "neutral"> = {
    running: "info",
    succeeded: "success",
    failed: "danger",
    stopped: "neutral",
    queued: "neutral",
  };
  return map[status] ?? "neutral";
}

function runStatusLabel(status: Run["status"]) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function runEventType(ev: { event_type?: string }) {
  return String(ev.event_type ?? "").toLowerCase();
}

function isTokenRunEvent(ev: { event_type?: string }) {
  return runEventType(ev) === "token";
}

const statusAccent: Record<Run["status"], string> = {
  succeeded: "oklch(0.72 0.17 142)",
  running:   "oklch(0.62 0.19 259)",
  failed:    "oklch(0.65 0.22 25)",
  stopped:   "oklch(0.60 0 0)",
  queued:    "oklch(0.78 0.13 80)",
};

function RunCard({ run, selected, onClick }: {
  run: Run;
  selected: boolean;
  onClick: () => void;
}) {
  const accent = statusAccent[run.status];
  const isRunning = run.status === "running";

  return (
    <button
      onClick={onClick}
      data-selected={selected}
      className={cn(
        "group relative isolate text-left rounded-lg overflow-hidden",
        "bg-card border border-foreground/12",
        "transition-[border-color,background-color,box-shadow] duration-150",
        "shadow-[0_1px_0_oklch(1_0_0/0.02)_inset,0_1px_3px_oklch(0_0_0/0.18)]",
        // hover
        "hover:border-foreground/22 hover:shadow-[0_1px_0_oklch(1_0_0/0.04)_inset,0_2px_8px_oklch(0_0_0/0.28)]",
        // selected
        "data-[selected=true]:border-foreground/28 data-[selected=true]:shadow-[0_0_0_1px_oklch(1_0_0/0.05)_inset,0_8px_24px_-10px_oklch(0_0_0/0.5)]",
      )}
    >
      {/* Top-left accent — small dot, not a stripe */}
      <div className="absolute inset-x-0 top-0 h-px opacity-0 group-hover:opacity-100 group-data-[selected=true]:opacity-100 transition-opacity"
           style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />

      {/* Body */}
      <div className="px-4 pt-3.5 pb-3">
        {/* Row 1: status pill + run id + chevron */}
        <div className="flex items-center gap-2 mb-2">
          <span className="relative inline-flex items-center gap-1.5 shrink-0">
            <span
              className={cn("w-1.5 h-1.5 rounded-full", isRunning && "animate-pulse")}
              style={{ backgroundColor: accent, boxShadow: isRunning ? `0 0 6px ${accent}` : undefined }}
            />
            <span className="text-[11px] font-medium tracking-[-0.01em]" style={{ color: accent }}>
              {runStatusLabel(run.status)}
            </span>
          </span>
          <span className="text-border/60">·</span>
          <span className="font-mono text-[11px] text-muted-foreground/70 truncate">{run.id}</span>
          <ChevronRight className="ml-auto w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/70 group-hover:translate-x-0.5 transition-all shrink-0" />
        </div>

        {/* Row 2: task */}
        <h3 className="text-[14px] font-semibold leading-[1.35] text-foreground line-clamp-2 tracking-[-0.01em]">
          {run.task || <span className="italic text-muted-foreground/50">No task description</span>}
        </h3>

        {/* Row 3: meta */}
        <div className="flex items-center gap-1.5 mt-1.5 text-[11.5px] text-muted-foreground/80">
          <span className="font-mono truncate">{run.graphName}</span>
          <span className="text-border/60">·</span>
          <span className="truncate">{run.startedAt}</span>
        </div>
      </div>

      {/* Stats row — flat, inline, separated by hairlines */}
      <div className="grid grid-cols-4 border-t border-foreground/10 divide-x divide-foreground/10">
        <CardStat icon={Clock}    label="Duration" value={run.duration}                color="text-blue-400/90"   />
        <CardStat icon={Cpu}      label="Tokens"   value={run.tokens.toLocaleString()} color="text-violet-400/90" />
        <CardStat icon={Activity} label="Steps"    value={String(run.steps)}           color="text-teal-400/90"   />
        <CardStat icon={Zap}      label="Tools"    value={String(run.toolCalls)}       color="text-amber-400/90"  />
      </div>

      {/* Error row — only if errors */}
      {run.errors > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-t border-foreground/10 bg-red-500/[0.04]">
          <AlertTriangle className="w-3 h-3 text-red-400/90" />
          <span className="text-[11.5px] text-red-400/90 font-medium">
            {run.errors} {run.errors === 1 ? "error" : "errors"}
          </span>
        </div>
      )}
    </button>
  );
}

function CardStat({ icon: Icon, label, value, color }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground/60">
        <Icon className={cn("w-3 h-3 shrink-0", color)} />
        {label}
      </div>
      <div className="text-[13px] font-mono font-medium mt-0.5 tabular-nums truncate text-foreground/90">{value}</div>
    </div>
  );
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

function EventCard({ ev }: {
  ev: {
    id: string; type: string; timestamp: string; agentName?: string;
    toolName?: string; content?: string; durationMs?: number; tokens?: number;
    message: string; status: "ok" | "error";
  }
}) {
  const [expanded, setExpanded] = useState(false);
  const isAgentOutput = ev.type === "agent_output";
  const isToolCall = ev.type === "tool_call" || ev.type === "tool_end" || ev.type === "tool_error";
  const hasContent = !!ev.content;

  const badgeClass = ev.type.includes("error")
    ? "bg-red-500/15 text-red-400 border-red-500/25"
    : isAgentOutput
    ? "bg-blue-500/15 text-blue-400 border-blue-500/25"
    : isToolCall
    ? "bg-amber-500/15 text-amber-400 border-amber-500/25"
    : ev.type.includes("agent")
    ? "bg-blue-500/15 text-blue-400 border-blue-500/25"
    : "bg-zinc-700/40 text-zinc-400 border-zinc-600/40";

  return (
    <div className={cn(
      "rounded border transition-colors",
      ev.status === "error" ? "bg-red-500/5 border-red-500/20" : "bg-card/20 border-border/30",
      hasContent && "hover:bg-card/40 cursor-pointer"
    )}
      onClick={() => hasContent && setExpanded(e => !e)}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <Badge className={cn("h-5 shrink-0 rounded-full px-2 text-[10px] font-mono tracking-wide uppercase border", badgeClass)}>
          {ev.type}
        </Badge>
        {ev.agentName && (
          <span className="text-[11px] font-medium text-foreground/80 truncate">{ev.agentName}</span>
        )}
        {ev.toolName && (
          <span className="text-[11px] font-mono text-amber-400/80 truncate">{ev.toolName}</span>
        )}
        <span className="text-[9px] font-mono text-muted-foreground/40 ml-auto shrink-0">{ev.timestamp}</span>
        {ev.tokens != null && ev.tokens > 0 && (
          <span className="text-[9px] font-mono text-violet-400/60 shrink-0">{ev.tokens} tok</span>
        )}
        {ev.durationMs != null && ev.durationMs > 0 && (
          <span className="text-[9px] font-mono text-muted-foreground/40 shrink-0">{Math.round(ev.durationMs)}ms</span>
        )}
        {hasContent && (
          <ChevronRight className={cn("w-3 h-3 text-muted-foreground/40 shrink-0 transition-transform", expanded && "rotate-90")} />
        )}
      </div>

      {/* Short message if no content */}
      {!hasContent && ev.message && (
        <div className="px-2.5 pb-2 text-[10px] text-muted-foreground/60">{ev.message}</div>
      )}

      {/* Expanded agent output */}
      {hasContent && expanded && (
        <div className="px-2.5 pb-3 pt-0 space-y-1.5" onClick={e => e.stopPropagation()}>
          <div className="text-[11px] text-foreground/85 leading-relaxed whitespace-pre-wrap break-words bg-muted/20 rounded p-2.5 border border-border/30 max-h-[60vh] overflow-y-auto">
            {ev.content}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                copyText(ev.content!).then(ok => ok ? toast.success("Copied") : toast.error("Copy failed"));
              }}
              className="flex items-center gap-1 px-2 py-1 rounded border border-border/50 bg-card/30 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
            >
              <Copy className="w-3 h-3" /> Copy
            </button>
            <button
              onClick={() => {
                const blob = new Blob([ev.content!], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${ev.agentName || ev.type}-${Date.now()}.txt`;
                document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                toast.success("Exported");
              }}
              className="flex items-center gap-1 px-2 py-1 rounded border border-border/50 bg-card/30 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
            >
              <Download className="w-3 h-3" /> Export
            </button>
            <span className="ml-auto text-[9px] font-mono text-muted-foreground/40 self-center">
              {ev.content!.length.toLocaleString()} chars
            </span>
          </div>
        </div>
      )}

      {/* Preview when collapsed */}
      {hasContent && !expanded && (
        <div className="px-2.5 pb-2 text-[10px] text-muted-foreground/50 truncate">
          {ev.content!.slice(0, 120)}{ev.content!.length > 120 ? "…" : ""}
        </div>
      )}
    </div>
  );
}

type RunEventView = {
  id: string;
  type: string;
  timestamp: string;
  timestampMs: number;
  agentName?: string;
  toolName?: string;
  content?: string;
  durationMs?: number;
  tokens?: number;
  message: string;
  status: "ok" | "error";
};

function AgentReasoningList({
  events,
  agentBreakdown,
}: {
  events: RunEventView[];
  agentBreakdown: Run["agentBreakdown"];
}) {
  // Group events by agent. Tool events often have no agent_name attached,
  // so we attribute them to the most-recently-started agent on the timeline.
  const sorted = [...events].sort((a, b) => a.timestampMs - b.timestampMs);
  const byAgent = new Map<string, RunEventView[]>();
  let currentAgent: string | undefined;
  for (const ev of sorted) {
    if (ev.agentName) {
      if (ev.type === "agent_start") currentAgent = ev.agentName;
      const arr = byAgent.get(ev.agentName) ?? [];
      arr.push(ev);
      byAgent.set(ev.agentName, arr);
      continue;
    }
    // Tool / model events without agent_name → attribute to current agent
    const isAttachable = ev.type.includes("tool") || ev.type.includes("model");
    if (isAttachable && currentAgent) {
      const arr = byAgent.get(currentAgent) ?? [];
      arr.push({ ...ev, agentName: currentAgent });
      byAgent.set(currentAgent, arr);
    }
  }

  const breakdownByName = new Map(agentBreakdown.map(a => [a.name, a]));
  const agentNames = Array.from(byAgent.keys());

  if (agentNames.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-muted-foreground/50">
        <Cpu className="w-8 h-8 mb-2 opacity-30" />
        <div className="text-xs">No agent activity in this run yet.</div>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-2">
      {agentNames.map((name, i) => (
        <AgentReasoningCard
          key={name}
          name={name}
          events={byAgent.get(name) ?? []}
          breakdown={breakdownByName.get(name)}
          defaultOpen={i === 0}
        />
      ))}
    </div>
  );
}

function AgentReasoningCard({
  name,
  events,
  breakdown,
  defaultOpen,
}: {
  name: string;
  events: RunEventView[];
  breakdown?: Run["agentBreakdown"][number];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Sort once for stable ordering inside the card
  const ordered = [...events].sort((a, b) => a.timestampMs - b.timestampMs);

  // Compute summary from events
  const totalTokens = ordered.reduce((s, e) => s + (e.tokens ?? 0), 0);
  const totalDurationMs = ordered.reduce((s, e) => s + (e.durationMs ?? 0), 0);
  const hasError = ordered.some(e => e.status === "error");
  const firstTs = ordered.find(e => e.timestampMs > 0)?.timestamp;

  // Split into thinking steps vs final response.
  // Final response = the last agent_output that has content.
  const outputEvent = [...ordered].reverse().find(e => e.type === "agent_output" && e.content);
  const thinkingSteps = ordered.filter(
    e => e !== outputEvent && (e.toolName || (e.content && e.type !== "agent_start")),
  );

  const status = breakdown?.status
    ?? (hasError ? "failed" : outputEvent ? "succeeded" : "running");
  const statusColor =
    status === "succeeded" ? "oklch(0.72 0.17 142)"
    : status === "failed" ? "oklch(0.65 0.22 25)"
    : status === "running" ? "oklch(0.62 0.19 259)"
    : "oklch(0.60 0 0)";

  const agentTokens = breakdown?.tokens ?? totalTokens;
  const durationLabel = totalDurationMs > 0
    ? totalDurationMs >= 1000 ? `${(totalDurationMs / 1000).toFixed(1)}s` : `${Math.round(totalDurationMs)}ms`
    : "—";

  const responsePreview = outputEvent?.content?.slice(0, 110).replace(/\s+/g, " ").trim();

  return (
    <div
      className="rounded-xl border-2 bg-card overflow-hidden shadow-[0_2px_4px_oklch(0_0_0/0.06),0_8px_24px_-12px_oklch(0_0_0/0.4)]"
      style={{ borderColor: `color-mix(in oklch, ${statusColor} 35%, transparent)` }}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start gap-3 px-3.5 py-3 text-left hover:bg-accent/30 transition-colors"
      >
        <span
          className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0 font-mono text-[13px] font-bold mt-0.5"
          style={{
            backgroundColor: `color-mix(in oklch, ${statusColor} 18%, transparent)`,
            color: statusColor,
            boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${statusColor} 25%, transparent)`,
          }}
        >
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13px] font-semibold text-foreground truncate">{name}</span>
            <span
              className="inline-flex items-center gap-1 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wider rounded"
              style={{ backgroundColor: `color-mix(in oklch, ${statusColor} 14%, transparent)`, color: statusColor }}
            >
              <span className="w-1 h-1 rounded-full" style={{ backgroundColor: statusColor }} />
              {status}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[10.5px] font-mono text-muted-foreground/80">
            <span>⏱ {durationLabel}</span>
            <span>·</span>
            <span>{agentTokens.toLocaleString()} tok</span>
            {thinkingSteps.length > 0 && <><span>·</span><span>{thinkingSteps.length} {thinkingSteps.length === 1 ? "step" : "steps"}</span></>}
            {firstTs && <><span>·</span><span className="text-muted-foreground/60">{firstTs}</span></>}
          </div>
          {!open && responsePreview && (
            <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/70 line-clamp-2">
              {responsePreview}…
            </div>
          )}
        </span>
        <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground/40 shrink-0 transition-transform mt-1", open && "rotate-90")} />
      </button>

      {open && (
        <div
          className="border-t-2 px-3.5 pt-3 pb-3 space-y-3"
          style={{ borderColor: `color-mix(in oklch, ${statusColor} 20%, transparent)` }}
        >
          {/* Thinking steps */}
          {thinkingSteps.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-2">
                <Cpu className="w-3 h-3" style={{ color: statusColor }} />
                Thinking · {thinkingSteps.length} {thinkingSteps.length === 1 ? "step" : "steps"}
              </div>
              <div className="space-y-2">
                {thinkingSteps.map(ev => (
                  <div key={ev.id} className="rounded-md border border-border/40 bg-muted/30 p-2.5">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span
                        className={cn(
                          "text-[9.5px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wide",
                          ev.type.includes("tool_error") ? "bg-red-500/15 text-red-400"
                          : ev.type.includes("tool") ? "bg-amber-500/15 text-amber-400"
                          : ev.type.includes("error") ? "bg-red-500/15 text-red-400"
                          : "bg-blue-500/15 text-blue-400"
                        )}
                      >
                        {ev.type}
                      </span>
                      {ev.toolName && (
                        <span className="text-[10.5px] font-mono text-amber-400/90 truncate">{ev.toolName}</span>
                      )}
                      <span className="text-[9.5px] font-mono text-muted-foreground/50 ml-auto shrink-0">{ev.timestamp}</span>
                      {ev.durationMs != null && ev.durationMs > 0 && (
                        <span className="text-[9.5px] font-mono text-muted-foreground/60 shrink-0">{Math.round(ev.durationMs)}ms</span>
                      )}
                    </div>
                    {(ev.content || ev.message) && (
                      <div className="text-[11.5px] leading-relaxed text-foreground/85 whitespace-pre-wrap break-words">
                        {(ev.content || ev.message).slice(0, 800)}
                        {(ev.content || ev.message).length > 800 ? "…" : ""}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Final response */}
          {outputEvent && (
            <div>
              <div className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-2">
                <Activity className="w-3 h-3" style={{ color: statusColor }} />
                Response
              </div>
              <pre
                className="font-mono text-[11.5px] leading-relaxed text-foreground/95 whitespace-pre-wrap break-words rounded-md p-3 max-h-[50vh] overflow-y-auto"
                style={{
                  backgroundColor: `color-mix(in oklch, ${statusColor} 6%, var(--background))`,
                  boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${statusColor} 18%, transparent)`,
                }}
              >
                {outputEvent.content}
              </pre>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  onClick={() => copyText(outputEvent.content!).then(ok => ok ? toast.success("Copied") : toast.error("Copy failed"))}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border/50 bg-card/40 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
                >
                  <Copy className="w-3 h-3" /> Copy response
                </button>
                <span className="ml-auto text-[9.5px] font-mono text-muted-foreground/50">
                  {outputEvent.content!.length.toLocaleString()} chars
                </span>
              </div>
            </div>
          )}

          {thinkingSteps.length === 0 && !outputEvent && (
            <div className="text-[11px] text-muted-foreground/50 italic py-2 text-center">
              No detailed activity captured for this agent.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunDetail({
  run,
  onClose,
  floating,
  onToggleFloating,
  onStartDrag,
  onCancel,
  onReplay,
  onOpenGraph,
  onExport,
}: {
  run: Run;
  onClose: () => void;
  floating: boolean;
  onToggleFloating: () => void;
  onStartDrag: (event: React.PointerEvent) => void;
  onCancel: (id: string) => void;
  onReplay: (run: Run) => void;
  onOpenGraph: (run: Run) => void;
  onExport: (run: Run) => void;
}) {
  const [rawEvents, setRawEvents] = useState<import("@/lib/api").RunEvent[]>([]);
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [eventView, setEventView] = useState<"log" | "timeline">("log");

  useEffect(() => {
    executionApi.get(run.id)
      .then(d => setRawEvents(d.events ?? []))
      .catch(() => {});
  }, [run.id]);

  const visibleRawEvents = rawEvents.filter(ev => !isTokenRunEvent(ev));

  const runEvents: RunEventView[] = visibleRawEvents.map((ev, i) => {
    const d = (ev.data as Record<string, unknown> | null) ?? {};
    const type = runEventType(ev);
    const isErrorEvent = type === "error" || type === "tool_error" || type === "agent_error";
    // Error events carry their text in error/error_detail/error_message, not
    // in content — surface it so the log never shows a blank error row.
    const errorText = ev.error_detail || ev.error || ev.error_message
      || (d.error_detail as string | undefined) || (d.error as string | undefined) || (d.error_message as string | undefined);
    const content = (ev.content ?? d.content as string | undefined) ?? (isErrorEvent ? errorText : undefined);
    const toolName = (ev as unknown as Record<string, unknown>).tool_name as string | undefined ?? d.tool_name as string | undefined;
    const agentName = ev.agent_name ?? d.agent_name as string | undefined ?? ev.agent_id;
    const durationMs = ev.duration_ms ?? d.duration_ms as number | undefined;
    const tokens = ev.tokens_used ?? d.tokens_used as number | undefined;
    return {
      id: `${i}`,
      type,
      timestamp: ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : "",
      timestampMs: ev.timestamp ? new Date(ev.timestamp).getTime() : 0,
      agentName,
      toolName,
      content,
      durationMs,
      tokens,
      message: ev.message ?? (isErrorEvent ? (errorText ?? "") : ""),
      status: (isErrorEvent ? "error" : "ok") as "ok" | "error",
    };
  });

  const eventTypes = ["all", ...Array.from(new Set(runEvents.map(e => e.type)))];
  const agentNames = ["all", ...Array.from(new Set(runEvents.map(e => e.agentName).filter(Boolean) as string[]))];

  const filteredEvents = runEvents.filter(e => {
    const matchType = eventTypeFilter === "all" || e.type === eventTypeFilter;
    const matchAgent = agentFilter === "all" || e.agentName === agentFilter;
    return matchType && matchAgent;
  });

  // Surface the error so a failed run's Output tab isn't blank.
  const errorEvent = [...runEvents].reverse().find(e => e.status === "error");
  const errorEventText = errorEvent?.content || errorEvent?.message;

  return (
    <motion.div
      initial={{ x: 20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 20, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "h-full min-h-0 w-full bg-sidebar/50 flex flex-col",
        floating ? "border border-border/70 rounded-xl shadow-2xl bg-sidebar/90 backdrop-blur-sm" : "border-l border-border"
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border cursor-grab active:cursor-grabbing touch-none" onPointerDown={onStartDrag}>
        <div>
          <div className="font-mono text-sm font-medium">{run.id}</div>
          <div className="text-[10px] text-muted-foreground">{run.graphName}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px] border-border/60"
            onClick={onToggleFloating}
          >
            {floating ? "Dock" : "Float"}
          </Button>
          <StatusLozenge tone={runStatusTone(run.status)} withDot={run.status === "running"}>
            {runStatusLabel(run.status)}
          </StatusLozenge>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="px-2 pt-1.5 border-b border-border">
          <TabsList className="w-full grid grid-cols-4 h-7 bg-muted/30 text-[10px]">
            <TabsTrigger value="overview" className="text-[10px]">Overview</TabsTrigger>
            <TabsTrigger value="agents" className="text-[10px]">Agents</TabsTrigger>
            <TabsTrigger value="logs" className="text-[10px]">Logs</TabsTrigger>
            <TabsTrigger value="output" className="text-[10px]">Output</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="flex-1 overflow-hidden m-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              {/* Task */}
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Task</div>
                <div className="text-xs text-muted-foreground bg-muted/20 rounded p-2 leading-relaxed">{run.task}</div>
              </div>

              {/* Metrics grid */}
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Metrics</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Duration", value: run.duration, icon: Clock, color: "text-blue-400" },
                    { label: "Steps", value: run.steps.toString(), icon: Activity, color: "text-green-400" },
                    { label: "Tokens", value: run.tokens.toLocaleString(), icon: Cpu, color: "text-violet-400" },
                    { label: "Tool Calls", value: run.toolCalls.toString(), icon: Zap, color: "text-amber-400" },
                    { label: "Errors", value: run.errors.toString(), icon: AlertTriangle, color: run.errors > 0 ? "text-red-400" : "text-zinc-500" },
                    { label: "Memory Ops", value: run.memoryOps.toString(), icon: Database, color: "text-cyan-400" },
                  ].map(({ label, value, icon: Icon, color }) => (
                    <div key={label} className="flex items-center gap-2 p-2.5 rounded border border-border/30 bg-card/20">
                      <Icon className={cn("w-4 h-4 shrink-0", color)} />
                      <div>
                        <div className="text-[10px] text-muted-foreground">{label}</div>
                        <div className="text-[13px] font-mono font-medium">{value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Timeline */}
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Timeline</div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Started</span>
                    <span className="font-mono">{run.startedAt}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Ended</span>
                    <span className="font-mono">{run.endedAt || "—"}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Strategy</span>
                    <span className="font-mono capitalize">{run.strategy}</span>
                  </div>
                </div>
              </div>

              {/* Agent breakdown */}
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Agent Breakdown</div>
                <div className="space-y-1.5">
                  {run.agentBreakdown.map(ab => (
                    <div key={ab.name} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                      <span className="text-xs text-muted-foreground flex-1 truncate">{ab.name}</span>
                      <span className="text-[11px] font-mono text-muted-foreground/60">{ab.tokens.toLocaleString()} tok</span>
                      <span className={cn(
                        "text-[10px] font-mono",
                        ab.status === 'succeeded' ? "text-green-400" :
                        ab.status === 'failed' ? "text-red-400" : "text-blue-400"
                      )}>{ab.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="logs" className="flex-1 overflow-hidden m-0 flex flex-col">
          {/* Filter bar */}
          <div className="shrink-0 px-2 py-1.5 border-b border-border/40 bg-muted/10 flex items-center gap-1.5 flex-wrap">
            <select
              value={eventTypeFilter}
              onChange={e => setEventTypeFilter(e.target.value)}
              className="h-6 px-1.5 text-[10px] font-mono rounded border border-border/60 bg-background text-muted-foreground"
            >
              {eventTypes.map(t => (
                <option key={t} value={t}>{t === "all" ? "All types" : t}</option>
              ))}
            </select>
            {agentNames.length > 1 && (
              <select
                value={agentFilter}
                onChange={e => setAgentFilter(e.target.value)}
                className="h-6 px-1.5 text-[10px] font-mono rounded border border-border/60 bg-background text-muted-foreground"
              >
                {agentNames.map(a => (
                  <option key={a} value={a}>{a === "all" ? "All agents" : a}</option>
                ))}
              </select>
            )}
            <span className="text-[9px] font-mono text-muted-foreground/40 ml-auto">{filteredEvents.length} events</span>
            <div className="flex rounded overflow-hidden border border-border/60">
              <button
                className={cn("px-2 py-0.5 text-[9px] font-mono transition-colors", eventView === "log" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
                onClick={() => setEventView("log")}
              >Log</button>
              <button
                className={cn("px-2 py-0.5 text-[9px] font-mono transition-colors", eventView === "timeline" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
                onClick={() => setEventView("timeline")}
              >Timeline</button>
            </div>
          </div>

          {eventView === "log" ? (
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-2 space-y-1.5">
                {filteredEvents.map(ev => (
                  <EventCard key={ev.id} ev={ev} />
                ))}
                {filteredEvents.length === 0 && (
                  <div className="text-xs text-muted-foreground/40 text-center mt-8">No events</div>
                )}
              </div>
            </ScrollArea>
          ) : (
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-3 space-y-0">
                {(() => {
                  const minTs = filteredEvents.find(e => e.timestampMs > 0)?.timestampMs ?? 0;
                  const maxTs = filteredEvents.reduce((m, e) => Math.max(m, e.timestampMs), 0);
                  const span = maxTs - minTs || 1;
                  return filteredEvents.map((ev, i) => {
                    const pct = minTs > 0 ? ((ev.timestampMs - minTs) / span) * 100 : 0;
                    const isLast = i === filteredEvents.length - 1;
                    const dotColor = ev.status === "error" ? "bg-red-500"
                      : ev.type === "agent_output" ? "bg-green-500"
                      : ev.type.includes("agent") ? "bg-blue-500"
                      : ev.type.includes("tool") ? "bg-amber-500"
                      : "bg-zinc-600";
                    return (
                      <div key={ev.id} className="flex gap-3 min-h-[2.5rem]">
                        {/* Timeline track */}
                        <div className="flex flex-col items-center w-6 shrink-0">
                          <div className={cn("w-2 h-2 rounded-full shrink-0 mt-1.5", dotColor)} />
                          {!isLast && <div className="w-px flex-1 bg-border/40 mt-0.5" />}
                        </div>
                        {/* Content */}
                        <div className="flex-1 pb-3 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={cn(
                              "text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase tracking-wide",
                              ev.status === "error" ? "bg-red-500/15 text-red-400 border-red-500/25"
                                : ev.type === "agent_output" ? "bg-green-500/15 text-green-400 border-green-500/25"
                                : ev.type.includes("agent") ? "bg-blue-500/15 text-blue-400 border-blue-500/25"
                                : ev.type.includes("tool") ? "bg-amber-500/15 text-amber-400 border-amber-500/25"
                                : "bg-zinc-700/40 text-zinc-400 border-zinc-600/40"
                            )}>{ev.type}</span>
                            {ev.agentName && <span className="text-[11px] font-medium text-foreground/70 truncate">{ev.agentName}</span>}
                            {ev.toolName && <span className="text-[11px] font-mono text-amber-400/70 truncate">{ev.toolName}</span>}
                            <span className="text-[9px] font-mono text-muted-foreground/40 ml-auto shrink-0">{ev.timestamp}</span>
                          </div>
                          {/* Relative position bar */}
                          {minTs > 0 && (
                            <div className="mt-1 h-0.5 rounded bg-border/30 w-full">
                              <div className="h-full rounded bg-blue-500/40" style={{ width: `${pct}%`, minWidth: 2 }} />
                            </div>
                          )}
                          {(ev.content || ev.message) && (
                            <div className="mt-1 text-[10px] text-muted-foreground/60 truncate">
                              {(ev.content || ev.message).slice(0, 100)}
                              {(ev.content || ev.message).length > 100 ? "…" : ""}
                            </div>
                          )}
                          {ev.tokens != null && ev.tokens > 0 && (
                            <span className="text-[9px] font-mono text-violet-400/50">{ev.tokens} tok</span>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
                {filteredEvents.length === 0 && (
                  <div className="text-xs text-muted-foreground/40 text-center mt-8">No events</div>
                )}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="agents" className="flex-1 overflow-hidden m-0">
          <ScrollArea className="h-full">
            <AgentReasoningList events={runEvents} agentBreakdown={run.agentBreakdown} />
          </ScrollArea>
        </TabsContent>

        {/* Failure view only when the run actually failed and produced no
            output — a completed run with transient/retried errors still shows
            its Final Output normally. */}
        {(() => { const isFailedView = run.status === 'failed' && !run.output; return (
        <TabsContent value="output" className="m-0 flex flex-1 min-h-0 flex-col overflow-hidden">
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden p-4 gap-2">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider shrink-0">
              {isFailedView ? "Failure" : "Final Output"}
            </div>
            <div className={cn(
              "flex-1 min-h-0 overflow-hidden rounded border bg-muted/20",
              isFailedView ? "border-red-500/30" : "border-border/30",
            )}>
              <ScrollArea className="h-full w-full">
                <pre className={cn(
                  "m-0 p-3 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words",
                  isFailedView ? "text-red-300/90" : "text-muted-foreground/85",
                )}>
                  {isFailedView
                    ? (errorEventText || "Run failed — no error detail was captured.")
                    : (run.output || "No output available.")}
                </pre>
              </ScrollArea>
            </div>
            {run.status === 'succeeded' && run.output && (
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" className="flex-1 h-7 text-xs border-border/60" onClick={() => onExport(run)}>
                  <Download className="w-3 h-3 mr-1" /> Export
                </Button>
                <Button size="sm" variant="outline" className="flex-1 h-7 text-xs border-border/60" onClick={() => {
                  copyText(run.output!).then(ok => ok ? toast.success("Copied") : toast.error("Copy failed"));
                }}>
                  <Copy className="w-3 h-3 mr-1" /> Copy
                </Button>
              </div>
            )}
            {isFailedView && errorEventText && (
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" className="flex-1 h-7 text-xs border-border/60" onClick={() => {
                  copyText(errorEventText).then(ok => ok ? toast.success("Error copied") : toast.error("Copy failed"));
                }}>
                  <Copy className="w-3 h-3 mr-1" /> Copy error
                </Button>
              </div>
            )}
          </div>
        </TabsContent>
        ); })()}
      </Tabs>

      {/* Actions */}
      <div className="border-t border-border p-3 space-y-2">
        <div className="flex gap-2">
          {run.status === 'running' ? (
            <Button size="sm" variant="outline" className="flex-1 h-7 text-xs border-border/60 text-red-400" onClick={() => onCancel(run.id)}>
              <Square className="w-3 h-3 mr-1" /> Stop
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="flex-1 h-7 text-xs border-border/60 text-green-400" onClick={() => onReplay(run)}>
              <RefreshCw className="w-3 h-3 mr-1" /> Replay
            </Button>
          )}
          <Button size="sm" variant="outline" className="flex-1 h-7 text-xs border-border/60" onClick={() => onOpenGraph(run)}>
            <Eye className="w-3 h-3 mr-1" /> Open Graph
          </Button>
        </div>
        {run.status !== 'running' && (
          <FollowupRow run={run} />
        )}
      </div>
    </motion.div>
  );
}

function FollowupRow({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [, setLocation] = useLocation();
  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="w-full h-7 text-xs border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
        onClick={() => setOpen(true)}
      >
        <ArrowRight className="w-3 h-3 mr-1" /> Continue with new question
      </Button>
    );
  }
  const submit = async () => {
    const q = text.trim();
    if (q.length < 3) { toast.error("Type your follow-up question"); return; }
    setBusy(true);
    try {
      const res = await executionApi.followup(run.id, { task_query: q });
      toast.success("Follow-up started", { description: res.run_id });
      setOpen(false);
      setText("");
      // Take user to the graph live-watching the new run
      setLocation(`/workflow?graph=${run.graphId}&run=${res.run_id}`);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Follow-up failed";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5 rounded border border-violet-500/30 bg-violet-500/5 p-2">
      <div className="text-[10px] font-mono text-violet-300/80 uppercase tracking-wider">
        Follow-up — same graph, same memory
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Ask a follow-up question that builds on the previous run…"
        rows={3}
        disabled={busy}
        className="w-full px-2 py-1.5 text-[11px] rounded border border-border/50 bg-background resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30"
      />
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" className="h-6 text-[10px] flex-1" onClick={() => { setOpen(false); setText(""); }} disabled={busy}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-6 text-[10px] flex-1 bg-violet-600 hover:bg-violet-500 text-white"
          onClick={submit}
          disabled={busy || text.trim().length < 3}
        >
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  caption,
  delta,
  accent,
  trendPoints,
  index,
}: {
  label: string;
  value: string;
  caption: string;
  delta: string;
  accent: string;
  trendPoints: string;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04, ease: "easeOut" }}
      whileHover={{ y: -2 }}
      className="group relative overflow-hidden rounded-xl border border-white/10 bg-[linear-gradient(180deg,oklch(0.14_0.006_285/0.96),oklch(0.115_0.006_285/0.96))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_24px_rgba(0,0,0,0.28)]"
    >
      <div className={cn("absolute left-0 right-0 top-0 h-px opacity-90", accent)} />
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] font-medium tracking-[0.01em] text-zinc-400">{label}</div>
        <span className="rounded-full border border-white/14 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
          {delta}
        </span>
      </div>
      <div className="mb-2 text-[32px] leading-none font-semibold tracking-tight text-zinc-50">{value}</div>
      <div className="mb-3 text-[11px] text-zinc-500">{caption}</div>
      <svg viewBox="0 0 100 24" className="h-6 w-full">
        <path d={trendPoints} fill="none" stroke="oklch(0.92 0.01 285 / 0.45)" strokeWidth="1.25" strokeLinecap="round" />
        <path d={trendPoints} fill="none" stroke="url(#trendGlow)" strokeWidth="1.8" strokeLinecap="round" className="opacity-0 transition-opacity duration-200 group-hover:opacity-80" />
        <defs>
          <linearGradient id="trendGlow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="oklch(0.75 0.08 250 / 0.1)" />
            <stop offset="100%" stopColor="oklch(0.9 0.02 285 / 0.9)" />
          </linearGradient>
        </defs>
      </svg>
    </motion.div>
  );
}

export default function Runs() {
  const layoutRef = useRef<HTMLDivElement>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [detailWidth, setDetailWidth] = useState(400);
  const [floatingDetail, setFloatingDetail] = useState(false);
  const detailDragControls = useDragControls();
  const [, setLocation] = useLocation();

  const fetchRuns = () => {
    executionApi.history()
      .then(data => setRuns(data.map(toRun)))
      .catch(() => toast.error("Failed to load run history"));
  };

  useEffect(() => {
    fetchRuns();
    // Poll every 3s to catch new/updated runs (running → completed)
    const id = setInterval(fetchRuns, 3000);
    return () => clearInterval(id);
  }, []);

  async function handleCancel(runId: string) {
    try {
      await executionApi.cancel(runId);
      setRuns(prev => prev.map(r => r.id === runId ? { ...r, status: "stopped" } : r));
      toast.success("Run stopped");
    } catch {
      toast.error("Failed to stop run");
    }
  }

  function handleExportRun(run: Run) {
    downloadJson(`run-${run.id}.json`, run);
    toast.success("Run exported");
  }

  function handleExportAll() {
    if (runs.length === 0) { toast.info("No runs to export"); return; }
    downloadJson(`runs-${new Date().toISOString().slice(0, 10)}.json`, runs);
    toast.success(`Exported ${runs.length} runs`);
  }

  function handleReplay(run: Run) {
    if (run.graphId) {
      setLocation(`/workflow?graph=${run.graphId}&task=${encodeURIComponent(run.task)}`);
    } else {
      setLocation("/workflow");
    }
  }

  function handleOpenGraph(run: Run) {
    if (run.graphId) {
      // Pass run id so Workflow can re-hydrate node statuses from that run's
      // events (live for running, final state for completed/failed).
      setLocation(`/workflow?graph=${run.graphId}&run=${run.id}`);
    } else {
      setLocation("/workflow");
    }
  }

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const filtered = runs.filter(r => {
    const matchSearch = r.id.toLowerCase().includes(search.toLowerCase()) ||
                        r.graphName.toLowerCase().includes(search.toLowerCase()) ||
                        r.task.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || r.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const selectedRun = runs.find(r => r.id === selected);

  const statuses = ["all", "running", "succeeded", "failed", "stopped", "queued"];

  // Summary stats
  const totalRuns = runs.length;
  const completedRuns = runs.filter(r => r.status === "succeeded" || r.status === "failed");
  const succeededRuns = completedRuns.filter(r => r.status === "succeeded").length;
  const successRate = completedRuns.length > 0 ? Math.round((succeededRuns / completedRuns.length) * 100) : 0;
  const totalTokens = runs.reduce((sum, r) => sum + r.tokens, 0);
  const measuredDurations = runs.flatMap(r => r.durationMs == null ? [] : [r.durationMs]);
  const averageDurationMs = measuredDurations.length
    ? measuredDurations.reduce((sum, value) => sum + value, 0) / measuredDurations.length
    : null;
  const avgDuration = averageDurationMs == null
    ? "—"
    : averageDurationMs >= 60_000
      ? `${Math.floor(averageDurationMs / 60_000)}m ${Math.round((averageDurationMs % 60_000) / 1000)}s`
      : `${(averageDurationMs / 1000).toFixed(1)}s`;
  const today = new Date().toDateString();
  const runsToday = runs.filter(r => r.startedAtIso && new Date(r.startedAtIso).toDateString() === today).length;
  const tokenValue = totalTokens >= 1_000
    ? `${(totalTokens / 1_000).toFixed(totalTokens >= 10_000 ? 0 : 1)}K`
    : totalTokens.toLocaleString();

  return (
    <AppShell
      breadcrumb={[{ label: "Runs" }]}
      actions={
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search runs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm w-52 bg-card border-border/60"
            />
          </div>
          <Button size="sm" variant="outline" className="h-8 text-sm border-border/60" onClick={fetchRuns}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-sm border-border/60" onClick={handleExportAll}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export
          </Button>
          <Button
            size="sm"
            className="h-8 text-sm"
            onClick={() => window.open(
              import.meta.env.VITE_GMAS_OBSERVABILITY_URL || "http://localhost:8100",
              "_blank",
              "noopener,noreferrer",
            )}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Trace Explorer
          </Button>
        </div>
      }
    >
      <div ref={layoutRef} className="relative flex h-full overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-3 border-b border-border/50 p-4 shrink-0 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              index={0}
              label="Total Runs"
              value={totalRuns.toString()}
              caption="Completed + active workflows"
              delta={`${runsToday} today`}
              accent="bg-[linear-gradient(90deg,transparent,oklch(0.7_0.12_245/0.8),transparent)]"
              trendPoints="M 2 18 C 18 14, 24 16, 36 10 C 46 7, 60 14, 74 9 C 84 6, 92 11, 98 8"
            />
            <KpiCard
              index={1}
              label="Success Rate"
              value={`${successRate}%`}
              caption="Runs completed without errors"
              delta={`${succeededRuns}/${completedRuns.length} completed`}
              accent="bg-[linear-gradient(90deg,transparent,oklch(0.8_0.16_150/0.8),transparent)]"
              trendPoints="M 2 16 C 14 12, 28 13, 40 11 C 50 10, 64 8, 74 9 C 84 10, 92 8, 98 7"
            />
            <KpiCard
              index={2}
              label="Total Tokens"
              value={tokenValue}
              caption="Prompt + completion aggregate"
              delta={`${runs.filter(r => r.tokens > 0).length} measured`}
              accent="bg-[linear-gradient(90deg,transparent,oklch(0.74_0.12_295/0.8),transparent)]"
              trendPoints="M 2 20 C 16 18, 26 12, 40 14 C 52 16, 60 10, 74 8 C 84 6, 94 5, 98 4"
            />
            <KpiCard
              index={3}
              label="Avg Duration"
              value={avgDuration}
              caption="Mean runtime per execution"
              delta={`${measuredDurations.length} measured`}
              accent="bg-[linear-gradient(90deg,transparent,oklch(0.84_0.13_75/0.8),transparent)]"
              trendPoints="M 2 7 C 16 8, 24 12, 36 11 C 48 10, 58 16, 72 15 C 84 14, 92 18, 98 17"
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-border/50 bg-muted/10 shrink-0 overflow-x-auto overflow-y-hidden">
            {statuses.map(s => (
              <Chip
                key={s}
                onClick={() => setStatusFilter(s)}
                active={statusFilter === s}
                className="capitalize"
              >
                {s === "all" ? `All (${runs.length})` : s}
              </Chip>
            ))}
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 p-4">
              {filtered.map(run => (
                <RunCard
                  key={run.id}
                  run={run}
                  selected={selected === run.id}
                  onClick={() => setSelected(run.id)}
                />
              ))}
            </div>
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground/40">
                <Activity className="w-8 h-8 mb-2 opacity-30" />
                <div className="text-sm">No runs found</div>
              </div>
            )}
          </ScrollArea>

          {/* Footer */}
          <div className="border-t border-border px-4 py-2 flex items-center gap-6 text-[11px] font-mono text-muted-foreground bg-muted/10 shrink-0">
            <span>{runs.length} runs total</span>
            <span className="text-green-400">{runs.filter(r => r.status === 'succeeded').length} succeeded</span>
            <span className="text-red-400">{runs.filter(r => r.status === 'failed').length} failed</span>
            <span className="text-blue-400">{runs.filter(r => r.status === 'running').length} running</span>
          </div>
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {selectedRun && !floatingDetail && (
            <motion.div
              key={selectedRun.id}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: detailWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
              className="flex shrink-0 overflow-hidden"
            >
              <ResizeRail side="right" onResize={(delta) => setDetailWidth(w => clamp(w + delta, 340, 640))} />
              <div style={{ width: detailWidth }} className="h-full shrink-0">
                <RunDetail
                  run={selectedRun}
                  floating={false}
                  onToggleFloating={() => setFloatingDetail(true)}
                  onStartDrag={() => {}}
                  onClose={() => setSelected(null)}
                  onCancel={handleCancel}
                  onReplay={handleReplay}
                  onOpenGraph={handleOpenGraph}
                  onExport={handleExportRun}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {selectedRun && floatingDetail && (
            <motion.div
              key={`${selectedRun.id}-floating`}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
              className="absolute z-30 right-4 top-4"
              style={{ width: detailWidth, height: "min(84%, 740px)" }}
              drag
              dragMomentum={false}
              dragElastic={0.05}
              dragListener={false}
              dragControls={detailDragControls}
              dragConstraints={layoutRef}
            >
              <RunDetail
                run={selectedRun}
                floating
                onToggleFloating={() => setFloatingDetail(false)}
                onStartDrag={(event) => detailDragControls.start(event)}
                onClose={() => setSelected(null)}
                onCancel={handleCancel}
                onReplay={handleReplay}
                onOpenGraph={handleOpenGraph}
                onExport={handleExportRun}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppShell>
  );
}
