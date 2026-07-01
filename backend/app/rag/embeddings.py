from typing import List

from chromadb.utils.embedding_functions.onnx_mini_lm_l6_v2 import ONNXMiniLM_L6_V2

# ~40MB, loads in <1s, runs in C/ONNX -> no Python GIL pressure
_onnx_ef = ONNXMiniLM_L6_V2()


class Embedder:
    """Thin wrapper around ChromaDB's built-in ONNX embedder.

    Keeping this isolated means we can swap the embedding model without
    touching ChromaDB or ingestion code.
    """

    def embed(self, texts: List[str]) -> List[List[float]]:
        return list(_onnx_ef(texts))
