# gMAS Web UI — Guide

End-to-end guide for the web client: what every page does, what every colour
means, and how features fit together.

The web client is a single-page React 19 + Vite + TypeScript app served by
the Vite dev server in development and as static files in production. It
talks to the FastAPI backend at `/api/*` and connects to live runs over
`ws://…/ws/execution/<run_id>`.

---

## Pages at a glance

| Page                     | Path           | Purpose                                                                 |
| ------------------------ | -------------- | ----------------------------------------------------------------------- |
| **Landing / Get Started**| `/`            | First-run onboarding, links to building a graph                         |
| **Workflow**             | `/workflow`    | Graph editor + live execution canvas (the main page)                    |
| **Agents**               | `/agents`      | CRUD for reusable agent profiles (persona, LLM config, tools)           |
| **Tools**                | `/tools`       | Toggle and configure runtime tools (shell, web search, vector, MCP …)   |
| **Runs**                 | `/runs`        | History of executions, live event log, follow-up continuations          |
| **Settings**             | `/settings`    | LLM providers, runner defaults, theme                                   |

---

## Status colours used everywhere

Whenever the UI shows a node, edge, badge, or chip with one of these tones,
this is what it means:

| Colour          | Meaning                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| **Blue** (oklch 0.62/0.19/259)  | Active — running, current selection, primary action                |
| **Green** (oklch 0.72/0.17/142) | Succeeded — agent finished, run completed, validation passed       |
| **Red**   (oklch 0.62/0.22/25)  | Failed — agent error, run error, validation error                  |
| **Amber** (oklch 0.72/0.19/55)  | Tool activity — tool calls, MCP, web search                        |
| **Violet**(oklch 0.65/0.18/295) | Waiting on LLM, follow-up runs, AI build                           |
| **Zinc / muted**                | Idle / queued / not relevant in current context                    |

---

## Workflow page (`/workflow`)

The Workflow page has four areas:

```
┌──────────────────────────────────────────────────────────────────┐
│ Top bar: graph name · Save · AI Build · Run / Stop · Templates … │
├──────────┬───────────────────────────────────────────┬───────────┤
│ Left     │                                           │ Right     │
│ panel    │           Graph canvas (SVG)              │ Inspector │
│ (assets) │           + minimap + zoom controls       │           │
├──────────┴───────────────────────────────────────────┴───────────┤
│ Bottom console (events log, collapsible)                         │
└──────────────────────────────────────────────────────────────────┘
```

### Left panel — Assets

Tabs (top of the panel):

1. **Agents** — every saved agent profile. Drag a card onto the canvas to
   place it as a node. Click a card to expand the persona and see the tool
   chips. Hover → Edit (✏️) jumps to `/agents`, Delete (🗑) removes the
   agent globally.
2. **Tools** — every enabled runtime tool. Drag a tool onto an agent node to
   attach it.
3. **Schemas** — JSON schemas / structured-output templates.
4. **Tmpl** — agent templates and **graph templates** (ready-made
   architectures). Click a graph template to clone it into a new graph.

Bottom of the left panel:

- **AI Build (LLM)** ✨ — opens a dialog. Type a task in plain language
  (e.g. *"how to bake sourdough — guide a beginner step by step"*),
  pick max agents (2–12), press **Build with AI**. The configured default
  LLM provider designs the agents, picks their tools, lays out a topology,
  saves the graph, and opens it on the canvas. Takes 30–90 s.
- **Link by Embeddings** — auto-build edges between the agents currently on
  canvas using sentence embeddings (no LLM call). Best for prototyping.
- **Auto Layout** — re-arranges nodes using a Sugiyama-lite layered layout
  (longest-path layering + barycenter ordering for fewer edge crossings).
  Also auto-fits the view.
- **Validate** — runs both local checks (does `__end__` have an incoming
  edge? are there any agents?) and the backend's full validation; results
  appear as a banner above the canvas.

### Canvas

- **Nodes**:
  - `task` (green tint, left) — entry point. The user's task query enters
    the graph here. (Underlying ID is `__start__`; displayed as `task`.)
  - `result` (orange tint, right) — terminal node. The final answer flows
    out here. (Underlying ID is `__end__`; displayed as `result`.)
  - Agent cards — show the agent name, status pill, model, and token count.
    Click to select; double-click the title to rename.
