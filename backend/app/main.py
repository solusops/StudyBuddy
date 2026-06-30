import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()  # must run before any local import that reads env vars

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.routers import annotations, health, library, regions, sandbox, session, review
from app.websockets.handlers import get_connection_manager, get_db, handle_event


@asynccontextmanager
async def lifespan(app: FastAPI):
    import os
    cerebras_key = os.environ.get("CEREBRAS_API_KEY", "")
    cerebras_base = "https://api.cerebras.ai/v1"
    # LiteLLM reads OPENAI_API_KEY/BASE when provider is "openai"
    os.environ["OPENAI_API_KEY"] = cerebras_key
    os.environ["OPENAI_API_BASE"] = cerebras_base
    # Cognee-specific vars (fallback)
    os.environ["LLM_API_KEY"] = cerebras_key
    os.environ["LLM_API_BASE"] = cerebras_base
    os.environ["LLM_MODEL"] = "openai/gemma-4-31b"
    
    import cognee
    from pathlib import Path
    try:
        root = str(Path.home() / ".studybuddy" / "cognee")
        cognee.config.data_root_directory(root)
        cognee.config.system_root_directory(f"{root}/system")
        from cognee.infrastructure.databases.relational.create_db_and_tables import create_db_and_tables
        await create_db_and_tables()
    except Exception as e:
        print("Cognee setup error:", e)
    yield


app = FastAPI(title="Study Buddy API", lifespan=lifespan)

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
app.include_router(library.router)
app.include_router(sandbox.router)
app.include_router(session.router)
app.include_router(annotations.router)
app.include_router(regions.router)
app.include_router(review.router)


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(ws: WebSocket, session_id: str):
    cm = get_connection_manager()
    await cm.connect(session_id, ws)
    try:
        while True:
            msg = await ws.receive_json()
            await handle_event(session_id, msg.get("type", ""), msg.get("data", {}))
    except (WebSocketDisconnect, RuntimeError):
        cm.disconnect(session_id)
    except Exception:
        cm.disconnect(session_id)
        raise
