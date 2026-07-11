// gMAS Mock Data — used across all pages for realistic demo content

export type NodeStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'waiting_tool' | 'waiting_llm';
export type ToolState = 'enabled' | 'disabled' | 'sandboxed' | 'restricted' | 'degraded' | 'missing_config';
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'stopped' | 'queued';
export type EventType =
  | "run_start" | "run_end"
  | "agent_start" | "agent_end" | "agent_output" | "agent_error"
  | "tool_call" | "tool_end" | "tool_error"
  | "token" | "token_usage"
  | "memory_event" | "memory_read" | "memory_write"
  | "topology_changed" | "prune" | "fallback"
  | "error" | "system";

export interface LogEventDetails {
  input?: string;
  output?: string;
  query?: string;
  toolName?: string;
  arguments?: unknown;
  result?: string;
  durationMs?: number;
  tokens?: number;
  error?: string;
  success?: boolean;
  metadata?: Record<string, unknown>;
}

export interface LogEvent {
  id: string;
  timestamp: string;
  type: EventType;
  entity: string;
  message: string;
  metadata?: string;
  status: "ok" | "error" | "warn";
  agentId?: string;
  details?: LogEventDetails;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  model: string;
  provider: string;
  tools: string[];
  schemas: string[];
  successRate: number;
  avgTokens: number;
  avgLatency: number;
  lastUsed: string;
  status: 'active' | 'inactive' | 'error';
  persona: string;
  description: string;
  memoryEnabled: boolean;
  usedInGraphs: string[];
}

