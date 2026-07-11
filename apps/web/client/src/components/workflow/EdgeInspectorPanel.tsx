import type { ReactNode } from "react";
import { ArrowRight, GitBranch, Info, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  EDGE_CONDITION_OPTIONS,
  KEYWORD_PRESETS,
  canvasEdgeLabel,
  collectRoutingMarkersForAgent,
  conditionalEdgeNeedsKeyword,
  getEdgeConditionMeta,
  isBackwardEdge,
  isEdgeEnabled,
  loopEdgeNeedsKeywordWarning,
  nodeDisplayName,
  roleContainsRoutingHint,
  routingInstructionForMarkers,
  type EdgeConditionKind,
} from "@/lib/edge-utils";
import type { GraphEdge, GraphNode } from "@/lib/mock-data";
import { toast } from "sonner";

const accentStyles = {
  neutral: "border-border/50 bg-muted/20 text-muted-foreground",
  green: "border-emerald-500/35 bg-emerald-500/[0.08] text-emerald-200/90",
  amber: "border-amber-500/35 bg-amber-500/[0.08] text-amber-200/90",
  cyan: "border-cyan-500/35 bg-cyan-500/[0.08] text-cyan-100/90",
  violet: "border-violet-500/35 bg-violet-500/[0.08] text-violet-100/90",
};

function RouteEndpoint({ name, role }: { name: string; role: "from" | "to" }) {
  return (
    <div className={cn(
      "flex-1 min-w-0 rounded-lg border px-2.5 py-2",
      role === "from" ? "border-border/50 bg-card/40" : "border-blue-500/25 bg-blue-500/[0.06]",
    )}>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">
        {role === "from" ? "From" : "To"}
      </div>
      <div className="text-[12px] font-medium text-foreground truncate" title={name}>{name}</div>
    </div>
  );
}

function ExampleCard({ title, children, accent }: { title: string; children: ReactNode; accent: keyof typeof accentStyles }) {
  return (
    <div className={cn("rounded-lg border px-3 py-2.5 space-y-1.5", accentStyles[accent])}>
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider opacity-90">
        <Info className="w-3 h-3 shrink-0" />
        {title}
      </div>
      <div className="text-[11px] leading-relaxed opacity-95">{children}</div>
    </div>
  );
}

