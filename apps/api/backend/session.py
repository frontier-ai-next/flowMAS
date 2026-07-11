"""Anonymous browser sessions — cookie-scoped workspaces without registration."""

import re
import uuid
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Iterator

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.config import settings

SESSION_COOKIE = "gmas_session"
SESSION_HEADER = "X-GMAS-Session"
_SESSION_ID_RE = re.compile(r"^[0-9a-f]{32}$")

_session_ctx: ContextVar[str | None] = ContextVar("gmas_session_id", default=None)


class SessionError(ValueError):
    """Raised when a session id fails validation."""


def is_valid_session_id(value: str | None) -> bool:
    return isinstance(value, str) and bool(_SESSION_ID_RE.fullmatch(value))


def normalize_session_id(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = value.strip().lower().replace("-", "")
    if is_valid_session_id(cleaned):
        return cleaned
    return None


def new_session_id() -> str:
    return uuid.uuid4().hex


def get_current_session_id() -> str:
    """Return the active session id (middleware or explicit scope must set it)."""
    session_id = _session_ctx.get()
    if session_id is None:
        raise RuntimeError("No active session — SessionMiddleware or session_scope() required")
    return session_id


def try_get_current_session_id() -> str | None:
    return _session_ctx.get()


def set_current_session_id(session_id: str) -> Token:
    if not is_valid_session_id(session_id):
        raise SessionError(f"Invalid session id: {session_id!r}")
    return _session_ctx.set(session_id)


def reset_current_session_id(token: Token) -> None:
    _session_ctx.reset(token)


@contextmanager
def session_scope(session_id: str) -> Iterator[str]:
    """Run storage/service code under a specific session (scheduler, tests)."""
    normalized = normalize_session_id(session_id)
    if normalized is None:
        raise SessionError(f"Invalid session id: {session_id!r}")
    token = set_current_session_id(normalized)
    try:
        yield normalized
    finally:
        reset_current_session_id(token)


def _parse_cookie_header(cookie_header: str, name: str) -> str | None:
    if not cookie_header:
        return None
    prefix = f"{name}="
    for part in cookie_header.split(";"):
        part = part.strip()
        if part.startswith(prefix):
            return normalize_session_id(part[len(prefix) :])
    return None


def _header_value(scope: Scope, name: str) -> str | None:
    target = name.lower().encode("latin-1")
    for key, value in scope.get("headers", ()):
        if key.lower() == target:
            return value.decode("latin-1")
    return None


def resolve_session_from_scope(scope: Scope) -> tuple[str, bool]:
    """Extract session id from HTTP/WebSocket scope; create one if missing."""
    cookie_header = _header_value(scope, "cookie") or ""
    session_id = _parse_cookie_header(cookie_header, SESSION_COOKIE)
    if session_id is None:
        session_id = normalize_session_id(_header_value(scope, SESSION_HEADER))
    if session_id is None:
        return new_session_id(), True
    return session_id, False


def _cookie_set_header(session_id: str) -> bytes:
    parts = [
        f"{SESSION_COOKIE}={session_id}",
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        f"Max-Age={int(settings.session_cookie_max_age)}",
    ]
    if settings.session_cookie_secure:
        parts.append("Secure")
    return "; ".join(parts).encode("latin-1")


class SessionMiddleware:
    """Assign each browser a stable anonymous session via HttpOnly cookie."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return

        session_id, is_new = resolve_session_from_scope(scope)
        token = set_current_session_id(session_id)
        try:
            if scope["type"] == "http" and is_new:

                async def send_with_cookie(message: Message) -> None:
                    if message["type"] == "http.response.start":
                        headers = list(message.get("headers", []))
                        headers.append((b"set-cookie", _cookie_set_header(session_id)))
                        message = {**message, "headers": headers}
                    await send(message)

                await self.app(scope, receive, send_with_cookie)
            else:
                await self.app(scope, receive, send)
        finally:
            reset_current_session_id(token)
