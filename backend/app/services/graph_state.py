"""GraphStateManager — single source of truth for node state per session.

The monotone non-decreasing score invariant is enforced HERE on the backend.
The frontend enforces the same rule in graphStore.ts. Both must stay in sync.
"""
import json
import os
from typing import Dict

from app.schemas.graph import NodeData, NodePatch, NodeScores

_GRAPH_DIR = os.path.expanduser("~/.studybuddy/graphs")

class GraphStateManager:
    def __init__(self) -> None:
        os.makedirs(_GRAPH_DIR, exist_ok=True)
        # { session_id: { node_id: NodeData } }
        self._graphs: Dict[str, Dict[str, NodeData]] = {}

    def _path(self, session_id: str) -> str:
        return os.path.join(_GRAPH_DIR, f"{session_id}.json")

    def _save(self, session_id: str) -> None:
        if session_id in self._graphs:
            with open(self._path(session_id), "w", encoding="utf-8") as f:
                json.dump([n.model_dump() for n in self._graphs[session_id].values()], f)

    def _load(self, session_id: str) -> bool:
        if session_id in self._graphs:
            return True
        p = self._path(session_id)
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                nodes = [NodeData(**n) for n in json.load(f)]
            self._graphs[session_id] = {n.id: n for n in nodes}
            return True
        return False

    def add_node(self, session_id: str, node: NodeData) -> None:
        self._load(session_id)
        self._graphs.setdefault(session_id, {})[node.id] = node
        self._save(session_id)

    def set_graph(self, session_id: str, nodes: list[NodeData]) -> None:
        self._graphs[session_id] = {n.id: n for n in nodes}
        self._save(session_id)

    def get_node(self, session_id: str, node_id: str) -> NodeData:
        self._load(session_id)
        return self._graphs[session_id][node_id]

    def list_nodes(self, session_id: str) -> list[NodeData]:
        self._load(session_id)
        return list(self._graphs.get(session_id, {}).values())

    def apply_node_patch(self, session_id: str, patch: NodePatch) -> NodeData:
        self._load(session_id)
        node = self._graphs.setdefault(session_id, {}).get(patch.node_id)
        if node is None:
            node = NodeData(id=patch.node_id, label=patch.node_id)
            self._graphs[session_id][patch.node_id] = node

        if patch.status is not None:
            node.status = patch.status
        if patch.updated_description is not None:
            node.description = patch.updated_description
        if patch.new_children:
            node.children_ids.extend(
                c for c in patch.new_children if c not in node.children_ids
            )
        if patch.score_patch:
            current = node.scores.model_dump()
            # Monotone clamp: scores can only increase
            clamped = {k: max(current.get(k, 0), v) for k, v in patch.score_patch.items()}
            node.scores = NodeScores(**{**current, **clamped})

        self._save(session_id)
        return node

    def clear_session(self, session_id: str) -> None:
        self._graphs.pop(session_id, None)
        p = self._path(session_id)
        if os.path.exists(p):
            os.remove(p)

    # ------------------------------------------------------------------ #
    # Document-keyed cache — reuse a built graph across sessions per PDF  #
    # ------------------------------------------------------------------ #

    def _doc_path(self, document_id: str) -> str:
        return os.path.join(_GRAPH_DIR, f"doc_{document_id}.json")

    def save_doc_graph(self, document_id: str, nodes: list[NodeData], edges: list) -> None:
        if not document_id:
            return
        with open(self._doc_path(document_id), "w", encoding="utf-8") as f:
            json.dump({"nodes": [n.model_dump() for n in nodes], "edges": edges}, f)

    def load_doc_graph(self, document_id: str):
        """Return (nodes, edges) for a previously built document, or None."""
        if not document_id:
            return None
        p = self._doc_path(document_id)
        if not os.path.exists(p):
            return None
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            nodes = [NodeData(**n) for n in data.get("nodes", [])]
            return nodes, data.get("edges", [])
        except Exception:
            return None