- **Status pills** on agent nodes:
  - **idle** — grey
  - **queued** — pale grey
  - **running** — pulsing blue halo, blue dot
  - **succeeded** — green dot
  - **failed** — red dot
  - **waiting_tool** — amber
  - **waiting_llm** — violet
- **Edges**:
  - Solid dark line with arrow — normal edge
  - **Dashed grey** — idle edge (not active in current run)
  - **Solid blue with glow + flowing particles** — currently active (the
    source agent is running and feeding the target)
  - **Pill in the middle** — `condition` for the edge (see Conditional
    routing below)
- **Pan / Zoom**:
  - Mouse-wheel — zoom around the cursor
  - Click-drag the empty canvas — pan
  - **⊕ / ⊖** buttons (top-right of canvas) — zoom in/out
  - **⛶ Fit to view** — fits the whole graph into the viewport
- **Minimap** (bottom-right) — miniature of the whole graph. Nodes are
  coloured by status, the blue dashed rectangle is the viewport you're
  looking at. Theme-aware (light grey on dark mode, dark grey on light mode).

### Adding edges manually

Hover any agent — a blue handle appears on its right side. Click and drag
from that handle onto another node to draw an edge. Drop on empty space to
cancel.

### Right inspector

Click an agent or edge to open it. Tabs:

- **Overview** — agent name, persona, model, base URL, tool list
- **Params** — temperature, top-p, top-k, max tokens, stop sequences,
  parallel tool calls, tool choice
- **Output** — last response for this node (or final result if no node is
  selected). Supports Copy and Export buttons.
- **Edge** — `condition` and `weight` for the selected edge, plus a list of
  all edges connected to the selected node

The inspector can be floated (drag from the title bar) and resized.

### Bottom console

Collapsed by default — click ▴ to expand. Streams every `RunEvent` as it
arrives over the WebSocket:

- Colour-coded by event type (blue agent_*, amber tool_*, red error,
  violet topology change)
- Hover any row to see the full payload
- "Clear" button — wipes the local view (doesn't affect the run on the
  backend)

### Top bar

- **Breadcrumb** (`Workflow / <graph name>`) — click the chevron to switch
  to another saved graph
- **Save** — persists current canvas state (nodes, positions, edges) to the
  backend
- **Run** ▶ (green) — opens the run dialog (task query, runner config).
  After submission turns into **Stop** ◾ (red).
- Status chip — `idle` / `running` etc. plus the active run id

### Conditional routing (the "skips" question)

Edges can carry a `condition` name. The scheduler evaluates it after the
source agent finishes; if the condition is False the edge is dropped from
the current run and the target agent may be skipped. Built-in conditions:

| Name             | Fires when …                                            |
| ---------------- | ------------------------------------------------------- |
| `always`         | unconditionally (default behaviour if no condition set) |
| `never`          | never (use to disable an edge without deleting it)      |
| `source_success` | source agent finished without error                     |
| `source_failed`  | source agent failed or raised                           |
| `has_response`   | source agent produced any text response                 |

**Example** — in the *Cooking Recipe Pipeline* graph template:

```
Ingredient Checker
    ├── source_failed  → Substitution Expert → Chef
    └── source_success → Chef                  (skip substitution)
```

To create one in the UI: click the edge → Inspector → Edge tab → fill the
`Condition` field with a name from the table above → Save.

---

## Agents page (`/agents`)

Grid of every saved agent. Each card shows: name, agent_id, persona, model,
tools. Top bar lets you:

- **New Agent** — create from scratch
- **From Template** — pick one of the built-in agent templates (researcher,
  writer, planner, reviewer, coder …)
- **Search / filter** by name, persona, model, tool

Detail view (click a card) is a tabbed editor: **Overview · Persona ·
LLM Config · Tools · Schemas**. Every field maps 1:1 to the backend
`AgentCreate` model.

The count badge in the sidebar (`Agents 49`) is the total saved count.

---

## Tools page (`/tools`)

Lists every tool available to agents. Built-ins are always there:

