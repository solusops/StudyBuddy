"""Scholarly paper lookup via the OpenAlex REST API.

Used by the Infinite Wiki to append "Further Reading" — the top most-cited papers
for a concept. Best-effort: any error or missing key yields an empty list so the
wiki card still renders.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List

_OPENALEX_URL = "https://api.openalex.org/works"


def _best_url(work: Dict[str, Any]) -> str:
    doi = work.get("doi")
    if doi:
        return doi  # already a full https://doi.org/... URL
    loc = work.get("primary_location") or {}
    if loc.get("landing_page_url"):
        return loc["landing_page_url"]
    return work.get("id", "")  # OpenAlex entity URL as last resort


def _authors(work: Dict[str, Any], limit: int = 3) -> str:
    names = [
        (a.get("author") or {}).get("display_name")
        for a in (work.get("authorships") or [])
    ]
    names = [n for n in names if n][:limit]
    if not names:
        return ""
    suffix = " et al." if len((work.get("authorships") or [])) > limit else ""
    return ", ".join(names) + suffix


async def fetch_top_papers(query: str, n: int = 3) -> List[Dict[str, Any]]:
    """Return up to `n` most-cited papers for `query`, newest-first on ties."""
    if not query.strip():
        return []
    import httpx

    params: Dict[str, Any] = {
        "search": query,
        "sort": "cited_by_count:desc",
        "per-page": n,
    }
    # OpenAlex "polite pool" / premium key conventions.
    api_key = os.getenv("OPENALEX_API_KEY", "")
    if api_key:
        params["api_key"] = api_key
    mailto = os.getenv("OPENALEX_MAILTO", "")
    if mailto:
        params["mailto"] = mailto

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(_OPENALEX_URL, params=params, timeout=6.0)
            if resp.status_code != 200:
                return []
            results = resp.json().get("results", [])
    except Exception as e:  # network/parse errors are non-fatal
        print("OpenAlex lookup error:", e)
        return []

    papers: List[Dict[str, Any]] = []
    for w in results[:n]:
        papers.append({
            "title": w.get("display_name") or "Untitled",
            "authors": _authors(w),
            "year": w.get("publication_year"),
            "cited_by": w.get("cited_by_count", 0),
            "url": _best_url(w),
        })
    return papers
