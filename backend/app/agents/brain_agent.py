"""Brain Agent — derives the curriculum tree from student-uploaded chunks.

IMPORTANT: extract_curriculum reads RAG content to find topics.
It NEVER invents topics from model weights.
"""
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field

from app.agents.cerebras_client import CerebrasClient
from app.schemas.graph import NodeData

FAMILIARITY_NOTES: Dict[str, str] = {
    "eli5": "Use purely sensory analogies, zero math, max 2-syllable words where possible.",
    "high_school": "Introduce standard terminology but immediately define it. Use real-world examples.",
    "graduate": "Assume baseline domain competence. Focus on edge cases and methodology.",
    "expert": "Pure synthesis. Focus on literature gaps, proofs, and algorithmic details. Zero analogies.",
}


class _SyllabusNode(BaseModel):
    id: str
    label: str
    description: str
    depth: int = Field(1, ge=1, le=3)
    parent_id: Optional[str] = None


class _SyllabusEdge(BaseModel):
    source: str = Field(description="Source node id")
    target: str = Field(description="Target node id")
    relationship: str = Field(description="prerequisite | related | builds-on")


class _SyllabusBlueprint(BaseModel):
    nodes: List[_SyllabusNode] = Field(
        ..., description="Ordered list of 6-25 concept nodes, macro to micro"
    )
    edges: List[_SyllabusEdge] = Field(
        default_factory=list,
        description="Explicit connections between nodes capturing how concepts relate",
    )


