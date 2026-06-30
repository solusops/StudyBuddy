"""Deterministic per-node activity tally (no LLM).

Computes each node's progress from what the student actually did on it — read from
the session journal. Runs on demand (graph load / every visit) to drive the node
fill animation and completion light-up. The LLM evaluation (reasoned scores) is a
separate path.
"""
from __future__ import annotations

from typing import Any, Dict, List

from app.schemas.journal import JournalEntry, JournalEventType

# The four tracked activities per node; all four done = node complete.
_ACTIVITIES = ("studied", "quiz", "flashcards", "feynman")


def compute_progress(journal: List[JournalEntry]) -> Dict[str, Dict[str, Any]]:
    """Return {node_id: {percent, complete, activities:{...}, quiz_correct, quiz_total}}."""
    nodes: Dict[str, Dict[str, Any]] = {}

    def _node(nid: str) -> Dict[str, Any]:
        if nid not in nodes:
            nodes[nid] = {
                "activities": {a: False for a in _ACTIVITIES},
                "quiz_correct": 0,
                "quiz_total": 0,
            }
        return nodes[nid]

    for e in journal:
        if not e.node_id:
            continue
        n = _node(e.node_id)
        et = e.event_type
        if et in (JournalEventType.NODE_OPENED, JournalEventType.CHAT_TURN):
            n["activities"]["studied"] = True
        elif et == JournalEventType.QUIZ_SUBMIT:
            n["activities"]["quiz"] = True
            n["quiz_total"] += 1
            if e.data.get("was_correct"):
                n["quiz_correct"] += 1
        elif et == JournalEventType.FLASHCARD_GRADE:
            n["activities"]["flashcards"] = True
        elif et == JournalEventType.FEYNMAN_TURN:
            n["activities"]["feynman"] = True

    out: Dict[str, Dict[str, Any]] = {}
    for nid, n in nodes.items():
        done = sum(1 for a in _ACTIVITIES if n["activities"][a])
        out[nid] = {
            "node_id": nid,
            "percent": round(done / len(_ACTIVITIES) * 100),
            "complete": done == len(_ACTIVITIES),
            "activities": n["activities"],
            "quiz_correct": n["quiz_correct"],
            "quiz_total": n["quiz_total"],
        }
    return out
