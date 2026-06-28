from typing import Any, Dict, List, Optional
import chromadb

from app.rag.embeddings import Embedder


class ChromaDBClient:
    """Session-scoped in-memory ChromaDB wrapper.

    Each session gets its own collection named by session_id.
    Deleting a collection purges all session content — no cross-session leakage.
    """

    def __init__(self, embedder: Optional[Embedder] = None) -> None:
        self._client = chromadb.EphemeralClient()
        self.embedder = embedder or Embedder()

    # ------------------------------------------------------------------ #
    # Internal                                                             #
    # ------------------------------------------------------------------ #

    def _get_or_create(self, name: str):
        return self._client.get_or_create_collection(name)

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
        kwargs: Dict[str, Any] = {
            "query_embeddings": [query_embedding],
            "n_results": n_results,
        }
        if where:
            kwargs["where"] = where
        results = col.query(**kwargs)
        out = []
        for doc, meta in zip(results["documents"][0], results["metadatas"][0]):
            out.append({"text": doc, **meta})
        return out

    def delete_collection(self, name: str) -> None:
        try:
            self._client.delete_collection(name)
        except Exception:
            pass
