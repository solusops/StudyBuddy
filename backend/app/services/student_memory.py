"""Cross-session student memory.

Stubbed for v1 — returns empty context so the rest of the app works.
Cognee integration will be wired in v2 once the core loop is stable.
"""
from typing import List

from app.schemas.graph import NodePatch
from app.schemas.journal import JournalEntry


class StudentMemoryService:
    async def push_session(
        self,
        session_id: str,
        topic: str,
        journal: List[JournalEntry],
        patches: List[NodePatch],
    ) -> None:
        import cognee
        try:
            await cognee.cognify(datasets=[f"session_{session_id}"])
        except Exception as e:
            import logging
            logging.getLogger(__name__).error("Failed to improve memory graph: %s", e)

    async def query_prior_knowledge(self, topic: str) -> str:
        import cognee
        from cognee import SearchType
        try:
            results = await cognee.search(
                query_text=f"What are the student's learning preferences, past struggles, and prior knowledge about {topic}?", 
                query_type=SearchType.GRAPH_COMPLETION
            )
            # search returns either a list of results or a single synthesized response
            if isinstance(results, list):
                return "\n".join(str(r) for r in results)
            return str(results) if results else ""
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("Failed to query prior knowledge: %s", e)
            return ""
