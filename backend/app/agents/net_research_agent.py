"""Net Research Agent -> decomposes a chat question into independent research
sub-agents so distinct entities/topics never get conflated in one search.

Pattern: plan() decides IF the question needs the web and, if it involves 2+
distinct people/entities/topics that could be confused with each other,
produces one sub_query per entity. research_subquery() then runs each
sub-agent in isolation -> its own Tavily search, its own grounded summary,
blind to the other sub-agents' results. The caller (CHAT_TURN) fans these
out concurrently and folds the labeled findings back into the main agent's
synthesis call, which is the only step that sees all of them together.
"""
from typing import Any, Awaitable, Callable, List, Optional

from pydantic import BaseModel, Field

from app.agents.cerebras_client import CerebrasClient


class SubQuery(BaseModel):
    entity_label: str = Field(
        description="Short, disambiguated label for this specific person/entity/topic "
                    "(e.g. 'Michael Jordan (NBA player)', not just 'Michael Jordan')"
    )
    search_query: str = Field(
        description="A specific, disambiguated web search query for just this entity/topic -> "
                    "include distinguishing context so it can't be confused with the others"
    )


class ResearchPlan(BaseModel):
    needs_web: bool = Field(
        description="True if answering requires external/current facts not in the uploaded material"
    )
    sub_queries: List[SubQuery] = Field(
        default_factory=list,
        description="One entry per DISTINCT entity/topic that needs its own independent search. "
                    "2+ entries if the question involves multiple different people/things that "
                    "could be confused with each other (e.g. two people sharing a name, or a "
                    "comparison between two subjects) -> otherwise at most 1 entry. Empty if "
                    "needs_web is False.",
    )


class SubAgentFinding(BaseModel):
    entity_label: str
    summary: str = Field(
        description="3-5 sentence grounded summary of the key facts from the search results, "
                    "about ONLY this entity/topic -> do not mention anything outside its scope"
    )


class NetResearchAgent:
    def __init__(self, client: Optional[CerebrasClient] = None) -> None:
        self._client = client or CerebrasClient()

    def plan(self, query: str, context: str = "") -> ResearchPlan:
        """Decide whether the question needs the web, and whether it must be split into
        independent per-entity searches to avoid conflating distinct people/topics."""
        context_note = f"\nAdditional context: {context[:500]}" if context else ""
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a research planner. Given a student's question, decide:\n"
                    "1. needs_web: does answering this require external/current facts (not just "
                    "reasoning or the student's own uploaded material)?\n"
                    "2. sub_queries: if the question involves 2 or more DISTINCT people, entities, "
                    "or topics that could be confused with each other (e.g. two people who share a "
                    "name, a comparison between two things), produce ONE sub_query per entity, each "
                    "with enough disambiguating context in the search_query that an independent "
                    "search on it alone won't accidentally pull in the other entity's information. "
                    "If there's only one entity/topic (the common case), produce at most one "
                    "sub_query. If needs_web is False, sub_queries must be empty."
                ),
            },
            {"role": "user", "content": f"Question: {query}{context_note}"},
        ]
        return self._client.structured_complete(messages, ResearchPlan)

    async def research_subquery(
        self, sub_query: SubQuery, search_fn: Callable[[str], Awaitable[List[dict]]]
    ) -> SubAgentFinding:
        """One isolated sub-agent: searches for and summarizes ONLY its own entity/topic,
        with no visibility into any other sub-agent's query or results."""
        import asyncio

        results = await search_fn(sub_query.search_query)
        if not results:
            return SubAgentFinding(
                entity_label=sub_query.entity_label,
                summary=f"No web results found for {sub_query.entity_label}.",
            )
        context = "\n\n".join(
            f"[{r.get('title', '?')}]({r.get('url', '')})\n{r.get('content', '')}" for r in results
        )
        messages = [
            {
                "role": "system",
                "content": (
                    f"You are a focused research sub-agent. You were asked ONLY about "
                    f"'{sub_query.entity_label}'. Summarize the key facts from the search results "
                    "below that are relevant to THIS specific entity/topic only. Do not discuss "
                    "anything else, even if the results mention other entities. Be concise. "
                    "Ground every claim in the results -> never invent facts."
                ),
            },
            {
                "role": "user",
                "content": f"Search results for \"{sub_query.search_query}\":\n\n{context}",
            },
        ]
        loop = asyncio.get_event_loop()
        finding: SubAgentFinding = await loop.run_in_executor(
            None, lambda: self._client.structured_complete(messages, SubAgentFinding)
        )
        finding.entity_label = sub_query.entity_label  # keep the planner's label, not a re-derived one
        return finding
