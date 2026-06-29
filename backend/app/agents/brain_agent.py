"""Brain Agent — derives the curriculum tree from student-uploaded chunks.

IMPORTANT: extract_curriculum reads RAG content to find topics.
It NEVER invents topics from model weights.
"""
from typing import Any, Dict, List, Optional

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


class _SyllabusBlueprint(BaseModel):
    nodes: List[_SyllabusNode] = Field(
        ..., description="Ordered list of 6-25 concept nodes, macro to micro"
    )


class BrainAgent:
    def __init__(self, client: Optional[CerebrasClient] = None) -> None:
        self._client = client or CerebrasClient()

    def extract_curriculum(
        self,
        chunks: List[Dict[str, Any]],
        familiarity: str,
        memory_context: str = "",
    ) -> List[NodeData]:
        """Derive topic tree from the student's uploaded content chunks.

        Samples up to 20 chunks to give the model an overview of what was
        uploaded. The model must only surface topics evidenced in the text.
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
                    "Return 6-25 nodes ordered from foundational to advanced."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Content excerpts:\n{sample}\n\n"
                    "Extract concept nodes from this material only. "
                    "Each node: id (n1, n2...), label, brief description drawn from the text, "
                    "depth (1=macro, 2=mid, 3=micro), optional parent_id."
                ),
            },
        ]
        blueprint = self._client.structured_complete(messages, _SyllabusBlueprint)
        return [
            NodeData(
                id=sn.id,
                label=sn.label,
                description=sn.description,
                depth=sn.depth,
                parent_id=sn.parent_id,
                status="ACTIVE" if i == 0 else "LOCKED",
            )
            for i, sn in enumerate(blueprint.nodes)
        ]

    def extract_curriculum_from_documents(
        self,
        document_overviews: List[Dict[str, str]],
        familiarity: str,
        topic_hint: str = "",
        memory_context: str = "",
    ) -> List[NodeData]:
        """Instant tree generation from document structure (headings/TOC/first pages).

        Unlike extract_curriculum(), this does NOT require chunking or RAG — it reads
        document headings and first pages directly. Returns a tree in ~2s.
        """
        all_structure = "\n\n---\n\n".join(
            f"Document: {d['filename']}\n{d['structure_text']}"
            for d in document_overviews
        )
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
                    "and derive the curriculum tree. "
                    "Use ONLY topics evidenced in the documents. "
                    "Return 6-25 nodes ordered foundational → advanced, with parent_id links."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Document structure:\n{all_structure}\n\n"
                    "Extract concept nodes. Each: id (n1, n2...), label, brief description, "
                    "depth (1=chapter, 2=section, 3=topic), optional parent_id."
                ),
            },
        ]
        blueprint = self._client.structured_complete(messages, _SyllabusBlueprint)
        return [
            NodeData(
                id=sn.id,
                label=sn.label,
                description=sn.description,
                depth=sn.depth,
                parent_id=sn.parent_id,
                status="ACTIVE" if i == 0 else "LOCKED",
            )
            for i, sn in enumerate(blueprint.nodes)
        ]

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
