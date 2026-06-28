from typing import List
from sentence_transformers import SentenceTransformer

_MODEL_NAME = "nomic-ai/nomic-embed-text-v1"


class Embedder:
    """Thin wrapper around a SentenceTransformer model.

    Keeping this isolated means we can swap the embedding model without
    touching ChromaDB or ingestion code.
    """

    def __init__(self, model_name: str = _MODEL_NAME) -> None:
        self._model = SentenceTransformer(model_name, trust_remote_code=True)

    def embed(self, texts: List[str]) -> List[List[float]]:
        return self._model.encode(texts, convert_to_numpy=True).tolist()
