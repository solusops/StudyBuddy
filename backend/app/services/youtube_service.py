"""YouTube search and transcript fetching.

Isolated here so InfinityWikiAgent doesn't directly import httpx/youtube_transcript_api.
"""
from typing import Any, Dict, List

import httpx


async def search_videos(query: str, api_key: str, max_results: int = 3) -> List[Dict[str, Any]]:
    if not api_key:
        return []
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            "https://www.googleapis.com/youtube/v3/search",
            params={
                "part": "snippet",
                "q": query,
                "type": "video",
                "maxResults": max_results,
                "key": api_key,
            },
        )
        resp.raise_for_status()
    return resp.json().get("items", [])


def fetch_transcript(video_id: str, max_chunks: int = 100) -> str:
    from youtube_transcript_api import YouTubeTranscriptApi

    chunks = YouTubeTranscriptApi.get_transcript(video_id)
    return " ".join(c["text"] for c in chunks[:max_chunks])
