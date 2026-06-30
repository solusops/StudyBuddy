"""WebSocket event dispatch table.

Each event branch is self-contained. Adding a new event type means adding
one elif block here — nothing else needs to change.

Singletons (agents, services, db) are module-level so they survive across
requests within one process lifetime.
"""
import asyncio
import json
from typing import Any, Dict

from app.agents.brain_agent import BrainAgent
from app.services.output_cache import OutputCache
from app.agents.evaluator_agent import EvaluatorAgent
from app.agents.infinity_wiki_agent import InfinityWikiAgent
from app.agents.modality_router import ModalityRouter
from app.agents.report_agent import ReportAgent
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
from app.services.scholar_service import fetch_top_papers
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
_router: ModalityRouter | None = None
_report: ReportAgent | None = None
_cache = OutputCache()
_wiki = WikiAgent()

from app.services.annotation_service import AnnotationService
from app.services.memory_service import MemoryService
_annotations = AnnotationService()
# Local memory: ephemeral per-PDF report clusters + persistent learning trajectory.
_local_mem = MemoryService()

# Tool the chat model may call to fetch live web context (executed via WikiAgent.search_tavily).
_WEB_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": (
            "Search the web for current or external information that is NOT in the student's "
            "uploaded material. Use when the question needs recent facts, external definitions, "
            "or context beyond the source documents."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The web search query."},
            },
            "required": ["query"],
        },
    },
}


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


def _get_router() -> ModalityRouter:
    global _router
    if _router is None:
        _router = ModalityRouter()
    return _router


def _get_report() -> ReportAgent:
    global _report
    if _report is None:
        _report = ReportAgent()
    return _report


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
    
    # Scope query to exactly this session_id so content from other sessions doesn't bleed.
    filters = [{"session_id": session_id}]
    if chunk_type:
        filters.append({"type": chunk_type})
    where = {"$and": filters} if len(filters) > 1 else filters[0]
    
    return db.query(LIBRARY_COLLECTION, embedding[0], n_results=n, where=where)


def _safe_get_node(session_id: str, node_id: str) -> NodeData:
    try:
        return _graph_mgr.get_node(session_id, node_id)
    except KeyError:
        return NodeData(id=node_id, label=node_id, status="ACTIVE")


def _read_session_structure() -> str:
    """Concatenate document structure (headings/first pages) of the uploaded content."""
    import os
    from app.rag.ingestion import extract_document_structure
    from app.services.settings_service import get_content_folder

    folder = get_content_folder() or os.path.expanduser("~/.studybuddy/uploads")
    if not os.path.isdir(folder):
        return ""
    parts = []
    for name in os.listdir(folder):
        if not name.lower().endswith((".pdf", ".docx", ".txt")):
            continue
        try:
            with open(os.path.join(folder, name), "rb") as f:
                content = f.read()
            parts.append(f"Document: {name}\n{extract_document_structure(content, name)[:3000]}")
        except Exception:
            continue
    return "\n\n---\n\n".join(parts)[:10000]


async def _replay_doc_graph(session_id: str, nodes: list, edges: list) -> None:
    """Stream a previously-built graph from cache (keeps the pop-in animation, no LLM calls)."""
    _graph_mgr.set_graph(session_id, nodes)
    # Order root → sections → deeper so children always attach to an existing parent.
    for n in sorted(nodes, key=lambda x: x.depth):
        await _cm.send(session_id, "GRAPH_NODE_ADDED", n.model_dump())
        await asyncio.sleep(0.05)  # small stagger so the cascade still reads as "fireworks"
    for e in edges:
        await _cm.send(session_id, "GRAPH_EDGE_ADDED", e)
    await _cm.send(session_id, "GRAPH_BUILD_DONE", {"count": len(nodes), "reused": True})


