"""WebSocket event dispatch table.

Each event branch is self-contained. Adding a new event type means adding
one elif block here — nothing else needs to change.

Singletons (agents, services, db) are module-level so they survive across
requests within one process lifetime.
"""
import asyncio
from typing import Any, Dict

from app.agents.brain_agent import BrainAgent
from app.services.output_cache import OutputCache
from app.agents.evaluator_agent import EvaluatorAgent
from app.agents.infinity_wiki_agent import InfinityWikiAgent
from app.agents.wiki_agent import WikiAgent
from app.agents.tutor_agent import TutorAgent
from app.rag.chromadb_client import ChromaDBClient
from app.rag.ingestion import LIBRARY_COLLECTION
from app.schemas.journal import JournalEntry, JournalEventType
from app.schemas.graph import NodeData
from app.services.graph_state import GraphStateManager
from app.services.journal_service import JournalService
from app.services.student_memory import StudentMemoryService
from app.services.transcription_service import TranscriptionService
from app.services.summary_writer import build_summary_markdown
from app.websockets.connection_manager import ConnectionManager

# All singletons are lazy — nothing loads at import time so uvicorn binds
# to the port immediately. Models and clients initialise on first request.
_cm = ConnectionManager()
_graph_mgr = GraphStateManager()
_journal = JournalService()
_memory = StudentMemoryService()

_db: ChromaDBClient | None = None
_brain: BrainAgent | None = None
_tutor: TutorAgent | None = None
_cache = OutputCache()
_wiki = WikiAgent()


def _get_db() -> ChromaDBClient:
    global _db
    if _db is None:
        _db = ChromaDBClient()
    return _db


def _get_brain() -> BrainAgent:
    global _brain
    if _brain is None:
        _brain = BrainAgent()
    return _brain


def _get_tutor() -> TutorAgent:
    global _tutor
    if _tutor is None:
        _tutor = TutorAgent()
    return _tutor


def get_connection_manager() -> ConnectionManager:
    return _cm


def get_db() -> ChromaDBClient:
    return _get_db()


def get_graph_manager() -> GraphStateManager:
    return _graph_mgr


# ------------------------------------------------------------------ #
# Helpers                                                             #
# ------------------------------------------------------------------ #

