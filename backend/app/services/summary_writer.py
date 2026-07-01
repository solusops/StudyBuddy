"""Builds the [Topic]_Summary.md artifact saved at session end."""
from typing import List

from app.schemas.graph import NodeData
from app.schemas.journal import JournalEntry, JournalEventType


def build_summary_markdown(
    topic: str,
    familiarity: str,
    nodes: List[NodeData],
    journal: List[JournalEntry],
    session_summary: str = "",
) -> str:
    failed_quizzes = [
        e
        for e in journal
        if e.event_type == JournalEventType.QUIZ_SUBMIT and not e.data.get("was_correct")
    ]
    citations: list[str] = list(
        {e.data["citation"] for e in journal if e.data.get("citation")}
    )

    lines = [f"# {topic} -> Session Summary ({familiarity})\n"]

    if session_summary:
        lines.append(f"## Overview\n\n{session_summary}\n")

    lines.append("## Core Concepts\n")
    for node in nodes:
        if node.status in ("ACTIVE", "MASTERED"):
            avg = sum(node.scores.model_dump().values()) // 4
            lines.append(f"- **{node.label}** -> Mastery: {avg}%\n  {node.description}\n")

    if citations:
        lines.append("\n## Source Citations\n" + "\n".join(f"- {c}" for c in citations))

    if failed_quizzes:
        lines.append("\n## Active Recall Log (Review These)\n")
        for e in failed_quizzes:
            lines.append(
                f"- Q: {e.data.get('question', '')} → Correct: {e.data.get('correct', '')}\n"
            )

    return "\n".join(lines)
