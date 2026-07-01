"""Brain Agent -> derives the curriculum tree from student-uploaded chunks.

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

# Familiarity-specific tree shape -> controls how many nodes and how deep the tree goes
FAMILIARITY_TREE_SHAPE: Dict[str, Dict[str, Any]] = {
    "eli5": {
        "node_range": "4-8",
        "max_depth": 2,
        "guidance": (
            "Create a SMALL, SIMPLE tree with only 4-8 nodes. "
            "Use broad, everyday labels a child would understand. "
            "Max depth 2 (root + one level of subtopics). "
            "Keep labels under 4 words. No jargon."
        ),
    },
    "high_school": {
        "node_range": "8-15",
        "max_depth": 3,
        "guidance": (
            "Create a standard textbook-style tree with 8-15 nodes. "
            "Use clear chapter/section/topic hierarchy. "
            "Max depth 3 (root → sections → topics). "
            "Labels should be concise standard terms."
        ),
    },
    "graduate": {
        "node_range": "12-20",
        "max_depth": 3,
        "guidance": (
            "Create a detailed tree with 12-20 nodes. "
            "Include methodology-specific subtopics, key theorems, and techniques. "
            "Max depth 3. Group by conceptual framework, not just textbook order."
        ),
    },
    "expert": {
        "node_range": "15-25",
        "max_depth": 4,
        "guidance": (
            "Create a fine-grained tree with 15-25 nodes. "
            "Include edge cases, proof techniques, open problems, and advanced subtopics. "
            "Max depth 4 (root → areas → topics → specifics). "
            "Use precise technical terminology."
        ),
    },
}


class _SyllabusNode(BaseModel):
    id: str
    label: str
    description: str
    depth: int = Field(1, ge=0, le=4)
    complexity: int = Field(3, ge=1, le=5, description="Conceptual density: 1=simple definition, 3=moderate, 5=very complex/math-heavy")
    parent_id: Optional[str] = None


class _SyllabusEdge(BaseModel):
    source: str = Field(description="Source node id")
    target: str = Field(description="Target node id")
    relationship: str = Field(description="prerequisite | related | builds-on")


class _SyllabusBlueprint(BaseModel):
    nodes: List[_SyllabusNode] = Field(
        ..., description="Ordered list of concept nodes, root first then macro to micro"
    )
    edges: List[_SyllabusEdge] = Field(
        default_factory=list,
        description="Explicit connections between nodes capturing how concepts relate",
    )


class _SectionItem(BaseModel):
    label: str = Field(description="≤6 word section title")
    description: str = Field("", description="≤80 char summary")
    complexity: int = Field(3, ge=1, le=5)
    source_doc: int = Field(0, description="Index of the document this section comes from (0-based)")


class _RootAndSections(BaseModel):
    root_label: str = Field(description="Overall subject/topic name")
    root_description: str = Field("", description="≤80 char summary of the whole subject")
    sections: List[_SectionItem] = Field(description="Top-level subtopics of the subject")


class _ExpansionChild(BaseModel):
    label: str = Field(description="≤6 word concept title")
    description: str = Field("", description="≤80 char summary")
    complexity: int = Field(3, ge=1, le=5)
    relationship: str = Field("prerequisite", description="prerequisite | related | builds-on")


class _SectionExpansion(BaseModel):
    children: List[_ExpansionChild] = Field(
        default_factory=list, description="1-3 specific concepts under this section"
    )


class BrainAgent:
    def __init__(self, client: Optional[CerebrasClient] = None) -> None:
        self._client = client or CerebrasClient()

    # ------------------------------------------------------------------ #
    # Streaming curriculum -> root-first, then parallel section expansion  #
    # ------------------------------------------------------------------ #

    def derive_root_and_sections(
        self,
        structure_text: str,
        familiarity: str,
        topic_hint: str = "",
        memory_context: str = "",
        doc_names: Optional[List[str]] = None,
    ) -> _RootAndSections:
        """One fast call: the root subject + its top-level sections (no children yet).

        When multiple documents are provided, each section is tagged with the index of
        the document it belongs to (source_doc), so the graph routes nodes to papers.
        """
        tree_shape = FAMILIARITY_TREE_SHAPE.get(familiarity, FAMILIARITY_TREE_SHAPE["high_school"])
        familiarity_note = FAMILIARITY_NOTES.get(familiarity, "")
        topic_note = f"The student wants to study: {topic_hint}\n" if topic_hint else ""
        memory_note = f"Prior student knowledge:\n{memory_context}\n" if memory_context else ""

        multi = doc_names and len(doc_names) > 1
        doc_note = ""
        if multi:
            listing = "\n".join(f"  [{i}] {n}" for i, n in enumerate(doc_names))
            doc_note = (
                f"\nThere are {len(doc_names)} source documents:\n{listing}\n"
                "Set each section's source_doc to the 0-based index of the document it comes from.\n"
            )
        messages = [
            {
                "role": "system",
                "content": (
                    f"You are a curriculum organiser. {familiarity_note}\n{topic_note}{memory_note}\n"
                    "Identify the overall subject (root) and its top-level sections ONLY -> "
                    "do not list sub-concepts yet. "
                    f"GRANULARITY:\n{tree_shape['guidance']}\n"
                    f"Use ONLY topics evidenced in the material. Provide 4-8 sections.{doc_note}"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Document structure:\n{structure_text[:10000]}\n\n"
                    f"root_label should be '{topic_hint}' if provided, else the subject name. "
                    "List the top-level sections (each ≤6 words)."
                    + (" Tag each with its source_doc index." if multi else "")
                ),
            },
        ]
        return self._client.structured_complete(messages, _RootAndSections)

    def expand_section(
        self,
        section_label: str,
        structure_text: str,
        familiarity: str,
        sibling_sections: Optional[List[str]] = None,
    ) -> _SectionExpansion:
        """Expand one section into 1-3 specific child concepts (one parallel call per section).

        sibling_sections lists the OTHER top-level sections in this same tree (generated
        together, before any of them were expanded). Each section is still expanded by its
        own independent call -> scales to many documents, unlike folding everything into one
        call -> but naming the siblings lets the model steer away from topics that plainly
        belong to one of them (e.g. don't put "AdaMax" under this section if "Adaptive
        Variants" is a sibling), cutting down cross-section overlap that exact-label
        deduplication alone can't catch.
        """
        familiarity_note = FAMILIARITY_NOTES.get(familiarity, "")
        sibling_note = ""
        if sibling_sections:
            sibling_note = (
                "\nOther sections in this same curriculum (do NOT repeat their topics -> "
                "if a concept clearly belongs to one of these instead, leave it out):\n"
                + "\n".join(f"- {s}" for s in sibling_sections) + "\n"
            )
        messages = [
            {
                "role": "system",
                "content": (
                    f"You are a curriculum organiser. {familiarity_note}\n"
                    "Given ONE section of a subject, list 1-3 specific concepts a student must learn "
                    "within it. Use ONLY topics evidenced in the material. Keep labels ≤6 words."
                    f"{sibling_note}"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Section: {section_label}\n\n"
                    f"Document structure (for grounding):\n{structure_text[:4000]}\n\n"
                    "List 1-3 child concepts for this section -> concepts that belong specifically "
                    "here, not to one of the other sections listed above."
                ),
            },
        ]
        return self._client.structured_complete(messages, _SectionExpansion)

    def _build_nodes_and_edges(
        self, blueprint: _SyllabusBlueprint
    ) -> Tuple[List[NodeData], List[Dict]]:
        """Convert a _SyllabusBlueprint into (NodeData list, edge dicts)."""
        node_ids = {sn.id for sn in blueprint.nodes}
        nodes = [
            NodeData(
                id=sn.id,
                label=sn.label,
                description=sn.description,
                depth=sn.depth,
                complexity=sn.complexity,
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

    def cleanup_curriculum(
        self,
        nodes: List[NodeData],
        edges: List[Dict],
    ) -> Tuple[List[NodeData], List[Dict]]:
        """Run a post-generation cleanup pass on the graph to merge semantic duplicates
        and fix any structural issues introduced by parallel expansion.
        """
        nodes_desc = "\n".join(
            f"- {n.id}: \"{n.label}\" (depth={n.depth}, parent={n.parent_id or 'none'})"
            for n in nodes
        )
        edges_desc = "\n".join(
            f"- {e['source']} → {e['target']} ({e.get('relationship', 'related')})"
            for e in edges
        )

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a curriculum organiser. Your job is to CLEAN UP a newly generated topic graph.\n"
                    "Because this graph was generated in parallel, it may contain semantic duplicates "
                    "(e.g., 'Math' and 'Mathematics', or 'Neural Networks' and 'Artificial Neural Networks').\n"
                    "RULES:\n"
                    "1. Merge nodes that mean the exact same thing. Keep the broader/better name.\n"
                    "2. Do NOT merge distinct sub-topics (e.g. 'Deep Learning' is distinct from 'Neural Networks').\n"
                    "3. Ensure the root node (n0) remains at depth=0 with parent_id=null.\n"
                    "4. Every other node MUST have a valid parent_id.\n"
                    "5. If you remove/merge a node, you MUST re-assign any edges or children that pointed to it.\n"
                    "6. Return the finalized list of nodes and edges."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"CURRENT NODES:\n{nodes_desc}\n\n"
                    f"CURRENT EDGES:\n{edges_desc}\n\n"
                    "Return the clean graph. Nodes: id, label, description, depth, complexity (1-5), parent_id.\n"
                    "Edges: source, target, relationship."
                ),
            },
        ]
        blueprint = self._client.structured_complete(messages, _SyllabusBlueprint)
        
        # When merging, we need to preserve document_ids.
        # The LLM doesn't output document_ids in _SyllabusBlueprint (it doesn't know about them).
        # We can map them back based on the node IDs that were kept.
        doc_map = {n.id: getattr(n, "document_ids", []) for n in nodes}
        
        clean_nodes, clean_edges = self._build_nodes_and_edges(blueprint)
        for cn in clean_nodes:
            if cn.id in doc_map:
                cn.document_ids = doc_map[cn.id]
                
        return clean_nodes, clean_edges

    def extract_curriculum(
        self,
        chunks: List[Dict[str, Any]],
        familiarity: str,
        memory_context: str = "",
    ) -> Tuple[List[NodeData], List[Dict]]:
        """Derive topic graph from the student's uploaded content chunks.

        Returns (nodes, edges) -> edges capture prerequisite and related-topic
        relationships between nodes. All nodes start as ACTIVE (no locking).
        """
        sample = "\n\n".join(
            f"[{c.get('source', '?')}]: {c['text'][:300]}" for c in chunks[:20]
        )
        familiarity_note = FAMILIARITY_NOTES.get(familiarity, "")
        tree_shape = FAMILIARITY_TREE_SHAPE.get(familiarity, FAMILIARITY_TREE_SHAPE["high_school"])
        memory_note = (
            f"\n\nPrior student knowledge from past sessions:\n{memory_context}"
            if memory_context
            else ""
        )
        messages = [
            {
                "role": "system",
                "content": (
                    f"You are a curriculum organiser. {familiarity_note}{memory_note}\n\n"
                    "TREE STRUCTURE RULES:\n"
                    "1. The FIRST node (id=n0, depth=0) MUST be the overall topic/subject as a root node with parent_id=null.\n"
                    "2. Every other node MUST have a parent_id pointing to its parent in the hierarchy.\n"
                    "3. The tree flows top-down: root → major subtopics → specific concepts.\n"
                    "4. Edges capture cross-connections BETWEEN nodes (prerequisite, related, builds-on) -> these are IN ADDITION to the parent-child hierarchy.\n"
                    "5. Each node gets a complexity score (1-5): 1=simple definition/concept, 3=moderate understanding needed, 5=very complex/math-heavy/proof-based.\n\n"
                    f"GRANULARITY for this student's level:\n{tree_shape['guidance']}\n\n"
                    "DO NOT invent topics not evidenced in the text."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Content excerpts:\n{sample}\n\n"
                    "Build a hierarchical skill tree from this material.\n"
                    f"Node count: {tree_shape['node_range']} nodes. Max depth: {tree_shape['max_depth']}.\n"
                    "First node: id=n0, depth=0, label=overall topic name from the material, complexity=3, parent_id=null.\n"
                    "Remaining nodes: id (n1, n2...), label (≤6 words), brief description, depth, complexity (1-5), parent_id (REQUIRED).\n"
                    "Edges: source, target, relationship (prerequisite | related | builds-on). Include cross-links where real relationships exist."
                ),
            },
        ]
        blueprint = self._client.structured_complete(messages, _SyllabusBlueprint)
        return self._build_nodes_and_edges(blueprint)

    def extract_curriculum_from_documents(
        self,
        document_overviews: List[Dict[str, str]],
        familiarity: str,
        topic_hint: str = "",
        memory_context: str = "",
    ) -> Tuple[List[NodeData], List[Dict]]:
        """Instant graph generation from document structure (headings/TOC/first pages).

        Returns (nodes, edges). All nodes start as ACTIVE -> no locking.
        """
        all_structure = "\n\n---\n\n".join(
            f"Document: {d['filename']}\n{d['structure_text'][:3000]}"
            for d in document_overviews
        )
        all_structure = all_structure[:10000]  # hard cap -> prevents JSON truncation at 32K MCL
        familiarity_note = FAMILIARITY_NOTES.get(familiarity, "")
        tree_shape = FAMILIARITY_TREE_SHAPE.get(familiarity, FAMILIARITY_TREE_SHAPE["high_school"])
        topic_note = f"The student wants to study: {topic_hint}\n\n" if topic_hint else ""
        memory_note = (
            f"Prior student knowledge:\n{memory_context}\n\n" if memory_context else ""
        )
        messages = [
            {
                "role": "system",
                "content": (
                    f"You are a curriculum organiser. {familiarity_note}\n"
                    f"{topic_note}{memory_note}\n"
                    "TREE STRUCTURE RULES:\n"
                    "1. The FIRST node (id=n0, depth=0) MUST be the overall topic/subject as a root node with parent_id=null.\n"
                    f"   Its label should be: '{topic_hint}' if provided, otherwise derive the subject name from the documents.\n"
                    "2. Every other node MUST have a parent_id pointing to its parent in the hierarchy.\n"
                    "3. The tree flows top-down: root → major subtopics → specific concepts.\n"
                    "4. Edges capture cross-connections BETWEEN nodes -> these are IN ADDITION to parent-child links.\n"
                    "5. Each node gets a complexity score (1-5): 1=simple definition, 3=moderate, 5=very complex/math-heavy.\n\n"
                    f"GRANULARITY for this student's level:\n{tree_shape['guidance']}\n\n"
                    "Use ONLY topics evidenced in the documents."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Document structure:\n{all_structure}\n\n"
                    "Build a hierarchical skill tree from these documents.\n"
                    f"Node count: {tree_shape['node_range']} nodes. Max depth: {tree_shape['max_depth']}.\n"
                    "First node: id=n0, depth=0, label=overall topic, complexity=3, parent_id=null.\n"
                    "Remaining nodes: id (n1, n2...), label (≤6 words), description (≤80 chars), depth, complexity (1-5), parent_id (REQUIRED).\n"
                    "Edges: source, target, relationship (prerequisite | related | builds-on).\n"
                    "Keep descriptions short."
                ),
            },
        ]
        blueprint = self._client.structured_complete(messages, _SyllabusBlueprint)
        return self._build_nodes_and_edges(blueprint)

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
        tree_shape = FAMILIARITY_TREE_SHAPE.get(familiarity, FAMILIARITY_TREE_SHAPE["high_school"])

        # Format existing tree as context
        nodes_desc = "\n".join(
            f"- {n['id']}: \"{n['label']}\" (depth={n.get('depth', 1)}, complexity={n.get('complexity', 3)}, parent={n.get('parent_id', 'none')}) -> {n.get('description', '')}"
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
                    "- Keep the root node (n0, depth=0) -> it is the topic name\n"
                    "- Keep nodes that are still relevant\n"
                    "- Add new nodes if the student wants more coverage\n"
                    "- Remove nodes the student says are unnecessary\n"
                    "- Rename or restructure nodes as requested\n"
                    "- Update edges to reflect the new structure\n"
                    "- Every non-root node MUST have a parent_id\n"
                    "- Every node gets a complexity score (1-5)\n"
                    "All changes must stay grounded in the source material."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"STUDENT FEEDBACK: {user_feedback}\n\n"
                    f"{current_tree}\n\n"
                    f"SOURCE MATERIAL EXCERPTS:\n{sample}\n\n"
                    "Apply the student's feedback to produce an updated set of nodes and edges.\n"
                    f"Target: {tree_shape['node_range']} nodes, max depth {tree_shape['max_depth']}.\n"
                    "Keep n0 as root (depth=0). Nodes: id, label, description, depth (0-4), complexity (1-5), parent_id.\n"
                    "Edges: source, target, relationship (prerequisite | related | builds-on).\n"
                    "Reuse existing node IDs where the concept is unchanged."
                ),
            },
        ]
        blueprint = self._client.structured_complete(messages, _SyllabusBlueprint)
        return self._build_nodes_and_edges(blueprint)

    def identify_concepts(self, page_text: str, familiarity: str) -> List[str]:
        """Given a page of text, return a list of key concept phrases to highlight."""
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a concept identifier. Extract 3-8 key concept phrases from the "
                    "provided text passage. Return only the exact phrases as they appear in the text -> "
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
