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
        pass  # v2

    async def query_prior_knowledge(self, topic: str) -> str:
        return ""  # v2
