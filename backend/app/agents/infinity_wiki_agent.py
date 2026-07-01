"""Infinity Wiki Agent -> on-demand YouTube "Deep Dive".

Fires only on an explicit Deep Dive button. Returns watchable videos (played in-app)
and, per video, a transcript-grounded summary that is fed into the session's RAG so
Quiz / Flashcards / revision can draw on it.
"""
import os
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.agents.cerebras_client import CerebrasClient
from app.services.youtube_service import fetch_transcript, search_videos


class _VideoSummary(BaseModel):
    summary: str = Field(description="2-4 sentence grounded summary of what the video teaches")
    key_points: List[str] = Field(default_factory=list, description="3-6 takeaways from the video")


class InfinityWikiAgent:
    def __init__(
        self,
        youtube_api_key: Optional[str] = None,
        client: Optional[CerebrasClient] = None,
    ) -> None:
        self._client = client or CerebrasClient()
        self._yt_key = youtube_api_key or os.getenv("YOUTUBE_API_KEY", "")

    async def find_videos(self, term: str, familiarity: str, n: int = 4) -> List[Dict[str, Any]]:
        """Return watchable videos for a term -> id/title/channel/thumbnail/url."""
        items = await search_videos(f"{term} {familiarity} explanation", self._yt_key, max_results=n)
        videos: List[Dict[str, Any]] = []
        for it in items:
            vid = (it.get("id") or {}).get("videoId")
            if not vid:
                continue
            sn = it.get("snippet") or {}
            thumb = ((sn.get("thumbnails") or {}).get("medium") or {}).get("url", "")
            videos.append({
                "video_id": vid,
                "title": sn.get("title", "Untitled"),
                "channel": sn.get("channelTitle", ""),
                "thumbnail": thumb,
                "url": f"https://www.youtube.com/watch?v={vid}",
            })
        return videos

    def summarize_video(self, video_id: str, term: str, familiarity: str) -> _VideoSummary:
        """Transcript-grounded summary of one video (used for study + revision)."""
        try:
            transcript = fetch_transcript(video_id)
        except Exception:
            transcript = ""
        if not transcript:
            return _VideoSummary(summary="Transcript unavailable for this video.", key_points=[])
        messages = [
            {
                "role": "system",
                "content": (
                    "Summarize this educational video transcript for a student. Ground everything in "
                    f"the transcript -> do not invent. Tailor to the {familiarity} level."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Topic: {term}\n\nTRANSCRIPT:\n{transcript[:6000]}\n\n"
                    "Give a short summary and the key takeaways."
                ),
            },
        ]
        return self._client.structured_complete(messages, _VideoSummary)