async def _compile_report(session_id: str, data: Dict[str, Any]) -> None:
    """Per-PDF report: process each note statelessly in parallel, pool the insights, then
    stream a synthesized, reworded report. A report edit re-synthesizes from the cached pool.
    """
    from app.agents.report_agent import NoteInsight

    document_id = data.get("document_id", "")
    topic = data.get("topic", "")
    familiarity = data.get("familiarity", "high_school")
    knowledge_mode = data.get("knowledge_mode", "content_only")
    edit_instruction = data.get("edit_instruction", "")
    loop = asyncio.get_event_loop()

    # Edit path: re-synthesize from the per-PDF memory cluster (no note reprocessing).
    insights: list = []
    if edit_instruction and _local_mem.read_cluster(document_id):
        insights = [NoteInsight(**d) for d in _local_mem.read_cluster(document_id)]
    else:
        # Fresh compile — clear any stale cluster for this PDF first.
        _local_mem.flush_cluster(document_id)
        notes = _annotations.get_for_document(document_id) if document_id else []
        if not notes:
            await _cm.send(session_id, "REPORT_TOKEN", {"token":
                "_No notes yet. Highlight passages and add margin notes, or pin figures/formulas, "
                "then compile the report._"})
            await _cm.send(session_id, "REPORT_DONE", {})
            return

        await _cm.send(session_id, "REPORT_PROGRESS", {"done": 0, "total": len(notes), "stage": "reading notes"})

        async def proc(idx: int, note) -> Optional[NoteInsight]:
            snippet_text = " ".join(s.text for s in note.target_snippets)
            query = snippet_text or note.note_text or topic or "overview"
            chunks = await _get_chunks(session_id, query, n=3)
            ctx = "\n".join(c["text"] for c in chunks)
            extracted = note.note_text if note.image_base64 else ""
            try:
                ins = await loop.run_in_executor(
                    None, _get_report().process_note,
                    note.note_text or "", snippet_text, ctx, familiarity, extracted,
                )
            except Exception as e:
                print("process_note error:", e)
                ins = None
            await _cm.send(session_id, "REPORT_PROGRESS",
                           {"done": idx + 1, "total": len(notes), "stage": "reading notes"})
            return ins

        results = await asyncio.gather(*(proc(i, n) for i, n in enumerate(notes)))
        insights = [r for r in results if r]
        # Persist each processed note-insight to this PDF's ephemeral memory cluster.
        _local_mem.push_insights(document_id, [r.model_dump() for r in insights])

    web_context = ""
    if knowledge_mode == "net_support" and topic:
        wr = await _wiki.search_tavily(topic)
        if wr:
            web_context = "\n\n".join(f"[Web: {r.get('title')}]\n{r.get('content')}" for r in wr)

    toc_labels = [n.label for n in _graph_mgr.list_nodes(session_id)]
    await _cm.send(session_id, "REPORT_PROGRESS", {"done": 1, "total": 1, "stage": "writing report"})

    full = ""
    async for token in _get_report().synthesize_report(
        insights, topic, toc_labels, familiarity,
        knowledge_mode=knowledge_mode, edit_instruction=edit_instruction, web_context=web_context,
    ):
        full += token
        await _cm.send(session_id, "REPORT_TOKEN", {"token": token})
    await _cm.send(session_id, "REPORT_DONE", {})

    # Attach a grounded visual to the report if warranted.
    try:
        decision = await loop.run_in_executor(None, _get_router().classify, topic or "report", full, [], familiarity)
        if decision.modality != "NONE":
            ctx_chunks = [{"source": "report", "text": full}]
            if decision.modality == "STATIC_PLOT":
                visual = await loop.run_in_executor(None, _get_tutor().generate_plot, topic or "report", ctx_chunks, familiarity)
            else:
                anim = "three.js" if decision.recommended_tool == "Three.js" else "canvas"
                visual = await loop.run_in_executor(None, _get_tutor().generate_visual, topic or "report", anim, familiarity, ctx_chunks)
            await _cm.send(session_id, "REPORT_SECTION_VISUAL", {"section_id": "compiled", "visual": visual.model_dump()})
    except Exception as e:
        print("Report visual error:", e)


