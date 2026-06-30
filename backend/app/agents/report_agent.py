"""Report Agent — streams textbook-style report sections from highlighted context.

Used by the Live-Compiling Research Report Canvas. Each highlighted passage becomes
a formatted section; a background pass may attach a grounded visual to it.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.agents.cerebras_client import CerebrasClient


class NoteInsight(BaseModel):
    concept: str = Field(description="The concept/topic this note is about (≤8 words)")
    summary: str = Field(description="What the student captured, grounded in the source (2-4 sentences)")
    key_points: List[str] = Field(default_factory=list, description="0-4 atomic facts worth keeping")


class ReportAgent:
    def __init__(self, client: Optional[CerebrasClient] = None) -> None:
        self._client = client or CerebrasClient()

    # ------------------------------------------------------------------ #
    # Notes → report: process each note statelessly, then synthesize      #
    # ------------------------------------------------------------------ #

    def process_note(
        self,
        note_text: str,
        snippet_text: str,
        source_context: str,
        familiarity: str,
        extracted_content: str = "",
    ) -> NoteInsight:
        """One stateless pass over a single note → a grounded insight (pooled later).

        This is the per-note unit a per-PDF agent runs over every annotation; the output
        is what gets pooled (and, at scale, persisted to the PDF's Cognee cluster).
        """
        messages = [
            {
                "role": "system",
                "content": (
                    "You are extracting a clean, grounded insight from ONE of a student's notes on a "
                    "research paper. Use the student's note and the surrounding source context. "
                    "Capture what the note is really about — do not invent beyond the source. "
                    f"Tailor wording to the {familiarity} level."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"STUDENT NOTE:\n{note_text or '(no written note — the student marked this region)'}\n\n"
                    f"HIGHLIGHTED PASSAGE:\n{snippet_text[:1200]}\n\n"
                    f"PINNED/EXTRACTED CONTENT:\n{extracted_content[:800]}\n\n"
                    f"SURROUNDING SOURCE CONTEXT:\n{source_context[:2000]}"
                ),
            },
        ]
        return self._client.structured_complete(messages, NoteInsight)

    async def synthesize_report(
        self,
        insights: List[NoteInsight],
        topic: str,
        toc_labels: List[str],
        familiarity: str,
        knowledge_mode: str = "content_only",
        edit_instruction: str = "",
        web_context: str = "",
    ):
        """Stream the final report, amalgamating all pooled note-insights into one document."""
        pooled = "\n\n".join(
            f"### {ins.concept}\n{ins.summary}\n"
            + "".join(f"- {p}\n" for p in ins.key_points)
            for ins in insights
        )
        toc = "\n".join(f"- {t}" for t in toc_labels) if toc_labels else "(none)"

        if knowledge_mode == "net_support":
            grounding = "Ground the report in the pooled notes and web context; you may add expert framing."
        else:
            grounding = "Base the report strictly on the pooled notes and their source. Never fabricate."

        edit_note = f"REVISION REQUEST (apply to the whole report): {edit_instruction}\n\n" if edit_instruction else ""
        web_block = f"\n\nWEB CONTEXT:\n{web_context}" if web_context else ""

        system = (
            "You are compiling a student's personal research report from THEIR OWN notes on a paper. "
            "You are given pooled insights (one per note) and the paper's auto-generated table of "
            f"contents. {grounding} Tailor depth to the {familiarity} level.\n\n"
            "Your job: amalgamate, de-duplicate, reorganize, and reword the pooled insights into a "
            "single coherent, textbook-style report that follows the table of contents where it helps. "
            "It should read as the student's distilled understanding, not a list of notes.\n\n"
            "FORMAT (Markdown):\n"
            "- A '# ' title, then '## ' sections.\n"
            "- Flowing prose with **bold** key terms and bullet lists where useful.\n"
            "- LaTeX for math: $...$ and $$...$$.\n"
            "- You MAY include a ```mermaid diagram (plain-text labels, quote labels with parentheses) "
            "or a ```plotly JSON block for real data from the notes.\n"
            "- No [Source: ...] citations."
        )
        user = (
            f"{edit_note}"
            f"PAPER TOPIC: {topic or '(derive from the notes)'}\n\n"
            f"TABLE OF CONTENTS:\n{toc}\n\n"
            f"POOLED NOTE INSIGHTS:\n{pooled or '(no notes yet)'}{web_block}\n\n"
            "Write the full report now."
        )
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        async for token in self._client.stream_complete(messages):
            yield token

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
