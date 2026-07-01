# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Study Buddy is a **local-first Electron desktop app** -> an agentic study partner. Gemma 4 on Cerebras acts as a Cognitive Translator: it organises and rephrases student-uploaded content, never generates facts from its own weights. Students must upload their own material. The app ships as a native desktop executable; Python FastAPI runs as a child process spawned by Electron.

---

## Running the App

```bash
# Prerequisites: Python 3.11+, Node.js 20+, uv (https://docs.astral.sh/uv/)

# First time
cd backend && uv sync              # installs all Python deps + dev group via uv
cd ..
npm install                        # root Electron deps
npm install --prefix frontend      # React deps

# Dev (starts Electron + Vite + Python together)
npm run dev
```

Backend only: `cd backend && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8765`
Frontend only: `cd frontend && npm run dev`

## Running Tests

```bash
# Backend
cd backend && uv run pytest tests/ -v
cd backend && uv run pytest tests/test_cerebras_errors.py -v   # single file

# Frontend
cd frontend && npx vitest run
cd frontend && npx vitest run src/store/__tests__/       # single dir
```

---

## Architecture

Three processes at runtime:

- **Electron main** (`electron/main.js`) -> spawns Python on port 8765, owns the BrowserWindow, exposes file-system IPC via `contextBridge`
- **Vite/React renderer** -> `http://localhost:5173` in dev, `dist/index.html` in prod. Connects to backend at hardcoded `http://127.0.0.1:8765` / `ws://127.0.0.1:8765` (no env var in prod)
- **FastAPI backend** -> all agents, RAG, WebSocket dispatch

### Two Memory Layers -> the most important design decision

| Layer | Tool | Scope | Location |
|---|---|---|---|
| Content RAG | ChromaDB | Per-session, ephemeral | In-memory, scoped by `document_ids` |
| Student memory | Cognee (via `StudentMemoryService`) | Cross-session, persistent | `~/.studybuddy/cognee/` (LanceDB + SQLite) |

ChromaDB holds **what the uploaded material says**. Cognee holds **how this student learns** -> quiz accuracy, flashcard ease, Feynman attempts, per-node mastery classification -> and accumulates across sessions on disk. The Brain Agent queries Cognee (`query_prior_knowledge`) before building any curriculum tree; the Evaluator's session summary gets pushed to Cognee at `END_SESSION` (see **Cognee Architecture** below for the exact remember/flush mechanics -> it is NOT a simple fire-and-forget write).

**Do not confuse this with `backend/app/services/memory_service.py`'s `MemoryService`** -> that is an unrelated, disk-only (no `cognee` package involved) JSON store for two different things: (1) an ephemeral per-PDF "report cluster" used only by the Report Canvas feature while a report is being compiled, flushed when the report closes, and (2) an append-only per-PDF evaluation `trajectory` history (`GET /session/trajectory/{document_id}`). It happens to also live under `~/.studybuddy/cognee/` (subfolders `clusters/` and `trajectory/`, sitting alongside cognee's own `system/` directory and LanceDB files) but is a completely separate system -> the module's own docstring calls this "the cognee *role*", not an integration with the library.

### Cognee Architecture

Bootstrap happens once, in `app/main.py`'s FastAPI `lifespan`, before any request is served:

1. Cerebras is aliased as an OpenAI-compatible provider for Cognee's LiteLLM backend (`OPENAI_API_KEY`/`OPENAI_API_BASE` set to the Cerebras key/URL; `LLM_MODEL=openai/gemma-4-31b`).
2. **Embeddings are forced local** (`EMBEDDING_PROVIDER=fastembed`, `sentence-transformers/all-MiniLM-L6-v2`, 384-dim) -> Cerebras has no embeddings endpoint, so Cognee's OpenAI-shaped default would otherwise get routed through the Cerebras base URL and 404. This is also what keeps the "Cognee never writes to cloud" guarantee true for embeddings, not just for graph extraction.
3. `cognee.config.data_root_directory(...)` / `system_root_directory(...)` are pointed at `~/.studybuddy/cognee`, then `create_db_and_tables()` initializes the relational (SQLite) side.
4. **Dataset bootstrap**: `cognee.remember(..., session_id=...)` only ever writes to a session-scoped cache -> it never creates the target dataset -> and `cognee.improve()` (the flush step) requires the dataset to already exist or it fails with "Dataset not found". So `main.py` explicitly seeds a `student_memory` dataset with one throwaway `cognee.add()` call on first startup if it doesn't already exist.

