from fastapi import APIRouter
from pydantic import BaseModel

from app.agents.tutor_agent import TutorAgent

router = APIRouter(prefix="/sandbox", tags=["sandbox"])
_tutor: TutorAgent | None = None


def _get_tutor() -> TutorAgent:
    global _tutor
    if _tutor is None:
        _tutor = TutorAgent()
    return _tutor


class RepairRequest(BaseModel):
    original_html: str
    error_message: str
    node_id: str = ""
    animation_type: str = "canvas"


@router.post("/repair")
def repair_visual(req: RepairRequest):
    visual = _get_tutor().repair_visual(req.original_html, req.error_message)
    return {"visual": visual.model_dump()}
