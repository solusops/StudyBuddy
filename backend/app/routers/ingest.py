import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from app.agents.brain_agent import BrainAgent
from app.rag.ingestion import ChunkType, ingest_file, ingest_text
from app.schemas.session import FamiliarityLevel
from app.services.student_memory import StudentMemoryService
from app.websockets.handlers import get_db, get_graph_manager

router = APIRouter(prefix="/ingest", tags=["ingest"])
_brain: BrainAgent | None = None
_memory: StudentMemoryService | None = None


def _get_brain() -> BrainAgent:
    global _brain
    if _brain is None:
        _brain = BrainAgent()
    return _brain


def _get_memory() -> StudentMemoryService:
    global _memory
    if _memory is None:
        _memory = StudentMemoryService()
    return _memory


class TextIngestRequest(BaseModel):
    session_id: str
    text: str
    source_label: str = "Pasted Text"
    chunk_type: ChunkType = "content"


class FinalizeRequest(BaseModel):
    session_id: str
    topic: str
    familiarity: FamiliarityLevel


@router.post("/file")
async def ingest_file_endpoint(
    session_id: Annotated[str, Form()],
    chunk_type: Annotated[ChunkType, Form()] = "content",
    file: UploadFile = File(...),
):
    content = await file.read()
    filename = file.filename or "upload"
    db = get_db()
    loop = asyncio.get_event_loop()
    count = await loop.run_in_executor(
        None, ingest_file, content, filename, session_id, chunk_type, db
    )
    return {"chunks_indexed": count, "filename": file.filename}


@router.post("/text")
def ingest_text_endpoint(body: TextIngestRequest):
    count = ingest_text(
        body.text, body.source_label, body.session_id,
        chunk_type=body.chunk_type, db=get_db()
    )
    return {"chunks_indexed": count}


@router.post("/finalize")
async def finalize_ingest(body: FinalizeRequest):
    """Called after all files are uploaded. Queries Cognee, then extracts curriculum."""
    from app.routers.session import set_ingest_status

    set_ingest_status(body.session_id, "extracting")
    try:
        prior = await _get_memory().query_prior_knowledge(body.topic)
        db = get_db()
        loop = asyncio.get_event_loop()
        query_emb = await loop.run_in_executor(None, db.embedder.embed, ["main topics overview"])
        chunks = db.query(body.session_id, query_emb[0], n_results=20)
        if not chunks:
            raise HTTPException(400, "No content indexed. Upload at least one content file.")

        nodes = _get_brain().extract_curriculum(chunks, body.familiarity.value, memory_context=prior)
        get_graph_manager().set_graph(body.session_id, nodes)
        set_ingest_status(body.session_id, "ready")
        return {
            "status": "ready",
            "nodes": [n.model_dump() for n in nodes],
        }
    except HTTPException:
        raise
    except Exception as exc:
        set_ingest_status(body.session_id, "error")
        logger.exception("finalize failed for session %s", body.session_id)
        raise HTTPException(500, str(exc)) from exc