| Tool              | Purpose                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| `shell`           | Execute shell commands (sandboxed if configured)                           |
| `code_interpreter`| Run Python code, return stdout / value                                     |
| `file_search`     | Search files by name / content in the configured base directory            |
| `web_search`      | DuckDuckGo (default) or other providers; can `fetch_content` of results    |
| `vector_search`   | RAG over an embedding store (in-memory / Faiss / Qdrant / Pinecone)        |
| `mcp`             | Proxies tools from a remote Model Context Protocol server                  |
| `computer_use`    | Screenshot / click / type controller (mock / linux / macos / windows)      |

Click a tool to:

- Toggle **enabled / disabled** for this deployment
- Edit per-tool config (timeout, max results, base directory, MCP server
  URL, vector store type, …)

The count badge (`Tools 7`) shows how many are enabled.

---

## Runs page (`/runs`)

Top: 4 KPI cards (Total runs, Success rate, Total tokens, Avg duration)
with sparklines.

Below: filter chips for status (`all`, `running`, `succeeded`, `failed`,
`stopped`, `queued`), then a sortable list of runs. Active runs (those
still in memory on the backend) appear at the top of the list immediately
on start, even before they're persisted.

Click a run to open the detail panel on the right. Tabs:

- **Overview** — task, duration, steps, tokens, tool calls, errors,
  per-agent breakdown
- **Events** — every event with type filter and agent filter, both **Log**
  view (chronological cards, expandable to show full output) and
  **Timeline** view (with relative-time bars). Each expanded event has
  Copy and Export buttons and a character-count badge.
- **Topology** — every dynamic topology change made by the runner
- **Output** — the final answer, scrollable, with Copy and Export

Actions (bottom of the detail panel):

- **Stop** (red) — if the run is still running
- **Replay** (green) — re-run the same graph with the same task on the
  Workflow page
- **Open Graph** — jump to `/workflow?graph=<id>&run=<run_id>`. The
  canvas opens with **node statuses repainted** from this run's events:
  green for succeeded, red for failed, blue + pulsing for still-running. If
  the run is still active, a live WebSocket attaches automatically and the
  graph keeps updating in real time.
- **Continue with new question** (violet, only for finished runs) — opens
  an inline form. Type a follow-up question and press Send. The backend
  starts a new run on the same graph that carries forward the previous
  run's final answer as context, so agents can answer "and then what?"
  questions naturally. The browser jumps to the new run on the Workflow
  page so you watch it execute live.

---

## Settings page (`/settings`)

Three sections:

- **LLM Providers** — list, add, edit, delete. Each provider has
  `provider_id`, `provider_type` (openai / openai-compatible / custom),
  `base_url`, `api_key`, `default_model`. The first provider in the list
  (with an API key) is used as the default for AI Build and as the
  fallback for agents without explicit `llm_config`.
- **Runner defaults** — every field of `RunnerConfigSchema`: parallelism,
  memory, dynamic topology, error policy, callback modes.
- **Theme** — light / dark / system. The canvas, minimap, ambient
  backgrounds, and all status colours follow the choice live (via a
  MutationObserver on `<html class>`).

---

## State that survives navigation

`WorkflowRunProvider` lives at the App level, so the following state
persists across page transitions (it only resets on a hard refresh):

- `nodes`, `edges` on the canvas (with their live statuses)
- `activeGraphId`, `graphName`
- `activeRunId`, `liveEvents`, `nodeOutputs`, `lastRunOutput`
- The WebSocket connection itself

This means you can:

1. Start a run on Workflow → ▶
2. Switch to Tools or Runs to check something
3. Come back to Workflow — the run is still painting nodes in real time

You only lose the live view when you explicitly load a different graph
(canvas resets) or hard-refresh the page (sessionStorage keeps the
`activeGraphId` so the same graph re-loads, but live status from in-flight
events restarts from the snapshot).

---

## AI Build flow — step by step

1. Workflow → bottom of Left Panel → **AI Build (LLM)** ✨
2. Dialog opens. Type the task — anything: *"how to cook carbonara",*
   *"forecast political events with sources and scoring",* *"plan a
   weekend trip to Tbilisi".*
3. Choose max agents (2–12). Pick 4–6 for most tasks.
4. Press **Build with AI** (violet button).
5. The backend calls `gmas.builder.AutoGraphBuilder.assemble_full_async`
   against the default LLM provider. The LLM designs agents (with
   personas and tool choices) and a topology.
6. Backend strips the synthetic `__task__` node, deduplicates edges,
   computes a layered layout (longest path + barycenter), and returns a
   `GraphSaveRequest`.
