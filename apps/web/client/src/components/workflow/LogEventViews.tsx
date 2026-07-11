import { useState } from "react";
import { ChevronRight, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { LogEvent, LogEventDetails } from "@/lib/mock-data";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function DetailBlock({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value.trim()) return null;
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</div>
      <div className={cn(
        "rounded-md border border-border/40 bg-muted/15 p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words max-h-40 overflow-y-auto",
        mono ? "font-mono text-foreground/85" : "text-foreground/80",
      )}>
        {value}
      </div>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text.trim()) return null;
  return <DetailBlock label={label} value={text} mono />;
}

export function eventMatchesAgent(ev: LogEvent, node: { id: string; agentName?: string; label?: string }): boolean {
  const names = [node.id, node.agentName, node.label, ev.agentId].filter(Boolean) as string[];
  return names.some(n => ev.entity === n || ev.agentId === node.id || ev.message.includes(n));
}

export function agentToolEvents(events: LogEvent[], agentId: string): LogEvent[] {
  return events.filter(ev =>
    (ev.agentId === agentId || ev.entity === agentId)
    && (ev.type === "tool_call" || ev.type === "tool_end" || ev.type === "tool_error"),
  );
}

export function LogEventDetailPanel({
  event,
  onClose,
  compact,
}: {
  event: LogEvent;
  onClose?: () => void;
  compact?: boolean;
}) {
  const d = event.details ?? {};
  const copyPayload = [d.input, d.output, d.query, d.result, event.message].filter(Boolean).join("\n\n");

  return (
    <div className={cn("border-t border-border/50 bg-card/30", compact ? "p-2.5" : "p-3")}>
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-wide text-foreground/80">{event.type}</span>
            <span className="text-[10px] text-muted-foreground/60 font-mono">{event.timestamp}</span>
            {event.entity && (
              <span className="text-[10px] text-muted-foreground/70 truncate">{event.entity}</span>
            )}
          </div>
          {event.message && (
            <div className="text-[11px] text-muted-foreground/80 mt-1 break-words">{event.message}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {copyPayload && (
            <button
              type="button"
              onClick={() => copyText(copyPayload).then(ok => ok ? toast.success("Copied") : toast.error("Copy failed"))}
              className="p-1 rounded border border-border/50 text-muted-foreground hover:text-foreground"
              title="Copy"
            >
              <Copy className="w-3 h-3" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded border border-border/50 text-muted-foreground hover:text-foreground"
              title="Close"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <DetailBlock label="Input" value={d.input ?? d.query ?? ""} />
        <DetailBlock label="Output" value={d.output ?? d.result ?? ""} />
        {d.toolName && (
          <div className="text-[10px] text-muted-foreground/70">
            Tool: <span className="font-mono text-amber-300/90">{d.toolName}</span>
            {d.durationMs != null && d.durationMs > 0 && (
              <span className="ml-2">{Math.round(d.durationMs)}ms</span>
            )}
            {d.tokens != null && d.tokens > 0 && (
              <span className="ml-2">{d.tokens} tokens</span>
            )}
          </div>
        )}
        <JsonBlock label="Arguments" value={d.arguments} />
        {d.error && <DetailBlock label="Error" value={d.error} mono />}
        {d.metadata && Object.keys(d.metadata).length > 0 && (
          <JsonBlock label="Metadata" value={d.metadata} />
        )}
      </div>
    </div>
  );
}

export function InspectorActivitySection({
  node,
  liveEvents,
  nodeOutputs,
  nodeInputs,
  eventClass,
}: {
  node: { id: string; agentName?: string; label?: string; status: string; lastEvent?: string };
  liveEvents: LogEvent[];
  nodeOutputs?: Record<string, string>;
  nodeInputs?: Record<string, string>;
  eventClass: (type: string) => string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const agentEvents = liveEvents.filter(ev => eventMatchesAgent(ev, node));
  const tools = agentToolEvents(liveEvents, node.id);
  const input = nodeInputs?.[node.id];
  const output = nodeOutputs?.[node.id];
  const hasActivity = Boolean(input || output || agentEvents.length > 0);

  if (!hasActivity) {
    return (
      <div className="text-[10px] text-muted-foreground/50">
        Run the graph to see input, output, tool calls, and step logs here.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {input && (
        <div className="rounded border border-cyan-500/25 bg-cyan-500/[0.06] p-2">
          <div className="text-[10px] text-cyan-200/80 mb-1">Input</div>
          <div className="text-[11px] text-foreground/85 whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
            {input}
          </div>
        </div>
      )}
      {output && (
        <div className="rounded border border-emerald-500/25 bg-emerald-500/[0.06] p-2">
          <div className="text-[10px] text-emerald-200/80 mb-1">Output</div>
          <div className="text-[11px] text-foreground/85 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
            {output}
          </div>
        </div>
      )}
      {tools.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Tool calls</div>
          {tools.slice(-8).map(ev => (
            <button
              key={ev.id}
              type="button"
              onClick={() => setExpandedId(prev => prev === ev.id ? null : ev.id)}
              className="w-full text-left rounded border border-amber-500/20 bg-amber-500/[0.05] px-2 py-1.5 text-[10px] hover:bg-amber-500/[0.08]"
            >
              <div className="flex items-center gap-1.5">
                <ChevronRight className={cn("w-3 h-3 shrink-0 transition-transform", expandedId === ev.id && "rotate-90")} />
                <span className={cn(eventClass(ev.type), "shrink-0")}>{ev.type}</span>
                <span className="font-mono text-amber-200/80 truncate">{ev.details?.toolName ?? ev.entity}</span>
              </div>
              {expandedId === ev.id && (
                <div className="mt-1.5 pl-4 text-muted-foreground/80 whitespace-pre-wrap break-words">
                  {ev.details?.arguments != null
                    ? JSON.stringify(ev.details.arguments, null, 2)
                    : ev.message}
                  {ev.details?.result && (
                    <div className="mt-1 border-t border-border/30 pt-1">{ev.details.result}</div>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {agentEvents.slice(-16).map(ev => (
          <button
            key={ev.id}
            type="button"
            onClick={() => setExpandedId(prev => prev === ev.id ? null : ev.id)}
            className="w-full text-left rounded border border-border/30 bg-card/20 px-2 py-1.5 text-[10px] hover:bg-card/35"
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <ChevronRight className={cn("w-3 h-3 shrink-0 transition-transform", expandedId === ev.id && "rotate-90")} />
              <span className={cn(eventClass(ev.type), "shrink-0")}>{ev.type}</span>
              <span className="text-muted-foreground/40 font-mono text-[9px] ml-auto">{ev.timestamp}</span>
            </div>
            <div className="text-muted-foreground/80 break-words whitespace-pre-wrap pl-4">{ev.message}</div>
            {expandedId === ev.id && (ev.details?.input || ev.details?.output || ev.details?.error) && (
              <div className="mt-1 pl-4 space-y-1 border-t border-border/20 pt-1 text-muted-foreground/80 whitespace-pre-wrap break-words">
                {ev.details.input && <div><span className="text-muted-foreground/50">In: </span>{ev.details.input}</div>}
                {ev.details.output && <div><span className="text-muted-foreground/50">Out: </span>{ev.details.output}</div>}
                {ev.details.error && <div className="text-red-300/90">{ev.details.error}</div>}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function buildEventDetails(type: string, r: Record<string, unknown>, d: Record<string, unknown>): LogEventDetails {
  const details: LogEventDetails = {};
  const content = r.content as string | undefined ?? d.content as string | undefined;
  const tokens = r.tokens_used as number | undefined ?? d.tokens_used as number | undefined;
  const durationMs = r.duration_ms as number | undefined ?? d.duration_ms as number | undefined;

  if (type === "run_start") {
    details.query = String(r.query ?? d.query ?? "");
  } else if (type === "run_end") {
    details.output = String(r.final_answer ?? d.final_answer ?? r.output ?? "");
    details.tokens = r.total_tokens as number | undefined;
    details.metadata = {
      success: r.success,
      executed_agents: r.executed_agents,
      error: r.error,
    };
  } else if (type === "agent_start") {
    details.input = String(r.prompt_preview ?? d.prompt_preview ?? r.prompt ?? "");
    details.metadata = {
      step_index: r.step_index,
      predecessors: r.predecessors,
    };
  } else if (type === "agent_output") {
    details.output = content ?? String(r.content ?? "");
    details.tokens = tokens;
    details.durationMs = durationMs;
  } else if (type === "agent_error") {
    details.error = String(r.error_message ?? evError(r) ?? "");
    details.metadata = { error_type: r.error_type, will_retry: r.will_retry };
  } else if (type === "tool_call") {
    details.toolName = String(r.tool_name ?? d.tool_name ?? "");
    details.arguments = r.arguments ?? d.arguments;
  } else if (type === "tool_end") {
    details.toolName = String(r.tool_name ?? d.tool_name ?? "");
    details.result = String(r.result_summary ?? d.result_summary ?? "");
    details.durationMs = durationMs;
    details.success = r.success as boolean | undefined;
  } else if (type === "tool_error") {
    details.toolName = String(r.tool_name ?? d.tool_name ?? "");
    details.error = String(r.error_message ?? d.error_message ?? "");
  }

  return details;
}

function evError(r: Record<string, unknown>): string {
  return String(r.error ?? "");
}
