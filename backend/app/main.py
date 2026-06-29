import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.routers import health, ingest, sandbox, session
from app.websockets.handlers import get_connection_manager, handle_event

app = FastAPI(title="Study Buddy API")

_origins_env = os.getenv("ALLOWED_ORIGINS", "")
_origins = (
    _origins_env.split(",")
    if _origins_env
    else [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(ingest.router)
app.include_router(sandbox.router)
app.include_router(session.router)


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(ws: WebSocket, session_id: str):
    cm = get_connection_manager()
    await cm.connect(session_id, ws)
    try:
        while True:
            msg = await ws.receive_json()
            await handle_event(session_id, msg.get("type", ""), msg.get("data", {}))
    except WebSocketDisconnect:
        cm.disconnect(session_id)
    except Exception:
        cm.disconnect(session_id)
        raise
