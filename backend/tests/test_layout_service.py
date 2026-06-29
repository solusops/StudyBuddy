"""Geometry-only tests for layout_service (no vision/model calls)."""
import pymupdf as fitz

from app.services.layout_service import page_has_text, segment_page


def _pdf_with_drawing() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Figure 1: a chart of values")
    page.draw_rect(fitz.Rect(80, 120, 400, 360), color=(0, 0, 0), width=1)
    for i in range(5):
        page.draw_line(fitz.Point(90, 140 + i * 40), fitz.Point(390, 140 + i * 40), color=(0.2, 0.2, 0.8))
    data = doc.tobytes()
    doc.close()
    return data


def test_segments_vector_drawing_region():
    regions, (pw, ph) = segment_page(pdf_bytes=_pdf_with_drawing(), page_number=0)
    assert pw > 0 and ph > 0
    assert len(regions) >= 1
    r = regions[0]
    assert r["type"] in {"diagram", "figure", "table"}
    # bbox is normalized 0..1
    for k in ("x", "y", "w", "h"):
        assert 0.0 <= r["bbox_norm"][k] <= 1.0
    # a PNG crop was produced
    assert len(r["crop_base64"]) > 100


def test_page_has_text_true_for_born_digital():
    assert page_has_text(_pdf_with_drawing(), None, 0) is True


def test_blank_page_has_no_text_and_no_regions():
    doc = fitz.open()
    doc.new_page()
    data = doc.tobytes()
    doc.close()
    assert page_has_text(data, None, 0) is False
    regions, _ = segment_page(pdf_bytes=data, page_number=0)
    assert regions == []
