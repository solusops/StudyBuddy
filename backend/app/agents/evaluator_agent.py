"""Evaluator Agent — reads the full session journal and emits score patches.

Runs once on END_SESSION. Scores are 0-100 on four axes.
The monotone clamp is enforced downstream by GraphStateManager.
"""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.agents.cerebras_client import CerebrasClient
from app.schemas.graph import NodePatch
from app.schemas.journal import JournalEntry
from app.services.journal_service import JournalService


class _EvaluatorPatch(BaseModel):
    node_id: str
    score_patch: Dict[str, int] = Field(
        description="memory, comprehension, structure, application — each 0-100"
    )


class _EvaluatorOutput(BaseModel):
    patches: List[_EvaluatorPatch]
    session_summary: str = Field(description="One-paragraph plain-text summary of the session")


class EvaluatorAgent:
    def __init__(
        self,
        journal_service: Optional[JournalService] = None,
        client: Optional[CerebrasClient] = None,
    ) -> None:
        self._client = client or CerebrasClient()
        self._journal = journal_service or JournalService()

    def evaluate_session(self, session_id: str) -> tuple[List[NodePatch], str]:
        """Returns (patches, summary_text)."""
        journal = self._journal.get_session(session_id)
        if not journal:
            return [], "No activity recorded in this session."

        journal_text = "\n".join(
            f"[{e.event_type}] node={e.node_id} data={e.data}" for e in journal
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a mastery evaluator. Read the session journal and score each "
                    "concept node on four axes (0-100):\n"
                    "- memory: can the student recall facts?\n"
                    "- comprehension: do they understand the concept?\n"
                    "- structure: can they organise and connect ideas?\n"
                    "- application: can they apply knowledge to new problems?\n"
                    "Be evidence-based. Only score nodes that appear in the journal. "
                    "Also write a one-paragraph session_summary."
                ),
            },
            {
                "role": "user",
                "content": f"Session journal:\n{journal_text}\n\nProvide score patches per node.",
            },
        ]
        output = self._client.structured_complete(messages, _EvaluatorOutput)
        patches = [NodePatch(node_id=p.node_id, score_patch=p.score_patch) for p in output.patches]
        return patches, output.session_summary
