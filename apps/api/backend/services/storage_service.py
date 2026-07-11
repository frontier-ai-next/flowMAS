"""JSON file-based persistence scoped to anonymous browser sessions."""

import json
import os
import re
import tempfile
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.session import get_current_session_id, is_valid_session_id

# Entity ids become filenames, so they must not allow path traversal or
# separators. Anything outside this character class is rejected before it
# reaches the filesystem.
_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]+$")

_ENTITY_DIRS = ("agents", "graphs", "runs", "schedules")


class StorageService:
    """Session-scoped JSON file storage.

    Each anonymous browser session gets an isolated subtree:
    ``{data_dir}/sessions/{session_id}/agents|graphs|runs|schedules``.
    """

    def __init__(self, data_dir: str | None = None):
        self._root = Path(data_dir or settings.data_dir)
        self._locks_guard = threading.Lock()
        self._session_locks: dict[str, threading.RLock] = {}

    def _session_lock(self, session_id: str | None = None) -> threading.RLock:
        sid = session_id or get_current_session_id()
        if not is_valid_session_id(sid):
            raise ValueError(f"Invalid session id: {sid!r}")
        with self._locks_guard:
            return self._session_locks.setdefault(sid, threading.RLock())

    def _session_root(self, session_id: str | None = None) -> Path:
        sid = session_id or get_current_session_id()
        if not is_valid_session_id(sid):
            raise ValueError(f"Invalid session id: {sid!r}")
        root = (self._root / "sessions" / sid).resolve()
        if self._root.resolve() not in root.parents and root != self._root.resolve():
            raise ValueError(f"Invalid session path for id: {sid!r}")
        return root

    def _entity_dir(self, name: str, session_id: str | None = None) -> Path:
        if name not in _ENTITY_DIRS:
            raise ValueError(f"Unknown entity directory: {name}")
        directory = self._session_root(session_id) / name
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def ensure_session_dirs(self, session_id: str | None = None) -> None:
        for name in _ENTITY_DIRS:
            self._entity_dir(name, session_id)

    # --- Generic helpers ---

    @staticmethod
    def _safe_path(directory: Path, entity_id: str) -> Path:
        """Build a JSON path for ``entity_id`` inside ``directory``."""
        if not isinstance(entity_id, str) or not _SAFE_ID.match(entity_id) or entity_id in {".", ".."}:
            raise ValueError(f"Invalid entity id: {entity_id!r}")
        path = (directory / f"{entity_id}.json").resolve()
        if path.parent != directory.resolve():
            raise ValueError(f"Invalid entity id: {entity_id!r}")
        return path

    @classmethod
    def _existing_path(cls, directory: Path, entity_id: str) -> Path | None:
        try:
            path = cls._safe_path(directory, entity_id)
        except ValueError:
            return None
        return path if path.exists() else None

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        with path.open() as f:
            return json.load(f)

    @classmethod
    def _read_json_if_present(cls, path: Path) -> dict[str, Any] | None:
        try:
            return cls._read_json(path)
        except FileNotFoundError:
            return None

    @classmethod
    def _list_json(cls, directory: Path, *, reverse: bool = False) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for path in sorted(directory.glob("*.json"), reverse=reverse):
            value = cls._read_json_if_present(path)
            if value is not None:
                items.append(value)
        return items

    @staticmethod
    def _write_json(path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=path.parent,
                prefix=f".{path.name}.",
                suffix=".tmp",
                delete=False,
            ) as handle:
                temp_path = Path(handle.name)
                json.dump(data, handle, indent=2, default=str)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, path)
        finally:
            if temp_path is not None and temp_path.exists():
                temp_path.unlink(missing_ok=True)

    @staticmethod
    def _unlink(path: Path) -> bool:
        for attempt in range(20):
            try:
                path.unlink()
                return True
            except FileNotFoundError:
                return False
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.002)
        return False

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(UTC).isoformat()

    # --- Cross-session lookup (scheduler) ---

    def find_schedule(self, schedule_id: str) -> tuple[str, dict[str, Any]] | None:
        """Locate a schedule across all sessions (background jobs)."""
        sessions_root = self._root / "sessions"
        if not sessions_root.is_dir():
            return None
        for session_dir in sorted(sessions_root.iterdir()):
            if not session_dir.is_dir() or not is_valid_session_id(session_dir.name):
                continue
            path = self._existing_path(session_dir / "schedules", schedule_id)
            if path is not None:
                value = self._read_json_if_present(path)
                if value is not None:
                    return session_dir.name, value
        return None

    def iter_all_schedules(self) -> list[tuple[str, dict[str, Any]]]:
        """Enumerate schedules from every session (scheduler bootstrap)."""
        items: list[tuple[str, dict[str, Any]]] = []
        sessions_root = self._root / "sessions"
        if not sessions_root.is_dir():
            return items
        for session_dir in sorted(sessions_root.iterdir()):
            if not session_dir.is_dir() or not is_valid_session_id(session_dir.name):
                continue
            schedules_dir = session_dir / "schedules"
            if not schedules_dir.is_dir():
                continue
            items.extend(
                (session_dir.name, value)
                for value in self._list_json(schedules_dir)
            )
        return items

    # --- Agents ---

    def list_agents(self) -> list[dict[str, Any]]:
        return self._list_json(self._entity_dir("agents"))

    def get_agent(self, agent_id: str) -> dict[str, Any] | None:
        path = self._existing_path(self._entity_dir("agents"), agent_id)
        return self._read_json_if_present(path) if path else None

    def save_agent(self, agent_data: dict[str, Any]) -> dict[str, Any]:
        with self._session_lock():
            agent_id = agent_data.get("agent_id")
            if not agent_id:
                raise ValueError("agent_id is required")
            path = self._safe_path(self._entity_dir("agents"), str(agent_id))
            self._write_json(path, agent_data)
            return agent_data

    def delete_agent(self, agent_id: str) -> bool:
        with self._session_lock():
            path = self._existing_path(self._entity_dir("agents"), agent_id)
            if path:
                return self._unlink(path)
            return False

    # --- Graphs ---

    def list_graphs(self) -> list[dict[str, Any]]:
        return self._list_json(self._entity_dir("graphs"))

    def get_graph(self, graph_id: str) -> dict[str, Any] | None:
        path = self._existing_path(self._entity_dir("graphs"), graph_id)
        return self._read_json_if_present(path) if path else None

    def save_graph(self, graph_id: str, graph_data: dict[str, Any]) -> dict[str, Any]:
        with self._session_lock():
            path = self._safe_path(self._entity_dir("graphs"), graph_id)
            graph_data = {**graph_data, "graph_id": graph_id}
            self._write_json(path, graph_data)
            return graph_data

    def delete_graph(self, graph_id: str) -> bool:
        with self._session_lock():
            path = self._existing_path(self._entity_dir("graphs"), graph_id)
            if path:
                return self._unlink(path)
            return False

    # --- Runs ---

    def list_runs(self) -> list[dict[str, Any]]:
        return self._list_json(self._entity_dir("runs"), reverse=True)

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        path = self._existing_path(self._entity_dir("runs"), run_id)
        return self._read_json_if_present(path) if path else None

    def save_run(self, run_id: str, run_data: dict[str, Any]) -> None:
        with self._session_lock():
            path = self._safe_path(self._entity_dir("runs"), run_id)
            self._write_json(path, run_data)

    # --- Schedules ---

    def list_schedules(self) -> list[dict[str, Any]]:
        return self._list_json(self._entity_dir("schedules"))

    def get_schedule(self, schedule_id: str) -> dict[str, Any] | None:
        path = self._existing_path(self._entity_dir("schedules"), schedule_id)
        return self._read_json_if_present(path) if path else None

    def save_schedule(self, schedule_id: str, schedule_data: dict[str, Any]) -> dict[str, Any]:
        with self._session_lock():
            path = self._safe_path(self._entity_dir("schedules"), schedule_id)
            if not path.exists():
                schedule_data["created_at"] = self._now_iso()
            schedule_data["updated_at"] = self._now_iso()
            schedule_data["schedule_id"] = schedule_id
            schedule_data.setdefault("session_id", get_current_session_id())
            self._write_json(path, schedule_data)
            return schedule_data

    def delete_schedule(self, schedule_id: str) -> bool:
        with self._session_lock():
            path = self._existing_path(self._entity_dir("schedules"), schedule_id)
            if path:
                return self._unlink(path)
            return False


storage = StorageService()
