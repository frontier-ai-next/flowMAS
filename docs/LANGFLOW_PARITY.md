# Langflow vs flowMAS feature parity

This document maps [Langflow](https://docs.langflow.org/) (v1.10.x) capabilities to **flowMAS** (web studio + gMAS runtime). Use it to track what we already match and what to build next.

## Legend

| Status | Meaning |
|--------|---------|
| ✅ | Supported with comparable UX |
| ⚠️ | Partial / different model / workaround |
| 🔜 | Planned or stub only |
| ❌ | Not in scope or not applicable to gMAS |

---

## Build & canvas

| Langflow | flowMAS | Status | Notes |
|----------|-----------|--------|-------|
| Visual flow editor | Workflow canvas | ✅ | Agents, Start/Finish, edges |
| Component library (Core + Bundles) | Agent + Tool registry | ⚠️ | Langflow has LLM, vector, parser, etc. components |
| Flow templates | Graph templates API | ✅ | |
| Import Langflow JSON | `POST /api/graphs/import` | ⚠️ | Structure preserved; semantics differ |
| Rename / describe nodes | Agent inspector | ✅ | |
| Group components | — | ❌ | Multi-select group not implemented |
| Freeze component (skip re-run) | — | ❌ | gMAS re-executes agents each run |
| Run single component | — | ❌ | Whole graph run only |
| Inspect component output | Inspector + Console | ✅ | Per-agent I/O and tool calls |
| Typed ports / color coding | Agent edges only | ⚠️ | No Message/Tool port types on canvas |
| Dynamic ports | — | ❌ | |
| Component code editor | Agent Python in registry | ⚠️ | Agents are code-first, not in-canvas |
| Component version updates | — | ❌ | |
| Keyboard shortcuts | Partial hotkeys | ⚠️ | |
| Start / Finish nodes | Start / Finish | ✅ | Replaces Langflow Chat Input / Output |

---

## Control flow & routing

| Langflow | flowMAS | Status | Notes |
|----------|-----------|--------|-------|
| If-Else / conditional routing | Edge conditions | ✅ | success / fail / keyword / loop |
| Keyword branches (If-Else style) | Conditional + keyword edges | ✅ | Cyan edges; Run Settings hints |
| Loop (list iteration component) | — | ❌ | Langflow `Loop` over lists; use graph loops |
| Review / cycle loops | Loop edges (↺) | ✅ | Max Loop Iterations in Run Settings |
| Parallel branches | Run Settings → Parallel mode | ✅ | |
| Multi-input fan-in (AND join) | Multiple incoming edges | ✅ | Skipped branches unblock join (runtime fix) |
| Router / dynamic path | Adaptive scheduler + edges | ✅ | Requires Adaptive Scheduler |
| Timer / delay inside flow | — | ❌ | **Not edge delay** — use Schedules |
| Notify / Listen (delayed events) | — | ❌ | Langflow still evolving |

---

## Execution & triggers

| Langflow | flowMAS | Status | Notes |
|----------|-----------|--------|-------|
| Run once (Playground / API) | Run button + `POST /api/execution/run` | ✅ | |
| Token streaming | WebSocket events | ✅ | |
| Run history | Runs page | ✅ | |
| Cancel run | API + UI stop | ✅ | |
| Follow-up / continue run | Follow-up API | ✅ | |
| **Background Agents (cron / interval / date)** | **Schedules** `/schedules` | ✅ | pause, resume, run now; APScheduler |
| Workflow API v2 `background: true` | Schedules + async runs | ⚠️ | No generic job queue; scheduled + WS |
| Webhook trigger (`POST /webhook`) | — | 🔜 | Event-driven external trigger |
| Event triggers (Background Agents) | — | 🔜 | |
| Tweaks at runtime | Run Settings + per-run config | ⚠️ | No per-component tweak map |
| Session ID / chat memory | Task memory in Run Settings | ⚠️ | Different model than Langflow sessions |
| Global variables in request | — | 🔜 | Langflow v2 `globals` in JSON body |
| Sync workflow with timeout | — | ⚠️ | gMAS runs async; poll Runs / WS |
| Stop workflow by job_id | Cancel by run_id | ✅ | |

### Schedules API (Background Agents analogue)

| Action | Endpoint |
|--------|----------|
| List | `GET /api/schedules` |
| Create | `POST /api/schedules` |
| Update | `PUT /api/schedules/{id}` |
| Delete | `DELETE /api/schedules/{id}` |
| Run now | `POST /api/schedules/{id}/run` |
| Pause / Resume | `POST .../pause` / `.../resume` |

**Schedule types:** `cron` (5-field), `interval` (seconds ≥ 30), `once` (ISO datetime).

**Run metadata:** scheduled runs set `trigger_source: "schedule"`, `schedule_id`, `schedule_name` on persisted runs.

---

## Agents, tools & MCP

| Langflow | flowMAS | Status | Notes |
|----------|-----------|--------|-------|
| Agent component | Agent nodes | ✅ | |
| Tool Mode (component as tool) | Tool registry + agent tools | ⚠️ | |
| MCP server (expose flows) | — | ❌ | |
| MCP client (external servers) | — | ❌ | |
| Composio / bundle integrations | Custom tools | ⚠️ | web_search etc. via tool config |

---

## Observability & debugging

| Langflow | flowMAS | Status | Notes |
|----------|-----------|--------|-------|
| Playground (test flow) | Run + Console | ✅ | |
| Component logs | Console + Inspector | ✅ | Click log row for details |
| Run metrics | Runs detail | ✅ | Tokens, timing |
| Export flow / run | JSON export | ✅ | |
| Validate before run | Validate button | ✅ | Inline graph validation |

---

## API & deployment

| Langflow | flowMAS | Status | Notes |
|----------|-----------|--------|-------|
| `/v1/run/{flow_id}` | `/api/execution/run` | ✅ | |
| Flow CRUD API | `/api/graphs` | ✅ | |
| Agent CRUD API | `/api/agents` | ✅ | |
| API key auth on webhooks | — | 🔜 | |
| Docker deploy | `docker-compose.yml` | ✅ | |
| Multi-replica scheduler | Single API process | ⚠️ | APScheduler in-process; no distributed lock |

---

## Settings & LLM

| Langflow | flowMAS | Status | Notes |
|----------|-----------|--------|-------|
| Multiple LLM providers | Settings → LLM Providers | ✅ | |
| Per-flow provider override | Run Settings | ✅ | |
| Early stop rules | Run Settings | ✅ | keyword / metadata / custom |
| Adaptive scheduler / pruning | Run Settings | ✅ | Required for conditional edges |
| Parallel execution limits | Run Settings | ✅ | |

---

## Priority backlog (Langflow gaps)

1. **Webhook triggers** — `POST /api/webhooks/{graph_id}` to start a run from external systems (Langflow Webhook component).
2. **Background job queue** — optional `background: true` on run API with job polling (Langflow Workflow API v2).
3. **Global run variables** — typed `globals` on execution request.
4. **Distributed schedules** — Redis/DB-backed scheduler for multi-replica API.
5. **Component groups / freeze** — lower priority; different execution model.

---

## References

- [Langflow docs](https://docs.langflow.org/)
- [Background Agents PR](https://github.com/langflow-ai/langflow/pull/10502)
- [Webhooks](https://docs.langflow.org/webhook)
- [Workflow API (Beta)](https://docs.langflow.org/workflow-api)
- [Flow run API](https://docs.langflow.org/api-flows-run)
