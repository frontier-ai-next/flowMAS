import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  CalendarClock, Pause, Play, Plus, RefreshCw, Trash2, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusLozenge } from "@/components/ui/status-lozenge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { apiErrorMessage, futureLocalDateTimeToIso } from "@/lib/schedule-utils";
import {
  graphsApi,
  schedulesApi,
  type GraphListItem,
  type ScheduleItem,
  type ScheduleType,
} from "@/lib/api";

const SCHEDULE_TYPES: { id: ScheduleType; label: string; hint: string }[] = [
  { id: "cron", label: "Cron", hint: "e.g. 0 9 * * * — daily at 09:00" },
  { id: "interval", label: "Interval", hint: "Repeat every N seconds (min 30)" },
  { id: "once", label: "Once", hint: "Single run at a specific date/time" },
];

function formatWhen(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function Schedules() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const preselectedGraph = new URLSearchParams(search).get("graph") ?? "";
  const preselectionHandled = useRef(false);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [graphs, setGraphs] = useState<GraphListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    graph_id: "",
    task_query: "",
    schedule_type: "cron" as ScheduleType,
    cron_expression: "0 9 * * *",
    interval_seconds: 3600,
    run_at: "",
    timezone: "UTC",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [schedules, graphList] = await Promise.all([
        schedulesApi.list(),
        graphsApi.list(),
      ]);
      setItems(schedules);
      setGraphs(graphList);
    } catch {
      toast.error("Failed to load schedules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (
      !preselectionHandled.current
      && preselectedGraph
      && graphs.some(g => g.graph_id === preselectedGraph)
    ) {
      preselectionHandled.current = true;
      setForm(f => ({ ...f, graph_id: preselectedGraph }));
      setDialogOpen(true);
    }
  }, [preselectedGraph, graphs]);

  const submitCreate = async () => {
    if (!form.name.trim() || !form.graph_id || !form.task_query.trim()) {
      toast.error("Name, graph, and task are required");
      return;
    }
    let runAt: string | undefined;
    if (form.schedule_type === "once") {
      try {
        runAt = futureLocalDateTimeToIso(form.run_at);
      } catch (error) {
        toast.error(apiErrorMessage(error, "Invalid run date/time"));
        return;
      }
    }
    try {
      await schedulesApi.create({
        name: form.name.trim(),
        graph_id: form.graph_id,
        task_query: form.task_query.trim(),
        schedule_type: form.schedule_type,
        cron_expression: form.schedule_type === "cron" ? form.cron_expression : undefined,
        interval_seconds: form.schedule_type === "interval" ? form.interval_seconds : undefined,
        run_at: runAt,
        timezone: form.timezone || "UTC",
        enabled: true,
      });
      toast.success("Schedule created");
      setDialogOpen(false);
      void load();
    } catch (err: unknown) {
      const msg = apiErrorMessage(err, "Create failed");
      toast.error("Could not create schedule", { description: msg });
    }
  };

  const togglePause = async (item: ScheduleItem) => {
    try {
      if (item.enabled) await schedulesApi.pause(item.schedule_id);
      else await schedulesApi.resume(item.schedule_id);
      void load();
    } catch {
      toast.error("Failed to update schedule");
    }
  };

  const runNow = async (item: ScheduleItem) => {
    try {
      const res = await schedulesApi.runNow(item.schedule_id);
      toast.success("Run started", { description: res.last_run_id || item.schedule_id });
      void load();
    } catch {
      toast.error("Failed to trigger run");
    }
  };

  const remove = async (item: ScheduleItem) => {
    try {
      await schedulesApi.delete(item.schedule_id);
      toast.success("Schedule deleted");
      void load();
    } catch {
      toast.error("Failed to delete");
    }
  };

  return (
    <AppShell
      title="Schedules"
      breadcrumb={[{ label: "Operate" }, { label: "Schedules" }]}
      actions={(
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New schedule
        </Button>
      )}
    >
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
        <div className="rounded-lg border border-border/50 bg-card/20 px-4 py-3 text-sm text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground/90">Background runs</span> — like Langflow Background Agents:
          restart the whole workflow on a <strong>cron</strong>, fixed <strong>interval</strong>, or a <strong>one-shot</strong> datetime.
          Each trigger starts a new run (visible on Runs).
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <span className="text-xs text-muted-foreground">{items.length} schedule(s)</span>
        </div>

        <div className="space-y-2">
          {items.map(item => (
            <div
              key={item.schedule_id}
              className="rounded-lg border border-border/40 bg-card/25 p-4 flex flex-col sm:flex-row sm:items-start gap-3"
            >
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <CalendarClock className="w-4 h-4 text-violet-400 shrink-0" />
                  <span className="font-medium text-sm truncate">{item.name}</span>
                  <StatusLozenge tone={item.enabled ? "success" : "neutral"} withDot={item.enabled}>
                    {item.enabled ? "Active" : "Paused"}
                  </StatusLozenge>
                  <Chip className="capitalize text-[10px]">{item.schedule_type}</Chip>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  Graph: {item.graph_name || item.graph_id} · {item.task_query.slice(0, 80)}
                  {item.task_query.length > 80 ? "…" : ""}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-muted-foreground/70">
                  {item.schedule_type === "cron" && item.cron_expression && (
                    <span>cron: {item.cron_expression}</span>
                  )}
                  {item.schedule_type === "interval" && item.interval_seconds != null && (
                    <span>every {item.interval_seconds}s</span>
                  )}
                  {item.schedule_type === "once" && item.run_at && (
                    <span>at {formatWhen(item.run_at)}</span>
                  )}
                  <span>next: {formatWhen(item.next_run_at)}</span>
                  <span>runs: {item.run_count}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 shrink-0">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void runNow(item)}>
                  <Zap className="w-3 h-3 mr-1" /> Run now
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void togglePause(item)}>
                  {item.enabled ? <Pause className="w-3 h-3 mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                  {item.enabled ? "Pause" : "Resume"}
                </Button>
                {item.last_run_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => navigate(`/runs?run=${item.last_run_id}`)}
                  >
                    Last run
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-red-400"
                  onClick={() => void remove(item)}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
          {!loading && items.length === 0 && (
            <div className="text-center py-16 text-sm text-muted-foreground/60">
              No schedules yet. Create one to run a saved graph automatically.
            </div>
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New schedule</DialogTitle>
            <DialogDescription>
              Pick a saved graph and when to re-run it with the same task query.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Daily report" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Graph</Label>
              <select
                value={form.graph_id}
                onChange={e => setForm(f => ({ ...f, graph_id: e.target.value }))}
                className="w-full h-8 px-2 text-sm rounded border border-border bg-background"
              >
                <option value="">Select graph…</option>
                {graphs.map(g => (
                  <option key={g.graph_id} value={g.graph_id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Task query</Label>
              <Textarea
                value={form.task_query}
                onChange={e => setForm(f => ({ ...f, task_query: e.target.value }))}
                placeholder="What should each scheduled run do?"
                className="min-h-16 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Schedule type</Label>
              <div className="flex flex-wrap gap-1">
                {SCHEDULE_TYPES.map(t => (
                  <Chip
                    key={t.id}
                    active={form.schedule_type === t.id}
                    onClick={() => setForm(f => ({ ...f, schedule_type: t.id }))}
                  >
                    {t.label}
                  </Chip>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {SCHEDULE_TYPES.find(t => t.id === form.schedule_type)?.hint}
              </p>
            </div>
            {form.schedule_type === "cron" && (
              <div className="space-y-1">
                <Label className="text-xs">Cron (5 fields, UTC by default)</Label>
                <Input
                  value={form.cron_expression}
                  onChange={e => setForm(f => ({ ...f, cron_expression: e.target.value }))}
                  className="h-8 text-sm font-mono"
                  placeholder="0 9 * * *"
                />
              </div>
            )}
            {form.schedule_type === "interval" && (
              <div className="space-y-1">
                <Label className="text-xs">Interval (seconds)</Label>
                <Input
                  type="number"
                  min={30}
                  value={form.interval_seconds}
                  onChange={e => setForm(f => ({ ...f, interval_seconds: Number(e.target.value) || 3600 }))}
                  className="h-8 text-sm font-mono"
                />
              </div>
            )}
            {form.schedule_type === "once" && (
              <div className="space-y-1">
                <Label className="text-xs">Run at (local datetime)</Label>
                <Input
                  type="datetime-local"
                  name="run_at"
                  aria-label="Run at (local datetime)"
                  value={form.run_at}
                  onChange={e => setForm(f => ({ ...f, run_at: e.target.value }))}
                  onInput={e => setForm(f => ({ ...f, run_at: e.currentTarget.value }))}
                  className="h-8 text-sm"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitCreate()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
