import time
from enum import Enum
from typing import Any, Dict
from pydantic import BaseModel, Field


class JournalEventType(str, Enum):
    CHAT_TURN = "chat_turn"
    FLASHCARD_GRADE = "flashcard_grade"
    QUIZ_SUBMIT = "quiz_submit"
    FEYNMAN_TURN = "feynman_turn"
    NODE_OPENED = "node_opened"
    DEEP_DIVE = "deep_dive"


class JournalEntry(BaseModel):
    session_id: str
    node_id: str
    event_type: JournalEventType
    data: Dict[str, Any]
    timestamp: float = Field(default_factory=time.time)