export function EdgeInspectorPanel({
  edge,
  nodes,
  edges,
  onUpdateEdge,
  onEdgeDelete,
  onUpdateNode,
  onOpenRunSettings,
  maxLoopIterations = 5,
}: {
  edge: GraphEdge;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onUpdateEdge: (edgeId: string, patch: Partial<GraphEdge>) => void;
  onEdgeDelete: (edgeId: string) => void;
  onUpdateNode: (nodeId: string, patch: Partial<GraphNode>) => void;
  onOpenRunSettings?: () => void;
  maxLoopIterations?: number;
}) {
  const fromName = nodeDisplayName(edge.source, nodes);
  const toName = nodeDisplayName(edge.target, nodes);
  const kind = (edge.condition || "always") as EdgeConditionKind;
  const meta = getEdgeConditionMeta(edge.condition);
  const sourceAgent = nodes.find(n => n.id === edge.source && n.type === "agent");
  const routingMarkers = sourceAgent ? collectRoutingMarkersForAgent(edge.source, edges) : [];
  const routingHint = routingInstructionForMarkers(routingMarkers);
  const sourceHasRoutingHint = sourceAgent
    ? roleContainsRoutingHint(sourceAgent.role, routingMarkers)
    : false;
  const previewLabel = canvasEdgeLabel(edge);
  const needsKeyword = conditionalEdgeNeedsKeyword(edge) || loopEdgeNeedsKeywordWarning(edge);
  const outgoingBranches = edges.filter(
    e => e.source === edge.source && isEdgeEnabled(e) && e.id !== edge.id && (e.condition === "conditional" || e.condition === "loop"),
  );

  return (
    <div className="p-3 space-y-4 pb-6">
      <div className="flex items-center gap-1.5">
        <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground/90">Connection</span>
      </div>

      <div className="flex items-center gap-2">
        <RouteEndpoint name={fromName} role="from" />
        <ArrowRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
        <RouteEndpoint name={toName} role="to" />
      </div>

      {previewLabel && (
        <div className="text-[10px] text-muted-foreground/70 px-1">
          Canvas label: <span className="font-mono text-foreground/80">{previewLabel}</span>
        </div>
      )}

      <div className="flex items-center justify-between py-0.5 rounded-lg border border-border/40 bg-muted/10 px-2.5">
        <div>
          <Label className="text-[11px] text-foreground/85">Active in run</Label>
          <div className="text-[10px] text-muted-foreground/55">Off = visible only, not executed</div>
        </div>
        <Switch
          checked={edge.enabled !== false}
          onCheckedChange={v => onUpdateEdge(edge.id, { enabled: v })}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-[11px] text-muted-foreground">When to take this path</Label>
        <div className="grid grid-cols-1 gap-1.5">
          {EDGE_CONDITION_OPTIONS.map(opt => {
            const active = kind === opt.kind;
            return (
              <button
                key={opt.kind}
                type="button"
                onClick={() => onUpdateEdge(edge.id, {
                  condition: opt.kind === "always" ? undefined : opt.kind,
                })}
                className={cn(
                  "w-full text-left rounded-lg border px-2.5 py-2 transition-colors",
                  active
                    ? accentStyles[opt.accent]
                    : "border-border/40 bg-card/20 hover:border-border/60 hover:bg-accent/20",
                )}
              >
                <div className="flex items-center gap-2">
                  {opt.kind === "loop" && <RotateCcw className="w-3 h-3 shrink-0 opacity-80" />}
                  {opt.kind === "conditional" && <GitBranch className="w-3 h-3 shrink-0 opacity-80" />}
                  <span className="text-[12px] font-medium">{opt.label}</span>
                </div>
                <div className="text-[10px] opacity-75 mt-0.5 pl-5 leading-snug">{opt.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      {meta.example && (
        <ExampleCard title="Example" accent={meta.accent}>
          {meta.example}
        </ExampleCard>
      )}

      {(kind === "conditional" || kind === "loop") && (
        <div className="space-y-2">
          <Label htmlFor="edge-keyword" className="text-[11px] text-foreground/85">
            {kind === "loop" ? "Retry keyword" : "Branch keyword"}
          </Label>
          <Input
            id="edge-keyword"
            value={edge.label ?? ""}
            onChange={e => onUpdateEdge(edge.id, { label: e.target.value || undefined })}
            placeholder={kind === "loop" ? "needs_revision" : "approved"}
            className="h-9 text-sm font-mono"
          />
          <div className="flex flex-wrap gap-1.5">
            {KEYWORD_PRESETS.map(p => (
              <button
                key={p.value}
                type="button"
                title={p.hint}
                onClick={() => onUpdateEdge(edge.id, { label: p.value })}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-mono transition-colors",
                  edge.label === p.value
                    ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-100"
                    : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {p.value}
              </button>
            ))}
          </div>
          {needsKeyword && (
            <div className="text-[10px] text-amber-400/90 leading-snug rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-2 py-1.5">
              Pick a keyword above — without it this path may not route correctly.
            </div>
          )}
        </div>
      )}

      {kind === "conditional" && (
        <ExampleCard title="How it works (like Langflow If-Else)" accent="cyan">
          <div className="space-y-2 font-mono text-[10px] leading-relaxed">
            <div className="rounded bg-black/20 px-2 py-1.5 text-foreground/85 whitespace-pre-wrap">
              {`Reviewer output:\n"Summary looks good. approved"`}
            </div>
            <div className="text-[10px] font-sans opacity-90">
              → Path to <strong>{toName}</strong> runs because output contains «{edge.label || "approved"}».
            </div>
            {outgoingBranches.length > 0 && (
              <div className="text-[10px] font-sans opacity-80 pt-1 border-t border-white/10">
                {fromName} has {outgoingBranches.length + 1} branch path(s). Add different keywords on each edge.
              </div>
            )}
          </div>
        </ExampleCard>
      )}

      {kind === "loop" && (
        <ExampleCard title="Review loop" accent="violet">
          <div className="space-y-1.5 text-[10px] leading-relaxed">
            <div>{fromName} → {toName} when output contains «{edge.label || "needs_revision"}»</div>
            <div className="opacity-85">Pair with a forward branch (If «approved») to exit the cycle.</div>
            {!isBackwardEdge(edge, nodes) && (
              <div className="text-amber-300/90">Tip: loop edges usually go backward (left on canvas).</div>
            )}
            <div className="flex items-center justify-between pt-1">
              <span>Max retries</span>
              <span className="font-mono">{maxLoopIterations}</span>
            </div>
            {onOpenRunSettings && (
              <Button size="sm" variant="outline" className="w-full h-7 text-[10px] mt-1" onClick={onOpenRunSettings}>
                Open Run Settings
              </Button>
            )}
          </div>
        </ExampleCard>
      )}

      {sourceAgent && routingMarkers.length > 0 && (kind === "conditional" || kind === "loop") && (
        <div className="rounded-lg border border-violet-500/25 bg-violet-500/[0.06] px-2.5 py-2 space-y-2">
          <div className="text-[10px] text-muted-foreground/85">
            Teach <span className="font-medium text-foreground/80">{fromName}</span> to end with one of:{" "}
            <span className="font-mono text-violet-200/90">{routingMarkers.join(", ")}</span>
          </div>
          {!sourceHasRoutingHint && routingHint && (
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-[10px]"
              onClick={() => {
                const current = sourceAgent.role ?? "";
                onUpdateNode(sourceAgent.id, {
                  role: current.trim() ? `${current.trim()}\n\n${routingHint}` : routingHint,
                });
                toast.success("Routing hint added to agent role");
              }}
            >
              Add hint to {fromName} role
            </Button>
          )}
          {sourceHasRoutingHint && (
            <div className="text-[10px] text-emerald-400/85">Role already includes routing instructions.</div>
          )}
        </div>
      )}

      {(kind === "conditional" || outgoingBranches.length > 1) && (
        <div className="space-y-1">
          <Label htmlFor="edge-weight" className="text-[11px] text-muted-foreground">Priority weight</Label>
          <Input
            id="edge-weight"
            type="number"
            min={0}
            step={0.1}
            value={edge.weight ?? 1}
            onChange={e => onUpdateEdge(edge.id, { weight: Math.max(0, Number(e.target.value) || 0) })}
            className="h-8 text-xs font-mono"
          />
          <div className="text-[10px] text-muted-foreground/50">Higher weight wins when multiple paths match.</div>
        </div>
      )}

      <div className="flex gap-2 pt-2 border-t border-border/40">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-border/60 text-red-400 hover:text-red-300"
          onClick={() => onEdgeDelete(edge.id)}
        >
          <Trash2 className="w-3 h-3 mr-1.5" />
          Delete connection
        </Button>
      </div>
    </div>
  );
}
