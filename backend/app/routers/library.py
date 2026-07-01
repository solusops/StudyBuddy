"""Library router -> single-document content management.

A session is exactly one uploaded document (set): drag-and-drop files in,
get an instant curriculum tree, chunk the full text in the background.
There is no folder-configuration concept -> the uploads directory under
~/.studybuddy/uploads IS the content store.
"""
import asyncio
import hashlib
import json
import os
import shutil
import uuid

# Cap concurrent highlight-concepts LLM calls to avoid token-burst 429s
_deployment_env = os.getenv("DEPLOYMENT_ENV", "desktop")
_highlight_concurrency = 2 if _deployment_env == "demo" else 20
_highlight_sem = asyncio.Semaphore(_highlight_concurrency)
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
from app.routers.session import set_ingest_status
from app.schemas.graph import NodeData
from app.websockets.handlers import get_db, get_graph_manager

router = APIRouter(prefix="/library", tags=["library"])

_SUPPORTED_EXTS = {".pdf", ".docx", ".txt"}
_UPLOADS_DIR = os.path.expanduser("~/.studybuddy/uploads")
_SESSIONS_DIR = os.path.expanduser("~/.studybuddy/sessions")
_PDF_CACHE_DIR = os.path.expanduser("~/.studybuddy/pdfs")

_brain: BrainAgent | None = None


def _get_brain() -> BrainAgent:
    global _brain
    if _brain is None:
        _brain = BrainAgent()
    return _brain


# ------------------------------------------------------------------ #
# Models                                                              #
# ------------------------------------------------------------------ #


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


# ------------------------------------------------------------------ #
# Endpoints                                                           #
# ------------------------------------------------------------------ #


@router.get("/status")
def status():
    """Check what's currently uploaded and how many chunks are indexed."""
    db = get_db()
    files = _list_files(_UPLOADS_DIR)

    document_id = None
    if files:
        try:
            with open(files[0], "rb") as f:
                document_id = hashlib.sha256(f.read()).hexdigest()
        except Exception:
            pass

    return {
        "configured": bool(files),
        "content_folder": _UPLOADS_DIR if files else None,
        "content_files": [os.path.basename(p) for p in files],
        "indexed_chunks": db.collection_count(LIBRARY_COLLECTION),
        "document_id": document_id,
    }


@router.post("/start-session")
async def start_session(req: StartSessionRequest, background_tasks: BackgroundTasks):
    """Instant tree generation from document structure -> no RAG needed.

    Reads headings/TOC from each uploaded file and sends to Gemma 4.
    Returns in ~2s, before chunking is complete.
    """
    files = _list_files(_UPLOADS_DIR)
    if not files:
        raise HTTPException(400, "No document uploaded yet.")

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

    # Extract structure from each file (headings / first pages -> fast, no embedding)
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

    # Background: chunk full documents into LIBRARY_COLLECTION for RAG.
    db = get_db()
    db.delete_where(LIBRARY_COLLECTION, {"session_id": req.session_id})
    set_ingest_status(req.session_id, "chunking")

    def _chunk_all():
        try:
            total = 0
            for path in files:
                with open(path, "rb") as f:
                    content = f.read()
                filename = os.path.basename(path)
                total += ingest_file(
                    content, filename, LIBRARY_COLLECTION, db=db,
                    skip_if_indexed=False, session_id=req.session_id,
                )
            set_ingest_status(req.session_id, "ready" if total > 0 else "error")
        except Exception:
            import logging
            logging.getLogger(__name__).exception("start_session chunking failed for session %s", req.session_id)
            set_ingest_status(req.session_id, "error")

    background_tasks.add_task(_chunk_all)

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
    try:
        async with _highlight_sem:
            concepts = await loop.run_in_executor(
                None,
                _get_brain().identify_concepts,
                req.page_text,
                req.familiarity,
            )
    except Exception:
        concepts = []
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
    - Reads document structure (headings/first pages) immediately -> no embedding needed
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

    # The curriculum tree is NOT generated here -> the client opens the WebSocket and
    # fires BUILD_GRAPH, which streams nodes in parallel ("fireworks"). This returns fast.

    # Persist uploaded files to disk so /library/file/{name} can serve them later
    os.makedirs(_UPLOADS_DIR, exist_ok=True)
    for content, filename in file_store:
        dest = os.path.join(_UPLOADS_DIR, filename)
        with open(dest, "wb") as fh:
            fh.write(content)

    # Cache EVERY uploaded file for layout/regions segmentation under its document_id hash
    # (multi-paper: each paper must be resolvable, not just the first).
    if file_store:
        pdf_dir = os.path.expanduser("~/.studybuddy/pdfs")
        os.makedirs(pdf_dir, exist_ok=True)
        for content, _fn in file_store:
            dest = os.path.join(pdf_dir, f"{hashlib.sha256(content).hexdigest()}.pdf")
            if not os.path.exists(dest):
                with open(dest, "wb") as fh:
                    fh.write(content)

    # Background: chunk full documents into LIBRARY_COLLECTION for RAG.
    # Clear this session's prior chunks first so new content fully replaces old
    # (single-PDF-per-session: no bleed from a previously studied document).
    db = get_db()
    db.delete_where(LIBRARY_COLLECTION, {"session_id": session_id})

    set_ingest_status(session_id, "chunking")

    def _chunk_all():
        try:
            total = 0
            for content, filename in file_store:
                total += ingest_file(
                    content, filename, LIBRARY_COLLECTION, db=db,
                    skip_if_indexed=False, session_id=session_id,
                )
            set_ingest_status(session_id, "ready" if total > 0 else "error")
        except Exception:
            import logging
            logging.getLogger(__name__).exception(
                "Background chunking failed for session %s", session_id
            )
            set_ingest_status(session_id, "error")

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


