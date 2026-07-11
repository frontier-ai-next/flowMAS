/**
 * gMAS API client — typed wrapper around the FastAPI backend.
 * Base URL is /api (proxied by Vite server or served from same origin in prod).
 */

import axios from "axios";

// In dev Vite proxies /api and /ws to localhost:8000.
// In prod backend serves on same origin. Override with VITE_API_URL if needed.
const BASE = import.meta.env.VITE_API_URL ?? "";

export const http = axios.create({
  baseURL: BASE,
  timeout: 30_000,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// ─── Types (mirrors backend Pydantic models) ──────────────────────────────────

export interface AgentLLMConfig {
  model_name?: string;
  base_url?: string;
  api_key?: string;
  max_tokens?: number;
  temperature?: number;
  timeout?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tool_calling_enabled?: boolean;
  tool_choice?: "auto" | "none" | "required";
  parallel_tool_calls?: boolean;
  extra_params?: Record<string, unknown>;
}

export interface AgentCreate {
  agent_id: string;
  display_name: string;
  persona?: string;
  description?: string;
  llm_backbone?: string;
  llm_config?: AgentLLMConfig;
  tools?: string[];
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
}

export interface AgentUpdate {
  display_name?: string;
  persona?: string;
  description?: string;
  llm_backbone?: string;
  llm_config?: AgentLLMConfig;
  tools?: string[];
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
}

export interface AgentResponse extends AgentCreate {
  agent_id: string;
}

export interface AgentTemplate {
  template_id: string;
  name: string;
  description: string;
  agent: AgentCreate;
}

// Graph -----------------------------------------------------------------------

export interface EdgeDefinition {
  source: string;
  target: string;
  weight?: number;
  enabled?: boolean;
  condition?: string;
  label?: string;
}

export interface Position {
  x: number;
  y: number;
}

export interface GraphSaveRequest {
  name: string;
  description?: string;
  agents?: AgentCreate[];
  edges?: EdgeDefinition[];
  positions?: Record<string, Position>;
  start_node?: string;
  end_node?: string;
  task_targets?: string[];
  task_query?: string;
  llm_provider_id?: string;
  llm_model?: string;
  run_config?: Record<string, unknown>;
}

export interface GraphResponse extends GraphSaveRequest {
  graph_id: string;
  created_at: string;
  updated_at: string;
  validation_errors: string[];
}

export interface GraphListItem {
  graph_id: string;
  name: string;
  description: string;
  agent_count: number;
  edge_count: number;
  created_at: string;
  updated_at: string;
}

export interface GraphValidationResponse {
  is_valid: boolean;
  errors: string[];
  warnings: string[];
  execution_order: string[];
}

export interface AutoBuildRequest {
  name: string;
  description?: string;
  task_query: string;
  agent_ids?: string[];
  strategy?: "embedding_knn" | "chain" | "dense";
  max_edges_per_agent?: number;
}

export interface AIBuildRequest {
  task_query: string;
  name?: string;
  description?: string;
  max_agents?: number;
  enabled_tools?: string[];
}

export type GraphImportSource = "gmas_json" | "gmas_python" | "langflow" | "langgraph_mermaid" | "mermaid";
export type GraphImportMode = "native_graph" | "native_python" | "agent_graph" | "component_graph" | "mermaid_graph";
export type GraphExportFormat = "gmas_json" | "gmas_python";

export interface GraphImportRequest {
  source: GraphImportSource;
  payload: unknown;
  name_override?: string;
}

export interface GraphImportResponse {
  source: GraphImportSource;
  import_mode: GraphImportMode;
  warnings: string[];
  graph: GraphResponse;
}

export interface GraphExportRequest {
  graph: GraphSaveRequest;
  format?: GraphExportFormat;
  filename_hint?: string;
  source_graph_id?: string;
}

export interface GraphExportResponse {
  format: GraphExportFormat;
  filename: string;
  mime_type: string;
  content: string;
  warnings: string[];
}

export interface FollowupRequest {
  task_query: string;
  config?: RunnerConfigSchema;
}

// Execution -------------------------------------------------------------------

export interface RunnerConfigSchema {
  timeout?: number;
  adaptive?: boolean;
  enable_parallel?: boolean;
  max_parallel_size?: number;
  max_retries?: number;
  retry_delay?: number;
  retry_backoff?: number;
  update_states?: boolean;
  routing_policy?: string;
  enable_hidden_channels?: boolean;
  hidden_combine_strategy?: string;
  pass_embeddings?: boolean;
  enable_memory?: boolean;
  memory_context_limit?: number;
  enable_token_streaming?: boolean;
  max_loop_iterations?: number;
  max_tool_iterations?: number;
  execution_mode?: "round" | "stream";
  broadcast_task_to_all?: boolean;
  enable_dynamic_topology?: boolean;
  callback_modes?: Array<"stdout" | "metrics" | "file">;
  [key: string]: unknown;
}

export interface ExecutionRequest {
  graph_id?: string;
  graph?: GraphSaveRequest;
  task_query: string;
  config?: RunnerConfigSchema;
  llm_provider?: LLMProviderConfig;
  llm_provider_id?: string;
  llm_model?: string;
}

export interface RunEvent {
  event_type: string;
  agent_id?: string;
  agent_name?: string;
  message?: string;
  data?: unknown;
  timestamp?: string;
  error?: string;
  error_type?: string;
  error_detail?: string;
  error_message?: string;
  tokens_used?: number;
  duration_ms?: number;
  content?: string;
  token?: string;
  token_index?: number;
  is_first?: boolean;
  is_last?: boolean;
  is_final?: boolean;
}

export interface RunDetail {
  run_id: string;
  status: "running" | "completed" | "error" | "cancelled";
  graph_id?: string;
  task_query?: string;
  events: RunEvent[];
  created_at?: string;
  started_at?: string;
  ended_at?: string;
  completed_at?: string;
  result?: unknown;
  error?: string;
}

export interface RunHistorySummary {
  total: number;
  running: number;
  by_status: Record<string, number>;
  latest_started_at?: string | null;
}

// Tools -----------------------------------------------------------------------

export interface ToolInfo {
  name: string;
  description: string;
  parameters_schema: Record<string, unknown>;
}

export interface ToolRuntimeConfig {
  enabled_tools?: string[];
  shell_timeout?: number;
  shell_max_output_size?: number;
  shell_allowed_commands?: string[] | null;
  file_search_base_directory?: string;
  file_search_max_results?: number;
  file_search_max_depth?: number;
  file_search_max_file_size?: number;
  file_search_max_read_size?: number;
  web_search?: {
    enabled?: boolean;
    provider?: string;
    max_results?: number;
    max_content_length?: number;
    fetch_content?: boolean;
    max_fetch_pages?: number;
    timeout?: number;
    deep_search?: string | null;
    cache_enabled?: boolean;
    cache_ttl?: number;
  };
  mcp?: {
    enabled?: boolean;
    url?: string | null;
    headers?: Record<string, string>;
    timeout?: number;
  };
  vector_search?: {
    enabled?: boolean;
    store_type?: string;
    top_k?: number;
    score_threshold?: number;
    max_context_tokens?: number;
    citation_mode?: string;
  };
  computer_use?: {
    enabled?: boolean;
    runtime_name?: string;
  };
}

export interface ToolTestResponse {
  tool_name: string;
  success: boolean;
  output?: string;
  structured_output?: Record<string, unknown> | null;
  error?: string | null;
}

// LLM Providers ---------------------------------------------------------------

export interface LLMProviderConfig {
  provider_id: string;
  provider_type: string;
  display_name?: string;
  base_url?: string;
  api_key?: string;
  default_model?: string;
  is_default?: boolean;
}

// ─── API methods ─────────────────────────────────────────────────────────────

// Agents
export const agentsApi = {
  list: () => http.get<AgentResponse[]>("/api/agents").then((r) => r.data),
  templates: () => http.get<AgentTemplate[]>("/api/agents/templates").then((r) => r.data),
  get: (id: string) => http.get<AgentResponse>(`/api/agents/${id}`).then((r) => r.data),
  create: (body: AgentCreate) => http.post<AgentResponse>("/api/agents", body).then((r) => r.data),
  update: (id: string, body: AgentUpdate) => http.put<AgentResponse>(`/api/agents/${id}`, body).then((r) => r.data),
  delete: (id: string) => http.delete(`/api/agents/${id}`),
};

// Graph templates (ready-to-use architecture patterns)
export interface GraphTemplate {
  template_id: string;
  name: string;
  description: string;
  category: string;
  graph: GraphSaveRequest;
}

// Graphs
export const graphsApi = {
  list: () => http.get<GraphListItem[]>("/api/graphs").then((r) => r.data),
  get: (id: string) => http.get<GraphResponse>(`/api/graphs/${id}`).then((r) => r.data),
  create: (body: GraphSaveRequest) => http.post<GraphResponse>("/api/graphs", body).then((r) => r.data),
  exportGraph: (body: GraphExportRequest) => http.post<GraphExportResponse>("/api/graphs/export", body).then((r) => r.data),
  exportSaved: (id: string, format: GraphExportFormat = "gmas_json") =>
    http.get<GraphExportResponse>(`/api/graphs/${id}/export`, { params: { format } }).then((r) => r.data),
  importGraph: (body: GraphImportRequest) => http.post<GraphImportResponse>("/api/graphs/import", body).then((r) => r.data),
  update: (id: string, body: GraphSaveRequest) => http.put<GraphResponse>(`/api/graphs/${id}`, body).then((r) => r.data),
  delete: (id: string) => http.delete(`/api/graphs/${id}`),
  validate: (id: string) => http.post<GraphValidationResponse>(`/api/graphs/${id}/validate`).then((r) => r.data),
  validateInline: (body: GraphSaveRequest) => http.post<GraphValidationResponse>("/api/graphs/validate", body).then((r) => r.data),
  autoBuild: (body: AutoBuildRequest) => http.post<GraphSaveRequest>("/api/graphs/auto-build", body).then((r) => r.data),
  aiBuild: (body: AIBuildRequest) => http.post<GraphSaveRequest>("/api/graphs/ai-build", body, { timeout: 120_000 }).then((r) => r.data),
  templates: () => http.get<GraphTemplate[]>("/api/graphs/templates").then((r) => r.data),
  createFromTemplate: (templateId: string) =>
    http.post<GraphResponse>(`/api/graphs/templates/${templateId}`).then((r) => r.data),
};

// Execution
export const executionApi = {
  run: (body: ExecutionRequest) => http.post<{ run_id: string; status: string }>("/api/execution/run", body).then((r) => r.data),
  get: (runId: string) => http.get<RunDetail>(`/api/execution/${runId}`).then((r) => r.data),
  cancel: (runId: string) => http.delete(`/api/execution/${runId}`),
  historySummary: () => http.get<RunHistorySummary>("/api/execution/history/summary").then((r) => r.data),
  history: () => http.get<RunDetail[]>("/api/execution/history/list").then((r) => r.data),
  followup: (runId: string, body: FollowupRequest) =>
    http.post<{ run_id: string; status: string; parent_run_id: string }>(
      `/api/execution/${runId}/followup`,
      body,
    ).then((r) => r.data),
};

// Schedules (Langflow Background Agents–style)
export type ScheduleType = "cron" | "interval" | "once";

export interface ScheduleCreate {
  name: string;
  graph_id: string;
  task_query: string;
  schedule_type: ScheduleType;
  cron_expression?: string;
  interval_seconds?: number;
  run_at?: string;
  timezone?: string;
  enabled?: boolean;
  llm_provider_id?: string;
  llm_model?: string;
}

export interface ScheduleUpdate extends Partial<ScheduleCreate> {}

export interface ScheduleItem {
  schedule_id: string;
  name: string;
  graph_id: string;
  graph_name?: string | null;
  task_query: string;
  schedule_type: ScheduleType;
  cron_expression?: string | null;
  interval_seconds?: number | null;
  run_at?: string | null;
  timezone: string;
  enabled: boolean;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_run_id?: string | null;
  last_status?: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

export const schedulesApi = {
  list: () => http.get<ScheduleItem[]>("/api/schedules").then((r) => r.data),
  get: (id: string) => http.get<ScheduleItem>(`/api/schedules/${id}`).then((r) => r.data),
  create: (body: ScheduleCreate) => http.post<ScheduleItem>("/api/schedules", body).then((r) => r.data),
  update: (id: string, body: ScheduleUpdate) => http.put<ScheduleItem>(`/api/schedules/${id}`, body).then((r) => r.data),
  delete: (id: string) => http.delete(`/api/schedules/${id}`),
  runNow: (id: string) => http.post<{ schedule_id: string; last_run_id: string; last_status: string }>(`/api/schedules/${id}/run`).then((r) => r.data),
  pause: (id: string) => http.post<ScheduleItem>(`/api/schedules/${id}/pause`).then((r) => r.data),
  resume: (id: string) => http.post<ScheduleItem>(`/api/schedules/${id}/resume`).then((r) => r.data),
};

// Tools
export const toolsApi = {
  list: () => http.get<ToolInfo[]>("/api/tools").then((r) => r.data),
  getConfig: () => http.get<ToolRuntimeConfig>("/api/tools/config").then((r) => r.data),
  updateConfig: (body: ToolRuntimeConfig) => http.put<ToolRuntimeConfig>("/api/tools/config", body).then((r) => r.data),
  test: (toolName: string, arguments_: Record<string, unknown>) =>
    http.post<ToolTestResponse>(`/api/tools/${toolName}/test`, { arguments: arguments_ }).then((r) => r.data),
};

// Config
export const configApi = {
  getRunnerDefaults: () => http.get<RunnerConfigSchema>("/api/config/runner-defaults").then((r) => r.data),
  listProviders: () => http.get<LLMProviderConfig[]>("/api/config/llm-providers").then((r) => r.data),
  upsertProvider: (body: LLMProviderConfig) => http.post<LLMProviderConfig>("/api/config/llm-providers", body).then((r) => r.data),
  deleteProvider: (id: string) => http.delete(`/api/config/llm-providers/${id}`),
};

// Health
export const healthApi = {
  check: () => http.get<{ status: string; gmas_available: boolean }>("/api/health").then((r) => r.data),
};

// ─── WebSocket helper ─────────────────────────────────────────────────────────

export function createExecutionSocket(
  runId: string,
  handlers: {
    onEvent: (event: RunEvent) => void;
    onDone: () => void;
    onError: (err: string) => void;
  }
): WebSocket {
  const wsBase = BASE
    ? BASE.replace(/^http/, "ws")
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
  const ws = new WebSocket(`${wsBase}/ws/execution/${runId}`);

  ws.onmessage = (msg) => {
    try {
      const event: RunEvent = JSON.parse(msg.data);
      if (event.event_type === "error") {
        handlers.onError(event.error_detail ?? event.error ?? event.error_message ?? "Unknown error");
      } else if (event.event_type === "run_complete" || event.event_type === "done") {
        handlers.onDone();
      } else {
        handlers.onEvent(event);
      }
    } catch {
      // ignore parse errors
    }
  };

  ws.onerror = () => handlers.onError("WebSocket connection failed");
  ws.onclose = (e) => {
    if (e.code !== 1000) handlers.onError(`WebSocket closed unexpectedly (${e.code})`);
    else handlers.onDone();
  };

  return ws;
}
