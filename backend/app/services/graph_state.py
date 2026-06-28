"""GraphStateManager — single source of truth for node state per session.

The monotone non-decreasing score invariant is enforced HERE on the backend.
The frontend enforces the same rule in graphStore.ts. Both must stay in sync.
"""
from typing import Dict

from app.schemas.graph import NodeData, NodePatch, NodeScores


class GraphStateManager:
    def __init__(self) -> None:
        # { session_id: { node_id: NodeData } }
        self._graphs: Dict[str, Dict[str, NodeData]] = {}

    def add_node(self, session_id: str, node: NodeData) -> None:
        self._graphs.setdefault(session_id, {})[node.id] = node

    def set_graph(self, session_id: str, nodes: list[NodeData]) -> None:
        self._graphs[session_id] = {n.id: n for n in nodes}

    def get_node(self, session_id: str, node_id: str) -> NodeData:
        return self._graphs[session_id][node_id]

    def list_nodes(self, session_id: str) -> list[NodeData]:
        return list(self._graphs.get(session_id, {}).values())

    def apply_node_patch(self, session_id: str, patch: NodePatch) -> NodeData:
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

        return node

    def clear_session(self, session_id: str) -> None:
        self._graphs.pop(session_id, None)