export interface Tool {
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

export interface Run {
  id: string;
  status: RunStatus;
  graphId: string;
  graphName: string;
  task: string;
  duration: number;
  tokens: number;
  costEstimate: number;
  toolCalls: number;
  errors: number;
  topologyMutations: number;
  streaming: boolean;
  createdAt: string;
  startedAt: string;
  endedAt?: string;
  steps: number;
  memoryOps: number;
  strategy: string;
  output?: string;
  agentBreakdown: { name: string; tokens: number; status: string }[];
}

export interface GraphNode {
  id: string;
  type: 'start' | 'end' | 'agent' | 'condition';
  label: string;
  x: number;
  y: number;
  status: NodeStatus;
  agentName?: string;
  role?: string;
  model?: string;
  provider?: string;
  description?: string;
  llmConfig?: Record<string, unknown>;
  tools?: string[];
  toolsCount?: number;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  tokenCount?: number;
  memoryEnabled?: boolean;
  lastEvent?: string;
  llmBaseUrl?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
  label?: string;
  weight?: number;
  /** When false, edge is kept on canvas but excluded from execution (weight forced to 0 on save). */
  enabled?: boolean;
  active: boolean;
  activationCount: number;
  hasWarning?: boolean;
}

// ---- Mock Agents ----
export const mockAgents: Agent[] = [
  {
    id: 'agent-001',
    name: 'ResearchAgent',
    role: 'Research Specialist',
    model: 'gpt-4o',
    provider: 'OpenAI',
    tools: ['web_search', 'pdf_reader', 'summarizer'],
    schemas: ['ResearchInput', 'ResearchOutput'],
    successRate: 94.2,
    avgTokens: 3840,
    avgLatency: 2340,
    lastUsed: '2 min ago',
    status: 'active',
    persona: 'Expert researcher with deep domain knowledge',
    description: 'Performs comprehensive research tasks using web search and document analysis',
    memoryEnabled: true,
    usedInGraphs: ['research-pipeline', 'content-creation'],
  },
  {
    id: 'agent-002',
    name: 'ReviewerAgent',
    role: 'Content Reviewer',
    model: 'gpt-4o',
    provider: 'OpenAI',
    tools: ['text_analyzer', 'fact_checker'],
    schemas: ['ReviewInput', 'ReviewOutput'],
    successRate: 97.8,
    avgTokens: 1920,
    avgLatency: 1120,
    lastUsed: '5 min ago',
    status: 'active',
    persona: 'Critical reviewer focused on accuracy and quality',
    description: 'Reviews and validates content produced by other agents',
    memoryEnabled: false,
    usedInGraphs: ['research-pipeline', 'reviewer-loop'],
  },
  {
    id: 'agent-003',
    name: 'WriterAgent',
    role: 'Content Writer',
    model: 'claude-3-5-sonnet',
    provider: 'Anthropic',
    tools: ['text_formatter', 'template_engine'],
    schemas: ['WriterInput', 'WriterOutput'],
    successRate: 91.5,
    avgTokens: 5200,
    avgLatency: 3100,
    lastUsed: '12 min ago',
    status: 'active',
    persona: 'Creative writer with structured output capabilities',
    description: 'Produces high-quality written content based on research and review inputs',
    memoryEnabled: true,
    usedInGraphs: ['content-creation'],
  },
  {
    id: 'agent-004',
    name: 'PlannerAgent',
    role: 'Task Planner',
    model: 'gpt-4o',
    provider: 'OpenAI',
    tools: ['task_decomposer', 'dependency_resolver'],
    schemas: ['PlanInput', 'PlanOutput'],
    successRate: 88.3,
    avgTokens: 2100,
    avgLatency: 890,
    lastUsed: '1 hour ago',
    status: 'active',
    persona: 'Strategic planner that decomposes complex tasks',
    description: 'Breaks down high-level objectives into executable agent subtasks',
    memoryEnabled: true,
    usedInGraphs: ['parallel-specialists'],
  },
  {
    id: 'agent-005',
    name: 'GuardrailAgent',
    role: 'Safety Monitor',
    model: 'gpt-4o-mini',
    provider: 'OpenAI',
    tools: ['pii_detector', 'policy_checker'],
    schemas: ['GuardrailInput', 'GuardrailOutput'],
    successRate: 99.1,
    avgTokens: 640,
    avgLatency: 320,
    lastUsed: '2 min ago',
    status: 'active',
    persona: 'Safety-focused agent that monitors policy compliance',
    description: 'Validates outputs against safety policies and PII detection rules',
    memoryEnabled: false,
    usedInGraphs: ['research-pipeline', 'content-creation', 'parallel-specialists'],
  },
  {
    id: 'agent-006',
    name: 'DataAgent',
    role: 'Data Analyst',
    model: 'gpt-4o',
    provider: 'OpenAI',
    tools: ['postgres_query', 'python_repl', 'csv_parser'],
    schemas: ['DataInput', 'DataOutput'],
    successRate: 85.7,
    avgTokens: 4100,
    avgLatency: 4200,
    lastUsed: '45 min ago',
    status: 'inactive',
    persona: 'Data analyst specialized in structured data processing',
    description: 'Queries databases and performs statistical analysis on structured data',
    memoryEnabled: false,
    usedInGraphs: ['dynamic-topology'],
  },
];

// ---- Mock Tools ----
export const mockTools: Tool[] = [
  { id: 'tool-001', name: 'web_search', category: 'Search', state: 'enabled', scope: 'global', safety: 'safe', calls: 1842, errors: 12, latency: 340, lastUsed: '1 min ago', description: 'Performs web searches via Brave/Google API', hasConfig: true },
  { id: 'tool-002', name: 'postgres_query', category: 'Database', state: 'sandboxed', scope: 'agent', safety: 'restricted', calls: 523, errors: 8, latency: 89, lastUsed: '45 min ago', description: 'Executes read-only PostgreSQL queries', hasConfig: true },
  { id: 'tool-003', name: 'python_repl', category: 'Execution', state: 'sandboxed', scope: 'agent', safety: 'dangerous', calls: 291, errors: 34, latency: 1240, lastUsed: '2 hours ago', description: 'Executes Python code in an isolated sandbox', hasConfig: true },
  { id: 'tool-004', name: 'pdf_reader', category: 'Document', state: 'enabled', scope: 'global', safety: 'safe', calls: 748, errors: 3, latency: 210, lastUsed: '5 min ago', description: 'Extracts and parses text from PDF documents', hasConfig: false },
  { id: 'tool-005', name: 'pii_detector', category: 'Safety', state: 'enabled', scope: 'global', safety: 'safe', calls: 2103, errors: 0, latency: 45, lastUsed: '2 min ago', description: 'Detects PII patterns in text content', hasConfig: true },
  { id: 'tool-006', name: 'text_formatter', category: 'Text', state: 'enabled', scope: 'global', safety: 'safe', calls: 1204, errors: 2, latency: 28, lastUsed: '12 min ago', description: 'Formats and structures text output', hasConfig: false },
  { id: 'tool-007', name: 'generate_chart', category: 'Visualization', state: 'enabled', scope: 'global', safety: 'safe', calls: 183, errors: 7, latency: 890, lastUsed: '1 hour ago', description: 'Generates charts and visualizations from data', hasConfig: true },
  { id: 'tool-008', name: 'email_sender', category: 'Communication', state: 'restricted', scope: 'graph', safety: 'dangerous', calls: 42, errors: 1, latency: 1800, lastUsed: '3 days ago', description: 'Sends emails via SMTP — requires approval', hasConfig: false },
  { id: 'tool-009', name: 'fact_checker', category: 'Validation', state: 'enabled', scope: 'global', safety: 'safe', calls: 634, errors: 15, latency: 560, lastUsed: '5 min ago', description: 'Validates factual claims against knowledge base', hasConfig: true },
  { id: 'tool-010', name: 'memory_store', category: 'Memory', state: 'enabled', scope: 'global', safety: 'safe', calls: 3421, errors: 4, latency: 12, lastUsed: '1 min ago', description: 'Stores and retrieves agent memory vectors', hasConfig: true },
  { id: 'tool-011', name: 'template_engine', category: 'Text', state: 'enabled', scope: 'global', safety: 'safe', calls: 892, errors: 1, latency: 18, lastUsed: '12 min ago', description: 'Renders Jinja2 templates with context data', hasConfig: false },
  { id: 'tool-012', name: 'api_caller', category: 'Integration', state: 'missing_config', scope: 'agent', safety: 'restricted', calls: 0, errors: 0, latency: 0, lastUsed: 'Never', description: 'Makes HTTP requests to external APIs', hasConfig: false },
];

// ---- Mock Runs ----
export const mockRuns: Run[] = [
  { id: 'run-7f3a2b', status: 'running', graphId: 'research-pipeline', graphName: 'Research Pipeline', task: 'Analyze Q2 2025 market trends in AI infrastructure', duration: 142, tokens: 18420, costEstimate: 0.184, toolCalls: 23, errors: 0, topologyMutations: 0, streaming: true, createdAt: '2 min ago', startedAt: '12:43:16', steps: 8, memoryOps: 12, strategy: 'sequential', agentBreakdown: [{ name: 'ResearchAgent', tokens: 12400, status: 'running' }, { name: 'GuardrailAgent', tokens: 6020, status: 'succeeded' }] },
  { id: 'run-9c1d4e', status: 'succeeded', graphId: 'content-creation', graphName: 'Content Creation', task: 'Write technical blog post about LLM routing strategies', duration: 284, tokens: 42100, costEstimate: 0.421, toolCalls: 18, errors: 0, topologyMutations: 2, streaming: false, createdAt: '15 min ago', startedAt: '12:30:00', endedAt: '12:34:44', steps: 14, memoryOps: 8, strategy: 'adaptive', output: 'Generated 2,400-word technical blog post covering LLM routing strategies including semantic routing, cost-based routing, and capability-based routing with code examples.', agentBreakdown: [{ name: 'ResearchAgent', tokens: 18200, status: 'succeeded' }, { name: 'WriterAgent', tokens: 20400, status: 'succeeded' }, { name: 'ReviewerAgent', tokens: 3500, status: 'succeeded' }] },
  { id: 'run-2a8f6c', status: 'failed', graphId: 'dynamic-topology', graphName: 'Dynamic Topology', task: 'Process and summarize 50 research papers on RAG', duration: 89, tokens: 8340, costEstimate: 0.083, toolCalls: 7, errors: 3, topologyMutations: 1, streaming: true, createdAt: '1 hour ago', startedAt: '11:45:00', endedAt: '11:46:29', steps: 5, memoryOps: 3, strategy: 'parallel', agentBreakdown: [{ name: 'DataAgent', tokens: 8340, status: 'failed' }] },
  { id: 'run-5e3b1a', status: 'succeeded', graphId: 'reviewer-loop', graphName: 'Reviewer Loop', task: 'Review and improve product documentation v2.3', duration: 198, tokens: 31200, costEstimate: 0.312, toolCalls: 12, errors: 0, topologyMutations: 0, streaming: false, createdAt: '2 hours ago', startedAt: '10:45:00', endedAt: '10:48:18', steps: 10, memoryOps: 6, strategy: 'sequential', output: 'Documentation reviewed and improved. 23 issues fixed, 8 sections rewritten, 4 new examples added.', agentBreakdown: [{ name: 'ReviewerAgent', tokens: 15600, status: 'succeeded' }, { name: 'WriterAgent', tokens: 15600, status: 'succeeded' }] },
  { id: 'run-8d4c7f', status: 'succeeded', graphId: 'parallel-specialists', graphName: 'Parallel Specialists', task: 'Competitive analysis: 5 AI coding assistants', duration: 412, tokens: 67800, costEstimate: 0.678, toolCalls: 41, errors: 1, topologyMutations: 3, streaming: true, createdAt: '4 hours ago', startedAt: '08:45:00', endedAt: '08:51:52', steps: 22, memoryOps: 18, strategy: 'parallel', output: 'Comprehensive 5,200-word competitive analysis covering Cursor, GitHub Copilot, Tabnine, Codeium, and Amazon Q.', agentBreakdown: [{ name: 'PlannerAgent', tokens: 4200, status: 'succeeded' }, { name: 'ResearchAgent', tokens: 38400, status: 'succeeded' }, { name: 'WriterAgent', tokens: 25200, status: 'succeeded' }] },
  { id: 'run-1b9e2d', status: 'stopped', graphId: 'research-pipeline', graphName: 'Research Pipeline', task: 'Summarize latest papers on multi-agent systems', duration: 34, tokens: 4200, costEstimate: 0.042, toolCalls: 3, errors: 0, topologyMutations: 0, streaming: false, createdAt: '6 hours ago', startedAt: '06:30:00', endedAt: '06:30:34', steps: 2, memoryOps: 1, strategy: 'sequential', agentBreakdown: [{ name: 'ResearchAgent', tokens: 4200, status: 'stopped' }] },
  { id: 'run-6f7a3c', status: 'succeeded', graphId: 'content-creation', graphName: 'Content Creation', task: 'Generate API documentation for gMAS v0.4', duration: 156, tokens: 28400, costEstimate: 0.284, toolCalls: 9, errors: 0, topologyMutations: 0, streaming: false, createdAt: '1 day ago', startedAt: 'yesterday 14:20', endedAt: 'yesterday 14:22:36', steps: 9, memoryOps: 5, strategy: 'sequential', output: 'Complete API reference documentation for gMAS v0.4 covering Graph, Agent, Tool, and Run APIs.', agentBreakdown: [{ name: 'WriterAgent', tokens: 28400, status: 'succeeded' }] },
  { id: 'run-4c2b8e', status: 'queued', graphId: 'dynamic-topology', graphName: 'Dynamic Topology', task: 'Analyze customer feedback dataset (12,000 entries)', duration: 0, tokens: 0, costEstimate: 0, toolCalls: 0, errors: 0, topologyMutations: 0, streaming: true, createdAt: 'just now', startedAt: '—', steps: 0, memoryOps: 0, strategy: 'adaptive', agentBreakdown: [] },
];

// ---- Mock Live Events ----
export const mockEvents: LogEvent[] = [
  { id: 'ev-001', timestamp: '12:45:18.312', type: 'agent_start', entity: 'ResearchAgent', message: 'Starting execution with objective: Analyze Q2 2025 market trends', metadata: 'graph=research-pipeline run=run-7f3a2b', status: 'ok' },
  { id: 'ev-002', timestamp: '12:45:18.441', type: 'tool_call', entity: 'ResearchAgent', message: 'Calling web_search | query="AI infrastructure market 2025 Q2"', metadata: 'tool_id=web_search call_id=tc-001', status: 'ok' },
  { id: 'ev-003', timestamp: '12:45:19.103', type: 'tool_end', entity: 'ResearchAgent', message: 'web_search completed | results=8 | duration=662ms', metadata: 'call_id=tc-001 tokens=0', status: 'ok' },
  { id: 'ev-004', timestamp: '12:45:19.842', type: 'token_usage', entity: 'ResearchAgent', message: 'Input: 1,246 tokens | Output: 2,753 tokens | Total: 3,999', metadata: 'model=gpt-4o cost=$0.040', status: 'ok' },
  { id: 'ev-005', timestamp: '12:45:20.103', type: 'agent_start', entity: 'ReviewerAgent', message: 'Received research output. Starting review pass.', metadata: 'graph=research-pipeline', status: 'ok' },
  { id: 'ev-006', timestamp: '12:45:20.891', type: 'tool_call', entity: 'ReviewerAgent', message: 'Calling fact_checker | claims=14 | source_count=8', metadata: 'tool_id=fact_checker call_id=tc-002', status: 'ok' },
  { id: 'ev-007', timestamp: '12:45:21.487', type: 'token_usage', entity: 'ReviewerAgent', message: 'Input: 2,104 tokens | Output: 1,607 tokens | Total: 3,711', metadata: 'model=gpt-4o cost=$0.037', status: 'ok' },
  { id: 'ev-008', timestamp: '12:45:21.731', type: 'agent_start', entity: 'GuardrailAgent', message: 'Running safety check on output content', metadata: 'graph=research-pipeline', status: 'ok' },
  { id: 'ev-009', timestamp: '12:45:21.890', type: 'tool_call', entity: 'GuardrailAgent', message: 'Calling pii_detector | content_length=4821 chars', metadata: 'tool_id=pii_detector call_id=tc-003', status: 'ok' },
  { id: 'ev-010', timestamp: '12:45:22.012', type: 'tool_end', entity: 'GuardrailAgent', message: 'pii_detector: No PII detected. Content is safe.', metadata: 'call_id=tc-003 duration=122ms', status: 'ok' },
  { id: 'ev-011', timestamp: '12:45:22.258', type: 'token_usage', entity: 'GuardrailAgent', message: 'Input: 512 tokens | Output: 128 tokens | Total: 640', metadata: 'model=gpt-4o-mini cost=$0.001', status: 'ok' },
  { id: 'ev-012', timestamp: '12:45:22.712', type: 'agent_end', entity: 'ResearchAgent', message: 'Execution complete. Routing to WriterAgent via sufficient_research edge.', metadata: 'edge=sufficient_research weight=0.75', status: 'ok' },
  { id: 'ev-013', timestamp: '12:45:23.103', type: 'agent_start', entity: 'WriterAgent', message: 'Received research + review. Generating structured report.', metadata: 'graph=research-pipeline', status: 'ok' },
  { id: 'ev-014', timestamp: '12:45:23.530', type: 'topology_changed', entity: 'GraphRuntime', message: 'Dynamic edge added: WriterAgent → QAAgent (confidence=0.82)', metadata: 'mutation_id=topo-001 trigger=output_quality', status: 'warn' },
  { id: 'ev-015', timestamp: '12:45:24.001', type: 'error', entity: 'WriterAgent', message: 'Rate limit hit on gpt-4o. Retrying in 2s (attempt 1/3)', metadata: 'error_code=rate_limit provider=OpenAI', status: 'error' },
];

// ---- Mock Graph Nodes ----
export const mockGraphNodes: GraphNode[] = [
  { id: 'start', type: 'start', label: '__start__', x: 80, y: 280, status: 'succeeded' },
  { id: 'research', type: 'agent', label: 'ResearchAgent', x: 280, y: 180, status: 'succeeded', agentName: 'ResearchAgent', role: 'Research Specialist', model: 'gpt-4o', provider: 'OpenAI', toolsCount: 3, tokenCount: 3999, memoryEnabled: true, lastEvent: 'Routing to ReviewerAgent' },
  { id: 'reviewer', type: 'agent', label: 'ReviewerAgent', x: 520, y: 100, status: 'running', agentName: 'ReviewerAgent', role: 'Content Reviewer', model: 'gpt-4o', provider: 'OpenAI', toolsCount: 2, tokenCount: 3711, memoryEnabled: false, lastEvent: 'Running fact check...' },
  { id: 'writer', type: 'agent', label: 'WriterAgent', x: 520, y: 340, status: 'queued', agentName: 'WriterAgent', role: 'Content Writer', model: 'claude-3-5-sonnet', provider: 'Anthropic', toolsCount: 2, tokenCount: 0, memoryEnabled: true, lastEvent: 'Waiting for ReviewerAgent' },
  { id: 'guardrail', type: 'agent', label: 'GuardrailAgent', x: 760, y: 220, status: 'idle', agentName: 'GuardrailAgent', role: 'Safety Monitor', model: 'gpt-4o-mini', provider: 'OpenAI', toolsCount: 2, tokenCount: 640, memoryEnabled: false, lastEvent: 'No PII detected' },
  { id: 'end', type: 'end', label: '__end__', x: 960, y: 280, status: 'idle' },
];

export const mockGraphEdges: GraphEdge[] = [
  { id: 'e1', source: 'start', target: 'research', active: true, activationCount: 1 },
  { id: 'e2', source: 'research', target: 'reviewer', condition: 'sufficient_research', weight: 0.75, active: true, activationCount: 1 },
  { id: 'e3', source: 'research', target: 'writer', condition: 'skip_review', weight: 0.25, active: false, activationCount: 0 },
  { id: 'e4', source: 'reviewer', target: 'writer', condition: 'approved', weight: 0.80, active: false, activationCount: 0 },
  { id: 'e5', source: 'reviewer', target: 'research', condition: 'needs_more_research', weight: 0.20, active: false, activationCount: 0, hasWarning: true },
  { id: 'e6', source: 'writer', target: 'guardrail', active: false, activationCount: 0 },
  { id: 'e7', source: 'guardrail', target: 'end', condition: 'approved', weight: 0.95, active: false, activationCount: 0 },
];
