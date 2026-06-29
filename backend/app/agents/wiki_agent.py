"""Wiki Agent — streams grounded context cards for Infinite Wiki drill-downs.

Card format (streamed Markdown):
  ## [Term]
  **[Familiarity] Summary:** (One-sentence summary matching difficulty level)
  **Core Formulas & Facts:** (3 core facts/formulas)
  **Active-Recall Quiz:** (2 active-recall questions)
"""
from __future__ import annotations

import os
from app.agents.cerebras_client import CerebrasClient

_WIKI_SYSTEM_CONTENT_ONLY = """You are a grounded knowledge explainer. Explain the selected term/passage
using ONLY the provided source material. Never invent facts.
Adopt a complexity level appropriate for a {level} student.

Structure your response exactly as:
## {term}

**{level_label} Summary:**
(One-sentence summary of the concept/passage using language suited for a {level} level student)

**Core Formulas & Facts:**
* (core fact/formula 1 from the source chunks)
* (core fact/formula 2 from the source chunks)
* (core fact/formula 3 from the source chunks)

**Active-Recall Quiz:**
* Question 1: (Conceptual active-recall question based purely on this concept, matching the {level} difficulty)
* Question 2: (Another active-recall question)

Cite inline with [Source: X, chunk N]. Ground every claim. Be concise."""

_WIKI_SYSTEM_NET_SUPPORT = """You are a knowledgeable study helper with internet search support.
Explain the selected term/passage.
Adopt a complexity level appropriate for a {level} student.

First, check if the term/passage is discussed in the provided Source material.
- If it IS discussed in the Source material, explain it using the Source material, citing inline with [Source: X, chunk N].
- If it IS NOT discussed or lacks key details in the Source material, use the Web Source material to explain it, citing inline with [Web: Source Title](url).
If both contain useful info, synthesize them, keeping citations clear.

Structure your response exactly as:
## {term}

**{level_label} Summary:**
(One-sentence summary of the concept/passage using language suited for a {level} level student)

**Core Formulas & Facts:**
* (core fact/formula 1 from the source chunks or web results)
* (core fact/formula 2 from the source chunks or web results)
* (core fact/formula 3 from the source chunks or web results)

**Active-Recall Quiz:**
* Question 1: (Conceptual active-recall question based purely on this concept, matching the {level} difficulty)
* Question 2: (Another active-recall question)

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
        
        system_prompt = _WIKI_SYSTEM_NET_SUPPORT if knowledge_mode == "net_support" else _WIKI_SYSTEM_CONTENT_ONLY

        if knowledge_mode == "net_support":
            tavily_results = await self.search_tavily(selection_text)
            if tavily_results:
                web_text = "\n\n".join(
                    f"[Web Source: {r.get('title')}, URL: {r.get('url')}]\n{r.get('content')}"
                    for r in tavily_results
                )

        # Resolve complexity level names and labels dynamically
        level_name = {
            "eli5": "5-year old",
            "high_school": "high school",
            "graduate": "graduate university",
            "expert": "expert research specialist"
        }.get(familiarity, "high school")
        
        level_label = {
            "eli5": "ELI5",
            "high_school": "High School",
            "graduate": "Graduate",
            "expert": "Expert"
        }.get(familiarity, "High School")

        # Inject actual selection term and level variables into the system prompt structure
        system_prompt = system_prompt.replace("{term}", selection_text)
        system_prompt = system_prompt.replace("{level}", level_name)
        system_prompt = system_prompt.replace("{level_label}", level_label)

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
