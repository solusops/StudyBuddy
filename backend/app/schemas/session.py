from enum import Enum
from typing import Optional
from pydantic import BaseModel


class FamiliarityLevel(str, Enum):
    ELI5 = "eli5"
    HIGH_SCHOOL = "high_school"
    GRADUATE = "graduate"
    EXPERT = "expert"


class Session(BaseModel):
    session_id: str
    topic: str
    familiarity: FamiliarityLevel
    active_node_id: Optional[str] = None
