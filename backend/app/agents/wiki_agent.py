"""Wiki Agent — streams grounded context cards for Infinite Wiki drill-downs.

Card format (streamed Markdown):
  ## [Term]
  **Contextual Definition** — what this means in the document's domain
  **Core Extraction** — key facts from the uploaded material
  **Cross-References** — other sections where this appears
"""
from __future__ import annotations

from app.agents.cerebras_client import CerebrasClient

_WIKI_SYSTEM = """You are a grounded knowledge explainer. Explain the selected term/passage
using ONLY the provided source material. Never invent facts.

Structure your response exactly as:
## {term}
**Contextual Definition:** (1-2 sentences, what it means in THIS document's domain)
**Core Extraction:** (bullet facts pulled verbatim from the chunks)
**Cross-References:** (mention other sections/chunks where this appears; if none, say "Not found elsewhere in uploaded material")

Cite inline with [Source: X, chunk N]. Ground every claim. Be concise."""


class WikiAgent:
    def __init__(self) -> None:
        self._client = CerebrasClient()

    async def stream_card(
        self,
        selection_text: str,
        surrounding_context: str,
        chunks: list[dict],
        familiarity: str,
        parent_context: str = "",
    ):
        """Async generator — yields text tokens for the Infinite Wiki card."""
        chunk_text = "\n\n".join(
            f"[Source: {c.get('source', '?')}, chunk {c.get('chunk_index', i)}]\n{c['text']}"
            for i, c in enumerate(chunks)
        )
        parent_note = f"\nDrill-down context: {parent_context[:300]}" if parent_context else ""
        messages = [
            {"role": "system", "content": _WIKI_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"Term/passage to explain: \"{selection_text}\"\n"
                    f"Surrounding text: {surrounding_context[:400]}{parent_note}\n\n"
                    f"Familiarity level: {familiarity}\n\n"
                    f"Source material:\n{chunk_text}"
                ),
            },
        ]
        async for token in self._client.stream_complete(messages):
            yield token
