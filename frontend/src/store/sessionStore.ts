import { create } from "zustand"
import type { FamiliarityLevel, Flashcard, MCQ, LessonPayload, HTML5VisualPayload, ChatMessage } from "../types"

interface StudyBuddyMessage {
  role: "student" | "study_buddy"
  content: string
}

interface SessionStore {
  // Session identity
  sessionId: string | null
  topic: string
  familiarity: FamiliarityLevel
  knowledgeMode: "content_only" | "net_support"

  // Navigation
  activeNodeId: string | null
  activeNodeLabel: string

  // Study tool data (reset when switching nodes)
  lesson: LessonPayload | null
  visual: HTML5VisualPayload | null
  flashcards: Flashcard[]
  quizQuestions: MCQ[]
  chatHistory: ChatMessage[]
  studyBuddyHistory: StudyBuddyMessage[]
  chatDraft: string

  // Streaming state
  streamingChat: string
  streamingStudyBuddy: string
  streamingLesson: string
  lessonStreaming: boolean
  studyBuddyInitializing: boolean

  // Lesson cache -> keyed by nodeId, avoids re-fetching already-loaded lessons
  lessonCache: Record<string, string>
  // Web sources (title + url) the current lesson drew on, when Net Support fetched them
  lessonWebSources: { title: string; url: string }[]

  // Actions
  setSession: (id: string, topic: string, familiarity: FamiliarityLevel, knowledgeMode?: "content_only" | "net_support") => void
  setKnowledgeMode: (mode: "content_only" | "net_support") => void
  setActiveNode: (id: string, label: string) => void
  setLesson: (lesson: LessonPayload) => void
  setVisual: (visual: HTML5VisualPayload) => void
  setFlashcards: (cards: Flashcard[]) => void
  setQuizQuestions: (qs: MCQ[]) => void
  appendLessonToken: (token: string) => void
  commitLesson: (visualSuggestion: string, webSources?: { title: string; url: string }[]) => void
  appendChatToken: (token: string) => void
  commitChatResponse: () => void
  appendStudyBuddyToken: (token: string) => void
  commitStudyBuddyResponse: () => void
  addChatMessage: (msg: ChatMessage) => void
  addStudyBuddyMessage: (msg: StudyBuddyMessage) => void
  setStudyBuddyHistory: (history: StudyBuddyMessage[]) => void
  setChatDraft: (draft: string) => void
  setChatHistory: (history: ChatMessage[]) => void
  setLessonCache: (cache: Record<string, string>) => void
  setStudyBuddyInitializing: (initializing: boolean) => void
  resetNodeData: () => void
  reset: () => void
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessionId: null,
  topic: "",
  familiarity: "high_school",
  knowledgeMode: "content_only",
  activeNodeId: null,
  activeNodeLabel: "",
  lesson: null,
  visual: null,
  flashcards: [],
  quizQuestions: [],
  chatHistory: [],
  studyBuddyHistory: [],
  chatDraft: "",
  streamingChat: "",
  streamingStudyBuddy: "",
  streamingLesson: "",
  lessonStreaming: false,
  studyBuddyInitializing: false,
  lessonCache: {},
  lessonWebSources: [],

  setSession: (id, topic, familiarity, knowledgeMode) =>
    set((state) => ({
      sessionId: id,
      topic,
      familiarity,
      knowledgeMode: knowledgeMode || state.knowledgeMode,
    })),

  setKnowledgeMode: (mode) => set({ knowledgeMode: mode }),

  // Switching nodes must drop all previously-generated tool output -> otherwise Study
  // Buddy/Flashcards/Quiz keep showing the prior node's content (lessonCache is the
  // one exception: it's intentionally keyed by nodeId so revisits don't re-fetch).
  setActiveNode: (id, label) =>
    set({
      activeNodeId: id,
      activeNodeLabel: label,
      lesson: null,
      visual: null,
      flashcards: [],
      quizQuestions: [],
      chatHistory: [],
      studyBuddyHistory: [],
      chatDraft: "",
      streamingChat: "",
      streamingStudyBuddy: "",
      streamingLesson: "",
      lessonStreaming: false,
      studyBuddyInitializing: false,
      lessonWebSources: [],
    }),

  setLesson: (lesson) => set({ lesson }),
  setVisual: (visual) => set({ visual }),
  setFlashcards: (cards) => set({ flashcards: cards }),
  setQuizQuestions: (qs) => set({ quizQuestions: qs }),

  appendLessonToken: (token) =>
    set((s) => ({ streamingLesson: s.streamingLesson + token, lessonStreaming: true })),

  commitLesson: (visualSuggestion, webSources) =>
    set((s) => ({
      lesson: {
        anchor: "",
        grounded_truth: s.streamingLesson,
        citations: [],
        visual_suggestion: visualSuggestion,
      },
      // Cache the completed lesson text keyed by active node so we never re-fetch
      lessonCache: s.activeNodeId
        ? { ...s.lessonCache, [s.activeNodeId]: s.streamingLesson }
        : s.lessonCache,
      streamingLesson: "",
      lessonStreaming: false,
      lessonWebSources: webSources ?? [],
    })),

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

  appendStudyBuddyToken: (token) =>
    set((s) => ({ streamingStudyBuddy: s.streamingStudyBuddy + token })),

  commitStudyBuddyResponse: () =>
    set((s) => ({
      studyBuddyHistory: [
        ...s.studyBuddyHistory,
        { role: "study_buddy" as const, content: s.streamingStudyBuddy },
      ],
      streamingStudyBuddy: "",
    })),

  addChatMessage: (msg) =>
    set((s) => ({ chatHistory: [...s.chatHistory, msg] })),

  addStudyBuddyMessage: (msg) =>
    set((s) => ({ studyBuddyHistory: [...s.studyBuddyHistory, msg] })),
  setStudyBuddyHistory: (history) => set({ studyBuddyHistory: history }),

  setChatDraft: (draft) => set({ chatDraft: draft }),
  setChatHistory: (history) => set({ chatHistory: history }),

  setLessonCache: (cache) => set({ lessonCache: cache }),
  setStudyBuddyInitializing: (initializing) => set({ studyBuddyInitializing: initializing }),

  resetNodeData: () =>
    set({
      lesson: null,
      visual: null,
      flashcards: [],
      quizQuestions: [],
      chatHistory: [],
      studyBuddyHistory: [],
      chatDraft: "",
      streamingChat: "",
      streamingStudyBuddy: "",
      streamingLesson: "",
      lessonStreaming: false,
      studyBuddyInitializing: false,
      lessonWebSources: [],
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
      studyBuddyHistory: [],
      chatDraft: "",
      streamingChat: "",
      streamingStudyBuddy: "",
      streamingLesson: "",
      lessonStreaming: false,
      studyBuddyInitializing: false,
      lessonCache: {},
      lessonWebSources: [],
    }),
}))
