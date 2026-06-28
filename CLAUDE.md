# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Study Buddy is a **local-first Electron desktop app** — an agentic study partner. Gemma 4 on Cerebras acts as a Cognitive Translator: it organises and rephrases student-uploaded content, never generates facts from its own weights. Students must upload their own material (no free lunch). The app ships as a native desktop executable; Python FastAPI runs as a child process spawned by Electron.

**Implementation plan:** `C:\Users\SystemSu\.claude\plans\deep-forging-lampson.md`

---

## Running the App

```bash
# Prerequisites: Python 3.11+, Node.js 20+

# First time
pip install -r backend/requirements.txt
npm install                        # root Electron deps
npm install --prefix frontend      # React deps

# Dev (starts Electron + Vite + Python together)
npm run dev
```

Backend only: `cd backend && uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`
Frontend only: `cd frontend && npm run dev`

## Running Tests

```bash
# Backend
cd backend && pytest tests/ -v
cd backend && pytest tests/test_cerebras_errors.py -v   # single file

# Frontend
cd frontend && npx vitest run
cd frontend && npx vitest run src/store/__tests__/       # single dir
```

---

## Architecture

Three processes at runtime:
- **Electron main** (`electron/main.js`) — spawns Python on port 8000, owns the BrowserWindow, exposes file-system IPC via `contextBridge`
- **Vite/React renderer** — `http://localhost:5173` in dev, `dist/index.html` in prod. Connects to backend at hardcoded `http://127.0.0.1:8000` / `ws://127.0.0.1:8000` (no env var in prod)
- **FastAPI backend** — all agents, RAG, WebSocket dispatch

### Two Memory Layers — the most important design decision

| Layer | Tool | Scope | Location |
|---|---|---|---|
| Content RAG | ChromaDB | Per-session, ephemeral | In-memory |
| Student memory | Cognee | Cross-session, persistent | `~/.studybuddy/cognee/` (LanceDB) |

ChromaDB holds **what the uploaded material says**. Cognee holds **how this student learns** — quiz failures, Feynman quality, mastery deltas — and accumulates across sessions on disk. The Brain Agent queries Cognee before building any curriculum tree; the Evaluator pushes to Cognee after scoring (fire-and-forget `asyncio.create_task`).

### Upload Flow

Two dropboxes per session:
- **Content** (required): PDFs/DOCX/TXT — the student's textbook or notes
- **Questions** (optional): past exam papers, Q&A sheets

Both are chunked (LangChain `RecursiveCharacterTextSplitter`, 512 tokens, 64 overlap) and indexed into the same ChromaDB collection. Question chunks get `metadata.type = "question"` so the Tutor Agent preferentially uses them for quiz/flashcard generation. After all files upload, `POST /ingest/finalize` triggers `BrainAgent.extract_curriculum()` which reads sample chunks to derive the topic tree — never invents topics from model weights.

### Agent Roster

All agents call `CerebrasClient.structured_complete()` with `strict=True` Pydantic schemas. Run in parallel via `asyncio`.

| Agent | Role |
|---|---|
| **Brain Agent** | Derives curriculum tree from RAG chunks (`extract_curriculum`), builds RAG queries, incorporates Cognee prior knowledge |
| **Tutor Agent** | 3-part grounded lessons (Anchor + cited Grounded Truth + lazy HTML5 visual), server-side syntax pre-flight before sending visuals, sandbox repair |
| **Evaluator Agent** | Reads full session journal on `END_SESSION`, emits score patches (monotone non-decreasing), triggers Cognee push |
| **Infinity Wiki Agent** | YouTube search + transcript selection — only fires on explicit "Deep Dive" button click |
| **Senses Agent** | Multimodal ingestion (images, audio) via Gemma 4 vision (base64 data URIs only) |

### Familiarity Profiles

Student-selected level changes prompt vocabulary throughout the session:
- `eli5` — sensory analogies, zero math, ≤2-syllable vocabulary
- `high_school` — standard terminology defined inline, real-world examples
- `graduate` — assume domain competence, focus on edge cases
- `expert` — pure synthesis, proofs, no analogies

### Knowledge Graph

React Flow canvas. 6–25 concept nodes derived from uploaded content. Nodes: typed edges, sized by average mastery score, coloured by status (`LOCKED` grey / `ACTIVE` blue / `MASTERED` green). Four scores per node: **Memory, Comprehension, Structure, Application** (0–100).

**Node score invariant — monotone non-decreasing.** Scores can only increase. Enforced in two places — both must stay correct or student progress is permanently corrupted:
- `backend/app/services/graph_state.py` → `GraphStateManager.apply_node_patch()`
- `frontend/src/store/graphStore.ts` → `applyNodePatch()`

