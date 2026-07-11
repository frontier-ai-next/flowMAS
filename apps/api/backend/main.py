"""FastAPI application for the gMAS Web UI backend."""

import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import settings
from backend.session import SessionMiddleware
from backend.services.tool_registry_service import get_tool_runtime_config

gmas_src = Path(settings.src_path)
if gmas_src.exists() and str(gmas_src) not in sys.path:
    sys.path.insert(0, str(gmas_src))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown."""
    (Path(settings.data_dir) / "sessions").mkdir(parents=True, exist_ok=True)
    for subdir in ("agents", "graphs", "runs", "schedules"):
        (Path(settings.data_dir) / subdir).mkdir(parents=True, exist_ok=True)
    get_tool_runtime_config()
    from backend.services.observability_service import (
        shutdown_observability,
        start_observability,
    )
    from backend.services.schedule_service import start_scheduler, shutdown_scheduler

    await start_observability()
    start_scheduler()
    try:
        yield
    finally:
        shutdown_scheduler()
        await shutdown_observability()


app = FastAPI(
    title="gMAS Web UI",
    description="Web interface for the gMAS graph Multi-Agent System framework",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SessionMiddleware)

from backend.routers import agents, config, execution, graphs, schedules, tools  # noqa: E402

app.include_router(agents.router)
app.include_router(graphs.router)
app.include_router(execution.router)
app.include_router(schedules.router)
app.include_router(tools.router)
app.include_router(config.router)

from backend.websocket.handlers import router as ws_router  # noqa: E402

app.include_router(ws_router)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    gmas_available = False
    try:
        import gmas  # noqa: F401

        gmas_available = True
    except ImportError:
        pass

    return {
        "status": "ok",
        "gmas_available": gmas_available,
        "src_path": settings.src_path,
    }
