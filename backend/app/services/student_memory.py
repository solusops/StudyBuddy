"""Cognee-backed cross-session student memory.

Stored locally at ~/.studybuddy/cognee/ using LanceDB.
Never writes to cloud. Degrades gracefully if Cognee graph is empty
(first session) or if the library is unavailable.

Design: thin façade — swap Cognee for another graph store without
touching any agent code.
"""
import os
from typing import List

from app.schemas.graph import NodePatch
from app.schemas.journal import JournalEntry, JournalEventType


class StudentMemoryService:
    def __init__(self, db_path: str | None = None) -> None:
        self._db_path = db_path or os.path.expanduser("~/.studybuddy/cognee")
        os.makedirs(self._db_path, exist_ok=True)
        self._configured = False

    def _ensure_configured(self) -> None:
        if self._configured:
            return
        try:
            import cognee

            cognee.config.set_vector_db_config(
                {"provider": "lancedb", "url": self._db_path}
            )
            cognee.config.set_embedding_config(
                {"provider": "fastembed", "model": "BAAI/bge-small-en-v1.5"}
            )
            self._configured = True
        except Exception:
            # Cognee unavailable — memory ops will be no-ops
            self._configured = True

    async def push_session(
        self,
        session_id: str,
        topic: str,
        journal: List[JournalEntry],
        patches: List[NodePatch],
    ) -> None:
        if not journal and not patches:
            return
        self._ensure_configured()
        try:
            import cognee

            struggled = [
                e
                for e in journal
                if e.event_type == JournalEventType.QUIZ_SUBMIT
                and not e.data.get("was_correct")
            ]
            mastered = [
                p
                for p in patches
                if p.score_patch and p.score_patch.get("memory", 0) >= 80
            ]
            feynman = [e for e in journal if e.event_type == JournalEventType.FEYNMAN_TURN]

            lines = [f"Session on topic: {topic}"]
            if struggled:
                lines.append(
                    f"Struggled with: {', '.join(e.data.get('question', '') for e in struggled[:5])}"
                )
            if mastered:
                lines.append(
                    f"Strong grasp on nodes: {', '.join(p.node_id for p in mastered)}"
                )
            if feynman:
                lines.append(
                    f"Feynman attempt: {feynman[0].data.get('student_text', '')[:300]}"
                )

            await cognee.add("\n".join(lines), dataset_name="student_sessions")
            await cognee.cognify()
        except Exception:
            pass  # Memory push is always fire-and-forget; never crash the session

    async def query_prior_knowledge(self, topic: str) -> str:
        self._ensure_configured()
        try:
            import cognee

            results = await cognee.search(
                f"What does the student know and struggle with related to {topic}?",
                query_type="INSIGHTS",
            )
            if not results:
                return ""
            return "\n".join(str(r) for r in results[:5])
        except Exception:
            return ""
