"""In-memory journal — append-only log of student interactions per session.

The Evaluator Agent reads the full journal at session end to score mastery.
All entries are immutable once appended.
"""
from collections import defaultdict
from typing import Dict, List

from app.schemas.journal import JournalEntry


class JournalService:
    def __init__(self) -> None:
        self._store: Dict[str, List[JournalEntry]] = defaultdict(list)

    def append(self, entry: JournalEntry) -> None:
        self._store[entry.session_id].append(entry)

    def get_session(self, session_id: str) -> List[JournalEntry]:
        return list(self._store[session_id])

    def clear_session(self, session_id: str) -> None:
        self._store.pop(session_id, None)
