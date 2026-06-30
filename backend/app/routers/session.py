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
    document_id: str = ""


@router.post("/commit")
async def commit_session(req: CommitRequest):
    import shutil
    import asyncio
    import cognee

    save_dir = os.path.expanduser("~/.studybuddy/sessions")
    os.makedirs(save_dir, exist_ok=True)
    payload = req.model_dump()
    # Force-save in ONE place per paper (document_id) when known, plus the session file.
    paths = [os.path.join(save_dir, f"{req.session_id}.json")]
    if req.document_id:
        paths.append(os.path.join(save_dir, f"doc_{req.document_id}.json"))
    paths.append(os.path.join(save_dir, "latest.json"))
    for path in paths:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
            
    # Stage memory in Cognee's session cache
    payload_str = json.dumps(payload)
    await cognee.add(payload_str, dataset_name=f"session_{req.session_id}")
    
    # Execute memory snapshot using shutil.copytree for Memory Versioning
    try:
        data_root = cognee.config.data_root_directory()
        if data_root and os.path.exists(data_root):
            snapshot_dir = f"{data_root}_snapshot_{req.session_id}"
            if os.path.exists(snapshot_dir):
                shutil.rmtree(snapshot_dir)
            shutil.copytree(data_root, snapshot_dir)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Failed to create memory snapshot: %s", e)

    return {"status": "committed", "paths": paths}


@router.get("/trajectory/{document_id}")
def get_trajectory(document_id: str):
    """Persistent learning trajectory for a paper (for the Evaluation window)."""
    from app.services.memory_service import MemoryService
    return {"trajectory": MemoryService().read_trajectory(document_id)}


class ClearRequest(BaseModel):
    session_id: str


@router.post("/clear")
def clear_session(req: ClearRequest):
    _journal.clear_session(req.session_id)
    mgr = get_graph_manager()
    mgr.clear_session(req.session_id)
    return {"status": "cleared"}
