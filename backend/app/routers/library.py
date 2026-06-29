"""Library router — folder-based content management.

The student configures their content and questions folders once. The app
scans those folders, chunks new files in the background, and generates
the curriculum tree instantly from document structure (no RAG needed).
"""
import asyncio
import os
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from app.agents.brain_agent import BrainAgent
from app.rag.ingestion import (
    LIBRARY_COLLECTION,
    extract_document_structure,
    ingest_file,
)
from app.rag.chromadb_client import ChromaDBClient
from app.services.settings_service import (
    get_content_folder,
    get_questions_folder,
    is_configured,
    save_settings,
)
from app.websockets.handlers import get_db, get_graph_manager

router = APIRouter(prefix="/library", tags=["library"])

_SUPPORTED_EXTS = {".pdf", ".docx", ".txt"}

_brain: BrainAgent | None = None


def _get_brain() -> BrainAgent:
    global _brain
    if _brain is None:
        _brain = BrainAgent()
    return _brain


# ------------------------------------------------------------------ #
# Models                                                              #
# ------------------------------------------------------------------ #


class ConfigureRequest(BaseModel):
    content_folder: str
    questions_folder: Optional[str] = None


class StartSessionRequest(BaseModel):
    session_id: str
    familiarity: str = "high_school"
    topic_hint: str = ""


class HighlightConceptsRequest(BaseModel):
    page_text: str
    familiarity: str = "high_school"


# ------------------------------------------------------------------ #
# Helpers                                                             #
# ------------------------------------------------------------------ #


def _list_files(folder: str) -> List[str]:
    if not folder or not os.path.isdir(folder):
        return []
    return [
        os.path.join(folder, f)
        for f in os.listdir(folder)
        if os.path.isfile(os.path.join(folder, f))
        and os.path.splitext(f)[1].lower() in _SUPPORTED_EXTS
    ]


def _scan_and_index(folder: str, chunk_type: str, db: ChromaDBClient) -> int:
    """Synchronous folder scan + chunk. Called in executor to avoid blocking."""
    total = 0
    for path in _list_files(folder):
        with open(path, "rb") as f:
            content = f.read()
        filename = os.path.basename(path)
        count = ingest_file(content, filename, LIBRARY_COLLECTION, chunk_type=chunk_type, db=db)  # type: ignore[arg-type]
        total += count
    return total


# ------------------------------------------------------------------ #
# Endpoints                                                           #
# ------------------------------------------------------------------ #


@router.post("/configure")
def configure(req: ConfigureRequest):
    """Save content and questions folder paths."""
    if not os.path.isdir(req.content_folder):
        raise HTTPException(400, f"Content folder not found: {req.content_folder}")
    if req.questions_folder and not os.path.isdir(req.questions_folder):
        raise HTTPException(400, f"Questions folder not found: {req.questions_folder}")
    settings = save_settings(
        {
            "content_folder": req.content_folder,
            "questions_folder": req.questions_folder or "",
        }
    )
    return {"status": "configured", **settings}


@router.get("/status")
def status():
    """Check if folders are configured and how many files are indexed."""
    content_folder = get_content_folder()
    questions_folder = get_questions_folder()
    db = get_db()
    return {
        "configured": is_configured(),
        "content_folder": content_folder,
        "questions_folder": questions_folder,
        "content_files": [os.path.basename(p) for p in _list_files(content_folder or "")],
        "questions_files": [os.path.basename(p) for p in _list_files(questions_folder or "")],
        "indexed_chunks": db.collection_count(LIBRARY_COLLECTION),
    }


@router.post("/scan")
async def scan_library(background_tasks: BackgroundTasks):
    """Trigger background chunking of all new files in the configured folders."""
    content_folder = get_content_folder()
    if not content_folder:
        raise HTTPException(400, "Library not configured. Call POST /library/configure first.")
    questions_folder = get_questions_folder()
    db = get_db()

    async def _bg():
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _scan_and_index, content_folder, "content", db)
        if questions_folder:
            await loop.run_in_executor(None, _scan_and_index, questions_folder, "question", db)

    background_tasks.add_task(lambda: asyncio.create_task(_bg()))
    return {"status": "scanning"}


@router.post("/start-session")
async def start_session(req: StartSessionRequest):
    """Instant tree generation from document structure — no RAG needed.

    Reads headings/TOC from each content file and sends to Gemma 4.
    Returns in ~2s, before chunking is complete.
    """
    content_folder = get_content_folder()
    if not content_folder:
        raise HTTPException(400, "Library not configured.")

    files = _list_files(content_folder)
    if not files:
        raise HTTPException(400, "No supported files found in content folder.")

    # Extract structure from each file (headings / first pages — fast, no embedding)
    loop = asyncio.get_event_loop()
    overviews = []
    for path in files[:5]:  # cap at 5 docs to keep the prompt manageable
        with open(path, "rb") as f:
            content = f.read()
        filename = os.path.basename(path)
        structure = await loop.run_in_executor(
            None, extract_document_structure, content, filename
        )
        overviews.append({"filename": filename, "structure_text": structure})

    # Generate tree instantly from document structure
    nodes = await loop.run_in_executor(
        None,
        _get_brain().extract_curriculum_from_documents,
        overviews,
        req.familiarity,
        req.topic_hint,
        "",
    )

    get_graph_manager().set_graph(req.session_id, nodes)
    return {
        "status": "ready",
        "nodes": [n.model_dump() for n in nodes],
    }


@router.post("/highlight-concepts")
async def highlight_concepts(req: HighlightConceptsRequest):
    """Given a page's text, return key concept phrases to highlight."""
    loop = asyncio.get_event_loop()
    concepts = await loop.run_in_executor(
        None,
        _get_brain().identify_concepts,
        req.page_text,
        req.familiarity,
    )
    return {"concepts": concepts}
