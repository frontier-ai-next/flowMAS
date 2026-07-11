"""WebSocket connection manager."""

import json

from fastapi import WebSocket


class ConnectionManager:
    """Manages WebSocket connections grouped by run_id."""

    def __init__(self):
        self._connections: dict[str, list[WebSocket]] = {}

    async def connect(self, run_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        if run_id not in self._connections:
            self._connections[run_id] = []
        self._connections[run_id].append(websocket)

    def disconnect(self, run_id: str, websocket: WebSocket) -> None:
        if run_id in self._connections:
            self._connections[run_id] = [ws for ws in self._connections[run_id] if ws != websocket]
            if not self._connections[run_id]:
                del self._connections[run_id]

    async def send_event(self, run_id: str, event: dict) -> None:
        """Send an event to all connections for a run."""
        if run_id not in self._connections:
            return
        dead: list[WebSocket] = []
        for ws in self._connections[run_id]:
            try:
                await ws.send_text(json.dumps(event, default=str))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(run_id, ws)


ws_manager = ConnectionManager()
