// gMAS Settings Page — Project, Runtime, Providers, Secrets, Integrations
import { startTransition, useEffect, useState, useTransition } from "react";
import { motion } from "framer-motion";
import {
  Settings2, Key, Plug, Bell, Shield, Database, Cpu,
  Eye, EyeOff, Copy, Plus, Trash2, CheckCircle2, AlertTriangle,
  ExternalLink, RefreshCw, Save, GitBranch, Zap, Globe, Activity
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusLozenge } from "@/components/ui/status-lozenge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { AppShell } from "@/components/AppShell";
import { useChipStyle } from "@/contexts/ChipStyleContext";
import { configApi, type LLMProviderConfig, type RunnerConfigSchema } from "@/lib/api";
import { toast } from "sonner";

const sections = [
  { id: "project", label: "Project", icon: Settings2 },
  { id: "runtime", label: "Runtime", icon: Cpu },
  { id: "providers", label: "LLM Providers", icon: Zap },
  { id: "memory", label: "Memory", icon: Database },
  { id: "secrets", label: "Secrets", icon: Key },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
];


const secrets = [
  { id: "s1", name: "OPENAI_API_KEY", value: "sk-...a4f2", lastUsed: "2 min ago", usedBy: ["ResearchAgent", "ReviewerAgent"] },
  { id: "s2", name: "ANTHROPIC_API_KEY", value: "sk-ant-...b3c1", lastUsed: "12 min ago", usedBy: ["WriterAgent"] },
  { id: "s3", name: "BRAVE_SEARCH_KEY", value: "BSA-...9f21", lastUsed: "1 min ago", usedBy: ["web_search"] },
  { id: "s4", name: "POSTGRES_URL", value: "postgres://...@host:5432/db", lastUsed: "45 min ago", usedBy: ["postgres_query"] },
];

