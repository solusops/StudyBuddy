import hashlib
from typing import Any, Dict, List, Optional

import chromadb

from app.rag.embeddings import Embedder

_FILE_INDEX_COLLECTION = "file-index"


class ChromaDBClient:
    """In-memory ChromaDB wrapper for the web demo deployment.

    State is persistent across process restarts. Files are deduplicated by
    SHA-256 content hash.
    """

    def __init__(self, embedder: Optional[Embedder] = None) -> None:
        import os
        db_path = os.path.expanduser("~/.studybuddy/chroma")
        os.makedirs(db_path, exist_ok=True)
        self._client = chromadb.PersistentClient(path=db_path)
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
        return hashlib.sha256(content).hexdigest()

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

    def delete_where(self, collection: str, where: Dict[str, Any]) -> None:
        """Delete all documents in a collection matching a metadata filter."""
        try:
            col = self._client.get_collection(collection)
            col.delete(where=where)
        except Exception:
            pass

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
