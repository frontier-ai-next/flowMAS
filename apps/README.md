# gMAS Applications

This repository uses an app-oriented structure:

```
apps/
├── api/       # FastAPI application (package: backend)
├── web/       # React 19 + Vite application
└── deploy/    # nginx + container entrypoint
```

## Development

From the repository root:

```bash
./scripts/dev-up.sh
```

Services:

- Web: `http://localhost:3000`
- API: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

## API app

- Code: `apps/api/backend`
- Data: `apps/api/data`
- Local package metadata: `apps/api/pyproject.toml`

## Web app

- Code: `apps/web/client/src`
- Config: `apps/web/vite.config.ts`
- Build output: `apps/web/dist/public`

## Production

The production container serves:

- Static web app from `apps/web/dist/public`
- API and WebSocket traffic proxied to Uvicorn via nginx

Build and run:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```
