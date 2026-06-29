"""PDF page layout segmentation via PyMuPDF (fitz).

Locates non-text regions a student can't otherwise select — figures, plots,
diagrams, tables — and returns pixel-accurate normalized bounding boxes plus a
PNG crop of each. Vision understanding (caption / LaTeX / table extraction) is a
separate step (SensesAgent.describe_region), so this module stays pure geometry
and is unit-testable without any model call.

Born-digital PDFs get exact geometry here. Scanned/image-only pages have no
embedded structure; `page_has_text()` lets the caller fall back to whole-page
vision instead.
"""
from __future__ import annotations

import base64
from typing import Any, Dict, List, Optional, Tuple

# Skip regions smaller than this fraction of the page (noise / tiny glyph runs).
_MIN_AREA_FRAC = 0.003
# Cap regions per page to bound downstream vision calls.
_MAX_REGIONS = 8
_CROP_ZOOM = 2.0


def _open(pdf_bytes: Optional[bytes], file_path: Optional[str]):
    import pymupdf as fitz

    if pdf_bytes is not None:
        return fitz.open(stream=pdf_bytes, filetype="pdf")
    return fitz.open(file_path)


def page_has_text(pdf_bytes: Optional[bytes], file_path: Optional[str], page_number: int) -> bool:
    doc = _open(pdf_bytes, file_path)
    try:
        return bool(doc[page_number].get_text("text").strip())
    finally:
        doc.close()


def _norm(rect, pw: float, ph: float) -> Dict[str, float]:
    return {
        "x": max(0.0, rect[0] / pw),
        "y": max(0.0, rect[1] / ph),
        "w": min(1.0, (rect[2] - rect[0]) / pw),
        "h": min(1.0, (rect[3] - rect[1]) / ph),
    }


def crop_page_region(
    pdf_bytes: Optional[bytes] = None,
    file_path: Optional[str] = None,
    page_number: int = 0,
    bbox_norm: Dict[str, float] = None,
) -> str:
    """Extract a base64 PNG crop of the given normalized bounding box."""
    import pymupdf as fitz
    
    doc = _open(pdf_bytes, file_path)
    try:
        page = doc[page_number]
        pw, ph = page.rect.width, page.rect.height
        
        # Convert normalized bbox to absolute coordinates
        x0 = bbox_norm["x"] * pw
        y0 = bbox_norm["y"] * ph
        x1 = (bbox_norm["x"] + bbox_norm["w"]) * pw
        y1 = (bbox_norm["y"] + bbox_norm["h"]) * ph
        
        rect = fitz.Rect(x0, y0, x1, y1)
        pix = page.get_pixmap(clip=rect, matrix=fitz.Matrix(_CROP_ZOOM, _CROP_ZOOM))
        return base64.b64encode(pix.tobytes("png")).decode("ascii")
    finally:
        doc.close()

def segment_page(
    pdf_bytes: Optional[bytes] = None,
    file_path: Optional[str] = None,
    page_number: int = 0,
) -> Tuple[List[Dict[str, Any]], Tuple[float, float]]:
    """Return (regions, (page_width, page_height)).
    
    Each region: {id, type, bbox_norm{x,y,w,h}, crop_base64}.
    """
    import pymupdf as fitz

    doc = _open(pdf_bytes, file_path)
    try:
        page = doc[page_number]
        pr = page.rect
        pw, ph = pr.width, pr.height
        page_area = max(1.0, pw * ph)

        candidates: List[Tuple[Any, str]] = []

        # 1. Embedded raster images (figures/plots)
        try:
            for info in page.get_image_info():
                bbox = info.get("bbox")
                if bbox:
                    candidates.append((fitz.Rect(bbox), "figure"))
        except Exception:
            pass

        # 2. Vector-drawing clusters (line plots, schematic diagrams)
        try:
            try:
                rects = page.cluster_drawings(x_tolerance=20.0, y_tolerance=20.0)
            except TypeError:
                rects = page.cluster_drawings()
            for rect in rects:
                candidates.append((fitz.Rect(rect), "diagram"))
        except Exception:
            pass

        regions: List[Dict[str, Any]] = []
        kept_rects: List[Tuple[Any, str]] = []

        # Sort all candidates by area (largest first)
        candidates.sort(key=lambda c: c[0].get_area(), reverse=True)
        
        for rect, rtype in candidates:
            if rect.is_empty or rect.width <= 0 or rect.height <= 0:
                continue
            if rect.get_area() < _MIN_AREA_FRAC * page_area:
                continue
                
            overlap = False
            for k_rect, k_type in kept_rects:
                inter = rect & k_rect
                # If same type, dedupe heavy overlap
                if rtype == k_type:
                    if not inter.is_empty and inter.get_area() > 0.6 * rect.get_area():
                        overlap = True
                        break
                # If diagram heavily overlaps a figure, skip it!
                elif rtype == "diagram" and k_type == "figure":
                    if not inter.is_empty and inter.get_area() > 0.6 * rect.get_area():
                        overlap = True
                        break

            if overlap:
                continue
                
            kept_rects.append((rect, rtype))
            try:
                mat = fitz.Matrix(_CROP_ZOOM, _CROP_ZOOM)
                pix = page.get_pixmap(clip=rect, matrix=mat)
                crop_b64 = base64.b64encode(pix.tobytes("png")).decode()
            except Exception:
                continue  # skip regions that fail to crop
                
            regions.append({
                "id": f"r{len(regions)}",
                "type": rtype,
                "bbox_norm": _norm(rect, pw, ph),
                "crop_base64": crop_b64,
            })
            
            # Removed _MAX_REGIONS cap to allow the page to be fully divided into sections

        return regions, (pw, ph)
    finally:
        doc.close()
