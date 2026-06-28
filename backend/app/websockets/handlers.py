"""WebSocket event dispatch table.

Each event branch is self-contained. Adding a new event type means adding
one elif block here — nothing else needs to change.

Singletons (agents, services, db) are module-level so they survive across
requests within one process lifetime.
"""
import asyncio
from typing import Any, Dict

from app.agents.brain_agent import BrainAgent
from app.agents.evaluator_agent import EvaluatorAgent
from app.agents.infinity_wiki_agent import InfinityWikiAgent
from app.agents.tutor_agent import TutorAgent
from app.rag.chromadb_client import ChromaDBClient
from app.schemas.journal import JournalEntry, JournalEventType
from app.schemas.graph import NodeData
from app.services.graph_state import GraphStateManager
from app.services.journal_service import JournalService
from app.services.student_memory import StudentMemoryService
from app.services.summary_writer import build_summary_markdown
from app.websockets.connection_manager import ConnectionManager

# Module-level singletons — replaceable with DI if needed
_cm = ConnectionManager()
_brain = BrainAgent()
_tutor = TutorAgent()
_db = ChromaDBClient()
_graph_mgr = GraphStateManager()
_journal = JournalService()
_memory = StudentMemoryService()


def get_connection_manager() -> ConnectionManager:
    return _cm


def get_db() -> ChromaDBClient:
    return _db


def get_graph_manager() -> GraphStateManager:
    return _graph_mgr


# ------------------------------------------------------------------ #
# Helpers                                                             #
# ------------------------------------------------------------------ #

def _get_chunks(session_id: str, query: str, n: int = 5, chunk_type: str | None = None):
    embedding = _db.embedder.embed([query])
    where = {"type": chunk_type} if chunk_type else None
    return _db.query(session_id, embedding[0], n_results=n, where=where)


def _safe_get_node(session_id: str, node_id: str) -> NodeData:
    try:
        return _graph_mgr.get_node(session_id, node_id)
    except KeyError:
        return NodeData(id=node_id, label=node_id, status="ACTIVE")


# ------------------------------------------------------------------ #
# Dispatch                                                            #
# ------------------------------------------------------------------ #