Runtime read/write pattern, all in `StudentMemoryService` (`backend/app/services/student_memory.py`):

- **Write** -> `push_session()` runs at `EVALUATE_SESSION` (Push): derives a per-node text summary from the journal (quiz accuracy, flashcard ease, Feynman attempts, rubric classification, weak areas) and calls `cognee.remember(summary, dataset_name="student_memory", session_id=session_id, self_improvement=False)`. This is cheap -> it only writes to Cognee's session cache, no graph rebuild.
- **Flush** -> `flush_session()` runs at `END_SESSION`: `cognee.improve(dataset="student_memory", session_ids=[session_id])` reads the cached session entries, runs the actual add+cognify pipeline, and persists them into the permanent graph. This is the expensive step, done once per session end, not on every Push.
- **Read** -> `query_prior_knowledge()` (called by the Brain Agent before curriculum generation) uses `cognee.recall(query_type=SearchType.CHUNKS, datasets=["student_memory"], session_id=session_id)` -> passing the *current* session_id means it also sees this session's own not-yet-flushed cache, not just prior sessions' committed graph data.
- A `DatabaseNotCreatedError` / "No data found in the system" on `recall()` is expected and silently swallowed on a fresh install before any `END_SESSION` has ever fired -> not a bug.

### Per-Session File & History Architecture

**There is no folder-wide/shared upload state.** Each session gets its own isolated upload folder; nothing is scanned or reused across sessions except by explicit, content-addressed cache hit.

- `backend/app/services/session_files.py` -> `session_upload_dir(session_id)` returns (and creates) `~/.studybuddy/session_uploads/{session_id}/`. `list_session_files(session_id)` is the *only* source of truth for "what documents does this session have" -> never a global directory scan.
- Two distinct identifiers, both content hashes (`ChromaDBClient.file_hash`, full 64-char SHA-256, never truncated):
  - **`file_id`** -> hash of one uploaded file's bytes.
  - **`document_id`** -> order-independent combined hash of the whole file *set* in a session (sorted per-file hashes, joined, re-hashed). Same set of files uploaded in any order -> same `document_id` -> same cached curriculum graph (`~/.studybuddy/graphs/doc_{document_id}.json`) is replayed instead of regenerated.
- **Session History** (`GET /library/history`, `POST /library/history/resume`) is backed by JSON files at `~/.studybuddy/sessions/{session_id}.json` (+ `doc_{document_id}.json` for dedup, + `latest.json`), written by `session_commit.py`'s `commit_session_snapshot()`. A resumed session restores every file into a **new** session-scoped folder (copied from the per-file PDF cache) and reuses the existing ChromaDB-indexed chunks under the original `session_id` -> it never re-chunks or re-indexes.
- **Duplication across sessions is an accepted tradeoff** for isolation -> uploading the same PDF in two sessions stores it twice on disk. This was an explicit architectural decision, not an oversight; do not "optimize" it back into a shared directory.
- Titles: `BrainAgent.generate_session_title()` derives a human title once per `document_id` (reused on every subsequent Push, not regenerated); `_fallback_topic_name()` guards the curriculum's root node label the same way, falling back to a second Cerebras attempt via `generate_session_title()` before ever falling back to filename munging (arXiv-style filenames like `1706.03762v7.pdf` carry no real title information).

### Agent Roster

