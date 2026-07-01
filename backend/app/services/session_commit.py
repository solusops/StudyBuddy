"""Shared session-history commit logic.

Used by both POST /session/commit (kept for compatibility, no longer called
by the frontend) and the EVALUATE_SESSION websocket handler ("Push"), which
now durably commits to Session History as part of the same student action
instead of requiring a separate manual "Commit" click.
"""
import json
import os
from typing import Any, Dict, List

_brain = None


def _get_brain():
    global _brain
    if _brain is None:
        from app.agents.brain_agent import BrainAgent
        _brain = BrainAgent()
    return _brain


async def commit_session_snapshot(
    session_id: str,
    topic: str,
    familiarity: str,
    nodes: List[Dict[str, Any]],
    content_files: List[str] = None,
    document_id: str = "",
    file_ids: List[str] = None,
) -> Dict[str, Any]:
    import cognee

    content_files = content_files or []
    file_ids = file_ids or []

    save_dir = os.path.expanduser("~/.studybuddy/sessions")
    os.makedirs(save_dir, exist_ok=True)

    # A title should describe the session once, not change on every Push -> reuse
    # whatever was already generated for this document set if it exists.
    title = ""
    doc_path = os.path.join(save_dir, f"doc_{document_id}.json") if document_id else None
    if doc_path and os.path.exists(doc_path):
        try:
            with open(doc_path, encoding="utf-8") as f:
                title = json.load(f).get("title", "")
        except Exception:
            pass
    if not title:
        try:
            title = _get_brain().generate_session_title(topic, content_files, familiarity)
        except Exception:
            title = topic or "Study Session"

    payload = {
        "session_id": session_id,
        "topic": topic,
        "familiarity": familiarity,
        "nodes": nodes,
        "content_files": content_files,
        "document_id": document_id,
        "file_ids": file_ids,
        "title": title,
    }
    # Force-save in ONE place per document set (document_id) when known, plus the session file.
    paths = [os.path.join(save_dir, f"{session_id}.json")]
    if document_id:
        paths.append(os.path.join(save_dir, f"doc_{document_id}.json"))
    paths.append(os.path.join(save_dir, "latest.json"))
    for path in paths:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    # Stage memory in Cognee's session cache
    payload_str = json.dumps(payload)
    await cognee.add(payload_str, dataset_name=f"session_{session_id}")

    return {"status": "committed", "paths": paths}
