<p align="center">
  <img src="https://img.shields.io/badge/Gemma_4-Cerebras_1500+_TPS-4A7FB5?style=for-the-badge" alt="Gemma 4 on Cerebras" />
  <img src="https://img.shields.io/badge/React_18-Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="React + Vite" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron" />
</p>

# 📚 Study Buddy

An **agentic AI study companion** that teaches exclusively from your uploaded material. Drop a textbook chapter, lecture notes, or past papers -> the system builds a structured curriculum, generates grounded explanations, interactive figures, flashcards, quizzes, and Feynman-method drills. Every answer is sourced and cited; nothing is invented from model weights.

**Gemma 4 (31B) on Cerebras** runs at **1,500+ tokens/second**, making the entire experience feel instantaneous.

---

## ✨ Features

### 📖 Intelligent PDF Reader
- **Discontinuous text selection** -> hold Shift to accumulate multiple passages across pages; custom yellow highlight overlays persist until cleared with Escape
- **Margin gutter notes** -> switch to Annotate mode, select text, and write draggable sticky notes that pin to the page margin. Click to edit, clear to delete
- **Interactive figure regions** -> toggle Regions mode to auto-detect figures, tables, plots, and diagrams. Click any detected region to send it to Infinite Wiki or Chat, or pin it as a note

### 🔬 Infinite Wiki
- **Contextual drill-down cards** -> select any text in the PDF and a streaming, grounded definition card appears. Highlight any term inside the card to drill deeper -> unlimited depth
- **Structured 3-part layout** -> every card streams a difficulty-adapted one-sentence summary, 3 core formulas/facts, and a 2-question active-recall quiz
- **Self-repairing HTML5 visualisations** -> scientific concepts auto-generate interactive Canvas simulations (orbital mechanics, wave interference, etc.). If the generated code errors at runtime, the sandbox catches it and self-heals via a repair endpoint
- **Web-augmented research** -> in Net Support mode, the wiki agent falls back to Tavily web search when the concept isn't covered in your material, with `[Web: Title](url)` citations

### 💬 Grounded Chat
- **RAG-powered Q&A** -> every answer cites its source chunk from your uploaded document
- **Rich markdown rendering** -> responses stream with headings, bullet lists, bold text, and web citation links
- **Context chip** -> the currently selected text is shown as a persistent chip above the input, grounding your questions

### 🧠 Knowledge Graph
- **Auto-generated curriculum tree** -> the AI extracts a topic hierarchy from your material and renders it as an interactive node graph
- **Click-to-learn** -> click any concept node to stream a full lesson. The tutor never refuses to teach a concept, even if it's only tangentially mentioned in the text
- **Session-scoped RAG** -> document chunks are isolated per session; uploading a new PDF doesn't bleed into old sessions

### 🎯 Study Tools
- **Flashcards** -> generated from your uploaded question papers
- **Quiz** -> timed self-assessment with graded answers
- **Feynman Method** -> explain the concept aloud to a curious Study Buddy persona (voice or text). The persona adapts its age and behaviour to your difficulty level (Age 5 for ELI5, Age 30 for Expert)
- **Speech-to-text** -> backend Canary neural transcription when available, with automatic Web Speech API fallback

### ⚙️ Adaptive Difficulty
Four familiarity levels that reshape every interaction:

| Level | Label | Behaviour |
|---|---|---|
| 🍼 ELI5 | Age 5 | Sensory analogies, no math, cartoon-like explanations |
| 🏫 High School | Age 15 | Standard terms, real-world examples, algebra-level formulas |
| 🎓 Graduate | Age 22 | Domain competence assumed, rigorous derivations |
| 🧪 Expert | Age 30 | Pure synthesis, proofs, literature-level discourse |

### 🔒 Privacy
- All student data stays **local** at `~/.studybuddy/` -> nothing goes to the cloud
- ChromaDB vector store, session memory, annotations, and summaries are all file-based
- The only outbound calls are to the Cerebras API (inference) and optionally Tavily (web search)

---

## 🛠 Prerequisites

