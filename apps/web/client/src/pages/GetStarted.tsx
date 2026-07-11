import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  Clock3,
  FilePlus2,
  GitBranch,
  Loader2,
  Network,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { graphsApi, type GraphListItem, type GraphTemplate } from "@/lib/api";

function formatUpdatedAt(value?: string) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function GetStarted() {
  const [, navigate] = useLocation();
  const [graphs, setGraphs] = useState<GraphListItem[]>([]);
  const [templates, setTemplates] = useState<GraphTemplate[]>([]);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("Untitled workflow");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [savedGraphs, graphTemplates] = await Promise.all([
          graphsApi.list(),
          graphsApi.templates(),
        ]);
        if (!cancelled) {
          setGraphs(savedGraphs);
          setTemplates(graphTemplates);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load workspace");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredGraphs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return graphs;
    return graphs.filter((graph) =>
      [graph.name, graph.description, graph.graph_id]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [graphs, query]);

  async function createBlankGraph() {
    setCreating(true);
    setError(null);
    try {
      const graph = await graphsApi.create({
        name: newName.trim() || "Untitled workflow",
        description: "New workspace graph",
        agents: [],
        edges: [],
        positions: {},
        run_config: { timeout: 180 },
      });
      navigate(`/workflow/${graph.graph_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create graph");
    } finally {
      setCreating(false);
    }
  }

  async function createFromTemplate(templateId: string) {
    setCreating(true);
    setError(null);
    try {
      const graph = await graphsApi.createFromTemplate(templateId);
      navigate(`/workflow/${graph.graph_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create template graph");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/95">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-blue-500/30 bg-blue-500/10">
              <GitBranch className="h-3.5 w-3.5 text-blue-400" />
            </div>
            <span className="text-sm font-semibold">gMAS</span>
          </Link>
          <Button variant="ghost" size="sm" onClick={() => navigate("/workflow")}>
            Open current canvas
            <ArrowRight className="ml-2 h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Default project
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Open a saved workflow, create a blank flow, or start from a template.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              className="h-9 sm:w-64"
              placeholder="New workflow name"
            />
            <Button onClick={createBlankGraph} disabled={creating} className="h-9">
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              New project
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="mb-8 rounded-xl border border-border/60 bg-card/40">
          <div className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <Network className="h-4 w-4 text-blue-400" />
                Saved workflows
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{graphs.length} saved</div>
            </div>
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search workflows"
                className="h-9 pl-9"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading projects
            </div>
          ) : filteredGraphs.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-center">
              <FilePlus2 className="mb-3 h-8 w-8 text-muted-foreground/50" />
              <div className="text-sm font-medium">No workflows found</div>
              <div className="mt-1 text-sm text-muted-foreground">Create a new project or choose a template below.</div>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {filteredGraphs.map((graph) => (
                <button
                  key={graph.graph_id}
                  onClick={() => navigate(`/workflow/${graph.graph_id}`)}
                  className="group grid w-full grid-cols-1 gap-3 p-4 text-left transition hover:bg-accent/35 md:grid-cols-[minmax(0,1fr)_140px_140px_32px]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{graph.name || "Untitled workflow"}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {graph.description || graph.graph_id}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground md:text-right">
                    {graph.agent_count} agents · {graph.edge_count} edges
                  </div>
                  <div className="inline-flex items-center gap-1 text-xs text-muted-foreground md:justify-end">
                    <Clock3 className="h-3 w-3" />
                    {formatUpdatedAt(graph.updated_at)}
                  </div>
                  <ArrowRight className="hidden h-4 w-4 self-center justify-self-end text-muted-foreground transition group-hover:translate-x-1 group-hover:text-foreground md:block" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-violet-400" />
            Templates
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.slice(0, 6).map((template) => (
              <button
                key={template.template_id}
                onClick={() => createFromTemplate(template.template_id)}
                disabled={creating}
                className="rounded-lg border border-border/60 bg-card/35 p-4 text-left transition hover:border-violet-500/40 hover:bg-accent/30 disabled:cursor-wait disabled:opacity-60"
              >
                <div className="text-sm font-medium">{template.name}</div>
                <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{template.description}</div>
                <div className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground">
                  {template.category}
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
