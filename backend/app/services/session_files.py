"""Per-session upload storage.

Each session gets its OWN folder -> no shared, rescanned "current uploads"
directory. A session's document set is exactly what's in its own folder,
nothing else, so a new session can never see another session's (or a prior
session's leftover) files. Duplication across sessions is an accepted
tradeoff for that isolation.
"""
import os
from typing import List

SESSION_UPLOADS_ROOT = os.path.expanduser("~/.studybuddy/session_uploads")
_SUPPORTED_EXTS = {".pdf", ".docx", ".txt"}


def session_upload_dir(session_id: str) -> str:
    d = os.path.join(SESSION_UPLOADS_ROOT, session_id)
    os.makedirs(d, exist_ok=True)
    return d


def list_session_files(session_id: str) -> List[str]:
    folder = session_upload_dir(session_id)
    return sorted(
        os.path.join(folder, f)
        for f in os.listdir(folder)
        if os.path.isfile(os.path.join(folder, f))
        and os.path.splitext(f)[1].lower() in _SUPPORTED_EXTS
    )