@router.post("/clear")
def clear_library():
    """Wipe the uploaded document so /library/status reports unconfigured."""
    if os.path.isdir(_UPLOADS_DIR):
        shutil.rmtree(_UPLOADS_DIR, ignore_errors=True)
    return {"status": "cleared"}


# ------------------------------------------------------------------ #
# History -> past learning materials, resumable from the start window #
# ------------------------------------------------------------------ #


@router.get("/history")
def list_history():
    """One entry per document the student has committed progress on, most recent first.

    A document only shows up here if its source PDF/DOCX/TXT bytes are still cached
    (~/.studybuddy/pdfs/{document_id}.*) -> otherwise there'd be nothing to resume.
    """
    if not os.path.isdir(_SESSIONS_DIR):
        return {"items": []}

    items = []
    for name in os.listdir(_SESSIONS_DIR):
        if not (name.startswith("doc_") and name.endswith(".json")):
            continue
        document_id = name[len("doc_"):-len(".json")]
        if not os.path.exists(os.path.join(_PDF_CACHE_DIR, f"{document_id}.pdf")):
            continue
        path = os.path.join(_SESSIONS_DIR, name)
        try:
            with open(path, encoding="utf-8") as f:
                saved = json.load(f)
        except Exception:
            continue
        items.append({
            "document_id": document_id,
            "topic": saved.get("topic") or "Untitled",
            "familiarity": saved.get("familiarity", "high_school"),
            "content_files": saved.get("content_files", []),
            "node_count": len(saved.get("nodes", [])),
            "updated_at": os.path.getmtime(path),
        })
    items.sort(key=lambda x: x["updated_at"], reverse=True)
    return {"items": items}


class ResumeHistoryRequest(BaseModel):
    document_id: str


@router.post("/history/resume")
async def resume_history(req: ResumeHistoryRequest, background_tasks: BackgroundTasks):
    """Restore a past document as the active upload, re-chunk it under a fresh session,
    and hand back its already-known curriculum tree -> no LLM tree regeneration needed.
    """
    doc_json_path = os.path.join(_SESSIONS_DIR, f"doc_{req.document_id}.json")
    pdf_path = os.path.join(_PDF_CACHE_DIR, f"{req.document_id}.pdf")
    if not os.path.exists(doc_json_path) or not os.path.exists(pdf_path):
        raise HTTPException(404, "That session's material is no longer available.")

    with open(doc_json_path, encoding="utf-8") as f:
        saved = json.load(f)
    with open(pdf_path, "rb") as f:
        content = f.read()
    filename = (saved.get("content_files") or [f"{req.document_id}.pdf"])[0]

    # Single-document-per-session model: resuming replaces whatever is currently active.
    if os.path.isdir(_UPLOADS_DIR):
        shutil.rmtree(_UPLOADS_DIR, ignore_errors=True)
    os.makedirs(_UPLOADS_DIR, exist_ok=True)
    with open(os.path.join(_UPLOADS_DIR, filename), "wb") as fh:
        fh.write(content)

    session_id = saved.get("session_id") or str(uuid.uuid4())
    set_ingest_status(session_id, "chunking")
    db = get_db()

    def _chunk_all():
        try:
            ingest_file(
                content, filename, LIBRARY_COLLECTION, db=db,
                skip_if_indexed=False, session_id=session_id,
            )
            set_ingest_status(session_id, "ready")
        except Exception:
            import logging
            logging.getLogger(__name__).exception(
                "Resume chunking failed for session %s", session_id
            )
            set_ingest_status(session_id, "error")

    background_tasks.add_task(_chunk_all)

    # Prefer the graph cache (has real edges); fall back to synthesizing edges from
    # parent_id on the committed nodes if that cache is somehow missing.
    graph_cache = get_graph_manager().load_doc_graph(req.document_id)
    if graph_cache:
        nodes, edges = graph_cache
    else:
        nodes = [NodeData(**n) for n in saved.get("nodes", [])]
        edges = [
            {"source": n.parent_id, "target": n.id, "relationship": "prerequisite"}
            for n in nodes if n.parent_id
        ]
    get_graph_manager().set_graph(session_id, nodes)

    return {
        "status": "ready",
        "session_id": session_id,
        "topic": saved.get("topic") or "Study Session",
        "familiarity": saved.get("familiarity", "high_school"),
        "nodes": [n.model_dump() for n in nodes],
        "edges": edges,
        "filenames": [filename],
        "document_id": req.document_id,
    }


@router.get("/file/{filename}")
def serve_library_file(filename: str):
    """Serve a file from the uploads directory (for browser-mode PDF viewer)."""
    path = os.path.join(_UPLOADS_DIR, filename)
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
    document_id: str = ""
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
            "Content is still being indexed -> wait a moment, then try again.",
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
        # Context-aware refinement -> send existing tree structure to LLM
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
    # Persist the refined graph for this PDF so reloads reuse the refinement.
    get_graph_manager().save_doc_graph(req.document_id, nodes, edges)
    return {
        "status": "ready",
        "nodes": [n.model_dump() for n in nodes],
        "edges": edges,
    }
