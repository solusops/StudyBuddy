"""Annotation persistence -> in-memory dict + disk at ~/.studybuddy/annotations/{document_id}.json.

Mirrors the session-persistence pattern in routers/session.py.
"""
import json
import os
import time
from typing import Dict, List, Optional

from app.schemas.annotation import StudentAnnotation

_ANNOT_DIR = os.path.expanduser("~/.studybuddy/annotations")


class AnnotationService:
    def __init__(self) -> None:
        self._store: Dict[str, StudentAnnotation] = {}
        os.makedirs(_ANNOT_DIR, exist_ok=True)

    def _path(self, document_id: str) -> str:
        return os.path.join(_ANNOT_DIR, f"{document_id}.json")

    def _hydrate(self, document_id: str) -> None:
        """Load annotations for a document into memory if not already loaded."""
        p = self._path(document_id)
        if not os.path.exists(p):
            return
        with open(p, encoding="utf-8") as f:
            items = json.load(f)
        for item in items:
            a = StudentAnnotation(**item)
            self._store.setdefault(a.annotation_id, a)

    def _flush(self, document_id: str) -> None:
        rows = [a.model_dump() for a in self._store.values() if a.document_id == document_id]
        with open(self._path(document_id), "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=2)

    def get_for_document(self, document_id: str) -> List[StudentAnnotation]:
        self._hydrate(document_id)
        return [a for a in self._store.values() if a.document_id == document_id]

    def create(self, annotation: StudentAnnotation) -> StudentAnnotation:
        self._store[annotation.annotation_id] = annotation
        self._flush(annotation.document_id)
        return annotation

    def patch_note(self, annotation_id: str, note_text: str) -> Optional[StudentAnnotation]:
        a = self._store.get(annotation_id)
        if not a:
            return None
        a.note_text = note_text
        a.updated_at = time.time()
        self._flush(a.document_id)
        return a

    def delete(self, annotation_id: str) -> bool:
        a = self._store.pop(annotation_id, None)
        if a:
            self._flush(a.document_id)
        return a is not None

    def delete_for_document(self, document_id: str) -> None:
        """Drop every annotation for a document -> in-memory and on disk."""
        for aid in [a.annotation_id for a in self._store.values() if a.document_id == document_id]:
            self._store.pop(aid, None)
        p = self._path(document_id)
        if os.path.exists(p):
            os.remove(p)


# Single process-wide instance -> every caller must go through get_annotation_service()
# rather than constructing AnnotationService() directly, or in-memory state forks
# (a write through one instance won't be visible to another until the next disk read).
_instance: AnnotationService | None = None


def get_annotation_service() -> AnnotationService:
    global _instance
    if _instance is None:
        _instance = AnnotationService()
    return _instance
