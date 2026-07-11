// gMAS Tools Page — Manage runtime tools
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import {
  Plus, Search, Wrench, X, Edit3, MoreHorizontal,
  CheckCircle, XCircle, Shield, AlertTriangle, Activity,
  Clock, Zap, Eye, Copy, Settings2, Play, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Chip } from "@/components/ui/chip";
import { StatusLozenge } from "@/components/ui/status-lozenge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/AppShell";
import { ResizeRail } from "@/components/layout/ResizeRail";
import { type ToolState } from "@/lib/mock-data";
import { toolsApi, executionApi, type ToolInfo, type ToolRuntimeConfig } from "@/lib/api";

interface Tool {
  id: string;
  name: string;
  category: string;
  state: ToolState;
  scope: 'global' | 'agent' | 'graph';
  safety: 'safe' | 'restricted' | 'dangerous';
  calls: number;
  errors: number;
  latency: number;
  lastUsed: string;
  description: string;
  hasConfig: boolean;
}
import { toast } from "sonner";

function toolStateTone(state: ToolState): "success" | "warning" | "danger" | "neutral" {
  const map: Record<ToolState, "success" | "warning" | "danger" | "neutral"> = {
    enabled: "success",
    disabled: "neutral",
    sandboxed: "warning",
    restricted: "warning",
    degraded: "danger",
    missing_config: "danger",
  };
  return map[state] ?? "neutral";
}