class BrainAgent:
    def __init__(self, client: Optional[CerebrasClient] = None) -> None:
        self._client = client or CerebrasClient()

    def extract_curriculum(
        self,
        chunks: List[Dict[str, Any]],
        familiarity: str,
        memory_context: str = "",
    ) -> Tuple[List[NodeData], List[Dict]]:
        """Derive topic graph from the student's uploaded content chunks.

        Returns (nodes, edges) — edges capture prerequisite and related-topic
        relationships between nodes. All nodes start as ACTIVE (no locking).
        """
        sample = "\n\n".join(
            f"[{c.get('source', '?')}]: {c['text'][:300]}" for c in chunks[:20]
        )
        familiarity_note = FAMILIARITY_NOTES.get(familiarity, "")
        memory_note = (
            f"\n\nPrior student knowledge from past sessions:\n{memory_context}"
            if memory_context
            else ""
        )
        messages = [
            {
                "role": "system",
                "content": (
                    f"You are a curriculum organiser. {familiarity_note}{memory_note}\n"
                    "Read the provided content excerpts and identify the main topics they cover. "
                    "DO NOT invent topics not evidenced in the text. "
                    "Return 6-25 nodes AND a list of edges capturing how the concepts relate to each other. "
                    "Edges should reflect real conceptual dependencies and relationships, not just a tree — "
                    "a concept can have multiple prerequisites and be related to several others."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Content excerpts:\n{sample}\n\n"
                    "Extract concept nodes and their interconnections from this material only.\n"
                    "Nodes: id (n1, n2...), label, brief description from the text, depth (1=macro 2=mid 3=micro), optional parent_id.\n"
                    "Edges: source node id, target node id, relationship (prerequisite | related | builds-on).\n"
                    "Include cross-links between non-adjacent concepts where a real relationship exists."
                ),
            },
        ]
        blueprint = self._client.structured_complete(messages, _SyllabusBlueprint)
        node_ids = {sn.id for sn in blueprint.nodes}
        nodes = [
            NodeData(
                id=sn.id,
                label=sn.label,
                description=sn.description,
                depth=sn.depth,
                parent_id=sn.parent_id,
                status="ACTIVE",
            )
            for sn in blueprint.nodes
        ]
        edges = [
            {"source": e.source, "target": e.target, "relationship": e.relationship}
            for e in blueprint.edges
            if e.source in node_ids and e.target in node_ids
        ]
        return nodes, edges

    def extract_curriculum_from_documents(
        self,
        document_overviews: List[Dict[str, str]],
        familiarity: str,
        topic_hint: str = "",
        memory_context: str = "",
    ) -> Tuple[List[NodeData], List[Dict]]:
        """Instant graph generation from document structure (headings/TOC/first pages).

        Returns (nodes, edges). All nodes start as ACTIVE — no locking.
        """
        all_structure = "\n\n---\n\n".join(
            f"Document: {d['filename']}\n{d['structure_text'][:3000]}"
            for d in document_overviews
        )
        all_structure = all_structure[:10000]  # hard cap — prevents JSON truncation at 32K MCL
        familiarity_note = FAMILIARITY_NOTES.get(familiarity, "")
        topic_note = f"The student wants to study: {topic_hint}\n\n" if topic_hint else ""
        memory_note = (
            f"Prior student knowledge:\n{memory_context}\n\n" if memory_context else ""
        )
        messages = [
            {
                "role": "system",
                "content": (
                    f"You are a curriculum organiser. {familiarity_note}\n"
                    f"{topic_note}{memory_note}"
                    "Read the provided document structure (headings, table of contents, first pages) "
                    "and derive a knowledge graph — not just a tree. "
                    "Use ONLY topics evidenced in the documents. "
                    "Return 6-25 nodes with parent_id links for hierarchy, "
                    "AND edges capturing prerequisite/related/builds-on relationships between any nodes "
                    "where a real conceptual link exists."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Document structure:\n{all_structure}\n\n"
                    "Extract concept nodes and interconnections.\n"
                    "Nodes: id (n1, n2...), label (≤6 words), description (≤80 chars), depth (1=chapter 2=section 3=topic), optional parent_id.\n"
                    "Edges: source, target, relationship (prerequisite | related | builds-on).\n"
                    "Keep descriptions short. Aim for 8-15 nodes total."
                ),
            },
        ]
        blueprint = self._client.structured_complete(messages, _SyllabusBlueprint)
        node_ids = {sn.id for sn in blueprint.nodes}
        nodes = [
            NodeData(
                id=sn.id,
                label=sn.label,
                description=sn.description,
                depth=sn.depth,
                parent_id=sn.parent_id,
                status="ACTIVE",
            )
            for sn in blueprint.nodes
        ]
        edges = [
            {"source": e.source, "target": e.target, "relationship": e.relationship}
            for e in blueprint.edges
            if e.source in node_ids and e.target in node_ids
        ]
        return nodes, edges

    def refine_curriculum(
        self,
        chunks: List[Dict[str, Any]],
        familiarity: str,
        user_feedback: str,
        current_nodes: List[Dict[str, Any]],
        current_edges: List[Dict[str, Any]],
    ) -> Tuple[List[NodeData], List[Dict]]:
        """Refine the existing curriculum tree based on student feedback.

        Instead of generating a brand-new tree, this sends the current graph
        structure to the LLM alongside user feedback so the model can make
        targeted adjustments (add, remove, rename, restructure nodes).
        """
        sample = "\n\n".join(
            f"[{c.get('source', '?')}]: {c['text'][:300]}" for c in chunks[:20]
        )
        familiarity_note = FAMILIARITY_NOTES.get(familiarity, "")

        # Format existing tree as context
        nodes_desc = "\n".join(
            f"- {n['id']}: \"{n['label']}\" (depth={n.get('depth', 1)}, parent={n.get('parent_id', 'none')}) — {n.get('description', '')}"
            for n in current_nodes
        )
        edges_desc = "\n".join(
            f"- {e['source']} → {e['target']} ({e.get('relationship', 'related')})"
            for e in current_edges
        )
        current_tree = (
            f"CURRENT NODES:\n{nodes_desc}\n\n"
            f"CURRENT EDGES:\n{edges_desc}"
        )

        messages = [
            {
                "role": "system",
                "content": (
                    f"You are a curriculum organiser. {familiarity_note}\n"
                    "You are REFINING an existing knowledge graph based on student feedback. "
                    "Do NOT regenerate from scratch. Instead:\n"
                    "- Keep nodes that are still relevant\n"
                    "- Add new nodes if the student wants more coverage\n"
                    "- Remove nodes the student says are unnecessary\n"
                    "- Rename or restructure nodes as requested\n"
                    "- Update edges to reflect the new structure\n"
                    "All changes must stay grounded in the source material — do NOT invent topics "
                    "not evidenced in the text."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"STUDENT FEEDBACK: {user_feedback}\n\n"
                    f"{current_tree}\n\n"
                    f"SOURCE MATERIAL EXCERPTS:\n{sample}\n\n"
                    "Apply the student's feedback to produce an updated set of nodes and edges. "
                    "Nodes: id (n1, n2...), label, brief description, depth (1=macro 2=mid 3=micro), optional parent_id.\n"
                    "Edges: source, target, relationship (prerequisite | related | builds-on).\n"
                    "Reuse existing node IDs where the concept is unchanged."
                ),
            },
        ]
        blueprint = self._client.structured_complete(messages, _SyllabusBlueprint)
        node_ids = {sn.id for sn in blueprint.nodes}
        nodes = [
            NodeData(
                id=sn.id,
                label=sn.label,
                description=sn.description,
                depth=sn.depth,
                parent_id=sn.parent_id,
                status="ACTIVE",
            )
            for sn in blueprint.nodes
        ]
        edges = [
            {"source": e.source, "target": e.target, "relationship": e.relationship}
            for e in blueprint.edges
            if e.source in node_ids and e.target in node_ids
        ]
        return nodes, edges

    def identify_concepts(self, page_text: str, familiarity: str) -> List[str]:
        """Given a page of text, return a list of key concept phrases to highlight."""
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a concept identifier. Extract 3-8 key concept phrases from the "
                    "provided text passage. Return only the exact phrases as they appear in the text — "
                    "no paraphrase, no addition. Short noun phrases preferred."
                ),
            },
            {
                "role": "user",
                "content": f"Text passage:\n{page_text[:3000]}\n\nList key concept phrases (exact matches from the text).",
            },
        ]

        class _ConceptList(BaseModel):
            concepts: List[str]

        result = self._client.structured_complete(messages, _ConceptList)
        return result.concepts

    def build_rag_query(self, node_label: str, familiarity: str) -> str:
        note = FAMILIARITY_NOTES.get(familiarity, "")
        return f"{node_label} {note} explanation concepts"