async def handle_event(session_id: str, event_type: str, data: Dict[str, Any]) -> None:
    node_id: str = data.get("node_id", "")
    familiarity: str = data.get("familiarity", "high_school")

    # ---- LEARN_NODE -----------------------------------------------
    if event_type == "LEARN_NODE":
        node = _safe_get_node(session_id, node_id)
        query = _brain.build_rag_query(data.get("node_label", node.label), familiarity)
        chunks = _get_chunks(session_id, query, n=5)
        lesson = _tutor.generate_lesson(node, chunks, familiarity)
        _journal.append(
            JournalEntry(
                session_id=session_id,
                node_id=node_id,
                event_type=JournalEventType.NODE_OPENED,
                data={"node_label": data.get("node_label")},
            )
        )
        await _cm.send(session_id, "LESSON_PAYLOAD", lesson.model_dump())

    # ---- GENERATE_VISUAL ------------------------------------------
    elif event_type == "GENERATE_VISUAL":
        visual = _tutor.generate_visual(
            data.get("node_label", node_id),
            data.get("animation_type", "canvas"),
            familiarity,
        )
        await _cm.send(session_id, "VISUAL_PAYLOAD", visual.model_dump())

    # ---- CHAT_TURN -----------------------------------------------
    elif event_type == "CHAT_TURN":
        query = data.get("content", "")
        chunks = _get_chunks(session_id, query, n=3)
        context = "\n".join(f"[{c['source']}]: {c['text']}" for c in chunks)
        messages = [
            {
                "role": "system",
                "content": (
                    f"Answer using ONLY this context. Cite sources inline.\n\n{context}"
                ),
            },
            {"role": "user", "content": query},
        ]
        full_response = ""
        async for token in _tutor._client.stream_complete(messages):
            full_response += token
            await _cm.send(session_id, "CHAT_TOKEN", {"token": token})
        _journal.append(
            JournalEntry(
                session_id=session_id,
                node_id=node_id,
                event_type=JournalEventType.CHAT_TURN,
                data={"role": "student", "content": query, "response": full_response},
            )
        )
        await _cm.send(session_id, "CHAT_DONE", {})

    # ---- FLASHCARDS_REQUEST --------------------------------------
    elif event_type == "FLASHCARDS_REQUEST":
        # Prefer question chunks; fall back to content if none found
        chunks = _get_chunks(session_id, data.get("node_label", node_id), n=8, chunk_type="question")
        if not chunks:
            chunks = _get_chunks(session_id, data.get("node_label", node_id), n=8)
        result = _tutor.generate_flashcards(
            data.get("node_label", node_id), chunks, familiarity
        )
        await _cm.send(session_id, "FLASHCARDS_READY", result.model_dump())

    # ---- QUIZ_REQUEST --------------------------------------------
    elif event_type == "QUIZ_REQUEST":
        chunks = _get_chunks(session_id, data.get("node_label", node_id), n=8, chunk_type="question")
        if not chunks:
            chunks = _get_chunks(session_id, data.get("node_label", node_id), n=8)
        result = _tutor.generate_quiz(
            data.get("node_label", node_id), chunks, familiarity
        )
        await _cm.send(session_id, "QUIZ_READY", result.model_dump())

    # ---- FLASHCARD_GRADE -----------------------------------------
    elif event_type == "FLASHCARD_GRADE":
        _journal.append(
            JournalEntry(
                session_id=session_id,
                node_id=node_id,
                event_type=JournalEventType.FLASHCARD_GRADE,
                data=data,
            )
        )

    # ---- QUIZ_SUBMIT ---------------------------------------------
    elif event_type == "QUIZ_SUBMIT":
        _journal.append(
            JournalEntry(
                session_id=session_id,
                node_id=node_id,
                event_type=JournalEventType.QUIZ_SUBMIT,
                data=data,
            )
        )
        await _cm.send(
            session_id,
            "QUIZ_FEEDBACK",
            {"correct": data.get("correct"), "was_correct": data.get("was_correct")},
        )

    # ---- FEYNMAN_TURN --------------------------------------------
    elif event_type == "FEYNMAN_TURN":
        messages = [
            {
                "role": "system",
                "content": (
                    "You are Clara, a curious 8-year-old. When the student explains something, "
                    "ask simple follow-up questions. Never use technical jargon. "
                    "Say things like 'But WHY?' and 'What does that mean?'"
                ),
            },
            {"role": "user", "content": data.get("student_text", "")},
        ]
        full = ""
        async for token in _tutor._client.stream_complete(messages):
            full += token
            await _cm.send(session_id, "FEYNMAN_TOKEN", {"token": token})
        _journal.append(
            JournalEntry(
                session_id=session_id,
                node_id=node_id,
                event_type=JournalEventType.FEYNMAN_TURN,
                data={"student_text": data.get("student_text"), "response": full},
            )
        )
        await _cm.send(session_id, "FEYNMAN_DONE", {})

    # ---- INFINITY_WIKI_REQUEST -----------------------------------
    elif event_type == "INFINITY_WIKI_REQUEST":
        wiki = InfinityWikiAgent()
        result = await wiki.deep_dive(data.get("node_label", node_id), familiarity)
        _journal.append(
            JournalEntry(
                session_id=session_id,
                node_id=node_id,
                event_type=JournalEventType.DEEP_DIVE,
                data=result,
            )
        )
        await _cm.send(session_id, "INFINITY_WIKI_RESULT", result)

    # ---- END_SESSION --------------------------------------------
    elif event_type == "END_SESSION":
        evaluator = EvaluatorAgent(journal_service=_journal)
        patches, session_summary = evaluator.evaluate_session(session_id)

        patched_nodes = []
        for patch in patches:
            node = _graph_mgr.apply_node_patch(session_id, patch)
            patched_nodes.append(node)
            await _cm.send(session_id, "SCORE_PATCH", patch.model_dump())

        journal = _journal.get_session(session_id)
        all_nodes = _graph_mgr.list_nodes(session_id)
        markdown = build_summary_markdown(
            topic=data.get("topic", "Study Session"),
            familiarity=familiarity,
            nodes=all_nodes,
            journal=journal,
            session_summary=session_summary,
        )
        await _cm.send(
            session_id,
            "SESSION_COMPLETE",
            {"markdown": markdown, "patches": [p.model_dump() for p in patches]},
        )
        # Fire-and-forget Cognee push
        asyncio.create_task(
            _memory.push_session(session_id, data.get("topic", ""), journal, patches)
        )