All agents call `CerebrasClient.structured_complete()` with `strict=True` Pydantic schemas, or `stream_complete()` for token-by-token output. Independent calls run in parallel via `asyncio` wherever the data doesn't depend on itself (per-section curriculum expansion, per-entity web research, per-note report processing).

| Agent | Role |
|---|---|
| **Brain Agent** (`brain_agent.py`) | Derives curriculum tree (`derive_root_and_sections` → `expand_section` → `cleanup_curriculum`, multi-document aware, cross-paper merge detection), builds RAG queries, generates session titles, incorporates Cognee prior knowledge |
| **Tutor Agent** (`tutor_agent.py`) | 3-part grounded lessons (Anchor + cited Grounded Truth + lazy HTML5 visual), flashcard/quiz generation, server-side syntax pre-flight before sending visuals, sandbox repair |
| **Evaluator Agent** (`evaluator_agent.py`) | Reads full session journal on `END_SESSION`; the model classifies each node's demonstrated understanding against a fixed rubric (`building_basics`/`foundational`/`comfortable`/`sophisticated`) from the *sophistication* of questions/quiz answers/Feynman explanations -> it never invents numeric scores. A deterministic rubric map converts the classification to the 4-axis score patch; `GraphStateManager` enforces the monotone clamp downstream |
| **Study Buddy Agent** (`study_buddy_agent.py`) | Powers the Feynman-method tab: Socratic-method persona (named "Clara") that asks the student to teach a concept, adapts age/tone to familiarity level, asks follow-ups grounded in the node's chunks. Aware of `is_merged` nodes -> asks cross-document questions instead of treating a merge as one paper |
| **Net Research Agent** (`net_research_agent.py`) | Decomposes a Net Support chat question into independent research sub-agents so 2+ distinct entities/topics never get conflated in one search -> see **Query Decomposition** below |
| **Report Agent** (`report_agent.py`) | Powers the Report Canvas: processes each margin annotation/highlight statelessly into a `NoteInsight`, pools them (persisted to a per-PDF ephemeral cluster via `MemoryService`), then synthesizes a textbook-style streamed report; can incorporate web context in Net Support mode and attaches a grounded visual at the end via `ModalityRouter` |
| **Infinity Wiki Agent** (`infinity_wiki_agent.py`) | YouTube search + transcript selection -> only fires on explicit "Deep Dive" button click |
| **Wiki Agent** (`wiki_agent.py`) | Streams grounded 3-section Markdown cards for Infinite Wiki tab -> auto-fires on text selection, recursive drill-down |
| **Senses Agent** (`senses_agent.py`) | Multimodal ingestion (images, audio) via Gemma 4 vision (base64 data URIs only). Vision model MUST be `gemma-4-31b` -> not `llama-4-scout` |
| **Modality Router** (`modality_router.py`) | Classifies a concept/report into which visual type (if any) best fits it -> feeds both `TutorAgent.generate_visual`/`generate_plot` and the Report Canvas's auto-attached visual |

### Query Decomposition (Net Support Chat)

`CHAT_TURN` in `net_support` mode no longer uses OpenAI-style `tools=[...]` function calling. Instead, `NetResearchAgent.plan()` runs *before* the final synthesis call: it decides `needs_web` and, if the question involves 2+ distinct people/entities/topics that could be confused with each other (e.g. two people sharing a name), produces one `SubQuery` per entity. Each sub-agent then runs `research_subquery()` in isolation via `asyncio.gather` -> its own Tavily search, its own grounded summary, blind to the other sub-agents' results -> and only the final synthesis call ever sees all the labeled findings together, folded in as an extra `system` message. **The final `stream_complete()` call has no `tools=` parameter at all** -> the system prompt must never instruct the model to "call" a tool itself (it has no mechanism to), only to use the pre-fetched WEB RESEARCH section if present.

### Familiarity Profiles

Student-selected level changes prompt vocabulary throughout the session:

- `eli5` -> sensory analogies, zero math, ≤2-syllable vocabulary
- `high_school` -> standard terminology defined inline, real-world examples
- `graduate` -> assume domain competence, focus on edge cases
- `expert` -> pure synthesis, proofs, no analogies

