"""Evaluator Agent — reasoned mastery assessment from the session journal.

The model does NOT invent numeric scores. It classifies the student's demonstrated
understanding per node against a rubric — judged from the SOPHISTICATION of their
questions, quiz answers, and Feynman explanations — and gives a reasoning + evidence.
A deterministic rubric map converts each classification into the 4-axis score patch.
The monotone clamp is enforced downstream by GraphStateManager.
"""
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from app.agents.cerebras_client import CerebrasClient
from app.schemas.graph import NodePatch
from app.services.journal_service import JournalService

Classification = Literal["building_basics", "foundational", "comfortable", "sophisticated"]

# Deterministic classification → 4-axis scores. The LLM never picks numbers.
_RUBRIC: Dict[str, Dict[str, int]] = {
    "building_basics": {"memory": 40, "comprehension": 25, "structure": 20, "application": 15},
    "foundational":    {"memory": 62, "comprehension": 52, "structure": 42, "application": 32},
    "comfortable":     {"memory": 82, "comprehension": 76, "structure": 70, "application": 60},
    "sophisticated":   {"memory": 96, "comprehension": 92, "structure": 90, "application": 88},
}


class NodeAssessment(BaseModel):
    node_id: str
    classification: Classification = Field(
        description="building_basics | foundational | comfortable | sophisticated, "
        "judged from how sophisticated the student's questions/answers are"
    )
    reasoning: str = Field(description="One sentence justifying the classification")
    evidence: List[str] = Field(default_factory=list, description="0-3 specific signals from the journal")


class _EvaluatorOutput(BaseModel):
    assessments: List[NodeAssessment]
    session_summary: str = Field(description="One-paragraph plain-text summary of the session")


class EvaluatorAgent:
    def __init__(
        self,
        journal_service: Optional[JournalService] = None,
        client: Optional[CerebrasClient] = None,
    ) -> None:
        self._client = client or CerebrasClient()
        self._journal = journal_service or JournalService()

    def evaluate_session(self, session_id: str) -> tuple[List[NodePatch], List[NodeAssessment], str]:
        """Returns (patches, assessments, summary_text)."""
        journal = self._journal.get_session(session_id)
        if not journal:
            return [], [], "No activity recorded in this session."

        journal_text = "\n".join(
            f"[{e.event_type}] node={e.node_id} data={e.data}" for e in journal
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a learning-trajectory evaluator. For each concept node in the journal, "
                    "classify the student's demonstrated understanding by the SOPHISTICATION of what "
                    "they did — the kind of questions they asked, their quiz answers, and their Feynman "
                    "explanations — into exactly one of:\n"
                    "- building_basics: asks definitional 'what is X' questions; frequent wrong answers.\n"
                    "- foundational: grasps core ideas but asks mostly surface-level questions.\n"
                    "- comfortable: asks 'why/how' questions, connects ideas, mostly correct.\n"
                    "- sophisticated: asks abstract, edge-case, or synthesis questions; near-mastery.\n"
                    "Give a one-sentence reasoning and up to 3 concrete evidence signals per node. "
                    "Only assess nodes that appear in the journal. Do NOT output numeric scores. "
                    "Also write a one-paragraph session_summary."
                ),
            },
            {
                "role": "user",
                "content": f"Session journal:\n{journal_text}\n\nClassify each node.",
            },
        ]
        output = self._client.structured_complete(messages, _EvaluatorOutput)
        patches = [
            NodePatch(node_id=a.node_id, score_patch=_RUBRIC[a.classification])
            for a in output.assessments
        ]
        return patches, output.assessments, output.session_summary