function humanizeState(state: ToolState) {
  return state
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function safetyClass(safety: Tool['safety']) {
  return safety === 'safe' ? "text-green-400" :
         safety === 'restricted' ? "text-amber-400" : "text-red-400";
}

function ToolRow({ tool, selected, onClick, onToggleEnabled }: {
  tool: Tool;
  selected: boolean;
  onClick: () => void;
  onToggleEnabled: (tool: Tool) => void;
}) {
  const errorRate = tool.calls > 0 ? ((tool.errors / tool.calls) * 100).toFixed(1) : "0.0";

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 border-b border-border/40 hover:bg-accent/30 transition-colors cursor-pointer text-sm",
        selected && "bg-accent/50 border-l-2 border-l-amber-500"
      )}
    >
      <div className="w-36 shrink-0">
        <div className="font-mono text-xs font-medium truncate">{tool.name}</div>
        <div className="text-[10px] text-muted-foreground">{tool.category}</div>
      </div>
      <div className="w-28 shrink-0">
        <StatusLozenge tone={toolStateTone(tool.state)}>{humanizeState(tool.state)}</StatusLozenge>
      </div>
      <div className="w-16 shrink-0">
        <span className="text-xs font-mono text-muted-foreground capitalize">{tool.scope}</span>
      </div>
      <div className="w-16 shrink-0">
        <span className={cn("text-xs font-mono capitalize", safetyClass(tool.safety))}>{tool.safety}</span>
      </div>
      <div className="w-16 shrink-0 text-right">
        <span className="text-xs font-mono text-muted-foreground">{tool.calls.toLocaleString()}</span>
      </div>
      <div className="w-16 shrink-0 text-right">
        <span className={cn("text-xs font-mono", parseFloat(errorRate) > 5 ? "text-red-400" : "text-muted-foreground")}>
          {tool.errors > 0 ? `${errorRate}%` : "—"}
        </span>
      </div>
      <div className="w-16 shrink-0 text-right">
        <span className="text-xs font-mono text-muted-foreground">{tool.latency > 0 ? `${tool.latency}ms` : "—"}</span>
      </div>
      <div className="flex-1 text-right">
        <span className="text-xs text-muted-foreground/60">{tool.lastUsed}</span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onClick={e => e.stopPropagation()}
            className="p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {tool.state === "enabled" ? (
            <DropdownMenuItem onClick={e => { e.stopPropagation(); onToggleEnabled(tool); }} className="text-amber-400">
              <XCircle className="w-3 h-3 mr-2" />
              <span>Disable</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={e => { e.stopPropagation(); onToggleEnabled(tool); }} className="text-green-400">
              <CheckCircle className="w-3 h-3 mr-2" />
              <span>Enable</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={e => { e.stopPropagation(); onClick(); }}>
            <Eye className="w-3 h-3 mr-2" />
            <span>View details</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ToolDetail({
  tool,
  onClose,
  floating,
  onToggleFloating,
  onStartDrag,
  onToggleEnabled,
  toolConfig,
  onSaveConfig,
}: {
  tool: Tool;
  onClose: () => void;
  floating: boolean;
  onToggleFloating: () => void;
  onStartDrag: (event: React.PointerEvent) => void;
  onToggleEnabled: (tool: Tool) => void;
  toolConfig: ToolRuntimeConfig | null;
  onSaveConfig: (cfg: ToolRuntimeConfig) => Promise<void>;
}) {
  const toolEvents: { id: string; type: string; timestamp: string; message: string }[] = [];

  // Local draft for runtime config editing
  const [draft, setDraft] = useState<ToolRuntimeConfig>(() => toolConfig ?? { enabled_tools: [] });
  const [saving, setSaving] = useState(false);
  const [testQuery, setTestQuery] = useState("latest AI news");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; output?: string; error?: string | null } | null>(null);

  useEffect(() => {
    if (toolConfig) setDraft(toolConfig);
  }, [toolConfig]);

  return (
    <motion.div
      initial={{ x: 20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 20, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "h-full w-full bg-sidebar/50 flex flex-col",
        floating ? "border border-border/70 rounded-xl shadow-2xl bg-sidebar/90 backdrop-blur-sm" : "border-l border-border"
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border cursor-grab active:cursor-grabbing touch-none" onPointerDown={onStartDrag}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <Wrench className="w-4 h-4 text-amber-400" />
          </div>
          <span className="font-mono text-[15px] font-medium">{tool.name}</span>
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
          <button onClick={onClose} className="p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <Tabs defaultValue="config" className="flex flex-col flex-1 overflow-hidden">
        <div className="px-2 pt-1.5 border-b border-border">
          <TabsList className="w-full grid grid-cols-4 h-7 bg-muted/30 text-[10px]">
            <TabsTrigger value="config" className="text-[10px]">Config</TabsTrigger>
            <TabsTrigger value="runtime" className="text-[10px]">Runtime</TabsTrigger>
            <TabsTrigger value="invocations" className="text-[10px]">Invocations</TabsTrigger>
            <TabsTrigger value="schema" className="text-[10px]">Schema</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="config" className="flex-1 overflow-hidden m-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Status</div>
                <StatusLozenge tone={toolStateTone(tool.state)}>{humanizeState(tool.state)}</StatusLozenge>
              </div>

              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Description</div>
                <div className="text-xs text-muted-foreground leading-relaxed">{tool.description}</div>
              </div>

              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Safety Policy</div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Safety Level</span>
                    <span className={cn("font-mono capitalize", safetyClass(tool.safety))}>{tool.safety}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Scope</span>
                    <span className="font-mono capitalize">{tool.scope}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Runtime Ready</span>
                    <span className={cn("font-mono", tool.hasConfig ? "text-green-400" : "text-zinc-500")}>
                      {tool.hasConfig ? "yes" : "no"}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Performance</div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Total Calls</span>
                    <span className="font-mono">{tool.calls.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Errors</span>
                    <span className={cn("font-mono", tool.errors > 0 ? "text-red-400" : "text-green-400")}>{tool.errors}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Avg Latency</span>
                    <span className="font-mono">{tool.latency > 0 ? `${tool.latency}ms` : "—"}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Last Used</span>
                    <span className="text-muted-foreground/60">{tool.lastUsed}</span>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="runtime" className="flex-1 overflow-hidden m-0 flex flex-col">
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-3 space-y-4">
              {/* Shell config */}
              {tool.name === "shell" && (
                <div className="space-y-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Shell Settings</div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Timeout (s)</Label>
                    <Input
                      type="number" min={1} max={300}
                      value={draft.shell_timeout ?? 30}
                      onChange={e => setDraft(d => ({ ...d, shell_timeout: parseInt(e.target.value) || 30 }))}
                      className="h-7 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Max Output Size (bytes)</Label>
                    <Input
                      type="number" min={512}
                      value={draft.shell_max_output_size ?? 8192}
                      onChange={e => setDraft(d => ({ ...d, shell_max_output_size: parseInt(e.target.value) || 8192 }))}
                      className="h-7 text-xs font-mono"
                    />
                  </div>
                </div>
              )}

              {tool.name === "code_interpreter" && (
                <div className="space-y-2">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Code Interpreter Runtime</div>
                  <div className="rounded border border-border/50 bg-card/25 p-2 text-[10px] text-muted-foreground/70 leading-relaxed">
                    Python execution uses the API container runtime. It does not inherit Shell timeout or output settings.
                  </div>
                </div>
              )}

              {/* Web search config */}
              {tool.name === "web_search" && (
                <div className="space-y-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Web Search Settings</div>
                  <div className="rounded border border-border/50 bg-card/25 p-2 text-[10px] text-muted-foreground/70 leading-relaxed">
                    Env hints: <span className="font-mono">SERPER_API_KEY</span>, <span className="font-mono">TAVILY_API_KEY</span>,
                    <span className="font-mono"> BRAVE_API_KEY</span>, <span className="font-mono">EXA_API_KEY</span>,
                    <span className="font-mono"> GOOGLE_API_KEY</span> + <span className="font-mono">GOOGLE_CSE_ID</span>.
                    DuckDuckGo works without a key.
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-foreground/80">Enabled</div>
                    </div>
                    <Switch
                      checked={draft.web_search?.enabled ?? true}
                      onCheckedChange={v => setDraft(d => ({ ...d, web_search: { ...d.web_search, enabled: v } as typeof d.web_search }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Provider</Label>
                    <select
                      value={draft.web_search?.provider ?? "duckduckgo"}
                      onChange={e => setDraft(d => ({ ...d, web_search: { ...d.web_search, provider: e.target.value } as typeof d.web_search }))}
                      className="w-full h-7 px-2 text-[10px] font-mono rounded border border-border/60 bg-background"
                    >
                      <option value="duckduckgo">duckduckgo</option>
                      <option value="brave">brave</option>
                      <option value="serper">serper</option>
                      <option value="tavily">tavily</option>
                      <option value="exa">exa</option>
                      <option value="google">google</option>
                      <option value="searxng">searxng</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Max Results</Label>
                      <Input
                        type="number" min={1} max={20}
                        value={draft.web_search?.max_results ?? 5}
                        onChange={e => setDraft(d => ({ ...d, web_search: { ...d.web_search, max_results: parseInt(e.target.value) || 5 } as typeof d.web_search }))}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Timeout (s)</Label>
                      <Input
                        type="number" min={1} max={60}
                        value={draft.web_search?.timeout ?? 15}
                        onChange={e => setDraft(d => ({ ...d, web_search: { ...d.web_search, timeout: parseInt(e.target.value) || 15 } as typeof d.web_search }))}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Max Content (chars)</Label>
                      <Input
                        type="number" min={500}
                        value={draft.web_search?.max_content_length ?? 4000}
                        onChange={e => setDraft(d => ({ ...d, web_search: { ...d.web_search, max_content_length: parseInt(e.target.value) || 4000 } as typeof d.web_search }))}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Max Fetch Pages</Label>
                      <Input
                        type="number" min={0} max={10}
                        value={draft.web_search?.max_fetch_pages ?? 3}
                        onChange={e => setDraft(d => ({ ...d, web_search: { ...d.web_search, max_fetch_pages: parseInt(e.target.value) || 3 } as typeof d.web_search }))}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-foreground/80">Fetch Content</div>
                      <div className="text-[10px] text-muted-foreground/50">Actually visit and scrape pages</div>
                    </div>
                    <Switch
                      checked={draft.web_search?.fetch_content ?? false}
                      onCheckedChange={v => setDraft(d => ({ ...d, web_search: { ...d.web_search, fetch_content: v } as typeof d.web_search }))}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-foreground/80">Cache Results</div>
                    </div>
                    <Switch
                      checked={draft.web_search?.cache_enabled ?? true}
                      onCheckedChange={v => setDraft(d => ({ ...d, web_search: { ...d.web_search, cache_enabled: v } as typeof d.web_search }))}
                    />
                  </div>
                  {draft.web_search?.cache_enabled && (
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Cache TTL (s)</Label>
                      <Input
                        type="number" min={0}
                        value={draft.web_search?.cache_ttl ?? 300}
                        onChange={e => setDraft(d => ({ ...d, web_search: { ...d.web_search, cache_ttl: parseFloat(e.target.value) || 300 } as typeof d.web_search }))}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                  )}
                  <div className="border-t border-border/40 pt-3 space-y-2">
                    <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Test Web Search</div>
                    <Input
                      value={testQuery}
                      onChange={e => setTestQuery(e.target.value)}
                      placeholder="search query"
                      className="h-7 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full h-7 text-xs border-border/60"
                      disabled={testing || !testQuery.trim()}
                      onClick={async () => {
                        setTesting(true);
                        setTestResult(null);
                        try {
                          await onSaveConfig(draft);
                          const result = await toolsApi.test("web_search", { query: testQuery.trim() });
                          setTestResult({ success: result.success, output: result.output, error: result.error });
                          if (result.success) toast.success("web_search test passed");
                          else toast.error("web_search test failed", { description: result.error ?? "No output" });
                        } catch (err) {
                          const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Tool test failed";
                          setTestResult({ success: false, error: msg });
                          toast.error(msg);
                        } finally {
                          setTesting(false);
                        }
                      }}
                    >
                      {testing ? "Testing…" : "Run test search"}
                    </Button>
                    {testResult && (
                      <div className={cn(
                        "rounded border p-2 text-[10px] leading-relaxed whitespace-pre-wrap max-h-32 overflow-auto",
                        testResult.success ? "border-green-500/25 bg-green-500/5 text-green-300/90" : "border-red-500/25 bg-red-500/5 text-red-300/90",
                      )}>
                        {testResult.success ? (testResult.output || "Success") : (testResult.error || "Failed")}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* File search config */}
              {tool.name === "file_search" && (
                <div className="space-y-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">File Search Settings</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Max Results</Label>
                      <Input
                        type="number" min={1}
                        value={draft.file_search_max_results ?? 50}
                        onChange={e => setDraft(d => ({ ...d, file_search_max_results: parseInt(e.target.value) || 50 }))}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Max Depth</Label>
                      <Input
                        type="number" min={1}
                        value={draft.file_search_max_depth ?? 10}
                        onChange={e => setDraft(d => ({ ...d, file_search_max_depth: parseInt(e.target.value) || 10 }))}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              {tool.name === "mcp" && (
                <div className="space-y-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">MCP Client Settings</div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Enabled</Label>
                    <Switch
                      checked={draft.mcp?.enabled ?? false}
                      onCheckedChange={v => setDraft(d => ({ ...d, mcp: { ...d.mcp, enabled: v } as typeof d.mcp }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Server URL</Label>
                    <Input
                      value={draft.mcp?.url ?? ""}
                      onChange={e => setDraft(d => ({ ...d, mcp: { ...d.mcp, url: e.target.value || null } as typeof d.mcp }))}
                      placeholder="https://mcp.example.com/sse"
                      className="h-7 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Timeout (s)</Label>
                    <Input
                      type="number" min={1}
                      value={draft.mcp?.timeout ?? 30}
                      onChange={e => setDraft(d => ({ ...d, mcp: { ...d.mcp, timeout: parseFloat(e.target.value) || 30 } as typeof d.mcp }))}
                      className="h-7 text-xs font-mono"
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground/50 leading-relaxed">
                    On save, the backend opens a session to the MCP server and registers every tool it advertises.
                  </div>
                </div>
              )}

              {tool.name === "vector_search" && (
                <div className="space-y-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Vector Search Settings</div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Enabled</Label>
                    <Switch
                      checked={draft.vector_search?.enabled ?? false}
                      onCheckedChange={v => setDraft(d => ({ ...d, vector_search: { ...d.vector_search, enabled: v } as typeof d.vector_search }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Store Type</Label>
                    <select
                      value={draft.vector_search?.store_type ?? "in_memory"}
                      onChange={e => setDraft(d => ({ ...d, vector_search: { ...d.vector_search, store_type: e.target.value } as typeof d.vector_search }))}
                      className="w-full h-7 text-xs rounded border border-border bg-background font-mono px-2"
                    >
                      <option value="in_memory">in_memory</option>
                      <option value="faiss">faiss</option>
                      <option value="qdrant">qdrant</option>
                      <option value="pinecone">pinecone</option>
                      <option value="milvus">milvus</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Top-K</Label>
                      <Input
                        type="number" min={1}
                        value={draft.vector_search?.top_k ?? 5}
                        onChange={e => setDraft(d => ({ ...d, vector_search: { ...d.vector_search, top_k: parseInt(e.target.value) || 5 } as typeof d.vector_search }))}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Score Threshold</Label>
                      <Input
                        type="number" min={0} max={1} step={0.05}
                        value={draft.vector_search?.score_threshold ?? 0}
                        onChange={e => setDraft(d => ({ ...d, vector_search: { ...d.vector_search, score_threshold: parseFloat(e.target.value) || 0 } as typeof d.vector_search }))}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Max Context Tokens</Label>
                    <Input
                      type="number" min={256}
                      value={draft.vector_search?.max_context_tokens ?? 4096}
                      onChange={e => setDraft(d => ({ ...d, vector_search: { ...d.vector_search, max_context_tokens: parseInt(e.target.value) || 4096 } as typeof d.vector_search }))}
                      className="h-7 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Citation Mode</Label>
                    <select
                      value={draft.vector_search?.citation_mode ?? "numbered"}
                      onChange={e => setDraft(d => ({ ...d, vector_search: { ...d.vector_search, citation_mode: e.target.value } as typeof d.vector_search }))}
                      className="w-full h-7 text-xs rounded border border-border bg-background font-mono px-2"
                    >
                      <option value="numbered">numbered</option>
                      <option value="inline">inline</option>
                      <option value="none">none</option>
                    </select>
                  </div>
                </div>
              )}

              {tool.name === "computer_use" && (
                <div className="space-y-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Computer Use Settings</div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Enabled</Label>
                    <Switch
                      checked={draft.computer_use?.enabled ?? false}
                      onCheckedChange={v => setDraft(d => ({ ...d, computer_use: { ...d.computer_use, enabled: v } as typeof d.computer_use }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Runtime</Label>
                    <select
                      value={draft.computer_use?.runtime_name ?? "mock"}
                      onChange={e => setDraft(d => ({ ...d, computer_use: { ...d.computer_use, runtime_name: e.target.value } as typeof d.computer_use }))}
                      className="w-full h-7 text-xs rounded border border-border bg-background font-mono px-2"
                    >
                      <option value="auto">auto</option>
                      <option value="mock">mock</option>
                      <option value="linux_native">linux_native</option>
                      <option value="macos_native">macos_native</option>
                      <option value="windows_native">windows_native</option>
                    </select>
                  </div>
                  <div className="text-[10px] text-muted-foreground/50 leading-relaxed">
                    "mock" is safe and deterministic. Native runtimes require local desktop dependencies.
                  </div>
                </div>
              )}

              {!["shell", "code_interpreter", "web_search", "file_search", "mcp", "vector_search", "computer_use"].includes(tool.name) && (
                <div className="text-[10px] text-muted-foreground/40 text-center py-6">No configurable runtime settings for this tool</div>
              )}
            </div>
          </ScrollArea>
          <div className="border-t border-border p-3 shrink-0">
            <Button
              size="sm"
              className="w-full h-7 text-xs bg-amber-600 hover:bg-amber-500 text-white"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSaveConfig(draft);
                  toast.success("Runtime config saved");
                } catch {
                  toast.error("Failed to save config");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving…" : "Save Runtime Config"}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="invocations" className="flex-1 overflow-hidden m-0">
          <ScrollArea className="h-full">
            <div className="p-2 space-y-1">
              {toolEvents.slice(0, 6).map(ev => (
                <div key={ev.id} className="p-2.5 rounded border border-border/30 bg-card/20 hover:bg-card/40 transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={cn(
                      "h-5 rounded-full px-2.5 text-[10px] font-mono tracking-wide uppercase border",
                      ev.type === 'tool_error' ? "bg-red-500/15 text-red-400 border-red-500/25" :
                      ev.type === 'tool_end' ? "bg-green-500/15 text-green-400 border-green-500/25" :
                      "bg-amber-500/15 text-amber-400 border-amber-500/25"
                    )}>
                      {ev.type}
                    </Badge>
                    <span className="text-[9px] font-mono text-muted-foreground/50">{ev.timestamp}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">{ev.message}</div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="schema" className="flex-1 overflow-hidden m-0">
          <div className="p-4">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Input Schema</div>
            <pre className="text-[10px] font-mono text-muted-foreground/60 bg-muted/20 rounded p-2 overflow-x-auto">
{`{
  "query": "string",
  "limit": "integer?",
  "filters": "object?"
}`}
            </pre>
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2 mt-4">Output Schema</div>
            <pre className="text-[10px] font-mono text-muted-foreground/60 bg-muted/20 rounded p-2 overflow-x-auto">
{`{
  "results": "array",
  "count": "integer",
  "metadata": "object"
}`}
            </pre>
          </div>
        </TabsContent>
      </Tabs>

      {/* Actions */}
      <div className="border-t border-border p-3">
        {tool.state === 'enabled' ? (
          <Button size="sm" variant="outline" className="w-full h-7 text-xs border-border/60 text-amber-400" onClick={() => onToggleEnabled(tool)}>
            <XCircle className="w-3 h-3 mr-1" /> Disable Tool
          </Button>
        ) : tool.state === "missing_config" ? (
          <Button size="sm" variant="outline" className="w-full h-7 text-xs border-border/60 text-amber-400" onClick={() => onToggleEnabled(tool)}>
            <Settings2 className="w-3 h-3 mr-1" /> Configure Runtime
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="w-full h-7 text-xs border-border/60 text-green-400" onClick={() => onToggleEnabled(tool)}>
            <CheckCircle className="w-3 h-3 mr-1" /> Enable Tool
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function toDisplayTool(info: ToolInfo, config: ToolRuntimeConfig | null): Tool {
  const allowlisted = !config?.enabled_tools || config.enabled_tools.includes(info.name);
  let runtimeReady = true;
  if (info.name === "web_search") runtimeReady = config?.web_search?.enabled !== false;
  if (info.name === "mcp") runtimeReady = config?.mcp?.enabled === true && !!config.mcp.url?.trim();
  if (info.name === "vector_search") runtimeReady = config?.vector_search?.enabled === true;
  if (info.name === "computer_use") runtimeReady = config?.computer_use?.enabled === true;
  const state: ToolState = !allowlisted ? "disabled" : runtimeReady ? "enabled" : "missing_config";
  return {
    id: info.name,
    name: info.name,
    category: "tool",
    state,
    scope: "global",
    safety: "safe",
    calls: 0,
    errors: 0,
    latency: 0,
    lastUsed: "—",
    description: info.description,
    hasConfig: runtimeReady,
  };
}

export default function Tools() {
  const layoutRef = useRef<HTMLDivElement>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [toolConfig, setToolConfig] = useState<ToolRuntimeConfig | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [detailWidth, setDetailWidth] = useState(344);
  const [floatingDetail, setFloatingDetail] = useState(false);
  const [isPending, startUiTransition] = useTransition();
  const deferredSearch = useDeferredValue(search);
  const detailDragControls = useDragControls();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [infos, cfg, runs] = await Promise.all([
          toolsApi.list(),
          toolsApi.getConfig(),
          executionApi.history().catch(() => []),
        ]);
        if (cancelled) return;

        // Compute per-tool metrics from run history
        const stats: Record<string, { calls: number; errors: number; durations: number[] }> = {};
        for (const run of runs) {
          for (const ev of run.events) {
            const d = (ev.data as Record<string, unknown> | null) ?? {};
            const toolName = (ev as unknown as Record<string, unknown>).tool_name as string | undefined
              ?? d.tool_name as string | undefined;
            if (!toolName) continue;
            if (!stats[toolName]) stats[toolName] = { calls: 0, errors: 0, durations: [] };
            if (ev.event_type === "tool_end") {
              stats[toolName].calls += 1;
              const dur = (ev as unknown as Record<string, unknown>).duration_ms as number | undefined
                ?? d.duration_ms as number | undefined;
              if (typeof dur === "number") stats[toolName].durations.push(dur);
            } else if (ev.event_type === "tool_error") {
              stats[toolName].errors += 1;
              stats[toolName].calls += 1;
            }
          }
        }

        startTransition(() => {
          setToolConfig(cfg);
          setTools(infos.map((i) => {
            const base = toDisplayTool(i, cfg);
            const s = stats[i.name];
            if (!s || s.calls === 0) return base;
            const latency = s.durations.length
              ? Math.round(s.durations.reduce((a, b) => a + b, 0) / s.durations.length)
              : 0;
            return { ...base, calls: s.calls, errors: s.errors, latency };
          }));
        });
      } catch {
        if (!cancelled) toast.error("Failed to load tools");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSaveConfig(cfg: ToolRuntimeConfig) {
    const saved = await toolsApi.updateConfig(cfg);
    setToolConfig(saved);
    const enabledNow = saved.enabled_tools ?? tools.map(t => t.id);
    startUiTransition(() => setTools(prev => prev.map(t => toDisplayTool({ name: t.id, description: t.description, parameters_schema: {} }, { ...saved, enabled_tools: enabledNow }))));
  }

  async function handleToggleEnabled(tool: Tool) {
    if (tool.state === "missing_config") {
      setSelected(tool.id);
      toast.info("Complete the Runtime settings before enabling this tool");
      return;
    }
    const cfg = toolConfig ?? { enabled_tools: tools.map(t => t.id) };
    const currentlyEnabled = tool.state === "enabled";
    const newEnabledList = currentlyEnabled
      ? (cfg.enabled_tools ?? tools.map(t => t.id)).filter(n => n !== tool.id)
      : [...new Set([...(cfg.enabled_tools ?? tools.map(t => t.id)), tool.id])];
    const newConfig: ToolRuntimeConfig = { ...cfg, enabled_tools: newEnabledList };
    try {
      const saved = await toolsApi.updateConfig(newConfig);
      setToolConfig(saved);
      startUiTransition(() => {
        setTools((prev) => prev.map((t) =>
          t.id === tool.id ? toDisplayTool(
            { name: t.id, description: t.description, parameters_schema: {} },
            saved,
          ) : t
        ));
      });
      toast.success(`${tool.name} ${currentlyEnabled ? "disabled" : "enabled"}`);
    } catch {
      toast.error("Failed to update tool config");
    }
  }

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const filtered = useMemo(() => {
    const normalizedSearch = deferredSearch.trim().toLowerCase();
    return tools.filter((t) => {
      const matchSearch = normalizedSearch.length === 0
        || t.name.toLowerCase().includes(normalizedSearch)
        || t.category.toLowerCase().includes(normalizedSearch);
      const matchState = stateFilter === "all" || t.state === stateFilter;
      return matchSearch && matchState;
    });
  }, [tools, stateFilter, deferredSearch]);

  const selectedTool = tools.find(t => t.id === selected);

  const states = ["all", "enabled", "sandboxed", "restricted", "disabled", "missing_config"];

  return (
    <AppShell
      breadcrumb={[{ label: "Tools" }]}
      actions={
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search tools..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm w-52 bg-card border-border/60"
            />
          </div>
          <Button
            size="sm"
            className="h-8 text-sm bg-amber-600 hover:bg-amber-500 text-white"
            onClick={() => {
              // Refresh tools list from backend
              toolsApi.list().then(infos => {
                startUiTransition(() => setTools(infos.map(i => toDisplayTool(i, toolConfig))));
                toast.success(`Refreshed: ${infos.length} tools available`);
              }).catch(() => toast.error("Failed to refresh tools"));
            }}
            title="Refresh tool registry from backend"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
        </div>
      }
    >
      <div ref={layoutRef} className="relative flex h-full overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* State filter tabs */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-border/50 bg-muted/10 shrink-0 overflow-x-auto overflow-y-hidden">
            {states.map(s => (
              <Chip
                key={s}
                onClick={() => setStateFilter(s)}
                active={stateFilter === s}
              >
                {s === "all" ? `All (${tools.length})` : s.replace('_', ' ')}
              </Chip>
            ))}
          </div>

          {/* Column headers */}
          <div className="overflow-x-auto overflow-y-hidden border-b border-border bg-muted/10 shrink-0">
            <div className="flex min-w-[860px] items-center gap-3 px-4 py-2">
              <div className="w-36 shrink-0 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Tool</div>
              <div className="w-28 shrink-0 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">State</div>
              <div className="w-16 shrink-0 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Scope</div>
              <div className="w-16 shrink-0 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Safety</div>
              <div className="w-16 shrink-0 text-right text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Calls</div>
              <div className="w-16 shrink-0 text-right text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Errors</div>
              <div className="w-16 shrink-0 text-right text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Latency</div>
              <div className="flex-1 text-right text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Last Used</div>
              <div className="w-6 shrink-0" />
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="overflow-x-auto overflow-y-hidden">
            <div className="min-w-[860px]">
              {filtered.map(tool => (
                <ToolRow
                  key={tool.id}
                  tool={tool}
                  selected={selected === tool.id}
                  onClick={() => setSelected(tool.id)}
                  onToggleEnabled={handleToggleEnabled}
                />
              ))}
            </div>
            </div>
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground/40">
                <Wrench className="w-8 h-8 mb-2 opacity-30" />
                <div className="text-sm">No tools found</div>
              </div>
            )}
          </ScrollArea>

          {/* Footer */}
          <div className="border-t border-border px-4 py-2 flex items-center gap-6 text-[11px] font-mono text-muted-foreground bg-muted/10 shrink-0">
            <span>{tools.length} tools total</span>
            <span>{tools.filter(t => t.state === 'enabled').length} enabled</span>
            <span>{tools.filter(t => t.state === 'sandboxed').length} sandboxed</span>
            <span className="text-red-400">{tools.filter(t => t.state === 'missing_config').length} missing config</span>
          </div>
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {selectedTool && !floatingDetail && (
            <motion.div
              key={selectedTool.id}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: detailWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
              className="flex shrink-0 overflow-hidden"
            >
              <ResizeRail side="right" onResize={(delta) => setDetailWidth(w => clamp(w + delta, 300, 560))} />
              <div style={{ width: detailWidth }} className="h-full shrink-0">
              <ToolDetail
                tool={selectedTool}
                floating={false}
                onToggleFloating={() => setFloatingDetail(true)}
                onStartDrag={() => {}}
                onClose={() => setSelected(null)}
                onToggleEnabled={handleToggleEnabled}
                toolConfig={toolConfig}
                onSaveConfig={handleSaveConfig}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

        <AnimatePresence>
          {selectedTool && floatingDetail && (
            <motion.div
              key={`${selectedTool.id}-floating`}
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
              <ToolDetail
                tool={selectedTool}
                floating
                onToggleFloating={() => setFloatingDetail(false)}
                onStartDrag={(event) => detailDragControls.start(event)}
                onClose={() => setSelected(null)}
                onToggleEnabled={handleToggleEnabled}
                toolConfig={toolConfig}
                onSaveConfig={handleSaveConfig}
              />
            </motion.div>
          )}
        </AnimatePresence>
        {isPending && (
          <div className="absolute right-4 bottom-4 rounded-md border border-border/60 bg-card/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
            Updating...
          </div>
        )}
      </div>
    </AppShell>
  );
}
