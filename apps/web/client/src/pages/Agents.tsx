// gMAS Agents Page — Manage reusable agents
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import {
  Plus, Search, Bot, Edit3, Copy, Trash2, Wrench, Cpu,
  Database, TrendingUp, Clock, CheckCircle2, AlertCircle,
  ChevronRight, MoreHorizontal, Filter, X, Activity
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/AppShell";
import { ResizeRail } from "@/components/layout/ResizeRail";
import { type Agent } from "@/lib/mock-data";
import { agentsApi, configApi, toolsApi, executionApi, type AgentResponse, type AgentCreate, type AgentLLMConfig, type LLMProviderConfig, type ToolInfo } from "@/lib/api";
import { toast } from "sonner";

type DisplayAgent = Agent & {
  llmConfig?: AgentLLMConfig;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

// Map backend AgentResponse → local Agent shape for display
function toDisplayAgent(a: AgentResponse): DisplayAgent {
  return {
    id: a.agent_id,
    name: a.display_name,
    role: a.persona || a.description || "",
    model: a.llm_config?.model_name ?? a.llm_backbone ?? "—",
    provider: "",
    tools: a.tools ?? [],
    schemas: [],
    successRate: 0,
    avgTokens: 0,
    avgLatency: 0,
    lastUsed: "—",
    status: "active",
    persona: a.persona ?? "",
    description: a.description ?? "",
    memoryEnabled: false,
    usedInGraphs: [],
    llmConfig: a.llm_config,
    inputSchema: a.input_schema ?? undefined,
    outputSchema: a.output_schema ?? undefined,
  };
}

function AgentStatusDot({ status }: { status: Agent['status'] }) {
  return (
    <div className={cn(
      "w-1.5 h-1.5 rounded-full shrink-0",
      status === 'active' ? "bg-green-500" :
      status === 'inactive' ? "bg-zinc-500" : "bg-red-500"
    )} />
  );
}

function AgentRow({ agent, selected, onClick, onEdit, onDelete, onDuplicate }: {
  agent: DisplayAgent;
  selected: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (agent: DisplayAgent) => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 border-b border-border/40 hover:bg-accent/30 transition-colors cursor-pointer text-sm",
        selected && "bg-accent/50 border-l-2 border-l-blue-500"
      )}
    >
      <AgentStatusDot status={agent.status} />
      <div className="w-36 shrink-0">
        <div className="font-medium text-[13px] truncate">{agent.name}</div>
        <div className="text-[10px] font-mono text-blue-400/60 truncate">{agent.id}</div>
        {agent.role && <div className="text-[11px] text-muted-foreground truncate">{agent.role}</div>}
      </div>
      <div className="w-28 shrink-0">
        <span className="text-xs font-mono text-muted-foreground">{agent.model}</span>
      </div>
      <div className="w-20 shrink-0">
        <div className="flex gap-1 flex-wrap">
          {agent.tools.slice(0, 2).map(t => (
            <Badge key={t} className="h-5 rounded-full px-2.5 text-[10px] font-mono border border-amber-500/25 bg-amber-500/12 text-amber-300 backdrop-blur-[1px]">
              {t.length > 8 ? t.slice(0, 8) + '…' : t}
            </Badge>
          ))}
          {agent.tools.length > 2 && (
            <span className="text-[10px] font-mono text-muted-foreground/60">+{agent.tools.length - 2}</span>
          )}
        </div>
      </div>
      <div className="w-16 shrink-0 text-right">
        <span className="text-xs font-mono text-green-400">{agent.successRate}%</span>
      </div>
      <div className="w-20 shrink-0 text-right">
        <span className="text-xs font-mono text-muted-foreground">{agent.avgTokens.toLocaleString()}</span>
      </div>
      <div className="w-20 shrink-0 text-right">
        <span className="text-xs font-mono text-muted-foreground">{agent.avgLatency}ms</span>
      </div>
      <div className="flex-1 text-right">
        <span className="text-xs text-muted-foreground/60">{agent.lastUsed}</span>
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
          <DropdownMenuItem onClick={e => { e.stopPropagation(); onEdit?.(); }}>
            <Edit3 className="w-3 h-3 mr-2" />
            <span>Edit</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={e => { e.stopPropagation(); onDuplicate?.(agent); }}>
            <Copy className="w-3 h-3 mr-2" />
            <span>Duplicate</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={e => { e.stopPropagation(); onDelete?.(agent.id); }}
            className="text-red-400"
          >
            <Trash2 className="w-3 h-3 mr-2" />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AgentDetail({
  agent,
  onClose,
  floating,
  onToggleFloating,
  onStartDrag,
  onDelete,
  onDuplicate,
  onEdit,
}: {
  agent: DisplayAgent;
  onClose: () => void;
  floating: boolean;
  onToggleFloating: () => void;
  onStartDrag: (event: React.PointerEvent) => void;
  onDelete: (id: string) => void;
  onDuplicate: (agent: DisplayAgent) => void;
  onEdit: (agent: DisplayAgent) => void;
}) {
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
          <div className="w-7 h-7 rounded bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
            <Bot className="w-4 h-4 text-blue-400" />
          </div>
          <span className="font-medium text-[15px]">{agent.name}</span>
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
          <TabsList className="w-full grid grid-cols-3 h-7 bg-muted/30 text-[10px]">
            <TabsTrigger value="config" className="text-[10px]">Config</TabsTrigger>
            <TabsTrigger value="stats" className="text-[10px]">Stats</TabsTrigger>
            <TabsTrigger value="history" className="text-[10px]">History</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="config" className="flex-1 overflow-hidden m-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              {/* Persona */}
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Persona</div>
                <div className="text-xs text-muted-foreground bg-muted/20 rounded p-2 leading-relaxed">{agent.persona}</div>
              </div>
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Description</div>
                <div className="text-xs text-muted-foreground leading-relaxed">{agent.description}</div>
              </div>

              {/* Model */}
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Model Config</div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Provider</span>
                    <span className="font-mono">{agent.provider}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Model</span>
                    <span className="font-mono">{agent.model}</span>
                  </div>
                  {agent.llmConfig?.temperature != null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Temperature</span>
                      <span className="font-mono">{agent.llmConfig.temperature}</span>
                    </div>
                  )}
                  {agent.llmConfig?.top_p != null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Top-P</span>
                      <span className="font-mono">{agent.llmConfig.top_p}</span>
                    </div>
                  )}
                  {agent.llmConfig?.top_k != null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Top-K</span>
                      <span className="font-mono">{agent.llmConfig.top_k}</span>
                    </div>
                  )}
                  {agent.llmConfig?.tool_choice && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Tool choice</span>
                      <span className="font-mono">{agent.llmConfig.tool_choice}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Task Memory</span>
                    <span className={cn("text-[10px] font-mono", agent.memoryEnabled ? "text-green-400" : "text-zinc-500")}>
                      {agent.memoryEnabled ? "enabled" : "disabled"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Tools */}
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Tools ({agent.tools.length})</div>
                <div className="flex flex-wrap gap-1">
                  {agent.tools.map(t => (
                    <Badge key={t} className="h-5 rounded-full px-2.5 text-[10px] font-mono border border-amber-500/25 bg-amber-500/12 text-amber-300 backdrop-blur-[1px]">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Schemas */}
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Schemas</div>
                <div className="flex flex-wrap gap-1">
                  {agent.schemas.map(s => (
                    <Badge key={s} className="h-5 rounded-full px-2.5 text-[10px] font-mono border border-violet-500/25 bg-violet-500/12 text-violet-300 backdrop-blur-[1px]">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* IO Schemas */}
              {(agent.inputSchema || agent.outputSchema) && (
                <div className="space-y-3">
                  {agent.inputSchema && (
                    <div>
                      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Input Schema</div>
                      <pre className="text-[10px] font-mono text-muted-foreground/70 bg-muted/20 rounded p-2 overflow-x-auto leading-relaxed">
                        {JSON.stringify(agent.inputSchema, null, 2)}
                      </pre>
                    </div>
                  )}
                  {agent.outputSchema && (
                    <div>
                      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Output Schema</div>
                      <pre className="text-[10px] font-mono text-muted-foreground/70 bg-muted/20 rounded p-2 overflow-x-auto leading-relaxed">
                        {JSON.stringify(agent.outputSchema, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Used in */}
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Used in Graphs</div>
                <div className="space-y-1">
                  {agent.usedInGraphs.map(g => (
                    <div key={g} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ChevronRight className="w-3 h-3" />
                      <span className="font-mono">{g}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="stats" className="flex-1 overflow-hidden m-0">
          <div className="p-4 space-y-3">
            {[
              { label: "Success Rate", value: `${agent.successRate}%`, icon: CheckCircle2, color: "text-green-400" },
              { label: "Avg Tokens", value: agent.avgTokens.toLocaleString(), icon: Activity, color: "text-violet-400" },
              { label: "Avg Latency", value: `${agent.avgLatency}ms`, icon: Clock, color: "text-blue-400" },
              { label: "Last Used", value: agent.lastUsed, icon: TrendingUp, color: "text-amber-400" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="flex items-center gap-3 p-3 rounded border border-border/40 bg-card/30">
                <Icon className={cn("w-4 h-4 shrink-0", color)} />
                <div className="flex-1">
                  <div className="text-[10px] text-muted-foreground">{label}</div>
                  <div className="text-sm font-mono font-medium">{value}</div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="history" className="flex-1 overflow-hidden m-0">
          <div className="p-4 text-xs text-muted-foreground/50 text-center mt-8">Recent executions will appear here</div>
        </TabsContent>
      </Tabs>

      {/* Actions */}
      <div className="border-t border-border p-3 flex gap-2">
        <Button size="sm" variant="outline" className="flex-1 h-7 text-xs border-border/60" onClick={() => onEdit(agent)}>
          <Edit3 className="w-3 h-3 mr-1" /> Edit
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs border-border/60" onClick={() => onDuplicate(agent)}>
          <Copy className="w-3 h-3" />
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs border-border/60 text-red-400 hover:text-red-300"
          onClick={() => onDelete(agent.id)}>
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Agent Create/Edit Dialog ─────────────────────────────────────────────────
interface AgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: DisplayAgent;
  providers: LLMProviderConfig[];
  availableTools: ToolInfo[];
  onSubmit: (data: AgentCreate) => Promise<void>;
}

function AgentDialog({ open, onOpenChange, mode, initial, providers, availableTools, onSubmit }: AgentDialogProps) {
  const [agentId, setAgentId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [persona, setPersona] = useState("");
  const [description, setDescription] = useState("");
  const [providerId, setProviderId] = useState<string>("");
  const [modelName, setModelName] = useState("");
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [temperature, setTemperature] = useState("");
  const [topP, setTopP] = useState("");
  const [topK, setTopK] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [timeout, setTimeout_] = useState("");
  const [toolCallingEnabled, setToolCallingEnabled] = useState(true);
  const [toolChoice, setToolChoice] = useState<"auto" | "none" | "required">("auto");
  const [parallelToolCalls, setParallelToolCalls] = useState(true);
  const [inputSchemaText, setInputSchemaText] = useState("");
  const [outputSchemaText, setOutputSchemaText] = useState("");
  const [inputSchemaError, setInputSchemaError] = useState("");
  const [outputSchemaError, setOutputSchemaError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      const initialConfig = initial?.llmConfig;
      if (mode === "edit" && initial) {
        setAgentId(initial.id);
        setDisplayName(initial.name);
        setPersona(initial.persona);
        setDescription(initial.description);
        setModelName(initial.model !== "—" ? initial.model : "");
        setSelectedTools(initial.tools);
        const matchedProvider = providers.find(p =>
          (initialConfig?.base_url && p.base_url === initialConfig.base_url)
          || (initialConfig?.api_key && p.api_key === initialConfig.api_key)
        );
        setProviderId(matchedProvider?.provider_id ?? "");
      } else {
        setAgentId("");
        setDisplayName("");
        setPersona("");
        setDescription("");
        setModelName(providers[0]?.default_model ?? "");
        setSelectedTools([]);
        setProviderId(providers[0]?.provider_id ?? "");
      }
      setTemperature(initialConfig?.temperature != null ? String(initialConfig.temperature) : "");
      setTopP(initialConfig?.top_p != null ? String(initialConfig.top_p) : "");
      setTopK(initialConfig?.top_k != null ? String(initialConfig.top_k) : "");
      setMaxTokens(initialConfig?.max_tokens != null ? String(initialConfig.max_tokens) : "");
      setTimeout_(initialConfig?.timeout != null ? String(initialConfig.timeout) : "");
      setToolCallingEnabled(initialConfig?.tool_calling_enabled ?? true);
      setToolChoice(initialConfig?.tool_choice ?? "auto");
      setParallelToolCalls(initialConfig?.parallel_tool_calls ?? true);
      setInputSchemaText(initial?.inputSchema ? JSON.stringify(initial.inputSchema, null, 2) : "");
      setOutputSchemaText(initial?.outputSchema ? JSON.stringify(initial.outputSchema, null, 2) : "");
      setInputSchemaError("");
      setOutputSchemaError("");
    }
  }, [open, mode, initial, providers]);

  const handleSubmit = async () => {
    if (!displayName.trim()) {
      toast.error("Display name is required");
      return;
    }
    const id = mode === "edit"
      ? agentId
      : (agentId.trim() || displayName.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now().toString(36));

    const provider = providers.find(p => p.provider_id === providerId);
    const existingConfig = initial?.llmConfig;
    const parseOptionalFloat = (value: string) => value !== "" && Number.isFinite(Number(value)) ? Number(value) : undefined;
    const parseOptionalInt = (value: string) => value !== "" && Number.isFinite(Number(value)) ? parseInt(value, 10) : undefined;
    const llmConfig: AgentLLMConfig | undefined = modelName || provider || existingConfig || temperature || topP || topK || maxTokens || timeout
      ? {
          model_name: modelName || provider?.default_model || existingConfig?.model_name,
          base_url: provider?.base_url ?? existingConfig?.base_url,
          api_key: provider?.api_key ?? existingConfig?.api_key,
          temperature: parseOptionalFloat(temperature),
          top_p: parseOptionalFloat(topP),
          top_k: parseOptionalInt(topK),
          max_tokens: parseOptionalInt(maxTokens),
          timeout: parseOptionalFloat(timeout),
          tool_calling_enabled: toolCallingEnabled,
          tool_choice: toolChoice,
          parallel_tool_calls: parallelToolCalls,
          extra_params: existingConfig?.extra_params,
        }
      : undefined;
    let parsedInputSchema: Record<string, unknown> | undefined;
    let parsedOutputSchema: Record<string, unknown> | undefined;
    if (inputSchemaText.trim()) {
      try { parsedInputSchema = JSON.parse(inputSchemaText); setInputSchemaError(""); }
      catch { setInputSchemaError("Invalid JSON"); return; }
    }
    if (outputSchemaText.trim()) {
      try { parsedOutputSchema = JSON.parse(outputSchemaText); setOutputSchemaError(""); }
      catch { setOutputSchemaError("Invalid JSON"); return; }
    }
    const payload: AgentCreate = {
      agent_id: id,
      display_name: displayName,
      persona: persona || undefined,
      description: description || undefined,
      llm_backbone: modelName || undefined,
      llm_config: llmConfig,
      tools: selectedTools,
      input_schema: parsedInputSchema,
      output_schema: parsedOutputSchema,
    };

    setSubmitting(true);
    try {
      await onSubmit(payload);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTool = (toolName: string) => {
    setSelectedTools(prev =>
      prev.includes(toolName) ? prev.filter(t => t !== toolName) : [...prev, toolName]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] w-full flex flex-col gap-0 p-0 max-h-[90vh]">
        {/* Header — fixed */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border shrink-0">
          <DialogTitle className="text-base">{mode === "create" ? "Create Agent" : "Edit Agent"}</DialogTitle>
          <DialogDescription className="text-xs">
            {mode === "create" ? "Define a new agent with persona, model and tools." : "Update agent configuration."}
          </DialogDescription>
        </DialogHeader>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-h-0">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="agent-id" className="text-xs">
                Agent ID {mode === "edit" && <span className="text-muted-foreground">(read-only)</span>}
              </Label>
              <Input
                id="agent-id"
                value={agentId}
                onChange={e => setAgentId(e.target.value)}
                placeholder="auto-generated"
                disabled={mode === "edit"}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="display-name" className="text-xs">Display Name *</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="My Agent"
                className="h-9 text-sm"
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="persona" className="text-xs">Persona / Role</Label>
            <Input
              id="persona"
              value={persona}
              onChange={e => setPersona(e.target.value)}
              placeholder="e.g. You are a senior Python developer..."
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description" className="text-xs">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What does this agent do?"
              rows={3}
              className="text-sm resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="provider" className="text-xs">LLM Provider</Label>
              <select
                id="provider"
                value={providerId}
                onChange={e => {
                  setProviderId(e.target.value);
                  const p = providers.find(x => x.provider_id === e.target.value);
                  if (p?.default_model) setModelName(p.default_model);
                }}
                className="w-full h-9 px-2 text-sm rounded border border-border bg-background"
              >
                <option value="">— none —</option>
                {providers.map(p => (
                  <option key={p.provider_id} value={p.provider_id}>{p.display_name || p.provider_id}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model" className="text-xs">Model</Label>
              <Input
                id="model"
                value={modelName}
                onChange={e => setModelName(e.target.value)}
                placeholder="gpt-4o"
                className="h-9 text-sm font-mono"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Sampling</Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="temperature" className="text-xs">Temperature</Label>
                <Input
                  id="temperature"
                  type="number"
                  min="0" max="2" step="0.05"
                  value={temperature}
                  onChange={e => setTemperature(e.target.value)}
                  placeholder="0.7"
                  className="h-9 text-sm font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="top-p" className="text-xs">Top-P</Label>
                <Input
                  id="top-p"
                  type="number"
                  min="0" max="1" step="0.05"
                  value={topP}
                  onChange={e => setTopP(e.target.value)}
                  placeholder="1.0"
                  className="h-9 text-sm font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="top-k" className="text-xs">Top-K</Label>
                <Input
                  id="top-k"
                  type="number"
                  min="1" step="1"
                  value={topK}
                  onChange={e => setTopK(e.target.value)}
                  placeholder="40"
                  className="h-9 text-sm font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max-tokens" className="text-xs">Max Tokens</Label>
                <Input
                  id="max-tokens"
                  type="number"
                  min="1" step="128"
                  value={maxTokens}
                  onChange={e => setMaxTokens(e.target.value)}
                  placeholder="2048"
                  className="h-9 text-sm font-mono"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Tool Calling</Label>
            <div className="grid grid-cols-2 gap-4">
              <label className="flex items-center gap-2 rounded border border-border bg-muted/20 px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={toolCallingEnabled}
                  onChange={e => setToolCallingEnabled(e.target.checked)}
                  className="rounded"
                />
                <span>Enabled</span>
              </label>
              <label className="flex items-center gap-2 rounded border border-border bg-muted/20 px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={parallelToolCalls}
                  onChange={e => setParallelToolCalls(e.target.checked)}
                  className="rounded"
                  disabled={!toolCallingEnabled}
                />
                <span className={cn(!toolCallingEnabled && "text-muted-foreground")}>Parallel calls</span>
              </label>
              <div className="space-y-1.5">
                <Label htmlFor="tool-choice" className="text-xs">Tool choice</Label>
                <select
                  id="tool-choice"
                  value={toolChoice}
                  onChange={e => setToolChoice(e.target.value as "auto" | "none" | "required")}
                  disabled={!toolCallingEnabled}
                  className="w-full h-9 px-2 text-sm rounded border border-border bg-background font-mono disabled:opacity-50"
                >
                  <option value="auto">auto</option>
                  <option value="required">required</option>
                  <option value="none">none</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="timeout" className="text-xs">Timeout (s)</Label>
                <Input
                  id="timeout"
                  type="number"
                  min="1" step="1"
                  value={timeout}
                  onChange={e => setTimeout_(e.target.value)}
                  placeholder="60"
                  className="h-9 text-sm font-mono"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Tools ({selectedTools.length} selected)</Label>
            <div className="border border-border rounded-md bg-muted/20 divide-y divide-border/50">
              {availableTools.length === 0 ? (
                <div className="text-xs text-muted-foreground px-3 py-3">No tools available. Configure tools in the Tools page.</div>
              ) : (
                availableTools.map(t => (
                  <label key={t.name} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-accent/30 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedTools.includes(t.name)}
                      onChange={() => toggleTool(t.name)}
                      className="mt-0.5 rounded shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-mono font-medium">{t.name}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{t.description}</div>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Structured IO Schemas</Label>
            <div className="text-[10px] text-muted-foreground/50 leading-relaxed -mt-1">
              Optional JSON Schema objects that validate agent input / output at runtime.
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="input-schema" className="text-xs">Input Schema</Label>
                <Textarea
                  id="input-schema"
                  value={inputSchemaText}
                  onChange={e => { setInputSchemaText(e.target.value); setInputSchemaError(""); }}
                  placeholder={'{\n  "type": "object",\n  "properties": {}\n}'}
                  rows={5}
                  className={cn("text-[11px] font-mono resize-none", inputSchemaError && "border-red-500/60")}
                />
                {inputSchemaError && <div className="text-[10px] text-red-400">{inputSchemaError}</div>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="output-schema" className="text-xs">Output Schema</Label>
                <Textarea
                  id="output-schema"
                  value={outputSchemaText}
                  onChange={e => { setOutputSchemaText(e.target.value); setOutputSchemaError(""); }}
                  placeholder={'{\n  "type": "object",\n  "properties": {}\n}'}
                  rows={5}
                  className={cn("text-[11px] font-mono resize-none", outputSchemaError && "border-red-500/60")}
                />
                {outputSchemaError && <div className="text-[10px] text-red-400">{outputSchemaError}</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Footer — fixed */}
        <DialogFooter className="px-6 py-4 border-t border-border shrink-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting} className="bg-blue-600 hover:bg-blue-500 text-white">
            {submitting ? "Saving..." : mode === "create" ? "Create Agent" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Agents() {
  const layoutRef = useRef<HTMLDivElement>(null);
  const [agents, setAgents] = useState<DisplayAgent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [detailWidth, setDetailWidth] = useState(344);
  const [floatingDetail, setFloatingDetail] = useState(false);
  const detailDragControls = useDragControls();

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [dialogAgent, setDialogAgent] = useState<DisplayAgent | undefined>(undefined);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [providers, setProviders] = useState<LLMProviderConfig[]>([]);
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  // Load agents from backend
  useEffect(() => {
    // Load agents then enrich with metrics from run history
    Promise.all([
      agentsApi.list(),
      executionApi.history().catch(() => []),
    ]).then(([agentData, runs]) => {
      // Per-agent stats: { tokens[], durations[], errors, total }
      const stats: Record<string, { tokens: number[]; durations: number[]; errors: number; total: number }> = {};
      for (const run of runs) {
        const isSuccess = run.status === "completed";
        for (const ev of run.events) {
          if (ev.event_type !== "agent_output") continue;
          const aid = ev.agent_id;
          if (!aid) continue;
          const d = (ev.data as Record<string, unknown> | null) ?? {};
          const tokens = ev.tokens_used ?? (typeof d.tokens_used === "number" ? d.tokens_used : 0);
          const duration = ev.duration_ms ?? (typeof d.duration_ms === "number" ? d.duration_ms : 0);
          if (!stats[aid]) stats[aid] = { tokens: [], durations: [], errors: 0, total: 0 };
          stats[aid].tokens.push(tokens as number);
          stats[aid].durations.push(duration as number);
          stats[aid].total += 1;
          if (!isSuccess) stats[aid].errors += 1;
        }
      }
      setAgents(agentData.map(a => {
        const s = stats[a.agent_id];
        if (!s || s.total === 0) return toDisplayAgent(a);
        const avgTokens = Math.round(s.tokens.reduce((x, y) => x + y, 0) / s.tokens.length);
        const avgLatency = Math.round(s.durations.reduce((x, y) => x + y, 0) / s.durations.length);
        const successRate = Math.round(((s.total - s.errors) / s.total) * 100);
        return { ...toDisplayAgent(a), avgTokens, avgLatency, successRate };
      }));
    }).catch(() => toast.error("Failed to load agents"));
    configApi.listProviders()
      .then(setProviders)
      .catch(() => {/* providers are optional */});
    toolsApi.list()
      .then(setAvailableTools)
      .catch(() => {/* tools are optional */});
  }, []);

  const openCreate = () => {
    setDialogMode("create");
    setDialogAgent(undefined);
    setDialogOpen(true);
  };

  const openEdit = (agent: DisplayAgent) => {
    setDialogMode("edit");
    setDialogAgent(agent);
    setDialogOpen(true);
  };

  const handleSubmitAgent = async (data: AgentCreate) => {
    try {
      if (dialogMode === "create") {
        const created = await agentsApi.create(data);
        setAgents(prev => [...prev, toDisplayAgent(created)]);
        toast.success(`Agent "${data.display_name}" created`);
      } else {
        const updated = await agentsApi.update(data.agent_id, {
          display_name: data.display_name,
          persona: data.persona,
          description: data.description,
          llm_backbone: data.llm_backbone,
          llm_config: data.llm_config,
          tools: data.tools,
        });
        setAgents(prev => prev.map(a => a.id === data.agent_id ? toDisplayAgent(updated) : a));
        toast.success(`Agent "${data.display_name}" updated`);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || (dialogMode === "create" ? "Failed to create agent" : "Failed to update agent");
      toast.error(msg);
      throw err;
    }
  };

  const handleDelete = async (id: string) => {
    setDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await agentsApi.delete(deleteId);
      setAgents(prev => prev.filter(a => a.id !== deleteId));
      if (selected === deleteId) setSelected(null);
      toast.success("Agent deleted");
    } catch {
      toast.error("Failed to delete agent");
    } finally {
      setDeleteId(null);
    }
  };

  const handleDuplicate = async (agent: DisplayAgent) => {
    try {
      const newId = `${agent.id}-copy-${Date.now().toString(36)}`;
      const created = await agentsApi.create({
        agent_id: newId,
        display_name: `${agent.name} (copy)`,
        persona: agent.persona,
        description: agent.description,
        llm_backbone: agent.model !== "—" ? agent.model : undefined,
        llm_config: agent.llmConfig,
        tools: agent.tools,
      });
      setAgents(prev => [...prev, toDisplayAgent(created)]);
      toast.success("Agent duplicated");
    } catch {
      toast.error("Failed to duplicate agent");
    }
  };

  const filtered = agents.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.role.toLowerCase().includes(search.toLowerCase())
  );

  const selectedAgent = agents.find(a => a.id === selected);

  return (
    <AppShell
      breadcrumb={[{ label: "Agents" }]}
      actions={
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search agents..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm w-52 bg-card border-border/60"
            />
          </div>
          <Button size="sm" className="h-8 text-sm bg-blue-600 hover:bg-blue-500 text-white" onClick={openCreate}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Create Agent
          </Button>
        </div>
      }
    >
      <div ref={layoutRef} className="relative flex h-full overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Column headers */}
          <div className="overflow-x-auto overflow-y-hidden border-b border-border bg-muted/10 shrink-0">
            <div className="flex min-w-[900px] items-center gap-3 px-4 py-2">
            <div className="w-1.5 shrink-0" />
            <div className="w-36 shrink-0 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Agent</div>
            <div className="w-28 shrink-0 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Model</div>
            <div className="w-20 shrink-0 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Tools</div>
            <div className="w-16 shrink-0 text-right text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Success</div>
            <div className="w-20 shrink-0 text-right text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Avg Tokens</div>
            <div className="w-20 shrink-0 text-right text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Latency</div>
            <div className="flex-1 text-right text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Last Used</div>
            <div className="w-6 shrink-0" />
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="overflow-x-auto overflow-y-hidden">
            <div className="min-w-[900px]">
              {filtered.map(agent => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  selected={selected === agent.id}
                  onClick={() => setSelected(agent.id)}
                  onEdit={() => openEdit(agent)}
                  onDelete={handleDelete}
                  onDuplicate={handleDuplicate}
                />
              ))}
            </div>
            </div>
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground/40">
                <Bot className="w-8 h-8 mb-2 opacity-30" />
                <div className="text-sm">No agents found</div>
              </div>
            )}
          </ScrollArea>

          {/* Footer stats */}
          <div className="border-t border-border px-4 py-2 flex items-center gap-6 text-[11px] font-mono text-muted-foreground bg-muted/10 shrink-0">
            <span>{agents.length} agents total</span>
            <span>{agents.filter(a => a.status === 'active').length} active</span>
            <span>{agents.filter(a => a.memoryEnabled).length} with task memory</span>
          </div>
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {selectedAgent && !floatingDetail && (
            <motion.div
              key={selectedAgent.id}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: detailWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
              className="flex shrink-0 overflow-hidden"
            >
              <ResizeRail side="right" onResize={(delta) => setDetailWidth(w => clamp(w + delta, 300, 560))} />
              <div style={{ width: detailWidth }} className="h-full shrink-0">
                <AgentDetail
                  agent={selectedAgent}
                  floating={false}
                  onToggleFloating={() => setFloatingDetail(true)}
                  onStartDrag={() => {}}
                  onClose={() => setSelected(null)}
                  onDelete={handleDelete}
                  onDuplicate={handleDuplicate}
                  onEdit={openEdit}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {selectedAgent && floatingDetail && (
            <motion.div
              key={`${selectedAgent.id}-floating`}
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
              <AgentDetail
                agent={selectedAgent}
                floating
                onToggleFloating={() => setFloatingDetail(false)}
                onStartDrag={(event) => detailDragControls.start(event)}
                onClose={() => setSelected(null)}
                onDelete={handleDelete}
                onDuplicate={handleDuplicate}
                onEdit={openEdit}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AgentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        initial={dialogAgent}
        providers={providers}
        availableTools={availableTools}
        onSubmit={handleSubmitAgent}
      />

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete agent <span className="font-mono text-foreground">{deleteId}</span>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-500 text-white" onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