### Knowledge Graph

React Flow canvas. 6–25 concept nodes derived from uploaded content. Nodes: typed edges, sized by average mastery score, coloured by status (`LOCKED` grey / `ACTIVE` blue / `MASTERED` green). Four scores per node: **Memory, Comprehension, Structure, Application** (0–100).

**Node score invariant -> monotone non-decreasing.** Scores can only increase. Enforced in two places -> both must stay correct or student progress is permanently corrupted:

- `backend/app/services/graph_state.py` → `GraphStateManager.apply_node_patch()`
- `frontend/src/store/graphStore.ts` → `applyNodePatch()`

### Study Panel -> Flat Tab Layout

The right-side panel (`ScientificFigurePanel.tsx`) uses a flat single-row `TabBar` component. Tabs: **Chat · Infinite Wiki · Flashcards · Quiz · Feynman**. No nested tab groups.

### Margin-Gutter Annotations

When in Read mode, each PDF page is wrapped in `display:flex` with a 272px `MarginGutter` column beside it. Notes are positioned with `position:absolute; top: anchorYNorm * pageHeightPx` inside the gutter -> they scroll with the page and never drift.

- Draft note state: `"idle" | "draft" | "saving" | "error"`. Retry button shown on error.
- Saves locally (in-memory via `interactionStore`) when `documentId`/`sessionId` are missing; otherwise POSTs to `POST /annotations`.
- Annotations persist to disk at `~/.studybuddy/annotations/{document_id}.json` via `AnnotationService`.

### Context Broker (`contextStore.ts`)

A Zustand store shared between `ChatTool` and `InfiniteWiki`:

```typescript
{ selectionSnippets, selectionText, surroundingContext, familiarity }
setSelection(snippets, text, surrounding) / clearSelection()
```

- `PDFReader` pushes to contextStore on text selection in DEFAULT (Read) mode.
- `clearSelection()` is called when the browser selection collapses in Read mode -> prevents ghost chips.
- `ChatTool` shows a `↳ "quoted text" ×` chip inline above the textarea when context is present.
- `InfiniteWiki` auto-fires on `selectionText` change (400ms debounce) when its tab is active.

### Infinite Wiki

Page stack (`WikiPage[]`) with `currentIdx`. **Off-by-one fix** -> when stack is empty, new page lands at index 0:

```typescript
setCurrentIdx(stack.length === 0 ? 0 : currentIdx + 1)
```

`WIKI_TOKEN` / `WIKI_DONE` WebSocket events are dispatched as `CustomEvent` on `window` (since the WS hook lives at App level). `InfiniteWiki` listens via `window.addEventListener("wiki-token", ...)`.

### Study Tools (4 tabs per node)

- **Chat** (`ChatTool.tsx`) -> multi-turn, RAG-grounded, citations inline, streamed via `CHAT_TOKEN` WS events. Accepts `selection_text` + `surrounding_context` from contextStore. Net Support mode uses the Net Research Agent's query-decomposition pattern (see above).
- **Flashcards** (`FlashcardTool.tsx`) -> open-recall, self-graded (Again / Hard / Good / Easy), preferentially sourced from question chunks
- **Quiz** (`QuizTool.tsx`) -> forced-choice MCQ (1 correct + 3 distractors), generated from question chunks
- **Feynman** (`StudyBuddyTool.tsx`, backed by `StudyBuddyAgent`) -> agent plays curious persona "Clara"; student teaches, agent asks follow-ups. Driven by `STUDY_BUDDY_INIT` / `STUDY_BUDDY_TURN` / `STUDY_BUDDY_AUDIO` WS events, not a `FEYNMAN_*` namespace despite the tab label

### Report Canvas (`ReportView.tsx`, separate from the 4-tab panel)

