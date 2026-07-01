"""Library router -> per-session content management.

Each session gets its own isolated upload folder (see app.services.session_files) ->
a session's document set is exactly what's in its own folder, never a shared,
rescanned "current uploads" directory. Drag-and-drop files in, get an instant
curriculum tree, chunk the full text in the background.
"""
import asyncio
import hashlib
import json
import os
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
from app.rag.ingestion import LIBRARY_COLLECTION, ingest_file
from app.routers.session import set_ingest_status
from app.schemas.graph import NodeData
from app.services.session_files import list_session_files, session_upload_dir
from app.websockets.handlers import get_db, get_graph_manager

router = APIRouter(prefix="/library", tags=["library"])

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


class HighlightConceptsRequest(BaseModel):
    page_text: str
    familiarity: str = "high_school"


# ------------------------------------------------------------------ #
# Helpers                                                             #
# ------------------------------------------------------------------ #


def _combined_document_id(file_contents: List[bytes]) -> str:
    """Order-independent identity for a session's whole set of uploaded files.

    Sorting the per-file hashes before joining means the same SET of files
    always produces the same id regardless of upload order or directory
    listing order -> callers (upload, resume, status) can compute this
    independently and still land on the same cache key.
    """
    per_file = sorted(hashlib.sha256(c).hexdigest() for c in file_contents)
    return hashlib.sha256("".join(per_file).encode()).hexdigest()


# ------------------------------------------------------------------ #
# Endpoints                                                           #
# ------------------------------------------------------------------ #


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

    # Each session gets its OWN upload folder (session_id is always a fresh UUID from
    # /session/create) -> no shared directory, so there's nothing to clear and nothing
    # another session's leftover files could contaminate this one with.
    upload_dir = session_upload_dir(session_id)
    for content, filename in file_store:
        dest = os.path.join(upload_dir, filename)
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

    # Stable document id = order-independent hash of the WHOLE uploaded file set
    # (same set of files, any order = same id).
    document_id = _combined_document_id([c for c, _ in file_store]) if file_store else ""
    return {
        "status": "ready",
        "nodes": [],   # streamed via BUILD_GRAPH over the WebSocket
        "edges": [],
        "filenames": [name for _, name in file_store],
        "document_id": document_id,
    }


# ------------------------------------------------------------------ #
# History -> past learning materials, resumable from the start window #
# ------------------------------------------------------------------ #


@router.get("/history")
def list_history():
    """One entry per document set the student has committed progress on, most recent first.

    A document set only shows up here if at least one of its source files is
    still cached under ~/.studybuddy/pdfs/{file_id}.* -> otherwise there'd be
    nothing to resume. document_id is a combined, order-independent hash of
    the whole file set (see _combined_document_id), so it never corresponds
    to a single cached PDF filename directly -> file_ids (the per-file
    hashes) is what's checked against the PDF cache.
    """
    if not os.path.isdir(_SESSIONS_DIR):
        return {"items": []}

    items = []
    for name in os.listdir(_SESSIONS_DIR):
        if not (name.startswith("doc_") and name.endswith(".json")):
            continue
        document_id = name[len("doc_"):-len(".json")]
        path = os.path.join(_SESSIONS_DIR, name)
        try:
            with open(path, encoding="utf-8") as f:
                saved = json.load(f)
        except Exception:
            continue
        file_ids = saved.get("file_ids", [])
        if not any(os.path.exists(os.path.join(_PDF_CACHE_DIR, f"{fid}.pdf")) for fid in file_ids):
            continue
        items.append({
            "document_id": document_id,
            "title": saved.get("title") or saved.get("topic") or "Untitled",
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
async def resume_history(req: ResumeHistoryRequest):
    """Restore a past session's document set into its own folder and hand back its
    already-known curriculum tree -> no LLM regeneration, no re-chunking, no
    re-indexing. Chunks already exist in ChromaDB tagged with the original
    session_id (reused here), so they're immediately queryable again.
    """
    doc_json_path = os.path.join(_SESSIONS_DIR, f"doc_{req.document_id}.json")
    if not os.path.exists(doc_json_path):
        raise HTTPException(404, "That session's material is no longer available.")

    with open(doc_json_path, encoding="utf-8") as f:
        saved = json.load(f)

    content_files = saved.get("content_files") or []
    file_ids = saved.get("file_ids") or []
    session_id = saved.get("session_id") or str(uuid.uuid4())

    # Restore every file in this document set from its own per-file PDF cache into the
    # session's own folder -> content_files/file_ids are parallel lists built together
    # at commit time.
    upload_dir = session_upload_dir(session_id)
    restored_any = False
    for filename, file_id in zip(content_files, file_ids):
        src = os.path.join(_PDF_CACHE_DIR, f"{file_id}.pdf")
        if not os.path.exists(src):
            continue
        with open(src, "rb") as f:
            content = f.read()
        with open(os.path.join(upload_dir, filename), "wb") as fh:
            fh.write(content)
        restored_any = True
    if not restored_any:
        raise HTTPException(404, "That session's material is no longer available.")

    # No re-chunking, no re-indexing: this session_id's chunks already exist in
    # ChromaDB from the original session and are never deleted except by an explicit
    # /session/clear or a fresh upload reusing the same session_id.
    set_ingest_status(session_id, "ready")

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
        "filenames": content_files,
        "document_id": req.document_id,
    }


@router.get("/file/{session_id}/{filename}")
def serve_library_file(session_id: str, filename: str):
    """Serve a file from this session's own upload folder (for browser-mode PDF viewer)."""
    path = os.path.join(session_upload_dir(session_id), filename)
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
    # Persist the refined graph under whatever document set is CURRENTLY uploaded,
    # not the client-supplied document_id -> which can be stale if a file was
    # added/removed since the tree was first built, and would otherwise silently
    # orphan the refined tree under the wrong cache key.
    current_files = list_session_files(req.session_id)
    current_id = req.document_id
    if current_files:
        try:
            contents = []
            for p in current_files:
                with open(p, "rb") as f:
                    contents.append(f.read())
            current_id = _combined_document_id(contents)
        except Exception:
            pass
    get_graph_manager().save_doc_graph(current_id, nodes, edges)
    return {
        "status": "ready",
        "nodes": [n.model_dump() for n in nodes],
        "edges": edges,
    }
