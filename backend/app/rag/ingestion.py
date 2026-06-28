"""File and text ingestion into ChromaDB.

Chunk type is recorded in metadata so the Tutor Agent can preferentially
query question chunks for quiz/flashcard generation.
"""
import io
import uuid
from typing import Literal, Optional

from app.rag.chunker import chunk_text
from app.rag.chromadb_client import ChromaDBClient

ChunkType = Literal["content", "question"]


def _extract_pdf(file_bytes: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(file_bytes))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _extract_docx(file_bytes: bytes) -> str:
    import docx

    doc = docx.Document(io.BytesIO(file_bytes))
    return "\n".join(p.text for p in doc.paragraphs)


def ingest_text(
    text: str,
    source_label: str,
    session_id: str,
    chunk_type: ChunkType = "content",
    db: Optional[ChromaDBClient] = None,
) -> int:
    if db is None:
        db = ChromaDBClient()
    chunks = chunk_text(text)
    if not chunks:
        return 0
    ids = [f"{source_label}_{i}_{uuid.uuid4().hex[:6]}" for i in range(len(chunks))]
    metadatas = [
        {"source": source_label, "chunk_index": i, "type": chunk_type}
        for i in range(len(chunks))
    ]
    db.upsert(session_id, chunks, metadatas, ids)
    return len(chunks)


def ingest_file(
    file_bytes: bytes,
    filename: str,
    session_id: str,
    chunk_type: ChunkType = "content",
    db: Optional[ChromaDBClient] = None,
) -> int:
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext == "pdf":
        text = _extract_pdf(file_bytes)
    elif ext == "docx":
        text = _extract_docx(file_bytes)
    else:
        text = file_bytes.decode("utf-8", errors="replace")
    return ingest_text(text, filename, session_id, chunk_type=chunk_type, db=db)