### Study Tools (4 tabs per node)

- **Chat** — multi-turn, RAG-grounded, citations inline, streamed via `CHAT_TOKEN` WS events
- **Flashcards** — open-recall, self-graded (Again / Hard / Good / Easy), preferentially sourced from question chunks
- **Quiz** — forced-choice MCQ (1 correct + 3 distractors), generated from question chunks
- **Feynman** — agent plays curious 8-year-old "Clara"; student teaches, agent asks follow-ups

### Visual Sandbox

**Lazy by default** — `LEARN_NODE` returns lesson text only. The visual is generated only when the student opens the Visual tab (`GENERATE_VISUAL` WS event). Eager mode is opt-in.

Five visual types: `three.js` (anatomy/molecules, Three.js r128 CDN), `canvas` (physics/chem animations, vanilla `requestAnimationFrame`), `katex` (formulas, KaTeX CDN), `plot` (functions/distributions, inline SVG/Canvas), `quote` (legal articles/named papers, styled `<blockquote>`).

Server-side syntax pre-flight (`compile(script, '<visual>', 'exec')`) catches truncated or broken JS before the iframe sees it. Client-side `onerror` posts `SANDBOX_ERROR` back to `POST /sandbox/repair`; student sees "Repairing..." not red text.

### WebSocket Protocol

All messages: `{ "type": str, "data": dict }` — never bare strings. Dispatch table in `backend/app/websockets/handlers.py`:

| Event | Action |
|---|---|
| `LEARN_NODE` | RAG fetch → lesson text → `LESSON_PAYLOAD` |
| `GENERATE_VISUAL` | `TutorAgent.generate_visual` (with preflight) → `VISUAL_PAYLOAD` |
| `CHAT_TURN` | RAG fetch → stream → `CHAT_TOKEN`* + `CHAT_DONE` |
| `FLASHCARDS_REQUEST` | Generate from question+content chunks → `FLASHCARDS_READY` |
| `QUIZ_REQUEST` | Generate MCQs from question chunks → `QUIZ_READY` |
| `FLASHCARD_GRADE` | Journal append only |
| `QUIZ_SUBMIT` | Journal append → `QUIZ_FEEDBACK` |
| `FEYNMAN_TURN` | Stream as Clara → `FEYNMAN_TOKEN`* + `FEYNMAN_DONE` |
| `INFINITY_WIKI_REQUEST` | YouTube search + transcript select → `INFINITY_WIKI_RESULT` |
| `END_SESSION` | Evaluate → score patches → summary MD → Cognee push → `SESSION_COMPLETE` |

### Error Handling

`cerebras_errors.py` (no SDK import — independently unit-testable) defines `CerebrasErrorKind`: `auth_lost / rate_limited / model_unsupported / generic`. `CerebrasClient` tracks rate-limit cooldown windows and short-circuits future calls without hitting the API. Health state exposed at `GET /api/health`; frontend polls on mount and shows a banner.

### File System

Electron IPC handles all writes — `window.electronAPI.saveFile(path, content)` via `contextBridge`. Session summaries land at `~/.studybuddy/summaries/[Topic]_Summary.md`. Falls back to browser download anchor when `window.electronAPI` is undefined (browser dev mode without Electron).

---

## Pydantic Core Schemas

These are locked — agents must output exactly to these shapes:

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

- **Model ID:** `gemma-4-31b` — always pinned explicitly; never omit or the SDK may resolve a retired default
- **Context:** 32K MCL (message context limit) / 65K MSL
- **Structured outputs:** `response_format.type = "json_schema"`, `strict: true`
- **Image input:** multimodal via `image_url` content type, **base64 data URIs only** — hosted URLs not supported
- **Reasoning:** off by default; enable with `reasoning_effort: "low"|"medium"|"high"`
- **Tool calling:** `parallel_tool_calls=True` supported

---

## Key Constraints

- Gemma 4 generates **structure** (topic tree) and **translation** (rephrasing) only — never factual content from its own weights
- Every AI answer must cite its RAG source: `[Source: <label>, chunk <n>]`
- Out-of-scope questions: answer from the nearest relevant chunk and note it is not directly covered — never fabricate
- Sandbox iframe: `sandbox="allow-scripts"` only, `srcdoc` only, HTML fully self-contained (no external `src`)
- Cognee never writes to cloud — local LanceDB only at `~/.studybuddy/cognee/`
- Python 3.11+ required on host machine (assumed installed; not bundled in v1)

## Cut from v1

Story Agent, Crunch Mode / Google Calendar, Handwriting synthesis engine, Daily cron logs, OER fetching (no Zero-to-Hero content generation from external APIs)
