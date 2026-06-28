"""Infinity Wiki Agent — YouTube curation.

Only fires on an explicit "Deep Dive" button click. Never auto-triggered.
"""
import os
from typing import Any, Dict, Optional

from pydantic import BaseModel

from app.agents.cerebras_client import CerebrasClient
from app.services.youtube_service import fetch_transcript, search_videos


class _VideoSelection(BaseModel):
    selected_video_id: str
    reason: str


class InfinityWikiAgent:
    def __init__(
        self,
        youtube_api_key: Optional[str] = None,
        client: Optional[CerebrasClient] = None,
    ) -> None:
        self._client = client or CerebrasClient()
        self._yt_key = youtube_api_key or os.getenv("YOUTUBE_API_KEY", "")

    async def deep_dive(self, node_label: str, familiarity: str) -> Dict[str, Any]:
        videos = await search_videos(
            f"{node_label} {familiarity} explanation", self._yt_key
        )
        if not videos:
            return {"video_url": None, "summary": "No video found."}

        transcripts = []
        for v in videos[:3]:
            vid_id = v["id"]["videoId"]
            try:
                text = fetch_transcript(vid_id)
                transcripts.append(
                    {"video_id": vid_id, "title": v["snippet"]["title"], "transcript": text}
                )
            except Exception:
                continue

        if not transcripts:
            vid_id = videos[0]["id"]["videoId"]
            return {
                "video_url": f"https://www.youtube.com/watch?v={vid_id}",
                "summary": "Transcript unavailable.",
            }

        transcript_text = "\n\n".join(
            f"VIDEO {t['video_id']}: {t['title']}\n{t['transcript']}"
            for t in transcripts
        )
        messages = [
            {"role": "system", "content": "Select the best educational video for the student."},
            {
                "role": "user",
                "content": (
                    f"Topic: {node_label} at {familiarity} level.\n\n"
                    f"Videos:\n{transcript_text}\n\n"
                    "Which video best matches the topic and level?"
                ),
            },
        ]
        selection = self._client.structured_complete(messages, _VideoSelection)
        return {
            "video_url": f"https://www.youtube.com/watch?v={selection.selected_video_id}",
            "summary": selection.reason,
        }
