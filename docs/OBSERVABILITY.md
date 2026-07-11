# gMAS Observability

This repository contains the first end-to-end version of a self-hosted
observability product for applications built on gMAS. It is intentionally a
separate product from the Low-Code platform: the platform is its first
integration host, not its owner.

## Components

```text
gMAS application
  ├─ GMASObservabilityCallback
  └─ wrapped async LLM callers
              │
              ▼
      gmas-observability SDK
      (redaction, queue, batching)
              │ HTTP
              ▼
      observability service
      async ingestion + query API
              │
              ├─ async SQLAlchemy + SQLite/WAL store
              └─ Trace Explorer
```

- `packages/gmas-observability` is the reusable, dependency-light Python SDK.
- `apps/observability` is the standalone FastAPI service and Trace Explorer.
- `apps/api/backend/services/observability_service.py` is the Low-Code adapter.
- `vendor/gmas` remains unchanged.

## Event model

Every event uses a versioned canonical envelope:

- `event_id`, `event_type`, `timestamp`, `sequence`;
- `trace_id`, `span_id`, `parent_span_id`;
- `project_id`, `environment`;
- `source`, `attributes`, `payload`.

The current integration captures run, agent, LLM, tool, memory, retry, budget,
parallel execution and dynamic-topology lifecycle events. Agent and LLM events
are represented as related spans. The Trace Explorer reconstructs the planned
and executed gMAS graph from the run plan and agent predecessors.

## Local development

From the repository root:

```bash
./scripts/dev-up.sh
```

This starts:

- Low-Code UI: `http://localhost:3000`
- platform API: `http://localhost:8000`
- Trace Explorer: `http://localhost:8100`

Run a workflow, open **Runs**, then choose **Trace Explorer**. Runtime trace
data is stored in `apps/observability/data/observability.sqlite3` and is not
part of the source tree committed to version control.

## Docker

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

Docker Compose bind-mounts persistent host directories under `.docker-data`:
platform graphs and runs use `.docker-data/api`, while traces use
`.docker-data/observability`. The paths are ignored by Git and can be
overridden with `GMAS_DATA_PATH` and `GMAS_OBSERVABILITY_DATA_PATH`. The
platform waits for the service health check but telemetry delivery remains
fail-open during later outages.

## Configuration

The platform integration accepts these environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GMAS_OBSERVABILITY_ENABLED` | `false` outside Compose | Enable telemetry |
| `GMAS_OBSERVABILITY_ENDPOINT` | `http://localhost:8100` | Service URL |
| `GMAS_OBSERVABILITY_PROJECT` | `gmas-demo` | Project partition |
| `GMAS_OBSERVABILITY_ENVIRONMENT` | `development` | Deployment environment |
| `GMAS_OBSERVABILITY_API_KEY` | empty | Shared ingestion/query key |
| `GMAS_OBSERVABILITY_CAPTURE_CONTENT` | `true` | Capture prompts and outputs |

## Privacy and failure behavior

- The platform owns one observability client per process and starts and closes
  it through the FastAPI lifespan.
- Delivery uses one shared `asyncio.Queue`, one asynchronous worker task and a
  reusable HTTP connection pool; agent callbacks only enqueue events.
- Queue, transport and callback failures do not fail a gMAS workflow.
- Secret-like keys and bearer credentials are redacted before transport.
- Strings are bounded before ingestion.
- Provider raw responses and hidden reasoning are not persisted.
- Set `GMAS_OBSERVABILITY_CAPTURE_CONTENT=false` when prompts or outputs must
  not leave the application process.

The current API key is suitable for a local/self-hosted MVP, not multi-tenant
production. Production hardening still requires user authentication, project
authorization, retention policies, durable retry and database migrations.

## Implemented UI

- trace overview and search;
- daily LLM provider token usage bar chart with input/output breakdown and today, 7-day, 30-day and custom date ranges;
- per-trace provider token usage histogram grouped by gMAS agent;
- usage coverage (`captured calls / all LLM calls`) with complete, partial and
  unavailable states; unavailable provider usage is shown as `N/A`, never as
  zero tokens;
- lifecycle agents without provider usage and LLM calls without an agent id
  remain visible as unavailable agents or an `Unattributed` bucket;
- success, latency, token, LLM and agent metrics;
- gMAS execution graph reconstructed from telemetry;
- graph pan/zoom and draggable nodes with live edge updates;
- agent inspector with full captured LLM request, output, usage and nested
  LLM/tool/memory activity;
- span waterfall and canonical event stream.

Navigation exposes only the implemented trace explorer route; planned product
areas are intentionally omitted until their routes are available.

## Tests

Run each application independently because both FastAPI applications currently
use a top-level Python package named `backend`:

```bash
uv run --project packages/gmas-observability --with pytest --with pytest-asyncio pytest -q packages/gmas-observability/tests
(cd apps/api && ../../.venv/bin/python -m pytest -q tests)
uv run --project apps/observability --extra dev pytest -q apps/observability/tests
(cd apps/web && npm run test)
```

The generic server package name is known technical debt and should be renamed
before publishing the observability server as a standalone Python distribution.

## Next product phases

1. topology replay over time;
2. memory inspector;
3. sessions and multi-turn workflows;
4. trace/workflow-version comparison;
5. exact cost analytics and score/evaluation workflows;
6. durable delivery, retention and production access control.