async def _get_chunks(session_id: str, query: str, n: int = 5, chunk_type: str | None = None):
    db = _get_db()
    loop = asyncio.get_event_loop()
    embedding = await loop.run_in_executor(None, db.embedder.embed, [query])
    where = {"type": chunk_type} if chunk_type else None
    return db.query(LIBRARY_COLLECTION, embedding[0], n_results=n, where=where)


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
        query = _get_brain().build_rag_query(data.get("node_label", node.label), familiarity)
        chunks = await _get_chunks(session_id, query, n=5)
        selection_text = data.get("selection_text", "")
        anchor_id = data.get("anchor_id") or node_id
        cache_key = _cache.make_key("LEARN_NODE", familiarity, anchor_id, [c["text"] for c in chunks], selection_text)
        cached_lesson = _cache.get(cache_key)
        _journal.append(
            JournalEntry(
                session_id=session_id,
                node_id=node_id,
                event_type=JournalEventType.NODE_OPENED,
                data={"node_label": data.get("node_label"), "cache_hit": cached_lesson is not None},
            )
        )
        if cached_lesson:
            # Replay cached lesson as tokens to preserve streaming UX
            for word in cached_lesson.split(" "):
                await _cm.send(session_id, "LESSON_TOKEN", {"token": word + " "})
            await _cm.send(session_id, "LESSON_DONE", {"visual_suggestion": "canvas"})
        else:
            full_lesson = ""
            async for token in _get_tutor().stream_lesson(node, chunks, familiarity):
                full_lesson += token
                await _cm.send(session_id, "LESSON_TOKEN", {"token": token})
            _cache.put(cache_key, full_lesson)
            await _cm.send(session_id, "LESSON_DONE", {"visual_suggestion": "canvas"})

    # ---- GENERATE_VISUAL ------------------------------------------
    elif event_type == "GENERATE_VISUAL":
        label = data.get("node_label", node_id)
        anim = data.get("animation_type", "canvas")
        anchor_id = data.get("anchor_id") or node_id
        selection_text = data.get("selection_text", "")
        cache_key = _cache.make_key("GENERATE_VISUAL", familiarity, anchor_id, [label, anim], selection_text)
        cached = _cache.get(cache_key)
        if cached:
            await _cm.send(session_id, "VISUAL_PAYLOAD", cached)
        else:
            visual = _get_tutor().generate_visual(label, anim, familiarity)
            payload = visual.model_dump()
            _cache.put(cache_key, payload)
            await _cm.send(session_id, "VISUAL_PAYLOAD", payload)

    # ---- CHAT_TURN -----------------------------------------------
    elif event_type == "CHAT_TURN":
        query = data.get("content", "")
        selection_text = data.get("selection_text", "")
        surrounding_context = data.get("surrounding_context", "")
        chunks = await _get_chunks(session_id, query or selection_text or "context", n=5)
        chunk_ctx = "\n".join(f"[{c.get('source','?')}]: {c['text']}" for c in chunks)
        selection_prefix = ""
        if selection_text:
            selection_prefix = f"Student selected passage:\n\"{selection_text}\"\n"
            if surrounding_context:
                selection_prefix += f"Surrounding context from the document:\n{surrounding_context[:4000]}\n"
            selection_prefix += "\n"
        system_msg = (
            f"{selection_prefix}"
            f"Answer using ONLY this source material. Cite inline. Never fabricate.\n\n{chunk_ctx}"
        )
        messages = [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": query or f"Explain: {selection_text[:200]}"},
        ]
        full_response = ""
        async for token in _get_tutor()._client.stream_complete(messages):
            full_response += token
            await _cm.send(session_id, "CHAT_TOKEN", {"token": token})
        _journal.append(
            JournalEntry(
                session_id=session_id,
                node_id=node_id,
                event_type=JournalEventType.CHAT_TURN,
                data={"role": "student", "content": query, "selection_text": selection_text, "response": full_response},
            )
        )
        await _cm.send(session_id, "CHAT_DONE", {})

    # ---- FLASHCARDS_REQUEST --------------------------------------
    elif event_type == "FLASHCARDS_REQUEST":
        label = data.get("node_label", node_id)
        anchor_id = data.get("anchor_id") or node_id
        selection_text = data.get("selection_text", "")
        chunks = await _get_chunks(session_id, label, n=8, chunk_type="question")
        if not chunks:
            chunks = await _get_chunks(session_id, label, n=8)
        cache_key = _cache.make_key("FLASHCARDS_REQUEST", familiarity, anchor_id, [c["text"] for c in chunks], selection_text)
        cached = _cache.get(cache_key)
        if cached:
            await _cm.send(session_id, "FLASHCARDS_READY", cached)
        else:
            result = _get_tutor().generate_flashcards(label, chunks, familiarity)
            payload = result.model_dump()
            _cache.put(cache_key, payload)
            await _cm.send(session_id, "FLASHCARDS_READY", payload)

    # ---- QUIZ_REQUEST --------------------------------------------
    elif event_type == "QUIZ_REQUEST":
        label = data.get("node_label", node_id)
        anchor_id = data.get("anchor_id") or node_id
        selection_text = data.get("selection_text", "")
        chunks = await _get_chunks(session_id, label, n=8, chunk_type="question")
        if not chunks:
            chunks = await _get_chunks(session_id, label, n=8)
        cache_key = _cache.make_key("QUIZ_REQUEST", familiarity, anchor_id, [c["text"] for c in chunks], selection_text)
        cached = _cache.get(cache_key)
        if cached:
            await _cm.send(session_id, "QUIZ_READY", cached)
        else:
            result = _get_tutor().generate_quiz(label, chunks, familiarity)
            payload = result.model_dump()
            _cache.put(cache_key, payload)
            await _cm.send(session_id, "QUIZ_READY", payload)

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
        familiarity_level = data.get("familiarity", familiarity)
        feynman_persona = {
            "eli5": {
                "name": "Study Buddy (Age 5)",
                "system": (
                    "You are Study Buddy (Age 5), a curious 5-year-old child. When the student explains something, "
                    "ask very simple, innocent questions. Use basic words. Say things like 'But why?' or 'What does that mean?' "
                    "Be very encouraging; only interject if the analogy completely breaks. "
                    "Never reveal answers directly."
                )
            },
            "high_school": {
                "name": "Study Buddy (Age 15)",
                "system": (
                    "You are Study Buddy (Age 15), a high school student learning this for the first time. "
                    "Ask standard conceptual questions. "
                    "Interject on clear factual errors (>40% drift from the text). "
                    "Never reveal answers directly."
                )
            },
            "graduate": {
                "name": "Study Buddy (Age 22)",
                "system": (
                    "You are Study Buddy (Age 22), a college graduate student. "
                    "Ask analytical and technical questions. "
                    "Interject on any technical inaccuracy (>15% drift). "
                    "Never reveal answers directly."
                )
            },
            "expert": {
                "name": "Study Buddy (Age 30)",
                "system": (
                    "You are Study Buddy (Age 30), a junior researcher or peer. "
                    "Ask deep, critical, and rigorous questions. Challenge logic. "
                    "Interject on any invalid logical leaps or unsupported claims. "
                    "Never reveal answers directly."
                )
            }
        }.get(familiarity_level, {
            "name": "Study Buddy (Age 15)",
            "system": "You are Study Buddy (Age 15). Ask questions on this level. Never reveal answers directly."
        })

        messages = [
            {
                "role": "system",
                "content": feynman_persona["system"],
            },
            {"role": "user", "content": data.get("student_text", "")},
        ]
        full = ""
        async for token in _get_tutor()._client.stream_complete(messages):
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

    # ---- FEYNMAN_AUDIO (voice → STT → Feynman turn) ----------------------
    elif event_type == "FEYNMAN_AUDIO":
        stt = TranscriptionService.get()
        audio_b64 = data.get("audio_base64", "")
        if not audio_b64:
            await _cm.send(session_id, "FEYNMAN_DONE", {"error": "no audio"})
        elif not stt.is_available:
            await _cm.send(session_id, "FEYNMAN_DONE", {
                "error": "STT model not available (Canary-Qwen not loaded)"
            })
        else:
            import base64
            audio_bytes = base64.b64decode(audio_b64)
            text = stt.transcribe(audio_bytes)
            if not text:
                await _cm.send(session_id, "FEYNMAN_DONE", {"error": "transcription returned empty"})
            else:
                await _cm.send(session_id, "FEYNMAN_TRANSCRIBED", {"text": text})
                familiarity_level = data.get("familiarity", familiarity)
                feynman_persona = {
                    "eli5": {
                        "name": "Study Buddy (Age 5)",
                        "system": (
                            "You are Study Buddy (Age 5), a curious 5-year-old child. When the student explains something, "
                            "ask very simple, innocent questions. Use basic words. Say things like 'But why?' or 'What does that mean?' "
                            "Be very encouraging; only interject if the analogy completely breaks. "
                            "Never reveal answers directly."
                        )
                    },
                    "high_school": {
                        "name": "Study Buddy (Age 15)",
                        "system": (
                            "You are Study Buddy (Age 15), a high school student learning this for the first time. "
                            "Ask standard conceptual questions. "
                            "Interject on clear factual errors (>40% drift from the text). "
                            "Never reveal answers directly."
                        )
                    },
                    "graduate": {
                        "name": "Study Buddy (Age 22)",
                        "system": (
                            "You are Study Buddy (Age 22), a college graduate student. "
                            "Ask analytical and technical questions. "
                            "Interject on any technical inaccuracy (>15% drift). "
                            "Never reveal answers directly."
                        )
                    },
                    "expert": {
                        "name": "Study Buddy (Age 30)",
                        "system": (
                            "You are Study Buddy (Age 30), a junior researcher or peer. "
                            "Ask deep, critical, and rigorous questions. Challenge logic. "
                            "Interject on any invalid logical leaps or unsupported claims. "
                            "Never reveal answers directly."
                        )
                    }
                }.get(familiarity_level, {
                    "name": "Study Buddy (Age 15)",
                    "system": "You are Study Buddy (Age 15). Ask questions on this level. Never reveal answers directly."
                })

                messages = [
                    {"role": "system", "content": feynman_persona["system"]},
                    {"role": "user", "content": text},
                ]
                full = ""
                async for token in _get_tutor()._client.stream_complete(messages):
                    full += token
                    await _cm.send(session_id, "FEYNMAN_TOKEN", {"token": token})
                _journal.append(JournalEntry(session_id=session_id, node_id=node_id,
                    event_type=JournalEventType.FEYNMAN_TURN,
                    data={"student_text": text, "input_type": "voice", "response": full}))
                await _cm.send(session_id, "FEYNMAN_DONE", {})

    # ---- INFINITY_WIKI_REQUEST -----------------------------------
    elif event_type == "INFINITY_WIKI_REQUEST":
        try:
            wiki = InfinityWikiAgent()
            result = await wiki.deep_dive(data.get("node_label", node_id), familiarity)
        except Exception:
            result = {"video_url": None, "summary": "Deep Dive unavailable — add a YOUTUBE_API_KEY to backend/.env"}
        _journal.append(
            JournalEntry(
                session_id=session_id,
                node_id=node_id,
                event_type=JournalEventType.DEEP_DIVE,
                data=result,
            )
        )
        await _cm.send(session_id, "INFINITY_WIKI_RESULT", result)

    # ---- EVALUATE_SESSION (Push) --------------------------------
    elif event_type == "EVALUATE_SESSION":
        evaluator = EvaluatorAgent(journal_service=_journal)
        patches, _ = evaluator.evaluate_session(session_id)
        for patch in patches:
            _graph_mgr.apply_node_patch(session_id, patch)
            await _cm.send(session_id, "SCORE_PATCH", patch.model_dump())
        await _cm.send(session_id, "EVALUATION_DONE", {"patches": [p.model_dump() for p in patches]})

    # ---- CACHE_CLEAR (dev) -----------------------------------------------
    elif event_type == "CACHE_CLEAR":
        count = _cache.clear()
        await _cm.send(session_id, "CACHE_CLEARED", {"count": count})

    # ---- CONTEXT_CARD_REQUEST (Infinite Wiki) ----------------------------
    elif event_type == "CONTEXT_CARD_REQUEST":
        selection_text = data.get("selection_text", "")
        surrounding_context = data.get("surrounding_context", "")
        familiarity = data.get("familiarity", "high_school")
        parent_context = data.get("parent_context", "")
        anchor_id = f"wiki_{hash(selection_text) & 0xFFFFFF}"
        chunks = await _get_chunks(session_id, selection_text, n=5)
        cache_key = _cache.make_key("CONTEXT_CARD", familiarity, anchor_id, [c["text"] for c in chunks], selection_text)
        cached = _cache.get(cache_key)
        if cached:
            for word in cached.split(" "):
                await _cm.send(session_id, "WIKI_TOKEN", {"token": word + " "})
            await _cm.send(session_id, "WIKI_DONE", {})
        else:
            full = ""
            async for token in _wiki.stream_card(
                selection_text, surrounding_context, chunks, familiarity, parent_context
            ):
                full += token
                await _cm.send(session_id, "WIKI_TOKEN", {"token": token})
            _cache.put(cache_key, full)
            await _cm.send(session_id, "WIKI_DONE", {})

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
