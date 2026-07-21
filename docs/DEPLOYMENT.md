# Deployment

flowMAS ships separate containers for the web studio, platform API, and
observability service. The production Compose file routes web, API, and
WebSocket traffic through an external Traefik network.

## Local Compose

Use the local override when evaluating the complete stack on one machine:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

The override exposes ports `3000`, `8000`, and `8100` and creates a local proxy
network. Persistent state is stored in `.docker-data/api` and
`.docker-data/observability`.

## Production prerequisites

- A Docker host with Compose v2
- An existing external Docker network named `traefik-proxy-net`
- Traefik configured with the `websecure` entrypoint and `letsEncrypt` resolver
- DNS for `GMAS_HOST` pointing to the proxy
- Persistent host paths for API state and observability data
- A stable `GMAS_PROVIDER_SECRET_KEY`

Create the external network if it does not already exist:

```bash
docker network create traefik-proxy-net
```

## Production configuration

Create a local `.env` file on the host. Keep it out of version control.

```dotenv
GMAS_HOST=gmas.example.com
GMAS_PROVIDER_SECRET_KEY=<stable-random-secret>
GMAS_DATA_PATH=/srv/flowmas/api
GMAS_OBSERVABILITY_DATA_PATH=/srv/flowmas/observability
GMAS_OBSERVABILITY_API_KEY=<shared-random-secret>
GMAS_OBSERVABILITY_CAPTURE_CONTENT=false
```

Provider keys can be configured in the UI or injected as environment variables.
When prompts or model outputs may contain sensitive data, leave content capture
disabled and define an explicit retention policy for the observability store.

## Start and update

```bash
docker compose up -d --build
docker compose ps
```

To update the pinned runtime and application together, pull the repository with
submodules before rebuilding:

```bash
git pull --recurse-submodules
git submodule update --init --recursive
docker compose up -d --build
```

## Verify the deployment

Check the public studio and API health endpoint through the configured host. The
observability container also exposes a health endpoint internally on port
`8100`.

```bash
curl --fail https://gmas.example.com/
curl --fail https://gmas.example.com/api/health
docker compose ps
```

Then run a small workflow and confirm that it appears in both **Runs** and
**Trace Explorer**.

## Persistence and backups

Back up the API and observability directories independently:

- API data contains graphs, agents, runs, schedules, sessions, and the generated
  provider encryption key when an explicit key is not supplied.
- Observability data can contain prompts, outputs, tool traces, and provider
  usage depending on capture settings.

`docker compose down` does not remove these bind-mounted directories. Their
retention, access control, and backup lifecycle remain the operator's
responsibility.

## Current scaling boundary

The scheduler runs in the API process and does not use a distributed lock.
Operate one scheduling API replica unless an external coordination layer is
introduced. The web and observability services can be separated operationally,
but validate persistence and ingestion behavior before scaling them.

## Security checklist

- Terminate TLS at the reverse proxy and keep HTTPS enabled.
- Set `GMAS_SESSION_COOKIE_SECURE=true` behind HTTPS.
- Use stable, high-entropy provider and observability secrets.
- Restrict access to persistent data and backups.
- Disable content capture unless prompts and outputs are required for debugging.
- Add authentication and project authorization before exposing a private or
  multi-tenant deployment.