async def _build_graph_streaming(session_id: str, familiarity: str, topic: str, document_id: str = "") -> None:
    """Root-first, then parallel section expansion. Streams each node/edge as it resolves.

    If a graph was already built for this document, it is REPLAYED from cache (no LLM
    calls). Falls back to a single-call tree if the streaming path fails.
    """
    loop = asyncio.get_event_loop()

    # Reuse: a graph already exists for this PDF → replay it instead of regenerating.
    cached = _graph_mgr.load_doc_graph(document_id)
    if cached:
        await _replay_doc_graph(session_id, cached[0], cached[1])
        return

    structure = await loop.run_in_executor(None, _read_session_structure)
    if not structure:
        await _cm.send(session_id, "GRAPH_BUILD_DONE", {"count": 0})
        return

    try:
        rs = await loop.run_in_executor(
            None, _get_brain().derive_root_and_sections, structure, familiarity, topic, ""
        )
        nodes: list[NodeData] = []
        edges: list = []

        root = NodeData(
            id="n0", label=rs.root_label or (topic or "Topic"),
            description=rs.root_description, depth=0, complexity=3,
            parent_id=None, status="ACTIVE",
        )
        nodes.append(root)
        _graph_mgr.add_node(session_id, root)
        await _cm.send(session_id, "GRAPH_NODE_ADDED", root.model_dump())

        section_nodes: list[NodeData] = []
        for i, s in enumerate(rs.sections):
            sid = f"s{i + 1}"
            sn = NodeData(
                id=sid, label=s.label, description=s.description, depth=1,
                complexity=s.complexity, parent_id="n0", status="ACTIVE",
            )
            section_nodes.append(sn)
            nodes.append(sn)
            _graph_mgr.add_node(session_id, sn)
            await _cm.send(session_id, "GRAPH_NODE_ADDED", sn.model_dump())
            edge = {"source": "n0", "target": sid, "relationship": "prerequisite"}
            edges.append(edge)
            await _cm.send(session_id, "GRAPH_EDGE_ADDED", edge)

        async def expand(sn: NodeData) -> tuple:
            try:
                exp = await loop.run_in_executor(
                    None, _get_brain().expand_section, sn.label, structure, familiarity
                )
                children = exp.children
            except Exception as e:
                print("expand_section error:", e)
                children = []
            out_nodes: list[NodeData] = []
            out_edges: list = []
            for j, ch in enumerate(children):
                cid = f"{sn.id}c{j + 1}"
                cn = NodeData(
                    id=cid, label=ch.label, description=ch.description, depth=sn.depth + 1,
                    complexity=ch.complexity, parent_id=sn.id, status="ACTIVE",
                )
                out_nodes.append(cn)
                _graph_mgr.add_node(session_id, cn)
                await _cm.send(session_id, "GRAPH_NODE_ADDED", cn.model_dump())
                e = {"source": sn.id, "target": cid, "relationship": ch.relationship}
                out_edges.append(e)
                await _cm.send(session_id, "GRAPH_EDGE_ADDED", e)
            return out_nodes, out_edges

        results = await asyncio.gather(*(expand(sn) for sn in section_nodes))
        for child_nodes, child_edges in results:
            nodes.extend(child_nodes)
            edges.extend(child_edges)

        _graph_mgr.set_graph(session_id, nodes)
        _graph_mgr.save_doc_graph(document_id, nodes, edges)  # persist for reuse across sessions
        await _cm.send(session_id, "GRAPH_BUILD_DONE", {"count": len(nodes)})
    except Exception as e:
        print("BUILD_GRAPH streaming failed, falling back to single-call:", e)
        try:
            overviews = [{"filename": "content", "structure_text": structure}]
            nodes, edges = await loop.run_in_executor(
                None, _get_brain().extract_curriculum_from_documents, overviews, familiarity, topic, ""
            )
            _graph_mgr.set_graph(session_id, nodes)
            _graph_mgr.save_doc_graph(document_id, nodes, edges)
            for n in nodes:
                await _cm.send(session_id, "GRAPH_NODE_ADDED", n.model_dump())
            for e2 in edges:
                await _cm.send(session_id, "GRAPH_EDGE_ADDED", e2)
            await _cm.send(session_id, "GRAPH_BUILD_DONE", {"count": len(nodes)})
        except Exception as e3:
            print("BUILD_GRAPH fallback also failed:", e3)
            await _cm.send(session_id, "GRAPH_BUILD_DONE", {"count": 0})



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
        knowledge_mode = data.get("knowledge_mode", "content_only")

        # Fetch Tavily web results if Net Support is enabled
        web_context = ""
        if knowledge_mode == "net_support":
            tavily_results = await _wiki.search_tavily(data.get("node_label", node.label))
            if tavily_results:
                web_context = "\n\n".join(
                    f"[Web: {r.get('title')} — {r.get('url')}]\n{r.get('content')}"
                    for r in tavily_results
                )

        cache_key = _cache.make_key(
            "LEARN_NODE", familiarity, anchor_id, [c["text"] for c in chunks],
            f"{selection_text}|{knowledge_mode}|{web_context[:100]}"
        )
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
            async for token in _get_tutor().stream_lesson(
                node, chunks, familiarity, knowledge_mode=knowledge_mode, web_context=web_context
            ):
                full_lesson += token
                await _cm.send(session_id, "LESSON_TOKEN", {"token": token})
            _cache.put(cache_key, full_lesson)
            await _cm.send(session_id, "LESSON_DONE", {"visual_suggestion": "canvas"})

    # ---- BUILD_GRAPH (parallel curriculum streaming — "fireworks") ------
    elif event_type == "BUILD_GRAPH":
        await _build_graph_streaming(
            session_id,
            familiarity,
            data.get("topic", ""),
            data.get("document_id", ""),
        )

    # ---- REPORT_COMPILE (notes → per-PDF report, launched from the graph window) ----
    elif event_type == "REPORT_COMPILE":
        await _compile_report(session_id, data)

    # ---- REPORT_CLOSE — flush the ephemeral per-PDF report memory cluster ----
    elif event_type == "REPORT_CLOSE":
        _local_mem.flush_cluster(data.get("document_id", ""))

    # ---- REPORT_REQUEST / REPORT_EDIT (per-highlight section — legacy panel mode) ----
    elif event_type in ("REPORT_REQUEST", "REPORT_EDIT"):
        section_id = data.get("section_id", "")
        topic = data.get("selection_text") or data.get("topic", "")
        context_text = data.get("surrounding_context", "")
        knowledge_mode = data.get("knowledge_mode", "content_only")
        edit_instruction = data.get("edit_instruction", "") if event_type == "REPORT_EDIT" else ""
        chunks = await _get_chunks(session_id, topic or "overview", n=5)

        web_context = ""
        if knowledge_mode == "net_support":
            results = await _wiki.search_tavily(topic)
            if results:
                web_context = "\n\n".join(
                    f"[Web: {r.get('title')} — {r.get('url')}]\n{r.get('content')}" for r in results
                )

        full = ""
        async for token in _get_report().stream_section(
            topic, context_text, chunks, familiarity,
            knowledge_mode=knowledge_mode, edit_instruction=edit_instruction, web_context=web_context,
        ):
            full += token
            await _cm.send(session_id, "REPORT_TOKEN", {"section_id": section_id, "token": token})
        await _cm.send(session_id, "REPORT_DONE", {"section_id": section_id})

        # Background: attach a grounded visual if the section warrants one.
        try:
            loop = asyncio.get_event_loop()
            decision = await loop.run_in_executor(
                None, _get_router().classify, topic, full, chunks, familiarity
            )
            if decision.modality != "NONE":
                ctx_chunks = [{"source": "report section", "text": full}] + chunks
                if decision.modality == "STATIC_PLOT":
                    visual = await loop.run_in_executor(
                        None, _get_tutor().generate_plot, topic, ctx_chunks, familiarity
                    )
                else:
                    anim = "three.js" if decision.recommended_tool == "Three.js" else "canvas"
                    visual = await loop.run_in_executor(
                        None, _get_tutor().generate_visual, topic, anim, familiarity, ctx_chunks
                    )
                await _cm.send(session_id, "REPORT_SECTION_VISUAL", {
                    "section_id": section_id, "visual": visual.model_dump(),
                })
        except Exception as e:
            print("Report section visual error:", e)

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
    elif event_type == "WIKI_RECALL_GENERATE":
        selection_text = data.get("selection_text", "")
        familiarity = data.get("familiarity", "high_school")
        card_content = data.get("card_content", "")
        
        async for token in _wiki.stream_recall_quiz(selection_text, card_content, familiarity):
            await _cm.send(session_id, "WIKI_TOKEN", {"token": token})
        await _cm.send(session_id, "WIKI_DONE", {})

    elif event_type == "CHAT_TURN":
        query = data.get("content", "")
        selection_text = data.get("selection_text", "")
        surrounding_context = data.get("surrounding_context", "")
        knowledge_mode = data.get("knowledge_mode", "content_only")
        chunks = await _get_chunks(session_id, query or selection_text or "context", n=5)
        chunk_ctx = "\n".join(f"[{c.get('source','?')}]: {c['text']}" for c in chunks)
        selection_img = data.get("selection_image_base64")
        selection_prefix = ""
        if selection_text or selection_img:
            selection_prefix = "The student has provided a specific selection (image and/or text) from the document.\n"
            selection_prefix += "CRITICAL INSTRUCTION: Your primary task is to explain and address THIS specific selection directly. Do NOT just summarize the general SOURCE MATERIAL. Use the SOURCE MATERIAL only to provide supporting context for the selection.\n\n"
            if selection_text:
                selection_prefix += f"Student selected text:\n\"{selection_text}\"\n"
            if surrounding_context:
                selection_prefix += f"Surrounding context:\n{surrounding_context[:4000]}\n"
            selection_prefix += "\n"

        _CHAT_FORMATTING = (
            "Formatting:\n"
            "- Write math in LaTeX: inline $...$ and display $$...$$.\n"
            "- Use GitHub-style Markdown tables (a header row, then a |---|---| separator row).\n"
            "- For structural concepts you MAY add a ```mermaid fenced diagram. IMPORTANT: Mermaid "
            "does NOT render math — use PLAIN-TEXT node labels only, with no $...$ and no backslash "
            "commands (write 'theta', 'gradient of loss', 'nabla L' — never '$\\nabla \\ell$'). "
            "ALWAYS wrap a node label in double quotes if it contains parentheses or symbols, "
            "e.g. B[\"Low Memory Cost: O(n)\"].\n"
            "- For concrete numeric data you MAY add a ```plotly fenced JSON spec "
            "{\"data\":[...],\"layout\":{...}} (real numbers only — never invent data).\n\n"
        )

        loop = asyncio.get_event_loop()
        full_response = ""

        if knowledge_mode == "net_support":
            # Hybrid tutor: source-anchored, but free to use web + expert knowledge.
            system_msg = (
                "You are Study Buddy, an expert research tutor helping a student understand a paper "
                "they uploaded. Be genuinely helpful and substantive — explain, define, give intuition, "
                "analogies, and worked reasoning. Tailor the depth to the "
                f"{familiarity} level.\n\n"
                f"{selection_prefix}"
                "Use the SOURCE MATERIAL below as your primary anchor when it is relevant. You may ALSO "
                "use your own expert knowledge, and call the web_search tool for facts, recent "
                "information, or external definitions that are not in the material.\n\n"
                "Attribution rules:\n"
                "- A fact from the student's material → cite inline like [Source: <label>].\n"
                "- A fact from the web → cite the title/URL it came from.\n"
                "- Explaining from general expertise → just explain it clearly; no citation needed.\n"
                "- NEVER invent a citation or attribute a claim to the source if it is not there.\n\n"
                f"{_CHAT_FORMATTING}"
                f"SOURCE MATERIAL:\n{chunk_ctx}"
            )
            user_content = query or f"Explain: {selection_text[:200] if selection_text else 'this image'}"
            if selection_img:
                user_msg = {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_content},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{selection_img}"}}
                    ]
                }
            else:
                user_msg = {"role": "user", "content": user_content}

            history_msgs = data.get("history", [])
            messages = [{"role": "system", "content": system_msg}]
            for h in history_msgs[-10:]:
                role = "user" if h.get("role") in ("student", "user") else "assistant"
                messages.append({"role": role, "content": h.get("content", "")})
            messages.append(user_msg)
            # Let the model decide whether it needs the web (tool-calling, "auto when helpful").
            decision = await loop.run_in_executor(
                None,
                lambda: _get_tutor()._client.complete_with_tools(messages, [_WEB_SEARCH_TOOL]),
            )
            tool_calls = getattr(decision, "tool_calls", None)
            if tool_calls:
                await _cm.send(session_id, "CHAT_TOOL", {"tool": "web_search", "status": "running"})
                messages.append({
                    "role": "assistant",
                    "content": decision.content or "",
                    "tool_calls": [
                        {"id": tc.id, "type": "function",
                         "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                        for tc in tool_calls
                    ],
                })
                for tc in tool_calls:
                    try:
                        args = json.loads(tc.function.arguments or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    results = await _wiki.search_tavily(args.get("query", query or selection_text))
                    web_text = "\n\n".join(
                        f"[Web: {r.get('title')} — {r.get('url')}]\n{r.get('content')}" for r in results
                    ) or "No web results found."
                    messages.append({"role": "tool", "tool_call_id": tc.id, "content": web_text})
                async for token in _get_tutor()._client.stream_complete(messages):
                    full_response += token
                    await _cm.send(session_id, "CHAT_TOKEN", {"token": token})
            else:
                # No tool needed — the decision call already produced the full answer; replay as tokens.
                full_response = decision.content or ""
                for word in full_response.split(" "):
                    await _cm.send(session_id, "CHAT_TOKEN", {"token": word + " "})
        else:
            # content_only mode: strictly grounded in the uploaded material, no web, no outside facts.
            system_msg = (
                "You are Study Buddy, helping a student understand a paper they uploaded, at the "
                f"{familiarity} level.\n\n"
                f"{selection_prefix}"
                "Answer using ONLY the SOURCE MATERIAL below. Cite inline like [Source: <label>]. "
                "If the material does not contain the answer, say so plainly and point to the nearest "
                "relevant part — never fabricate facts or pull from outside knowledge.\n\n"
                f"{_CHAT_FORMATTING}"
                f"SOURCE MATERIAL:\n{chunk_ctx}"
            )
            user_content = query or f"Explain: {selection_text[:200] if selection_text else 'this image'}"
            if selection_img:
                user_msg = {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_content},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{selection_img}"}}
                    ]
                }
            else:
                user_msg = {"role": "user", "content": user_content}

            history_msgs = data.get("history", [])
            messages = [{"role": "system", "content": system_msg}]
            for h in history_msgs[-10:]:
                role = "user" if h.get("role") in ("student", "user") else "assistant"
                messages.append({"role": role, "content": h.get("content", "")})
            messages.append(user_msg)
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
            
        images_base64 = []
        doc_ids = {c["document_id"] for c in chunks if "document_id" in c}
        if doc_ids:
            from app.routers.regions import _load_region_cache
            for did in doc_ids:
                cache = _load_region_cache(did)
                for page_regions in cache.values():
                    for r in page_regions:
                        if r.get("crop_base64"):
                            images_base64.append(r["crop_base64"])
        images_base64 = images_base64[:10]  # Cap to prevent context blowup

        cache_key = _cache.make_key("FLASHCARDS_REQUEST", familiarity, anchor_id, [c["text"] for c in chunks], selection_text)
        cached = _cache.get(cache_key)
        if cached:
            await _cm.send(session_id, "FLASHCARDS_READY", cached)
        else:
            result = _get_tutor().generate_flashcards(label, chunks, familiarity, images_base64=images_base64)
            payload = result.model_dump()
            payload["context_images"] = images_base64
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
            
        images_base64 = []
        doc_ids = {c["document_id"] for c in chunks if "document_id" in c}
        if doc_ids:
            from app.routers.regions import _load_region_cache
            for did in doc_ids:
                cache = _load_region_cache(did)
                for page_regions in cache.values():
                    for r in page_regions:
                        if r.get("crop_base64"):
                            images_base64.append(r["crop_base64"])
        images_base64 = images_base64[:10]  # Cap to prevent context blowup

        cache_key = _cache.make_key("QUIZ_REQUEST", familiarity, anchor_id, [c["text"] for c in chunks], selection_text)
        cached = _cache.get(cache_key)
        if cached:
            await _cm.send(session_id, "QUIZ_READY", cached)
        else:
            result = _get_tutor().generate_quiz(label, chunks, familiarity, images_base64=images_base64)
            payload = result.model_dump()
            payload["context_images"] = images_base64
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
        document_id = data.get("document_id", "")
        evaluator = EvaluatorAgent(journal_service=_journal)
        loop = asyncio.get_event_loop()
        patches, assessments, _ = await loop.run_in_executor(
            None, evaluator.evaluate_session, session_id
        )
        for patch in patches:
            _graph_mgr.apply_node_patch(session_id, patch)
            await _cm.send(session_id, "SCORE_PATCH", patch.model_dump())
        for a in assessments:
            payload = a.model_dump()
            await _cm.send(session_id, "NODE_ASSESSMENT", payload)
            # Persist the reasoned snapshot to the long-running trajectory memory.
            _local_mem.append_trajectory(document_id, payload)
        await _cm.send(session_id, "EVALUATION_DONE", {"patches": [p.model_dump() for p in patches]})

    # ---- PROGRESS_REQUEST (deterministic activity tally) -----------------
    elif event_type == "PROGRESS_REQUEST":
        from app.services.progress_service import compute_progress
        progress = compute_progress(_journal.get_session(session_id))
        await _cm.send(session_id, "PROGRESS_UPDATE", {"nodes": list(progress.values())})

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
        knowledge_mode = data.get("knowledge_mode", "content_only")
        anchor_id = f"wiki_{hash(selection_text) & 0xFFFFFF}"
        chunks = await _get_chunks(session_id, selection_text, n=5)
        cache_key = _cache.make_key("CONTEXT_CARD", familiarity, anchor_id, [c["text"] for c in chunks], selection_text)
        cached = _cache.get(cache_key)
        if cached:
            for word in cached.split(" "):
                await _cm.send(session_id, "WIKI_TOKEN", {"token": word + " "})
            await _cm.send(session_id, "WIKI_DONE", {})
            full = cached
        else:
            full = ""
            async for token in _wiki.stream_card(
                selection_text, surrounding_context, chunks, familiarity, parent_context, knowledge_mode
            ):
                full += token
                await _cm.send(session_id, "WIKI_TOKEN", {"token": token})
            _cache.put(cache_key, full)
            await _cm.send(session_id, "WIKI_DONE", {})

        # ---- Further Reading (OpenAlex) — only in net_support mode ----
        if knowledge_mode == "net_support":
            try:
                papers = await fetch_top_papers(selection_text, n=3)
                if papers:
                    await _cm.send(session_id, "WIKI_FURTHER_READING", {
                        "term": selection_text,
                        "papers": papers,
                    })
            except Exception as e:
                print("Error fetching further reading:", e)

        # ---- Modality Router: decide whether a visual is worth OFFERING ----
        # The visual itself is generated lazily (on button click) via WIKI_VISUAL_GENERATE,
        # grounded in this card's content. Here we only classify and offer the button.
        try:
            loop = asyncio.get_event_loop()
            decision = await loop.run_in_executor(
                None,
                _get_router().classify,
                selection_text,
                full,
                chunks,
                familiarity,
            )
            if decision.modality != "NONE":
                label = "Data Plot" if decision.modality == "STATIC_PLOT" else "Interactive Simulation"
                await _cm.send(session_id, "WIKI_VISUAL_AVAILABLE", {
                    "term": selection_text,
                    "modality": decision.modality,
                    "recommended_tool": decision.recommended_tool,
                    "label": label,
                })
        except Exception as e:
            print("Error classifying wiki visual:", e)

    # ---- WIKI_VISUAL_GENERATE (Infinite Wiki — generate the offered visual on demand) ----
    elif event_type == "WIKI_VISUAL_GENERATE":
        selection_text = data.get("selection_text", "")
        familiarity = data.get("familiarity", "high_school")
        modality = data.get("modality", "INTERACTIVE_SIMULATION")
        recommended_tool = data.get("recommended_tool", "Canvas")
        card_content = data.get("card_content", "")
        anchor_id = f"wiki_{hash(selection_text) & 0xFFFFFF}"
        chunks = await _get_chunks(session_id, selection_text, n=5)
        # Ground the visual in BOTH the wiki card's content and the source chunks.
        ctx_chunks = ([{"source": "wiki summary", "text": card_content}] + chunks) if card_content else chunks
        visual_cache_key = _cache.make_key(
            "WIKI_VISUAL", familiarity, anchor_id, [c["text"] for c in chunks], f"{selection_text}|{modality}"
        )
        await _cm.send(session_id, "WIKI_VISUAL_START", {"term": selection_text})
        cached_visual = _cache.get(visual_cache_key)
        if cached_visual:
            await _cm.send(session_id, "WIKI_VISUAL_PAYLOAD", {"term": selection_text, "visual": cached_visual})
        else:
            try:
                loop = asyncio.get_event_loop()
                if modality == "STATIC_PLOT":
                    visual = await loop.run_in_executor(
                        None, _get_tutor().generate_plot, selection_text, ctx_chunks, familiarity
                    )
                else:  # INTERACTIVE_SIMULATION
                    anim = "three.js" if recommended_tool == "Three.js" else "canvas"
                    visual = await loop.run_in_executor(
                        None, _get_tutor().generate_visual, selection_text, anim, familiarity, ctx_chunks
                    )
                payload = visual.model_dump()
                _cache.put(visual_cache_key, payload)
                await _cm.send(session_id, "WIKI_VISUAL_PAYLOAD", {"term": selection_text, "visual": payload})
            except Exception as e:
                print("Error generating wiki visual:", e)
                await _cm.send(session_id, "WIKI_VISUAL_PAYLOAD", {"term": selection_text, "visual": None})

    # ---- END_SESSION --------------------------------------------
    elif event_type == "END_SESSION":
        evaluator = EvaluatorAgent(journal_service=_journal)
        patches, _assessments, session_summary = evaluator.evaluate_session(session_id)

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