Turns the student's own margin annotations/highlighted passages (not the source PDF directly) into a synthesized, textbook-style, streamed report -> triggered from the Knowledge Graph page (`TreePage.tsx`), not the reading panel. Each `AnnotationService`-stored note is processed **statelessly** into a `NoteInsight` (`ReportAgent.process_note`, run concurrently via `asyncio.gather`), pooled and persisted to a per-PDF ephemeral cluster in `MemoryService` so an *edit* to the report (`edit_instruction`) can re-synthesize from the already-processed notes instead of reprocessing them. `REPORT_CLOSE` flushes that cluster. Net Support mode folds in a Tavily search on the report's topic; on completion, `ModalityRouter` classifies the finished text and may attach one auto-generated visual (`REPORT_SECTION_VISUAL`).

### Visual Sandbox

**Lazy by default** -> `LEARN_NODE` returns lesson text only. The visual is generated only when the student opens the Visual tab (`GENERATE_VISUAL` WS event). Eager mode is opt-in.

Five visual types: `three.js` (anatomy/molecules, Three.js r128 CDN), `canvas` (physics/chem animations, vanilla `requestAnimationFrame`), `katex` (formulas, KaTeX CDN), `plot` (functions/distributions, inline SVG/Canvas), `quote` (legal articles/named papers, styled `<blockquote>`).

Server-side syntax pre-flight (`compile(script, '<visual>', 'exec')`) catches truncated or broken JS before the iframe sees it. Client-side `onerror` posts `SANDBOX_ERROR` back to `POST /sandbox/repair`; student sees "Repairing..." not red text.

### WebSocket Protocol

All messages: `{ "type": str, "data": dict }` -> never bare strings. Dispatch table in `backend/app/websockets/handlers.py`:

| Event | Action |
|---|---|
| `BUILD_GRAPH` | Kicks off `_build_graph_streaming()` -> root+sections, then parallel per-section expansion, streaming `GRAPH_NODE_ADDED`/`GRAPH_EDGE_ADDED` as they resolve → `GRAPH_BUILD_DONE` |
| `LEARN_NODE` | RAG fetch → lesson text → `LESSON_PAYLOAD` |
| `GENERATE_VISUAL` | `TutorAgent.generate_visual` (with preflight) → `VISUAL_PAYLOAD` |
| `REPORT_COMPILE` / `REPORT_CLOSE` | Report Canvas: process/pool annotations → stream `REPORT_TOKEN`* → `REPORT_DONE` (+ optional `REPORT_SECTION_VISUAL`) / flush the per-PDF cluster |
| `WIKI_RECALL_GENERATE` | Active-recall quiz for a Wiki card → `WIKI_TOKEN`* + `WIKI_DONE` |
| `CHAT_TURN` | RAG fetch → (Net Support: plan + parallel sub-agent research) → stream → `CHAT_TOKEN`* + `CHAT_DONE`. Accepts `selection_text`, `surrounding_context`, `knowledge_mode`. |
| `FLASHCARDS_REQUEST` | Generate from question+content chunks → `FLASHCARDS_READY` |
| `QUIZ_REQUEST` | Generate MCQs from question chunks → `QUIZ_READY` |
| `FLASHCARD_GRADE` | Journal append only |
| `QUIZ_SUBMIT` | Journal append → `QUIZ_FEEDBACK` |
| `STUDY_BUDDY_INIT` / `STUDY_BUDDY_TURN` / `STUDY_BUDDY_AUDIO` | Feynman-method turns as "Clara" (text or transcribed audio) → streamed tokens + done event |
| `WIKI_DEEPDIVE_REQUEST` / `WIKI_DEEPDIVE_SUMMARIZE` | Infinity Wiki Deep Dive: YouTube search + transcript select → summarize |
| `CONTEXT_CARD_REQUEST` | `WikiAgent.stream_card()` → cached in `output_cache` → `WIKI_TOKEN`* + `WIKI_DONE` |
| `WIKI_VISUAL_GENERATE` | Attaches a visual to an Infinite Wiki card, same preflight/repair path as `GENERATE_VISUAL` |
| `EVALUATE_SESSION` | "Push": Evaluator scores journal → monotone score patches → **commits Session History** (`commit_session_snapshot`) → `StudentMemoryService.push_session()` (Cognee session cache write) → `SESSION_EVALUATED` |
| `PROGRESS_REQUEST` | Deterministic (no-LLM) per-node activity tally from the journal → drives node fill/completion UI |
| `CACHE_CLEAR` | Clears `output_cache` entries for a node |
| `END_SESSION` | `StudentMemoryService.flush_session()` -> `cognee.improve()` flushes the session's cached memory into the permanent graph → summary MD written → `SESSION_COMPLETE` |

