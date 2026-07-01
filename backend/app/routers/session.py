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
    file_ids: List[str] = []


@router.post("/commit")
async def commit_session(req: CommitRequest):
    """Kept for compatibility -> the frontend no longer calls this directly.

    Session History is now committed automatically as part of Push
    (EVALUATE_SESSION, see handlers.py's _push_and_flush_memory), which
    calls the same commit_session_snapshot() this route delegates to.
    """
    from app.services.session_commit import commit_session_snapshot

    return await commit_session_snapshot(
        req.session_id, req.topic, req.familiarity, req.nodes,
        req.content_files, req.document_id, req.file_ids,
    )


@router.get("/trajectory/{document_id}")
def get_trajectory(document_id: str):
    """Persistent learning trajectory for a paper (for the Evaluation window)."""
    from app.services.memory_service import MemoryService
    return {"trajectory": MemoryService().read_trajectory(document_id)}


class ClearRequest(BaseModel):
    session_id: str
    document_id: str = ""
    file_ids: List[str] = []


@router.post("/clear")
def clear_session(req: ClearRequest):
    """Wipe everything tied to this session/document -> persistent and in-memory.

    A session is exactly one input document set, so clearing means starting over
    with nothing: no curriculum tree, no lessons, no chunks, no uploaded files.
    Cognee's cross-session student-memory profile is intentionally NOT touched ->
    it's meant to persist and grow across documents, not reset with them.
    """
    import shutil
    from pathlib import Path

    from app.rag.ingestion import LIBRARY_COLLECTION
    from app.services.annotation_service import get_annotation_service
    from app.services.memory_service import MemoryService
    from app.services.session_files import session_upload_dir

    _journal.clear_session(req.session_id)
    mgr = get_graph_manager()
    mgr.clear_session(req.session_id)

    db = get_db()
    db.delete_where(LIBRARY_COLLECTION, {"session_id": req.session_id})

    _ingest_status.pop(req.session_id, None)

    base = Path.home() / ".studybuddy"
    session_file = base / "sessions" / f"{req.session_id}.json"
    if session_file.exists():
        session_file.unlink()

    document_id = req.document_id
    if document_id:
        for p in (
            base / "sessions" / f"doc_{document_id}.json",
            base / "graphs" / f"doc_{document_id}.json",
        ):
            if p.exists():
                p.unlink()
        get_annotation_service().delete_for_document(document_id)
        MemoryService().flush_cluster(document_id)
    # document_id is a combined hash of the whole file set, not a single PDF's cache
    # filename -> the per-file PDF cache is keyed by file_ids instead.
    for file_id in req.file_ids:
        p = base / "pdfs" / f"{file_id}.pdf"
        if p.exists():
            p.unlink()

    # This session's own upload folder -> never a shared directory.
    shutil.rmtree(session_upload_dir(req.session_id), ignore_errors=True)

    return {"status": "cleared"}