| Tool | Version | Install |
|---|---|---|
| Python | 3.12+ | [python.org](https://www.python.org/downloads/) |
| uv | latest | `pip install uv` or [docs.astral.sh/uv](https://docs.astral.sh/uv/) |
| Node.js | 20+ | [nodejs.org](https://nodejs.org/) |

---

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/solusops/StudyBuddy.git
cd StudyBuddy

# 2. Python dependencies
cd backend
uv sync
cd ..

# 3. Node dependencies
npm install                        # Electron + root orchestration
npm install --prefix frontend      # React frontend

# 4. API keys
cp backend/.env.example backend/.env
# Edit backend/.env:
#   CEREBRAS_API_KEY=csk-...       (required)
#   TAVILY_API_KEY=tvly-...        (optional -> enables Net Support mode)
#   YOUTUBE_API_KEY=...            (optional -> enables Deep Dive)

# 5. Launch
npm run dev
```

Open **http://localhost:5173**. The "Start Studying" button activates once the backend finishes loading (~10–15s on first run while the embedding model warms up).

---

## 🖥 Running

| Command | What it does |
|---|---|
| `npm run dev` | Starts Vite (`localhost:5173`) + uvicorn (`127.0.0.1:8765`) concurrently |
| `npm run dev:electron` | Full Electron desktop shell + Vite |
| `cd backend && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8765` | Backend only |
| `cd frontend && npm run dev` | Frontend only (browser, no Electron IPC) |

---

## 📋 How to Use

1. **Upload content** -> drop a PDF, DOCX, or TXT (textbook chapters, lecture notes, problem sets)
2. **Upload questions** *(optional)* -> past exam papers or Q&A sheets for flashcards and quizzes
3. **Pick a familiarity level** -> ELI5 / High School / Graduate / Expert
4. **Choose knowledge mode** -> Content Only (strict RAG) or Net Support (web search fallback)
5. **Click "Start Studying"** -> the curriculum tree is auto-extracted from your material
6. **Click any node** on the knowledge graph to open the study panel with all tools
7. **Select text** in the PDF while reading to populate the context chip -> then:
   - Open **Infinite Wiki** for a grounded drill-down card with quiz
   - **Ask in Chat** for a RAG-sourced answer
   - Toggle **Regions** to detect and interact with figures/tables/plots
8. **Annotate** -> switch to Annotate mode, select text, and write a margin note
9. **End Session** -> scores your mastery and saves a Markdown summary to `~/.studybuddy/summaries/`

---

## 🧱 Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Electron Shell                         │
│  ┌────────────────────────┬───────────────────────────┐  │
│  │     React Frontend     │     FastAPI Backend        │  │
│  │     (Vite, port 5173)  │     (uvicorn, port 8765)  │  │
│  │                        │                            │  │
│  │  PDFReader ◄──────────►│  WebSocket /ws/{session}   │  │
│  │  InfiniteWiki          │  ├─ BrainAgent             │  │
│  │  ChatTool              │  ├─ TutorAgent             │  │
│  │  FlashcardTool         │  ├─ WikiAgent              │  │
│  │  QuizTool              │  ├─ EvaluatorAgent         │  │
│  │  FeynmanTool           │  ├─ SensesAgent (vision)   │  │
│  │  VisualSandbox         │  └─ ModalityRouter         │  │
│  │  KnowledgeGraph        │                            │  │
│  │                        │  REST Routers              │  │
│  │  Zustand Stores ──────►│  ├─ /library     (upload)  │  │
│  │  (session, context,    │  ├─ /session     (create)  │  │
│  │   interaction, graph)  │  ├─ /regions     (figures) │  │
│  │                        │  ├─ /annotations (notes)   │  │
│  │                        │  ├─ /sandbox     (repair)  │  │
│  │                        │  └─ /api/health            │  │
│  │                        │                            │  │
│  │                        │  Services                  │  │
│  │                        │  ├─ ChromaDB (RAG)         │  │
│  │                        │  ├─ LayoutService (PyMuPDF)│  │
│  │                        │  ├─ OutputCache             │  │
│  │                        │  └─ AnnotationService      │  │
│  └────────────────────────┴───────────────────────────┘  │
│                              │                            │
│                    ┌─────────▼──────────┐                 │
│                    │   Cerebras Cloud   │                 │
│                    │  Gemma 4 (31B)     │                 │
│                    │  1,500+ TPS        │                 │
│                    └─────────┬──────────┘                 │
│                              │ (optional)                 │
│                    ┌─────────▼──────────┐                 │
│                    │   Tavily Search    │                 │
│                    │   (Net Support)    │                 │
│                    └────────────────────┘                 │
└──────────────────────────────────────────────────────────┘
```

---

## 📂 Project Structure

<details><summary>Click to expand</summary>

```text
StudyBuddy/
├── electron/                  # Electron main process + preload IPC bridge
├── backend/
│   ├── app/
│   │   ├── agents/            # AI agent layer
│   │   │   ├── brain_agent.py       # Curriculum extraction & topic hierarchy
│   │   │   ├── tutor_agent.py       # Lesson streaming & visual generation
│   │   │   ├── wiki_agent.py        # Infinite Wiki card generation
│   │   │   ├── evaluator_agent.py   # Quiz & flashcard evaluation
│   │   │   ├── senses_agent.py      # Vision model (figure/table description)
│   │   │   ├── modality_router.py   # Routes concepts to best visual type
│   │   │   ├── cerebras_client.py   # Cerebras SDK wrapper (structured + streaming)
│   │   │   └── cerebras_errors.py   # Error classification & rate-limit handling
│   │   ├── rag/               # ChromaDB vector store, embeddings, chunker
│   │   ├── schemas/           # Pydantic data contracts (graph, annotations)
│   │   ├── services/          # Business logic
│   │   │   ├── layout_service.py    # PyMuPDF page segmentation (figures/tables)
│   │   │   ├── output_cache.py      # Deterministic cache for LLM outputs
│   │   │   ├── annotation_service.py
│   │   │   ├── graph_state.py       # Graph state manager
│   │   │   ├── summary_writer.py    # End-of-session Markdown export
│   │   │   └── transcription_service.py  # Canary STT
│   │   ├── routers/           # FastAPI REST endpoints
│   │   │   ├── library.py          # File upload, indexing, status
│   │   │   ├── regions.py          # Figure/table segmentation
│   │   │   ├── session.py          # Session lifecycle
│   │   │   ├── annotations.py      # CRUD for margin notes
│   │   │   ├── sandbox.py          # Visual self-repair endpoint
│   │   │   └── health.py           # Readiness probe
│   │   └── websockets/
│   │       └── handlers.py         # Central event dispatch (LEARN_NODE, CHAT, etc.)
│   └── tests/                 # pytest suite
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── graph/              # KnowledgeGraph, ConceptNode
│       │   ├── panel/              # ScientificFigurePanel, InfiniteWiki, VisualSandbox
│       │   ├── reader/             # PDFReader, HighlightLayer, RegionLayer, MarginGutter
│       │   ├── study-tools/        # ChatTool, FlashcardTool, QuizTool, FeynmanTool
│       │   ├── overlay/            # FloatingToolbar (cursor mode switcher)
│       │   └── init/               # SetupModal (onboarding)
│       ├── hooks/                  # useWebSocket
│       ├── lib/                    # fileSystem (Electron IPC + browser fallback)
│       ├── pages/                  # TreePage, ManualPage, StudyPage
│       ├── store/                  # Zustand: graphStore, sessionStore, contextStore, interactionStore
│       └── types/                  # Shared TypeScript interfaces
└── package.json               # Root orchestration (concurrently, electron-forge)
```

</details>

---

## 🧪 Running Tests

```bash
# Full backend suite
cd backend
uv run pytest tests/ -v

# Single test file
uv run pytest tests/test_tutor_lesson.py -v

# Frontend tests
cd frontend
npx vitest run
```

---

## 🔑 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CEREBRAS_API_KEY` | ✅ | Cerebras Cloud API key for Gemma 4 inference |
| `TAVILY_API_KEY` | ❌ | Enables "Net Support" knowledge mode (web search fallback) |
| `YOUTUBE_API_KEY` | ❌ | Enables Deep Dive video search |
| `ALLOWED_ORIGINS` | ❌ | CORS origins (defaults to `http://localhost:5173`) |

---

## ⚠️ Key Constraints

- **Grounded-only generation** -> Gemma 4 organises and rephrases your uploaded content. It never generates facts from its own weights (except in Net Support mode, where web sources are cited)
- **Source citations** -> every AI answer cites its source: `[Source: filename, chunk N]`
- **Monotone mastery** -> node mastery scores can only increase, never decrease
- **Local-first data** -> all student memory stays at `~/.studybuddy/`. Nothing is sent to third-party storage
- **Proxy rule** -> when adding a new FastAPI router, add its path prefix to `frontend/vite.config.ts` proxy list or dev fetch calls will 404

---

## 📄 License

Apache 2.0