### Error Handling

`cerebras_errors.py` (no SDK import -> independently unit-testable) defines `CerebrasErrorKind`: `auth_lost / rate_limited / model_unsupported / generic`. `CerebrasClient` tracks rate-limit cooldown windows and short-circuits future calls without hitting the API. Health state exposed at `GET /api/health`; frontend polls on mount and shows a banner.

`CerebrasClient.structured_complete()` catches both `json.JSONDecodeError` AND `pydantic.ValidationError` (Cerebras can return truncated JSON / EOF) and retries once. `BrainAgent.extract_curriculum()` caps each document's `structure_text` to 3000 chars and total to 10000 chars to prevent context overflow.

### Backend Startup Race

Python startup takes ~10–15s (embedding model warmup). `SetupModal` polls `GET /api/health` every 1s on mount and disables the "Start Studying" button until the backend responds. `App.tsx` holds off rendering `SetupModal` for a flat 2s on mount (a plain timer, no request) to reduce Vite proxy ECONNREFUSED flash during startup.

### File System

Electron IPC handles all writes -> `window.electronAPI.saveFile(path, content)` via `contextBridge`. Session summaries land at `~/.studybuddy/summaries/[Topic]_Summary.md`. Falls back to browser download anchor when `window.electronAPI` is undefined (browser dev mode without Electron).

All persistent app state lives under `~/.studybuddy/`:

