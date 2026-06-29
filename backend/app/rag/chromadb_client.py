import hashlib
import os
from typing import Any, Dict, List, Optional

import chromadb

from app.rag.embeddings import Embedder

_CHROMA_PATH = os.path.expanduser("~/.studybuddy/chroma")
_FILE_INDEX_COLLECTION = "_file_index"


class ChromaDBClient:
    """Persistent ChromaDB wrapper.

    Content lives in ~/.studybuddy/chroma/ across sessions.
    Files are deduplicated by SHA-256 content hash — re-chunking only happens
    when a file's content changes.
    """

    def __init__(self, embedder: Optional[Embedder] = None) -> None:
        os.makedirs(_CHROMA_PATH, exist_ok=True)
        self._client = chromadb.PersistentClient(path=_CHROMA_PATH)
        self.embedder = embedder or Embedder()

    # ------------------------------------------------------------------ #
    # Internal                                                             #
    # ------------------------------------------------------------------ #

    def _get_or_create(self, name: str):
        return self._client.get_or_create_collection(name)

    # ------------------------------------------------------------------ #
    # File dedup                                                           #
    # ------------------------------------------------------------------ #

    @staticmethod
    def file_hash(content: bytes) -> str:
        return hashlib.sha256(content).hexdigest()[:16]

    def is_indexed(self, content_hash: str) -> bool:
        try:
            col = self._client.get_or_create_collection(_FILE_INDEX_COLLECTION)
            r = col.get(ids=[content_hash])
            return len(r["ids"]) > 0
        except Exception:
            return False

    def mark_indexed(self, content_hash: str, filename: str) -> None:
        col = self._client.get_or_create_collection(_FILE_INDEX_COLLECTION)
        col.upsert(
            ids=[content_hash],
            documents=[filename],
            metadatas=[{"filename": filename}],
        )

    # ------------------------------------------------------------------ #
    # Public API                                                           #
    # ------------------------------------------------------------------ #

    def upsert(
        self,
        collection: str,
        documents: List[str],
        metadatas: List[Dict[str, Any]],
        ids: List[str],
    ) -> None:
        col = self._get_or_create(collection)
        embeddings = self.embedder.embed(documents)
        col.upsert(documents=documents, embeddings=embeddings, metadatas=metadatas, ids=ids)

    def query(
        self,
        collection: str,
        query_embedding: List[float],
        n_results: int = 5,
        where: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        try:
            col = self._client.get_collection(collection)
        except Exception:
            return []
        # Clamp n_results to actual collection size
        try:
            actual = col.count()
            n_results = min(n_results, actual) if actual > 0 else 1
        except Exception:
            pass
        kwargs: Dict[str, Any] = {
            "query_embeddings": [query_embedding],
            "n_results": n_results,
        }
        if where:
            kwargs["where"] = where
        try:
            results = col.query(**kwargs)
        except Exception:
            return []
        out = []
        for doc, meta in zip(results["documents"][0], results["metadatas"][0]):
            out.append({"text": doc, **meta})
        return out

    def collection_count(self, collection: str) -> int:
        try:
            return self._client.get_collection(collection).count()
        except Exception:
            return 0

    def delete_collection(self, name: str) -> None:
        try:
            self._client.delete_collection(name)
        except Exception:
            pass