7. The frontend persists the graph (so it gets a real `graph_id`) and
   opens it on the canvas. Press ▶ Run to execute immediately.

---

## Follow-up runs

A follow-up is a new run on the same graph that **uses the previous run's
final answer as additional context**. Use it for "tell me more about X"
or "now make it shorter" questions.

How:

1. Runs page → pick any finished run → right panel
2. Press **Continue with new question** (violet)
3. Type the follow-up → **Send**
4. UI jumps to Workflow on the same graph with `?run=<new_run_id>` so you
   watch live

Behind the scenes the backend composes the prompt:

```
PREVIOUS CONVERSATION (run <prev_id>):
<prev_run_final_answer>

FOLLOW-UP TASK:
<your_new_question>
```

If the graph has `enable_memory: true` in its runner config, agents also
see their stored memory entries from the previous run.

---

## Real-time visuals during a run

What you should see when you press ▶:

1. **`task` node** → pulses blue first (queued / running)
2. The outgoing **edge from task** turns from dashed grey to **solid blue
   with three flowing particles** and a soft outer glow
3. Each agent that's currently executing has:
   - A **double blue halo** (outer pulsing ring + inner bright ring)
   - The status pill switches to "running" with a blinking blue dot
4. As an agent finishes, its halo turns **green** and the outgoing edges
   activate
5. Parallel branches light up at the same time — fan-out patterns show 4+
   agents pulsing simultaneously
6. The **minimap** highlights every active node and traces active edges
   in blue
7. When the run finishes:
   - All visited nodes are green
   - All edges return to dashed grey
   - A toast appears ("Execution complete") and the bottom-bar status
     reverts to "idle"

If you don't see real-time updates: check DevTools → Network → the
`ws://localhost:5173/ws/execution/<run_id>` socket should be `101
Switching Protocols`. The runtime throttles bursts so the canvas paints
each step instead of all transitions landing in one frame.

---

## Keyboard shortcuts

| Keys                | Action                              |
| ------------------- | ----------------------------------- |
| ⌘ Enter / Ctrl Enter| Run / Stop                          |
| ⌘ S                 | Save graph                          |
| ⌘ K                 | Open template / agent search        |
| Delete              | Remove selected node or edge        |
| ?                   | Open shortcut overlay               |
| Esc                 | Close dialog / deselect             |

---

## Troubleshooting

| Symptom                                | Likely cause / fix                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Runs list shows 0                      | Backend was down. Restart `uvicorn`, hard-refresh                                                        |
| Live canvas frozen after navigation    | Check WS in DevTools. If closed, the run finished — open it via Runs → Open Graph                        |
| AI Build returns 401                   | Default LLM provider key invalid. Edit in Settings → LLM Providers                                       |
| Web search times out for 30s+ per query| DuckDuckGo SSL issues. Either disable `web_search` on Tools page or wait for retries                     |
| Task node overlaps first agent         | Press **Auto Layout** — it re-spaces and centres everything                                              |
| Inspector cards overflow / scroll H    | Hard-refresh; the panel was patched to keep ScrollArea inner wrapper as block                            |

---

## File map (where to look in the code)

| Concern                      | File                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| Canvas, drag, zoom, minimap  | `apps/web/client/src/pages/Workflow.tsx` — `GraphCanvas`, `AgentCard`, `LeftPanel`    |
| Run state shared across pages| `apps/web/client/src/contexts/WorkflowContext.tsx`                                    |
| Run history + detail + follow-up | `apps/web/client/src/pages/Runs.tsx` — `RunDetail`, `FollowupRow`                 |
| Typed API client             | `apps/web/client/src/lib/api.ts`                                                      |
| AI build endpoint            | `apps/api/backend/routers/graphs.py` (`/api/graphs/ai-build`)                         |
| AI build logic               | `apps/api/backend/services/graph_service.py` (`ai_build_graph`)                       |
| Follow-up endpoint           | `apps/api/backend/routers/execution.py` (`/api/execution/{run_id}/followup`)          |
| Graph templates              | `apps/api/backend/services/graph_templates_service.py`                                |
| Conditional edges (engine)   | `src/gmas/execution/scheduler.py` (`_register_builtins`)                              |
| AutoGraphBuilder             | `src/gmas/builder/auto_builder.py`                                                    |