| Path | What |
|---|---|
| `session_uploads/{session_id}/` | This session's own uploaded files, isolated per session (see **Per-Session File & History Architecture**) |
| `sessions/{session_id}.json`, `doc_{document_id}.json`, `latest.json` | Session History entries (title, familiarity, nodes, content_files, file_ids) |
| `graphs/{session_id}.json`, `graphs/doc_{document_id}.json` | Live per-session graph state + content-addressed curriculum cache (replayed on matching re-upload) |
| `pdfs/{file_id}.pdf` | Per-file PDF cache, keyed by `file_id` (never `document_id` -> that's a combined-set hash, not a real filename) |
| `annotations/{document_id}.json` | Margin notes |
| `summaries/[Topic]_Summary.md` | End-of-session Markdown export |
| `cognee/` | Cognee's own LanceDB + SQLite data root (see **Cognee Architecture**) *and*, in separate subfolders (`clusters/`, `trajectory/`), the unrelated disk-only `MemoryService` |

### Deployment Environment / Rate Limits

To allow StudyBuddy to be deployed as a demo on platforms with tight resource constraints (e.g. Hugging Face Spaces) without being killed, the app supports a `DEPLOYMENT_ENV` environment variable:
- If `DEPLOYMENT_ENV=demo`: Internal semaphores throttle concurrent LLM and pipeline calls severely (e.g. max 5 concurrent Cerebras calls, max 2 highlight processes) to prevent 429s or container OOM kills.
- If `DEPLOYMENT_ENV=desktop` (the default): Concurrency limits are uncapped / significantly expanded (e.g. 50 concurrent Cerebras calls) to run at full speed on local hardware.

---

## Vite Proxy -> All Backend Routes Must Be Listed

`frontend/vite.config.ts` proxies specific path prefixes to `http://127.0.0.1:8765`. If you add a new FastAPI router with a new prefix, you **must** add it to the proxy config or all frontend fetch calls to that prefix will 404 in dev.

Current proxied prefixes: `/api`, `/session`, `/sandbox`, `/library`, `/annotations`, `/regions`, `/review`, `/ws`. (`/ingest` is a stale proxy entry left over from the pre-per-session upload flow -> no router registers that prefix anymore; harmless but don't treat its presence as evidence the endpoint still exists.)

---

## Pydantic Core Schemas

These are locked -> agents must output exactly to these shapes:

```python
class NodePatch(BaseModel):
    node_id: str
    status: Optional[Literal["LOCKED", "ACTIVE", "MASTERED", "STRUGGLING", "DEGRADED"]] = None
    updated_description: Optional[str] = None
    new_children: Optional[List[str]] = None
    score_patch: Optional[Dict[str, int]] = None  # memory|comprehension|structure|application

class HTML5VisualPayload(BaseModel):
    html_code: str  # fully self-contained, no external src attributes
    animation_type: Literal["three.js", "canvas", "katex", "plot", "quote"]

class OrchestratorAction(BaseModel):
    intent: Literal["UPDATE_GRAPH", "GENERATE_VISUAL", "STREAM_CHAT", "TOOL_CALL"]
    chat_stream_response: str = ""
    graph_patches: Optional[List[NodePatch]] = None
    visual_payload: Optional[HTML5VisualPayload] = None
    tool_execution: Optional[ExternalAction] = None
```

Structured outputs always use `strict=True` + `additionalProperties: false` at every level. `CerebrasClient._build_schema()` strips `$defs` before passing to the API (Cerebras strict mode does not support `$ref`).

---

## Cerebras API Reference

- **Model ID:** `gemma-4-31b` -> always pinned explicitly; never omit or the SDK may resolve a retired default
- **Context:** 32K MCL (message context limit) / 65K MSL
- **Structured outputs:** `response_format.type = "json_schema"`, `strict: true`
- **Image input:** multimodal via `image_url` content type, **base64 data URIs only** -> hosted URLs not supported
- **Reasoning:** off by default; enable with `reasoning_effort: "low"|"medium"|"high"`
- **Tool calling:** `parallel_tool_calls=True` supported

---

## Key Constraints

- Gemma 4 generates **structure** (topic tree) and **translation** (rephrasing) only -> never factual content from its own weights
- Every AI answer in chat must cite its RAG source: `[Source: <label>, chunk <n>]`
- Out-of-scope questions: answer from the nearest relevant chunk and note it is not directly covered, never fabricate
- Sandbox iframe: `sandbox="allow-scripts"` only, `srcdoc` only, HTML fully self-contained (no external `src`)
- Cognee never writes to cloud, local LanceDB only at `~/.studybuddy/cognee/`
- Python 3.11+ required on host machine (assumed installed; not bundled in v1)
- Vision model for `SensesAgent`: MUST be `gemma-4-31b` only
- **Grounded-only generation** -> Gemma 4 organises and rephrases your uploaded content. It never generates facts from its own weights (except in Net Support mode, where web sources are cited)
- **Source citations** -> every AI answer cites its source: `[Source: filename, chunk N]`
- **Monotone mastery** -> node mastery scores can only increase, never decrease
- **Local-first data** -> all student memory stays at `~/.studybuddy/`. Nothing is sent to third-party storage
- **Proxy rule** -> when adding a new FastAPI router, add its path prefix to `frontend/vite.config.ts` proxy list or dev fetch calls will 404
- **No folder-wide upload state** -> this was an explicit architectural decision (not an oversight): each session owns its own upload folder (`~/.studybuddy/session_uploads/{session_id}/`), never a shared/global directory. Do not reintroduce a shared uploads directory, a "clear all files" endpoint, or any code path that scans across sessions for "existing files" -> see **Per-Session File & History Architecture**

## Planned V2

Google Tasks/Calendar, TTS/STT, Voice AI, Handwriting synthesis engine, Daily cron logs, OER fetching (no Zero-to-Hero content generation from external APIs)
