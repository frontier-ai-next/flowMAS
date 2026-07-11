"""WebSocket endpoint for execution streaming."""

import asyncio
import contextlib
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.services.execution_service import cancel_execution, get_active_run, get_run_detail
from backend.websocket.manager import ws_manager

router = APIRouter()


@router.websocket("/ws/execution/{run_id}")
async def execution_stream(websocket: WebSocket, run_id: str):
    """Stream execution events to the client via WebSocket."""
    await ws_manager.connect(run_id, websocket)

    try:
        run_state = get_active_run(run_id)
        if run_state is None:
            persisted = get_run_detail(run_id)
            if persisted is not None:
                for event in persisted.get("events", []):
                    await websocket.send_text(json.dumps(event, default=str))
                await websocket.close(code=1000, reason="Run already finished")
                return
            await websocket.send_text(json.dumps({"event_type": "error", "error": f"Run '{run_id}' not found"}))
            await websocket.close()
            return

        # Replay snapshot of past events; track last replayed seq
        replay_count = len(run_state.events)
        last_replayed_seq = -1
        for event in run_state.events[:replay_count]:
            last_replayed_seq = event.get("_seq", last_replayed_seq)
            await websocket.send_text(json.dumps(event, default=str))

        # If the run already finished, close cleanly
        if run_state.status in ("completed", "error", "cancelled"):
            await websocket.close(code=1000, reason="Run already finished")
            return

        # Read live events from queue, skipping any that were already replayed
        async def stream_events():
            while True:
                event = await run_state.queue.get()
                if event is None:  # Sentinel: run complete
                    break
                seq = event.get("_seq", -1)
                if seq <= last_replayed_seq:
                    continue
                await ws_manager.send_event(run_id, event)

        async def listen_client():
            while True:
                try:
                    data = await websocket.receive_text()
                    msg = json.loads(data)
                    if msg.get("action") == "cancel":
                        cancel_execution(run_id)
                except (WebSocketDisconnect, Exception):
                    break

        stream_task = asyncio.create_task(stream_events())
        listen_task = asyncio.create_task(listen_client())

        _done, pending = await asyncio.wait({stream_task, listen_task}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()

        # Close WebSocket cleanly after streaming is done
        with contextlib.suppress(Exception):
            await websocket.close(code=1000, reason="Streaming complete")

    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(run_id, websocket)
