"""Library router — folder-based content management and direct file uploads.

Two content paths:
- Folder-based (Electron): configure content/questions folders, scan in background
- Upload-based (browser/Electron): drag-and-drop files, instant tree, background chunking
"""
import asyncio
import hashlib
import os
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
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
    files = _list_files(content_folder or "")
    
    document_id = None
    if files:
        try:
            import hashlib
            with open(files[0], "rb") as f:
                document_id = hashlib.sha256(f.read()).hexdigest()
        except Exception:
            pass

    return {
        "configured": is_configured(),
        "content_folder": content_folder,
        "questions_folder": questions_folder,
        "content_files": [os.path.basename(p) for p in files],
        "questions_files": [os.path.basename(p) for p in _list_files(questions_folder or "")],
        "indexed_chunks": db.collection_count(LIBRARY_COLLECTION),
        "document_id": document_id,
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

    # Cache the first file for layout/regions segmentation under its document_id hash
    document_id = ""
    if files:
        try:
            with open(files[0], "rb") as f:
                first_content = f.read()
            document_id = hashlib.sha256(first_content).hexdigest()
            pdf_dir = os.path.expanduser("~/.studybuddy/pdfs")
            os.makedirs(pdf_dir, exist_ok=True)
            pdf_cache_dest = os.path.join(pdf_dir, f"{document_id}.pdf")
            if not os.path.exists(pdf_cache_dest):
                with open(pdf_cache_dest, "wb") as fh:
                    fh.write(first_content)
        except Exception:
            pass

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

    # Generate graph instantly from document structure
    nodes, edges = await loop.run_in_executor(
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
        "edges": edges,
        "document_id": document_id,
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


@router.post("/upload-and-start")
async def upload_and_start(
    background_tasks: BackgroundTasks,
    session_id: str = Form(...),
    familiarity: str = Form("high_school"),
    topic_hint: str = Form(""),
    files: List[UploadFile] = File(...),
):
    """Accept direct file uploads (drag-and-drop), generate tree instantly, chunk in background.

    Works in both browser (no Electron needed) and Electron.
    - Reads document structure (headings/first pages) immediately — no embedding needed
    - Generates curriculum tree in ~2s
    - Chunks full documents into LIBRARY_COLLECTION in background
    """
    if not files:
        raise HTTPException(400, "No files uploaded")

    file_store: List[tuple] = []  # (bytes, filename) for background chunking
    for f in files[:5]:  # cap at 5 to keep prompt manageable
        content = await f.read()
        filename = f.filename or "upload"
        file_store.append((content, filename))

    # The curriculum tree is NOT generated here — the client opens the WebSocket and
    # fires BUILD_GRAPH, which streams nodes in parallel ("fireworks"). This returns fast.

    # Persist uploaded files to disk so /library/file/{name} can serve them later
    uploads_dir = os.path.expanduser("~/.studybuddy/uploads")
    os.makedirs(uploads_dir, exist_ok=True)
    for content, filename in file_store:
        dest = os.path.join(uploads_dir, filename)
        with open(dest, "wb") as fh:
            fh.write(content)

    # Cache the first file for layout/regions segmentation under its document_id hash
    if file_store:
        pdf_dir = os.path.expanduser("~/.studybuddy/pdfs")
        os.makedirs(pdf_dir, exist_ok=True)
        pdf_cache_dest = os.path.join(pdf_dir, f"{hashlib.sha256(file_store[0][0]).hexdigest()}.pdf")
        with open(pdf_cache_dest, "wb") as fh:
            fh.write(file_store[0][0])
    # Register uploads dir as the content folder so /library/status sees the files
    save_settings({"content_folder": uploads_dir})

    # Background: chunk full documents into LIBRARY_COLLECTION for RAG.
    # Clear this session's prior chunks first so new content fully replaces old
    # (single-PDF-per-session: no bleed from a previously studied document).
    db = get_db()
    db.delete_where(LIBRARY_COLLECTION, {"session_id": session_id})

    def _chunk_all():
        for content, filename in file_store:
            ingest_file(
                content, filename, LIBRARY_COLLECTION, db=db,
                skip_if_indexed=False, session_id=session_id,
            )

    background_tasks.add_task(_chunk_all)

    # Stable document id = SHA-256 of first uploaded file (same file = same id)
    document_id = hashlib.sha256(file_store[0][0]).hexdigest() if file_store else ""
    return {
        "status": "ready",
        "nodes": [],   # streamed via BUILD_GRAPH over the WebSocket
        "edges": [],
        "filenames": [name for _, name in file_store],
        "document_id": document_id,
    }


@router.get("/file/{filename}")
def serve_library_file(filename: str):
    """Serve a file from the uploads directory (for browser-mode PDF viewer)."""
    uploads_dir = os.path.expanduser("~/.studybuddy/uploads")
    path = os.path.join(uploads_dir, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, f"File not found: {filename}")
    ext = os.path.splitext(filename)[1].lower()
    media_types = {".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".txt": "text/plain"}
    return FileResponse(path, media_type=media_types.get(ext, "application/octet-stream"))


class _RefineNodeInfo(BaseModel):
    id: str
    label: str
    description: str = ""
    depth: int = 1
    parent_id: Optional[str] = None


class _RefineEdgeInfo(BaseModel):
    source: str
    target: str
    relationship: str = "prerequisite"


class RefineTreeRequest(BaseModel):
    session_id: str
    user_feedback: str
    familiarity: str = "high_school"
    current_nodes: Optional[List[_RefineNodeInfo]] = None
    current_edges: Optional[List[_RefineEdgeInfo]] = None


@router.post("/refine-tree")
async def refine_tree(req: RefineTreeRequest):
    """Refine the curriculum tree based on student feedback.

    When current_nodes/current_edges are provided, sends the existing graph
    to the LLM for context-aware refinement. Falls back to full regeneration
    if the current graph is not supplied.
    """
    db = get_db()
    chunk_count = db.collection_count(LIBRARY_COLLECTION)
    if chunk_count == 0:
        raise HTTPException(
            400,
            "Content is still being indexed — wait a moment, then try again.",
        )

    loop = asyncio.get_event_loop()
    query_emb = await loop.run_in_executor(
        None, db.embedder.embed, ["main topics overview summary table of contents"]
    )
    chunks = db.query(
        LIBRARY_COLLECTION, query_emb[0], n_results=20,
        where={"session_id": req.session_id},
    )

    brain = _get_brain()

    if req.current_nodes and len(req.current_nodes) > 0:
        # Context-aware refinement — send existing tree structure to LLM
        nodes, edges = await loop.run_in_executor(
            None,
            brain.refine_curriculum,
            chunks,
            req.familiarity,
            req.user_feedback,
            [n.model_dump() for n in req.current_nodes],
            [e.model_dump() for e in req.current_edges or []],
        )
    else:
        # Fallback: no existing graph context, regenerate from scratch
        guidance_note = f"Student feedback on the previous tree: {req.user_feedback}"
        nodes, edges = await loop.run_in_executor(
            None,
            brain.extract_curriculum,
            chunks,
            req.familiarity,
            guidance_note,
        )

    get_graph_manager().set_graph(req.session_id, nodes)
    return {
        "status": "ready",
        "nodes": [n.model_dump() for n in nodes],
        "edges": edges,
    }
