"""Interactive paper regions -> segment a PDF page into clickable figures/tables/formulas.

Pipeline: PyMuPDF locates regions (exact geometry) → Gemma vision describes each
crop concurrently (caption / LaTeX / markdown table). Results are cached per page.

The PDF itself is cached server-side by document_id on first receipt, so the
frontend only uploads the bytes once per session.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.agents.senses_agent import SensesAgent
from app.services.layout_service import page_has_text, segment_page

router = APIRouter(prefix="/regions", tags=["regions"])

_PDF_DIR = os.path.expanduser("~/.studybuddy/pdfs")
_REGION_DIR = os.path.expanduser("~/.studybuddy/regions")
os.makedirs(_PDF_DIR, exist_ok=True)
os.makedirs(_REGION_DIR, exist_ok=True)

_senses: Optional[SensesAgent] = None


def _get_senses() -> SensesAgent:
    global _senses
    if _senses is None:
        _senses = SensesAgent()
    return _senses


class SegmentRequest(BaseModel):
    document_id: str
    page_number: int  # 0-based
    pdf_base64: Optional[str] = None  # sent once when the server hasn't cached the PDF yet


class SnipRequest(BaseModel):
    document_id: str
    page_number: int
    bbox_norm: dict  # {x, y, w, h}
    pdf_base64: Optional[str] = None


def _pdf_path(document_id: str) -> str:
    return os.path.join(_PDF_DIR, f"{document_id}.pdf")


def _region_cache_path(document_id: str) -> str:
    return os.path.join(_REGION_DIR, f"{document_id}.json")


def _load_region_cache(document_id: str) -> dict:
    p = _region_cache_path(document_id)
    if os.path.exists(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[REGIONS] Error loading cache for {document_id}: {e}")
    return {}


def _save_region_cache(document_id: str, cache: dict) -> None:
    with open(_region_cache_path(document_id), "w", encoding="utf-8") as f:
        json.dump(cache, f)


@router.post("/segment")
async def segment(req: SegmentRequest):
    print(f"[REGIONS] Incoming segment request: doc_id={req.document_id}, page={req.page_number}, has_b64={bool(req.pdf_base64)}")
    # Serve from cache if this page was already segmented.
    cache = _load_region_cache(req.document_id)
    page_key = str(req.page_number)
    if page_key in cache:
        print(f"[REGIONS] Serving {len(cache[page_key])} regions from cache for page {req.page_number}")
        return {"regions": cache[page_key], "cached": True}
    # Resolve the PDF bytes: cached on disk, or freshly uploaded in this request.
    pdf_path = _pdf_path(req.document_id)
    if req.pdf_base64:
        print(f"[REGIONS] Writing uploaded PDF base64 bytes to: {pdf_path}")
        with open(pdf_path, "wb") as f:
            f.write(base64.b64decode(req.pdf_base64))
    if not os.path.exists(pdf_path):
        # Last-resort fallback -> normally unreachable, since upload_and_start/resume
        # both cache every file under ~/.studybuddy/pdfs/{file_id}.pdf immediately.
        # Each session has its own upload folder (no shared directory), so this
        # searches across all of them -> safe because it only ever copies a file
        # whose content hash actually matches the requested document_id.
        print(f"[REGIONS] PDF path {pdf_path} not found. Attempting backend-side resolution...")
        import hashlib
        import shutil
        from app.services.session_files import SESSION_UPLOADS_ROOT
        resolved = False
        if os.path.exists(SESSION_UPLOADS_ROOT):
            for session_dir in os.listdir(SESSION_UPLOADS_ROOT):
                folder = os.path.join(SESSION_UPLOADS_ROOT, session_dir)
                if not os.path.isdir(folder):
                    continue
                for filename in os.listdir(folder):
                    if not filename.lower().endswith(".pdf"):
                        continue
                    path = os.path.join(folder, filename)
                    try:
                        with open(path, "rb") as f:
                            h = hashlib.sha256(f.read()).hexdigest()
                        if h == req.document_id:
                            print(f"[REGIONS] Found matching file: {filename} ({h}). Copying to cache...")
                            shutil.copy(path, pdf_path)
                            resolved = True
                            break
                    except Exception as e:
                        print(f"[REGIONS] Error checking {filename}: {e}")
                if resolved:
                    break
        if not resolved:
            print(f"[REGIONS] PDF path does not exist on disk: {pdf_path}. Returning 409.")
            raise HTTPException(status_code=409, detail="pdf_not_cached")

    loop = asyncio.get_event_loop()

    # Scanned page with no text layer → no reliable geometry; signal vision-only fallback.
    has_text = await loop.run_in_executor(None, page_has_text, None, pdf_path, req.page_number)
    print(f"[REGIONS] Page text check: has_text={has_text}")

    try:
        regions, (pw, ph) = await loop.run_in_executor(
            None, lambda: segment_page(file_path=pdf_path, page_number=req.page_number)
        )
        print(f"[REGIONS] PyMuPDF segment_page extracted {len(regions)} regions (dimensions: {pw}x{ph})")
    except Exception as e:
        print(f"[REGIONS] Error running segment_page: {e}")
        regions, pw, ph = [], 0, 0

    # Describe each region crop concurrently (Cerebras throughput is not the bottleneck).
    async def describe(region: dict) -> dict:
        try:
            print(f"[REGIONS] Describing region {region['id']} (type: {region['type']})")
            desc = await loop.run_in_executor(
                None, _get_senses().describe_region, region["crop_base64"], region["type"]
            )
            print(f"[REGIONS] Successfully described region {region['id']}: type={desc.type}, caption={desc.caption[:40]}")
            return {
                **region,
                "type": desc.type,
                "caption": desc.caption,
                "extracted_content": desc.extracted_content,
            }
        except Exception as e:
            print(f"[REGIONS] describe_region error for {region['id']}: {e}")
            return {**region, "caption": "", "extracted_content": ""}

    described = await asyncio.gather(*(describe(r) for r in regions)) if regions else []
    # Filter out equations, text blocks misidentified as 'other', etc. during auto run.
    # Keep only visual plots/diagrams/figures.
    described = [d for d in described if d.get("type", "").lower() in ["figure", "plot", "diagram"]]

    print(f"[REGIONS] Returning {len(described)} regions to frontend.")
    cache[page_key] = described
    _save_region_cache(req.document_id, cache)
    return {"regions": described, "cached": False, "has_text_layer": has_text}


@router.post("/snip")
async def snip(req: SnipRequest):
    print(f"[REGIONS] Incoming snip request: doc_id={req.document_id}, page={req.page_number}")
    pdf_path = _pdf_path(req.document_id)
    if not os.path.exists(pdf_path):
        if req.pdf_base64:
            with open(pdf_path, "wb") as f:
                f.write(base64.b64decode(req.pdf_base64))
        else:
            raise HTTPException(status_code=409, detail="pdf_not_cached")

    loop = asyncio.get_event_loop()
    from app.services.layout_service import crop_page_region
    
    try:
        crop_base64 = await loop.run_in_executor(
            None, lambda: crop_page_region(file_path=pdf_path, page_number=req.page_number, bbox_norm=req.bbox_norm)
        )
    except Exception as e:
        print(f"[REGIONS] Error running crop_page_region: {e}")
        raise HTTPException(status_code=500, detail="crop_failed")

    try:
        desc = await loop.run_in_executor(
            None, _get_senses().describe_region, crop_base64, "snippet"
        )
        new_region = {
            "id": f"snip_{req.page_number}_{req.bbox_norm['y']:.3f}",
            "type": desc.type,
            "bbox_norm": req.bbox_norm,
            "caption": desc.caption,
            "extracted_content": desc.extracted_content,
            "crop_base64": crop_base64,
        }
        
        # Save to cache
        cache = _load_region_cache(req.document_id)
        page_key = str(req.page_number)
        if page_key not in cache:
            cache[page_key] = []
        cache[page_key].append(new_region)
        _save_region_cache(req.document_id, cache)
        
        return new_region
    except Exception as e:
        print(f"[REGIONS] describe_region error: {e}")
        raise HTTPException(status_code=500, detail="vision_failed")
