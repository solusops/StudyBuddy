from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.schemas.annotation import StudentAnnotation
from app.services.annotation_service import get_annotation_service

router = APIRouter(prefix="/annotations", tags=["annotations"])
_svc = get_annotation_service()


class PatchNoteRequest(BaseModel):
    note_text: str


@router.get("/{document_id}")
def list_annotations(document_id: str):
    return [a.model_dump() for a in _svc.get_for_document(document_id)]


@router.post("")
def create_annotation(annotation: StudentAnnotation):
    created = _svc.create(annotation)
    return created.model_dump()


@router.patch("/{annotation_id}")
def patch_annotation(annotation_id: str, req: PatchNoteRequest):
    updated = _svc.patch_note(annotation_id, req.note_text)
    if not updated:
        raise HTTPException(404, f"Annotation {annotation_id} not found")
    return updated.model_dump()


@router.delete("/{annotation_id}")
def delete_annotation(annotation_id: str):
    ok = _svc.delete(annotation_id)
    if not ok:
        raise HTTPException(404, f"Annotation {annotation_id} not found")
    return {"status": "deleted"}


@router.get("/stt-status")
def check_stt_status():
    from app.services.transcription_service import TranscriptionService
    stt = TranscriptionService.get()
    return {
        "available": stt.is_available,
        "is_loading": stt.is_model_loading()
    }
