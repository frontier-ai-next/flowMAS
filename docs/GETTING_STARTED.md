# Getting started

This guide takes a fresh checkout to a running flowMAS workspace. It keeps the
gMAS runtime pinned to the commit selected by the flowMAS repository.

## Prerequisites

- Git with submodule support
- Python 3.12 or 3.13
- Node.js 22 and pnpm, or Docker with Docker Compose
- An API key for at least one configured LLM provider when executing workflows

The development launcher is intended for macOS, Linux, or Windows through WSL.
Docker Compose is the most direct cross-platform option.

## Clone the complete repository

```bash
git clone --recurse-submodules https://github.com/frontier-ai-next/flowMAS.git
cd flowMAS
```

If the repository was cloned without submodules, initialize gMAS separately:

```bash
git submodule update --init --recursive
```

Confirm that `vendor/gmas/pyproject.toml` exists before installing the API.

## Option A: development launcher

```bash
./scripts/dev-up.sh
```

The script creates `.venv`, installs the pinned gMAS runtime and the local
Python packages, installs web dependencies, and starts all three services.
Stop them together with `Ctrl+C` in the launcher terminal.

| Service | Address | Purpose |
| --- | --- | --- |
| Studio | `http://localhost:3000` | Graph authoring and live execution |
| API | `http://localhost:8000` | Graph, agent, schedule, and execution APIs |
| API schema | `http://localhost:8000/docs` | Interactive OpenAPI documentation |
| Trace Explorer | `http://localhost:8100` | Runs, spans, topology, and usage inspection |

## Option B: Docker Compose

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

The local override exposes the same ports and replaces the external production
proxy network with a local network. Runtime data is written under
`.docker-data/` and survives container recreation.

Stop the stack without deleting persisted data:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

## Configure a provider

Open **Settings → LLM Providers** in the studio. Provider credentials saved in
the UI are encrypted at rest. For a stable deployment, set
`GMAS_PROVIDER_SECRET_KEY`; otherwise locally saved provider credentials may not
be recoverable after the generated key is replaced.

You can also pass supported provider keys through environment variables before
starting the services:

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
```

Never commit populated `.env` files or provider credentials.

## Run the first workflow

1. Open the studio and choose an existing graph or create one from the asset palette.
2. Add Start and Finish nodes and connect at least one configured agent.
3. Select **Validate** and resolve any reported route or configuration errors.
4. Select **Run**, enter a task, and follow agent state in the canvas and console.
5. Open **Runs**, select the completed run, and continue into **Trace Explorer**.

## Common setup failures

### `vendor/gmas` is empty

```bash
git submodule sync --recursive
git submodule update --init --recursive
```

### A provider is configured but execution fails

Check the selected provider, model name, endpoint, and credential in Settings.
Then inspect the structured error in the run console; flowMAS does not hide
provider errors behind a generic workflow failure.

### Trace Explorer has no data

Verify that `GMAS_OBSERVABILITY_ENABLED=true` and that the API can reach
`GMAS_OBSERVABILITY_ENDPOINT`. Telemetry delivery is fail-open, so an
observability outage does not fail the workflow itself.

## Next steps

- Learn the system boundaries in [Architecture](ARCHITECTURE.md).
- Use the complete [UI guide](UI_GUIDE.md).
- Review privacy and telemetry controls in [Observability](OBSERVABILITY.md).
- Prepare a persistent installation with [Deployment](DEPLOYMENT.md).
