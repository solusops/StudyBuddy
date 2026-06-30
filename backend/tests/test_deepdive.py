"""Tests for the YouTube Deep Dive agent (mocked youtube + Cerebras)."""
import asyncio
from unittest.mock import MagicMock

import app.agents.infinity_wiki_agent as iw


def _agent(client=None):
    a = iw.InfinityWikiAgent.__new__(iw.InfinityWikiAgent)
    a._yt_key = "key"
    a._client = client
    return a


def test_find_videos_maps_fields(monkeypatch):
    async def fake_search(query, key, max_results=4):
        return [{
            "id": {"videoId": "abc123"},
            "snippet": {"title": "Gradient Descent", "channelTitle": "3Blue1Brown",
                        "thumbnails": {"medium": {"url": "http://thumb"}}},
        }]
    monkeypatch.setattr(iw, "search_videos", fake_search)
    vids = asyncio.run(_agent().find_videos("gradient descent", "high_school"))
    assert vids[0]["video_id"] == "abc123"
    assert vids[0]["title"] == "Gradient Descent"
    assert vids[0]["channel"] == "3Blue1Brown"
    assert vids[0]["thumbnail"] == "http://thumb"
    assert vids[0]["url"].endswith("abc123")


def test_summarize_video_grounded(monkeypatch):
    monkeypatch.setattr(iw, "fetch_transcript", lambda vid: "the loss decreases each step")
    client = MagicMock()
    client.structured_complete.return_value = iw._VideoSummary(summary="It explains GD", key_points=["step", "rate"])
    res = _agent(client).summarize_video("abc123", "gradient descent", "high_school")
    assert res.summary == "It explains GD"
    assert res.key_points == ["step", "rate"]


def test_summarize_video_no_transcript(monkeypatch):
    def _raise(vid):
        raise Exception("transcripts disabled")
    monkeypatch.setattr(iw, "fetch_transcript", _raise)
    res = _agent(MagicMock()).summarize_video("abc123", "x", "high_school")
    assert "unavailable" in res.summary.lower()