function SectionNav({ active, onChange }: { active: string; onChange: (id: string) => void }) {
  return (
    <div className="w-48 border-r border-border py-4 shrink-0">
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2 px-4">Settings</div>
      <nav className="space-y-0.5 px-2">
        {sections.map(s => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => onChange(s.id)}
              className={cn(
                "flex items-center gap-2.5 w-full px-2 py-2 rounded-md text-sm transition-colors",
                active === s.id
                  ? "text-foreground bg-accent/60"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {s.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function ProjectSettings() {
  const { chipStyle, setChipStyle } = useChipStyle();

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h3 className="text-sm font-semibold mb-4">Project Settings</h3>
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Project Name</Label>
            <Input defaultValue="gMAS Research Workspace" className="h-8 text-sm bg-card border-border/60" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Default Graph</Label>
            <Input defaultValue="research-pipeline" className="h-8 text-sm font-mono bg-card border-border/60" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Workspace Description</Label>
            <textarea
              className="w-full h-16 text-sm bg-card border border-border/60 rounded-md p-2 resize-none text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-blue-500/50"
              defaultValue="Multi-agent research and content creation workspace"
            />
          </div>
        </div>
      </div>

      <div className="border-t border-border/40 pt-6">
        <h3 className="text-sm font-semibold mb-4">Appearance</h3>
        <div className="mb-5 space-y-3 rounded-lg border border-border/50 bg-card/30 p-3">
          <div>
            <div className="text-sm">Chip Style Preset</div>
            <div className="text-xs text-muted-foreground">Choose the visual style for filter chips and status lozenges across app pages.</div>
          </div>
          <div className="flex items-center gap-2">
            <Chip active={chipStyle === "linear"} onClick={() => setChipStyle("linear")}>
              Linear-like
            </Chip>
            <Chip active={chipStyle === "apple"} onClick={() => setChipStyle("apple")}>
              Apple-like
            </Chip>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-background/40 p-2">
            <StatusLozenge tone="info" withDot>Running</StatusLozenge>
            <StatusLozenge tone="success">Succeeded</StatusLozenge>
            <StatusLozenge tone="warning">Sandboxed</StatusLozenge>
            <StatusLozenge tone="danger">Failed</StatusLozenge>
          </div>
        </div>
        <div className="space-y-3">
          {[
            { label: "Compact Mode", desc: "Reduce padding and spacing in tables", defaultChecked: false },
            { label: "Show Token Counts", desc: "Display token usage on graph nodes", defaultChecked: true },
            { label: "Animate Edges", desc: "Animate active edges during execution", defaultChecked: true },
            { label: "Auto-scroll Console", desc: "Auto-scroll to latest events", defaultChecked: true },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between py-1">
              <div>
                <div className="text-sm">{item.label}</div>
                <div className="text-xs text-muted-foreground">{item.desc}</div>
              </div>
              <Switch defaultChecked={item.defaultChecked} />
            </div>
          ))}
        </div>
      </div>

      <Button className="bg-blue-600 hover:bg-blue-500 text-white h-8 text-xs" onClick={() => toast.success("Settings saved")}>
        <Save className="w-3.5 h-3.5 mr-2" /> Save Changes
      </Button>
    </div>
  );
}

function RuntimeSettings() {
  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h3 className="text-sm font-semibold mb-4">Execution Defaults</h3>
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Default Strategy</Label>
            <div className="flex gap-2">
              {["sequential", "parallel", "adaptive"].map(s => (
                <button
                  key={s}
                  className={cn(
                    "px-3 py-1.5 rounded border text-xs font-mono capitalize transition-all",
                    s === "sequential"
                      ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                      : "border-border/40 text-muted-foreground hover:border-border/70"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Max Iterations per Run</Label>
            <div className="flex items-center gap-3">
              <Slider defaultValue={[20]} max={100} step={5} className="flex-1" />
              <span className="text-xs font-mono text-muted-foreground w-8">20</span>
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Global Token Budget</Label>
            <Input defaultValue="200000" className="h-8 text-sm font-mono bg-card border-border/60" />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Execution Timeout (seconds)</Label>
            <Input defaultValue="300" className="h-8 text-sm font-mono bg-card border-border/60" />
          </div>
        </div>
      </div>

      <div className="border-t border-border/40 pt-6">
        <h3 className="text-sm font-semibold mb-4">Features</h3>
        <div className="space-y-3">
          {[
            { label: "Streaming Mode", desc: "Stream events via WebSocket", defaultChecked: true },
            { label: "Dynamic Topology", desc: "Allow runtime graph mutations", defaultChecked: false },
            { label: "Auto-retry on Failure", desc: "Retry failed agents up to 3 times", defaultChecked: true },
            { label: "Guardrail Checks", desc: "Run safety checks on all outputs", defaultChecked: true },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between py-1">
              <div>
                <div className="text-sm">{item.label}</div>
                <div className="text-xs text-muted-foreground">{item.desc}</div>
              </div>
              <Switch defaultChecked={item.defaultChecked} />
            </div>
          ))}
        </div>
      </div>

      <Button className="bg-blue-600 hover:bg-blue-500 text-white h-8 text-xs" onClick={() => toast.success("Settings saved")}>
        <Save className="w-3.5 h-3.5 mr-2" /> Save Changes
      </Button>
    </div>
  );
}

function ProvidersSettings() {
  const [providers, setProviders] = useState<LLMProviderConfig[]>([]);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [baseUrls, setBaseUrls] = useState<Record<string, string>>({});
  const [models, setModels] = useState<Record<string, string>>({});
  const [isPending, startUiTransition] = useTransition();

  // Add Provider dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [newProviderId, setNewProviderId] = useState("");
  const [newProviderType, setNewProviderType] = useState("openai");
  const [newProviderDisplay, setNewProviderDisplay] = useState("");
  const [newProviderBaseUrl, setNewProviderBaseUrl] = useState("");
  const [newProviderApiKey, setNewProviderApiKey] = useState("");
  const [newProviderModel, setNewProviderModel] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);

  // Delete confirmation state
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await configApi.listProviders();
        if (cancelled) return;
        startTransition(() => setProviders(next));
      } catch {
        if (!cancelled) toast.error("Failed to load providers");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSaveProvider(p: LLMProviderConfig) {
    const key = apiKeys[p.provider_id];
    const baseUrl = baseUrls[p.provider_id];
    const model = models[p.provider_id];
    try {
      const updated = await configApi.upsertProvider({
        ...p,
        ...(key ? { api_key: key } : {}),
        ...(baseUrl ? { base_url: baseUrl } : {}),
        ...(model ? { default_model: model } : {}),
      });
      startUiTransition(() => {
        setProviders((prev) => prev.map((x) => x.provider_id === updated.provider_id ? updated : x));
        setBaseUrls((prev) => {
          const next = { ...prev };
          delete next[p.provider_id];
          return next;
        });
        setModels((prev) => {
          const next = { ...prev };
          delete next[p.provider_id];
          return next;
        });
      });
      toast.success(`${p.display_name ?? p.provider_id} saved`);
    } catch {
      toast.error("Failed to save provider");
    }
  }

  async function confirmDeleteProvider() {
    if (!deleteId) return;
    try {
      await configApi.deleteProvider(deleteId);
      startUiTransition(() => {
        setProviders((prev) => prev.filter((p) => p.provider_id !== deleteId));
      });
      toast.success("Provider removed");
    } catch {
      toast.error("Failed to remove provider");
    } finally {
      setDeleteId(null);
    }
  }

  function openAddProvider() {
    setNewProviderId("");
    setNewProviderType("openai");
    setNewProviderDisplay("");
    setNewProviderBaseUrl("");
    setNewProviderApiKey("");
    setNewProviderModel("");
    setAddOpen(true);
  }

  async function submitAddProvider() {
    if (!newProviderId.trim()) { toast.error("Provider ID is required"); return; }
    setAddSubmitting(true);
    const payload: LLMProviderConfig = {
      provider_id: newProviderId.trim(),
      provider_type: newProviderType || newProviderId.trim(),
      display_name: newProviderDisplay || newProviderId.trim(),
      base_url: newProviderBaseUrl || undefined,
      api_key: newProviderApiKey || undefined,
      default_model: newProviderModel || undefined,
    };
    try {
      const created = await configApi.upsertProvider(payload);
      startUiTransition(() => {
        setProviders((prev) => {
          const filtered = prev.filter(p => p.provider_id !== created.provider_id);
          return [...filtered, created];
        });
      });
      toast.success(`Provider "${created.display_name ?? created.provider_id}" added`);
      setAddOpen(false);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to add provider";
      toast.error(msg);
    } finally {
      setAddSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <h3 className="text-sm font-semibold">LLM Providers</h3>
      <div className="space-y-3">
        {providers.map(p => (
          <div key={p.provider_id} className="p-4 rounded-lg border border-border/50 bg-card/30">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="font-medium text-sm">{p.display_name ?? p.provider_id}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-green-500/10 text-green-400 border-green-500/20">
                  configured
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-6 text-xs border-border/60 text-red-400"
                  disabled={isPending}
                  onClick={() => setDeleteId(p.provider_id)}>
                  <Trash2 className="w-3 h-3 mr-1" /> Remove
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <Input
                  placeholder="Base URL (e.g. https://gateway.frontierai.ru/v1 — без /chat/completions)"
                  value={baseUrls[p.provider_id] ?? p.base_url ?? ""}
                  onChange={e => setBaseUrls(prev => ({ ...prev, [p.provider_id]: e.target.value }))}
                  className="h-7 text-xs bg-card border-border/60"
                />
                <Input
                  placeholder="API Key"
                  value={apiKeys[p.provider_id] ?? ""}
                  onChange={e => setApiKeys(prev => ({ ...prev, [p.provider_id]: e.target.value }))}
                  className="h-7 text-xs font-mono bg-card border-border/60"
                  type="password"
                />
                <Input
                  placeholder="Default Model"
                  value={models[p.provider_id] ?? p.default_model ?? ""}
                  onChange={e => setModels(prev => ({ ...prev, [p.provider_id]: e.target.value }))}
                  className="h-7 text-xs bg-card border-border/60"
                />
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs border-border/60 w-full"
                disabled={isPending}
                onClick={() => handleSaveProvider(p)}>
                <Save className="w-3 h-3 mr-1" /> Save Provider
              </Button>
            </div>
          </div>
        ))}
        {providers.length === 0 && (
          <div className="text-sm text-muted-foreground/50 text-center py-8">No providers configured</div>
        )}
      </div>
      <Button variant="outline" className="h-8 text-xs border-border/60" disabled={isPending} onClick={openAddProvider}>
        <Plus className="w-3.5 h-3.5 mr-2" /> Add Provider
      </Button>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Add LLM Provider</DialogTitle>
            <DialogDescription>Configure a new LLM provider endpoint. You can use any OpenAI-compatible API.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="np-id" className="text-xs">Provider ID *</Label>
                <Input id="np-id" value={newProviderId} onChange={e => setNewProviderId(e.target.value)} placeholder="openai" className="h-8 text-sm font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="np-type" className="text-xs">Type</Label>
                <select id="np-type" value={newProviderType} onChange={e => setNewProviderType(e.target.value)} className="w-full h-8 px-2 text-sm rounded border border-border bg-background">
                  <option value="openai">openai</option>
                  <option value="anthropic">anthropic</option>
                  <option value="ollama">ollama</option>
                  <option value="azure">azure</option>
                  <option value="custom">custom</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-display" className="text-xs">Display Name</Label>
              <Input id="np-display" value={newProviderDisplay} onChange={e => setNewProviderDisplay(e.target.value)} placeholder="OpenAI" className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-url" className="text-xs">Base URL</Label>
              <Input id="np-url" value={newProviderBaseUrl} onChange={e => setNewProviderBaseUrl(e.target.value)} placeholder="https://gateway.frontierai.ru/v1" className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-key" className="text-xs">API Key</Label>
              <Input id="np-key" type="password" value={newProviderApiKey} onChange={e => setNewProviderApiKey(e.target.value)} placeholder="sk-..." className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-model" className="text-xs">Default Model</Label>
              <Input id="np-model" value={newProviderModel} onChange={e => setNewProviderModel(e.target.value)} placeholder="gpt-4o" className="h-8 text-sm font-mono" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)} disabled={addSubmitting}>Cancel</Button>
            <Button size="sm" onClick={submitAddProvider} disabled={addSubmitting} className="bg-blue-600 hover:bg-blue-500 text-white">
              {addSubmitting ? "Adding..." : "Add Provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={o => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove provider?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove provider <span className="font-mono text-foreground">{deleteId}</span> from your configuration. Agents using this provider will lose their connection.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-500 text-white" onClick={confirmDeleteProvider}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SecretsSettings({ onGoToProviders }: { onGoToProviders: () => void }) {
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Secrets & API Keys</h3>
        <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-500 text-white" onClick={onGoToProviders}>
          <Plus className="w-3 h-3 mr-1" /> Manage in LLM Providers
        </Button>
      </div>

      <div className="p-3 rounded border border-blue-500/20 bg-blue-500/5 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-400/80">
          API keys for LLM providers are managed in the <button onClick={onGoToProviders} className="underline hover:text-blue-300">LLM Providers</button> section. The list below is a preview of secrets used across your workspace.
        </div>
      </div>

      <div className="space-y-2">
        {secrets.map(s => (
          <div key={s.id} className="p-3 rounded-lg border border-border/50 bg-card/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono font-medium">{s.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground/60">{s.lastUsed}</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(s.value); toast.success("Copied"); }}
                  className="p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Copy className="w-3 h-3" />
                </button>
                <button
                  onClick={onGoToProviders}
                  className="p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-red-400 transition-colors"
                  title="Manage in LLM Providers section"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={showValues[s.id] ? s.value : "•".repeat(24)}
                readOnly
                className="h-7 text-xs font-mono bg-card border-border/60 flex-1"
              />
              <button
                onClick={() => setShowValues(prev => ({ ...prev, [s.id]: !prev[s.id] }))}
                className="p-1.5 rounded border border-border/50 hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showValues[s.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {s.usedBy.map(u => (
                <span key={u} className="text-[9px] font-mono bg-muted/30 text-muted-foreground/60 px-1.5 py-0.5 rounded">{u}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MemorySettings() {
  return (
    <div className="space-y-6 max-w-xl">
      <h3 className="text-sm font-semibold">Memory Configuration</h3>
      <div className="space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Vector Store Backend</Label>
          <div className="flex gap-2">
            {["in-memory", "chroma", "pinecone", "weaviate"].map(s => (
              <button
                key={s}
                className={cn(
                  "px-3 py-1.5 rounded border text-xs font-mono transition-all",
                  s === "in-memory"
                    ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                    : "border-border/40 text-muted-foreground hover:border-border/70"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Embedding Model</Label>
          <div className="flex gap-2">
            {["text-embedding-3-small", "text-embedding-3-large", "local"].map(s => (
              <button
                key={s}
                className={cn(
                  "px-3 py-1.5 rounded border text-xs font-mono transition-all",
                  s === "text-embedding-3-small"
                    ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                    : "border-border/40 text-muted-foreground hover:border-border/70"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Context Window (tokens)</Label>
          <div className="flex items-center gap-3">
            <Slider defaultValue={[8000]} max={32000} step={1000} className="flex-1" />
            <span className="text-xs font-mono text-muted-foreground w-12">8,000</span>
          </div>
        </div>
        <div className="space-y-3">
          {[
            { label: "Persistent Memory", desc: "Persist memory across runs", defaultChecked: false },
            { label: "Cross-Agent Memory", desc: "Allow agents to share memory", defaultChecked: false },
            { label: "Memory Compression", desc: "Compress old memories automatically", defaultChecked: true },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between py-1">
              <div>
                <div className="text-sm">{item.label}</div>
                <div className="text-xs text-muted-foreground">{item.desc}</div>
              </div>
              <Switch defaultChecked={item.defaultChecked} />
            </div>
          ))}
        </div>
      </div>
      <Button className="bg-blue-600 hover:bg-blue-500 text-white h-8 text-xs" onClick={() => toast.success("Memory settings saved")}>
        <Save className="w-3.5 h-3.5 mr-2" /> Save Changes
      </Button>
    </div>
  );
}

function IntegrationsSettings() {
  const STORAGE_KEY = "gmas:integrations";
  type IntegrationStatus = "connected" | "disconnected" | "configured";
  const defaults: { name: string; desc: string; status: IntegrationStatus; icon: typeof GitBranch }[] = [
    { name: "GitHub", desc: "Trigger runs from PRs and issues", status: "disconnected", icon: GitBranch },
    { name: "Slack", desc: "Send run notifications to channels", status: "disconnected", icon: Bell },
    { name: "Webhook", desc: "POST run events to custom endpoints", status: "disconnected", icon: Globe },
    { name: "OpenTelemetry", desc: "Export traces to OTEL collector", status: "disconnected", icon: Activity },
  ];
  const [statuses, setStatuses] = useState<Record<string, IntegrationStatus>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : Object.fromEntries(defaults.map(d => [d.name, d.status]));
    } catch {
      return Object.fromEntries(defaults.map(d => [d.name, d.status]));
    }
  });
  const [configureFor, setConfigureFor] = useState<string | null>(null);
  const [endpointUrl, setEndpointUrl] = useState("");
  const [endpointToken, setEndpointToken] = useState("");
  const [sessionTokens, setSessionTokens] = useState<Record<string, string>>({});

  const persist = (next: Record<string, IntegrationStatus>) => {
    setStatuses(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {/* ignore */}
  };

  const openConfigure = (name: string) => {
    setConfigureFor(name);
    setEndpointUrl(localStorage.getItem(`gmas:int:${name}:url`) ?? "");
    setEndpointToken(sessionTokens[name] ?? "");
  };

  const saveConfigure = () => {
    if (!configureFor) return;
    if (!endpointUrl.trim()) { toast.error("URL is required"); return; }
    localStorage.setItem(`gmas:int:${configureFor}:url`, endpointUrl);
    localStorage.removeItem(`gmas:int:${configureFor}:token`);
    setSessionTokens(prev => ({ ...prev, [configureFor]: endpointToken }));
    persist({ ...statuses, [configureFor]: "connected" });
    toast.success(`${configureFor} connected. Secret is kept for this browser session only.`);
    setConfigureFor(null);
  };

  const disconnect = (name: string) => {
    localStorage.removeItem(`gmas:int:${name}:url`);
    localStorage.removeItem(`gmas:int:${name}:token`);
    setSessionTokens(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    persist({ ...statuses, [name]: "disconnected" });
    toast.success(`${name} disconnected`);
  };

  return (
    <div className="space-y-4 max-w-xl">
      <h3 className="text-sm font-semibold">Integrations</h3>
      <div className="space-y-3">
        {defaults.map(i => {
          const Icon = i.icon;
          const status = statuses[i.name] ?? "disconnected";
          return (
            <div key={i.name} className="flex items-center justify-between p-4 rounded-lg border border-border/50 bg-card/30">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded border border-border/50 bg-muted/30 flex items-center justify-center">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-sm font-medium">{i.name}</div>
                  <div className="text-xs text-muted-foreground">{i.desc}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-[10px] font-mono px-1.5 py-0.5 rounded border",
                  status === 'connected' ? "bg-green-500/10 text-green-400 border-green-500/20" :
                  status === 'configured' ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                  "bg-zinc-700/40 text-zinc-500 border-zinc-600/40"
                )}>
                  {status}
                </span>
                {status === "connected" ? (
                  <Button size="sm" variant="outline" className="h-7 text-xs border-border/60 text-red-400" onClick={() => disconnect(i.name)}>
                    Disconnect
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 text-xs border-border/60" onClick={() => openConfigure(i.name)}>
                    Configure
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={configureFor !== null} onOpenChange={o => { if (!o) setConfigureFor(null); }}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Configure {configureFor}</DialogTitle>
            <DialogDescription>Endpoint URL is stored locally. Secrets are kept in memory for this browser session only.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="int-url" className="text-xs">Endpoint URL *</Label>
              <Input id="int-url" value={endpointUrl} onChange={e => setEndpointUrl(e.target.value)} placeholder="https://hooks.slack.com/..." className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="int-token" className="text-xs">Token / Secret</Label>
              <Input id="int-token" type="password" value={endpointToken} onChange={e => setEndpointToken(e.target.value)} placeholder="••••••••" className="h-8 text-sm font-mono" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfigureFor(null)}>Cancel</Button>
            <Button size="sm" onClick={saveConfigure} className="bg-blue-600 hover:bg-blue-500 text-white">Connect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NotificationsSettings() {
  const STORAGE_KEY = "gmas:notifications";
  const defaults = {
    runStarted: false,
    runCompleted: true,
    runFailed: true,
    quotaExceeded: true,
    emailEnabled: false,
    desktopEnabled: true,
  };
  const [prefs, setPrefs] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    } catch { return defaults; }
  });

  const toggle = (key: keyof typeof defaults) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {/* ignore */}
  };

  const save = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {/* ignore */}
    toast.success("Notification preferences saved");
  };

  const items: { key: keyof typeof defaults; label: string; desc: string }[] = [
    { key: "runStarted", label: "Run Started", desc: "Notify when a workflow starts" },
    { key: "runCompleted", label: "Run Completed", desc: "Notify when a workflow finishes successfully" },
    { key: "runFailed", label: "Run Failed", desc: "Notify when a workflow encounters an error" },
    { key: "quotaExceeded", label: "Quota Exceeded", desc: "Notify when token / request budget is exceeded" },
    { key: "emailEnabled", label: "Email Notifications", desc: "Send notifications to your email" },
    { key: "desktopEnabled", label: "Desktop Notifications", desc: "Show OS-level notifications" },
  ];

  return (
    <div className="space-y-6 max-w-xl">
      <h3 className="text-sm font-semibold">Notifications</h3>
      <div className="space-y-3">
        {items.map(it => (
          <div key={it.key} className="flex items-center justify-between py-2 px-3 rounded border border-border/40 bg-card/20">
            <div>
              <div className="text-sm font-medium">{it.label}</div>
              <div className="text-xs text-muted-foreground">{it.desc}</div>
            </div>
            <Switch checked={prefs[it.key]} onCheckedChange={() => toggle(it.key)} />
          </div>
        ))}
      </div>
      <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-500 text-white" onClick={save}>
        <Save className="w-3 h-3 mr-1.5" /> Save Preferences
      </Button>
    </div>
  );
}

function SecuritySettings() {
  const STORAGE_KEY = "gmas:security";
  const defaults = {
    sandboxShell: true,
    sandboxCode: true,
    rateLimitEnabled: false,
    auditLog: true,
    requireConfirmDelete: true,
  };
  const [prefs, setPrefs] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    } catch { return defaults; }
  });

  const toggle = (key: keyof typeof defaults) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {/* ignore */}
  };

  const save = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {/* ignore */}
    toast.success("Security settings saved");
  };

  const items: { key: keyof typeof defaults; label: string; desc: string }[] = [
    { key: "sandboxShell", label: "Sandbox Shell Tool", desc: "Run shell commands in isolated sandbox" },
    { key: "sandboxCode", label: "Sandbox Code Interpreter", desc: "Execute code in isolated runtime" },
    { key: "rateLimitEnabled", label: "Rate Limiting", desc: "Apply request rate limits to LLM calls" },
    { key: "auditLog", label: "Audit Log", desc: "Record sensitive operations to audit trail" },
    { key: "requireConfirmDelete", label: "Confirm Destructive Actions", desc: "Require confirmation for delete operations" },
  ];

  return (
    <div className="space-y-6 max-w-xl">
      <h3 className="text-sm font-semibold">Security & Sandbox</h3>
      <div className="p-3 rounded border border-amber-500/20 bg-amber-500/5 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-400/80">
          Disabling sandbox isolation can expose your system to untrusted code. Only disable in trusted environments.
        </div>
      </div>
      <div className="space-y-3">
        {items.map(it => (
          <div key={it.key} className="flex items-center justify-between py-2 px-3 rounded border border-border/40 bg-card/20">
            <div>
              <div className="text-sm font-medium">{it.label}</div>
              <div className="text-xs text-muted-foreground">{it.desc}</div>
            </div>
            <Switch checked={prefs[it.key]} onCheckedChange={() => toggle(it.key)} />
          </div>
        ))}
      </div>
      <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-500 text-white" onClick={save}>
        <Save className="w-3 h-3 mr-1.5" /> Save Settings
      </Button>
    </div>
  );
}

export default function Settings() {
  const [location] = useLocation();
  // /providers deep-links to the LLM Providers tab; otherwise default to project.
  const [activeSection, setActiveSection] = useState(() =>
    location.startsWith("/providers") ? "providers" : "project"
  );

  // Keep tab in sync if user clicks /providers or /settings while on this page.
  useEffect(() => {
    if (location.startsWith("/providers")) setActiveSection("providers");
  }, [location]);

  const renderContent = () => {
    switch (activeSection) {
      case "project": return <ProjectSettings />;
      case "runtime": return <RuntimeSettings />;
      case "providers": return <ProvidersSettings />;
      case "memory": return <MemorySettings />;
      case "secrets": return <SecretsSettings onGoToProviders={() => setActiveSection("providers")} />;
      case "integrations": return <IntegrationsSettings />;
      case "notifications": return <NotificationsSettings />;
      case "security": return <SecuritySettings />;
      default: return null;
    }
  };

  return (
    <AppShell
      breadcrumb={[{ label: "Settings" }]}
      actions={
        <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-500 text-white" onClick={() => toast.success("All settings saved")}>
          <Save className="w-3 h-3 mr-1" /> Save All
        </Button>
      }
    >
      <div className="flex h-full overflow-hidden">
        <SectionNav active={activeSection} onChange={setActiveSection} />
        <ScrollArea className="flex-1">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="p-8"
          >
            {renderContent()}
          </motion.div>
        </ScrollArea>
      </div>
    </AppShell>
  );
}
