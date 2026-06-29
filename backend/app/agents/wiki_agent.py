"""Wiki Agent — streams grounded context cards for Infinite Wiki drill-downs.

Card format (streamed Markdown):
  ## [Term]
  **Contextual Definition** — what this means in the document's domain
  **Core Extraction** — key facts from the uploaded material
  **Cross-References** — other sections where this appears
"""
from __future__ import annotations

import os
from app.agents.cerebras_client import CerebrasClient

_WIKI_SYSTEM_CONTENT_ONLY = """You are a grounded knowledge explainer. Explain the selected term/passage
using ONLY the provided source material. Never invent facts.

Structure your response exactly as:
## {term}

**Contextual Definition:** (1-2 sentences, what it means in THIS document's domain)

**Core Extraction:**
* (bullet facts pulled verbatim from the chunks)

**Cross-References:** (mention other sections/chunks where this appears; if none, say "Not found elsewhere in uploaded material")

Cite inline with [Source: X, chunk N]. Ground every claim. Be concise."""

_WIKI_SYSTEM_NET_SUPPORT = """You are a knowledgeable study helper with internet search support.
Explain the selected term/passage.
First, check if the term/passage is discussed in the provided Source material.
- If it IS discussed in the Source material, explain it using the Source material, citing inline with [Source: X, chunk N].
- If it IS NOT discussed or lacks key details in the Source material, use the Web Source material to explain it, citing inline with [Web: Source Title](url).
If both contain useful info, synthesize them, keeping citations clear.

Structure your response exactly as:
## {term}

**Contextual Definition:** (1-2 sentences)

**Core Extraction:**
* (bullet facts from Source material or Web Source material)

**Cross-References:** (mention other sections/chunks from Source material where this appears, or state 'Not found in source material, sourced from Web Search')

Keep citations accurate. Ground every claim. Be concise."""


class WikiAgent:
    def __init__(self) -> None:
        self._client = CerebrasClient()

    async def search_tavily(self, query: str) -> list[dict]:
        api_key = os.getenv("TAVILY_API_KEY", "")
        if not api_key:
            return []
        import httpx
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": api_key,
                        "query": query,
                        "max_results": 3
                    },
                    timeout=5.0
                )
                if resp.status_code == 200:
                    return resp.json().get("results", [])
        except Exception as e:
            print("Tavily search error:", e)
        return []

    async def stream_card(
        self,
        selection_text: str,
        surrounding_context: str,
        chunks: list[dict],
        familiarity: str,
        parent_context: str = "",
        knowledge_mode: str = "content_only",
    ):
        """Async generator — yields text tokens for the Infinite Wiki card."""
        chunk_text = "\n\n".join(
            f"[Source: {c.get('source', '?')}, chunk {c.get('chunk_index', i)}]\n{c['text']}"
            for i, c in enumerate(chunks)
        )
        parent_note = f"\nDrill-down context: {parent_context[:300]}" if parent_context else ""

        # Fetch Tavily results if Net Support is selected
        web_text = ""
        system_prompt = _WIKI_SYSTEM_CONTENT_ONLY

        if knowledge_mode == "net_support":
            system_prompt = _WIKI_SYSTEM_NET_SUPPORT
            tavily_results = await self.search_tavily(selection_text)
            if tavily_results:
                web_text = "\n\n".join(
                    f"[Web Source: {r.get('title')}, URL: {r.get('url')}]\n{r.get('content')}"
                    for r in tavily_results
                )

        # Inject actual selection term into the system prompt structure
        system_prompt = system_prompt.replace("{term}", selection_text)

        user_content = (
            f"Term/passage to explain: \"{selection_text}\"\n"
            f"Surrounding text: {surrounding_context[:400]}{parent_note}\n\n"
            f"Familiarity level: {familiarity}\n\n"
            f"Source material:\n{chunk_text}"
        )

        if web_text:
            user_content += f"\n\nWeb Source material:\n{web_text}"

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]

        async for token in self._client.stream_complete(messages):
            yield token
