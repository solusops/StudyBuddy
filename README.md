# Study Buddy

An agentic study partner that teaches exclusively from your uploaded material. Upload a textbook chapter or lecture notes — the AI organises and explains it, never inventing facts from its own weights.

Built with Electron + React + FastAPI. Gemma 4 on Cerebras runs at 1500+ TPS.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Python | 3.12 | [python.org](https://www.python.org/downloads/) |
| uv | latest | `pip install uv` or [docs.astral.sh/uv](https://docs.astral.sh/uv/) |
| Node.js | 20+ | [nodejs.org](https://nodejs.org/) |

---

## Setup (first time)

```bash
# 1. Clone and enter the repo
git clone <your-repo-url>
cd StudyBuddy

# 2. Install Python dependencies
cd backend
uv sync
cd ..

# 3. Install Node dependencies
npm install              # Electron + root deps
npm install --prefix frontend   # React deps

# 4. Add your API keys
cp backend/.env.example backend/.env
# Edit backend/.env and fill in:
#   CEREBRAS_API_KEY=...
#   YOUTUBE_API_KEY=...   (optional — only needed for Deep Dive)
```

---

## Running

### Full app (Electron + React + Python together)

```bash
npm run dev
```

Electron opens a window. Python FastAPI starts automatically on `http://127.0.0.1:8000`. Vite dev server runs on `http://localhost:5173`.

### Backend only

```bash
cd backend
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend only (browser, no Electron)

```bash
cd frontend
npm run dev
# Open http://localhost:5173
# File saves fall back to browser download (no Electron IPC)
```

---

## Using the app

1. **Upload content** — drop in a PDF, DOCX, or TXT (your textbook, lecture notes, etc.)
2. **Upload questions** *(optional)* — past exam papers or Q&A sheets, used for flashcards and quizzes
3. **Pick a familiarity level** — ELI5 / High School / Graduate / Expert
4. **Click "Start Studying"** — the curriculum tree is extracted from your material
5. **Click any node** on the knowledge graph to open the study panel:
   - **Lesson** — grounded explanation with citations back to your material
   - **Visual** — interactive HTML5 visual (generated on demand)
   - **Study Tools** — Chat, Flashcards, Quiz, Feynman (explain it to Clara)
   - **Deep Dive** — finds the best YouTube video for the topic
6. **End Session** — scores your mastery, saves a Markdown summary to `~/.studybuddy/summaries/`

Session memory is stored locally at `~/.studybuddy/cognee/` and used to personalise future sessions on related topics.

---

## Running tests

```bash
# Backend
cd backend
uv run pytest tests/ -v

# Single file
uv run pytest tests/test_cerebras_errors.py -v

# Frontend
cd frontend
npx vitest run

# Single directory
npx vitest run src/store/__tests__/
```

---

## Project structure

```
StudyBuddy/
├── electron/           # Electron main process + preload IPC bridge
├── backend/
│   ├── app/
│   │   ├── agents/     # BrainAgent, TutorAgent, EvaluatorAgent, InfinityWikiAgent, CerebrasClient
│   │   ├── rag/        # ChromaDB, embeddings, chunker, ingestion
│   │   ├── schemas/    # Pydantic data contracts (locked)
│   │   ├── services/   # GraphStateManager, JournalService, StudentMemoryService, SummaryWriter
│   │   ├── websockets/ # ConnectionManager + event dispatch table
│   │   └── routers/    # /ingest, /session, /sandbox, /api/health
│   └── tests/
└── frontend/
    └── src/
        ├── components/ # graph/, panel/, study-tools/, init/
        ├── hooks/      # useWebSocket
        ├── lib/        # fileSystem (Electron IPC + browser fallback)
        ├── pages/      # StudyPage
        ├── store/      # graphStore (Zustand), sessionStore
        └── types/      # Shared TypeScript types
```

---

## Key constraints

- **No free lunch** — Gemma 4 only organises and rephrases your uploaded content. It never generates facts from its own weights.
- Every AI answer cites its source: `[Source: filename, chunk N]`
- Node mastery scores are monotone non-decreasing — they can only go up
- All student memory stays local (`~/.studybuddy/`) — nothing goes to the cloud
