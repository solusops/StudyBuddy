import json
import os
import uuid
from typing import Any, Dict, List

from fastapi import APIRouter
from pydantic import BaseModel

from app.agents.brain_agent import BrainAgent
from app.rag.chromadb_client import ChromaDBClient
from app.schemas.session import FamiliarityLevel, Session
from app.services.graph_state import GraphStateManager
from app.services.student_memory import StudentMemoryService
from app.websockets.handlers import get_db, get_graph_manager, _journal

router = APIRouter(prefix="/session", tags=["session"])
_brain = BrainAgent()
_memory = StudentMemoryService()

# In-progress ingestion status
_ingest_status: Dict[str, str] = {}  # session_id -> "indexing" | "extracting" | "ready" | "error"


class CreateSessionRequest(BaseModel):
    topic: str
    familiarity: FamiliarityLevel


class CreateSessionResponse(BaseModel):
    session_id: str
    topic: str
    familiarity: FamiliarityLevel


@router.post("/create", response_model=CreateSessionResponse)
def create_session(req: CreateSessionRequest):
    session_id = str(uuid.uuid4())
    _ingest_status[session_id] = "indexing"
    return CreateSessionResponse(
        session_id=session_id, topic=req.topic, familiarity=req.familiarity
    )


@router.get("/ingest-status/{session_id}")
def ingest_status(session_id: str):
    return {"status": _ingest_status.get(session_id, "unknown")}


def set_ingest_status(session_id: str, status: str) -> None:
    _ingest_status[session_id] = status


class CommitRequest(BaseModel):
    session_id: str
    topic: str
    familiarity: str
    nodes: List[Dict[str, Any]]
    content_files: List[str] = []


@router.post("/commit")
def commit_session(req: CommitRequest):
    save_dir = os.path.expanduser("~/.studybuddy/sessions")
    os.makedirs(save_dir, exist_ok=True)
    payload = req.model_dump()
    path = os.path.join(save_dir, f"{req.session_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    # Also write as latest.json for easy restore
    with open(os.path.join(save_dir, "latest.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    return {"status": "committed", "path": path}


class ClearRequest(BaseModel):
    session_id: str


@router.post("/clear")
def clear_session(req: ClearRequest):
    _journal.clear_session(req.session_id)
    mgr = get_graph_manager()
    mgr.clear_session(req.session_id)
    return {"status": "cleared"}
