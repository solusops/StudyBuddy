import { create } from "zustand"
import type { FamiliarityLevel, Flashcard, MCQ, LessonPayload, HTML5VisualPayload } from "../types"

interface ChatMessage {
  role: "student" | "assistant"
  content: string
}

interface FeynmanMessage {
  role: "student" | "clara"
  content: string
}

interface SessionStore {
  // Session identity
  sessionId: string | null
  topic: string
  familiarity: FamiliarityLevel

  // Navigation
  activeNodeId: string | null
  activeNodeLabel: string

  // Study tool data (reset when switching nodes)
  lesson: LessonPayload | null
  visual: HTML5VisualPayload | null
  flashcards: Flashcard[]
  quizQuestions: MCQ[]
  chatHistory: ChatMessage[]
  feynmanHistory: FeynmanMessage[]
  chatDraft: string

  // Streaming state
  streamingChat: string
  streamingFeynman: string

  // Actions
  setSession: (id: string, topic: string, familiarity: FamiliarityLevel) => void
  setActiveNode: (id: string, label: string) => void
  setLesson: (lesson: LessonPayload) => void
  setVisual: (visual: HTML5VisualPayload) => void
  setFlashcards: (cards: Flashcard[]) => void
  setQuizQuestions: (qs: MCQ[]) => void
  appendChatToken: (token: string) => void
  commitChatResponse: () => void
  appendFeynmanToken: (token: string) => void
  commitFeynmanResponse: () => void
  addChatMessage: (msg: ChatMessage) => void
  addFeynmanMessage: (msg: FeynmanMessage) => void
  setChatDraft: (draft: string) => void
  resetNodeData: () => void
  reset: () => void
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessionId: null,
  topic: "",
  familiarity: "high_school",
  activeNodeId: null,
  activeNodeLabel: "",
  lesson: null,
  visual: null,
  flashcards: [],
  quizQuestions: [],
  chatHistory: [],
  feynmanHistory: [],
  chatDraft: "",
  streamingChat: "",
  streamingFeynman: "",

  setSession: (id, topic, familiarity) => set({ sessionId: id, topic, familiarity }),

  setActiveNode: (id, label) =>
    set({ activeNodeId: id, activeNodeLabel: label }),

  setLesson: (lesson) => set({ lesson }),
  setVisual: (visual) => set({ visual }),
  setFlashcards: (cards) => set({ flashcards: cards }),
  setQuizQuestions: (qs) => set({ quizQuestions: qs }),

  appendChatToken: (token) =>
    set((s) => ({ streamingChat: s.streamingChat + token })),

  commitChatResponse: () =>
    set((s) => ({
      chatHistory: [
        ...s.chatHistory,
        { role: "assistant" as const, content: s.streamingChat },
      ],
      streamingChat: "",
    })),

  appendFeynmanToken: (token) =>
    set((s) => ({ streamingFeynman: s.streamingFeynman + token })),

  commitFeynmanResponse: () =>
    set((s) => ({
      feynmanHistory: [
        ...s.feynmanHistory,
        { role: "clara" as const, content: s.streamingFeynman },
      ],
      streamingFeynman: "",
    })),

  addChatMessage: (msg) =>
    set((s) => ({ chatHistory: [...s.chatHistory, msg] })),

  addFeynmanMessage: (msg) =>
    set((s) => ({ feynmanHistory: [...s.feynmanHistory, msg] })),

  setChatDraft: (draft) => set({ chatDraft: draft }),

  resetNodeData: () =>
    set({
      lesson: null,
      visual: null,
      flashcards: [],
      quizQuestions: [],
      chatHistory: [],
      feynmanHistory: [],
      chatDraft: "",
      streamingChat: "",
      streamingFeynman: "",
    }),

  reset: () =>
    set({
      sessionId: null,
      topic: "",
      familiarity: "high_school",
      activeNodeId: null,
      activeNodeLabel: "",
      lesson: null,
      visual: null,
      flashcards: [],
      quizQuestions: [],
      chatHistory: [],
      feynmanHistory: [],
      chatDraft: "",
      streamingChat: "",
      streamingFeynman: "",
    }),
}))
