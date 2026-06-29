"""Report Agent — streams textbook-style report sections from highlighted context.

Used by the Live-Compiling Research Report Canvas. Each highlighted passage becomes
a formatted section; a background pass may attach a grounded visual to it.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.agents.cerebras_client import CerebrasClient


class ReportAgent:
    def __init__(self, client: Optional[CerebrasClient] = None) -> None:
        self._client = client or CerebrasClient()

    async def stream_section(
        self,
        topic: str,
        context_text: str,
        chunks: List[Dict[str, Any]],
        familiarity: str,
        knowledge_mode: str = "content_only",
        edit_instruction: str = "",
        web_context: str = "",
    ):
        """Async generator yielding markdown tokens for one report section."""
        chunk_ctx = "\n".join(f"[{c.get('source', '?')}]: {c['text']}" for c in chunks)

        if knowledge_mode == "net_support":
            grounding = (
                "Ground the section in the source material and any web context provided, and you may "
                "add your own expert knowledge to make it complete and clear."
            )
        else:
            grounding = (
                "Base the section on the source material. Teach it clearly; if a detail is missing, "
                "explain it briefly in general terms but stay focused on the material. Never fabricate."
            )

        edit_note = f"REVISION REQUEST (apply this): {edit_instruction}\n\n" if edit_instruction else ""
        web_block = f"\n\nWEB CONTEXT:\n{web_context}" if web_context else ""

        system = (
            "You are writing one section of a polished, textbook-style study report. "
            f"{grounding} Tailor depth to the {familiarity} level.\n\n"
            "FORMAT (Markdown):\n"
            "- Start with a '## ' heading naming the concept.\n"
            "- 2-4 tight paragraphs; use **bold** for key terms and bullet lists where useful.\n"
            "- Use LaTeX for math: $...$ inline and $$...$$ display.\n"
            "- You MAY include ONE ```mermaid diagram for a structural concept (plain-text labels, "
            "quote any label with parentheses) OR a ```plotly JSON block for real source data.\n"
            "- Do NOT include [Source: ...] citations. Write as flowing prose, not a Q&A."
        )
        user = (
            f"{edit_note}"
            f"Write the report section about: {topic}\n"
            f"Highlighted passage from the document:\n\"{context_text[:1500]}\"\n\n"
            f"SOURCE MATERIAL:\n{chunk_ctx}{web_block}"
        )
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        async for token in self._client.stream_complete(messages):
            yield token
