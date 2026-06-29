from __future__ import annotations
import time
import uuid
from typing import List, Optional

from pydantic import BaseModel, Field


class BoundingBox(BaseModel):
    """Page-normalised bounding box (all coords 0..1, relative to page element)."""
    page: int
    x: float
    y: float
    w: float
    h: float


class SelectionSnippet(BaseModel):
    page_number: int
    text: str
    boxes: List[BoundingBox]
    char_start: Optional[int] = None
    char_end: Optional[int] = None


class StudentAnnotation(BaseModel):
    annotation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    document_id: str        # SHA-256 content hash — stable across re-uploads
    session_id: str
    target_snippets: List[SelectionSnippet]
    note_text: Optional[str] = None
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
