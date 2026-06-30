import { create } from "zustand"
import type { ChatSession, WikiPage } from "../types"

export interface StudyBuddyMessage {
  role: "student" | "study_buddy"
  content: string
}

export interface StudyBuddySession {
  id: string
  messages: StudyBuddyMessage[]
  title?: string
  createdAt?: number
  updatedAt?: number
}

export type CursorMode = "DEFAULT" | "NOTE_APPEND" | "MAGNIFY"

export interface BoundingBox {
  page: number
  x: number  // normalised 0..1 relative to page element
  y: number
  w: number
  h: number
}

export interface SelectionSnippet {
  page_number: number
  text: string
  boxes: BoundingBox[]
}

export interface CommittedAnnotation {
  annotation_id: string
  document_id: string
  session_id: string
  target_snippets: SelectionSnippet[]
  note_text: string | null
  image_base64?: string | null  // P3: cropped canvas PNG
  created_at: number
  updated_at: number
}

interface InteractionStore {
  cursorMode: CursorMode
  regionsOn: boolean
  activeSelectionGroup: SelectionSnippet[]
  activeAnnotationId: string | null
  committedAnnotations: CommittedAnnotation[]
  documentId: string | null
  blinkTarget: { page: number, boxes: BoundingBox[] } | null

  setCursorMode: (mode: CursorMode) => void
  toggleRegions: () => void
  pushSnippet: (snippet: SelectionSnippet) => void
  clearGroup: () => void
  setActiveAnnotation: (id: string | null) => void
  setDocumentId: (id: string | null) => void
  setBlinkTarget: (target: { page: number, boxes: BoundingBox[] } | null) => void
  setAnnotations: (annotations: CommittedAnnotation[]) => void
  addAnnotation: (annotation: CommittedAnnotation) => void
  updateAnnotationNote: (id: string, note: string) => void
  removeAnnotation: (id: string) => void
  notePositions: Record<string, number>
  updateNotePosition: (id: string, yNorm: number) => void

  wikiHistory: Record<string, WikiPage[]> // key = documentId
  pushWikiPage: (docId: string, page: WikiPage) => void
  updateWikiPage: (docId: string, term: string, patch: Partial<WikiPage>) => void

  chatSessions: ChatSession[]
  activeChatSessionId: string | null
  setActiveChatSession: (id: string | null) => void
  addChatSession: (session: ChatSession) => void
  updateChatSession: (id: string, messages: ChatSession["messages"]) => void

  studyBuddySessions: StudyBuddySession[]
  activeStudyBuddySessionId: string | null
  setActiveStudyBuddySession: (id: string | null) => void
  addStudyBuddySession: (session: StudyBuddySession) => void
  updateStudyBuddySession: (id: string, messages: StudyBuddySession["messages"]) => void

  // Wipes every document-scoped field (in-memory + the localStorage it mirrors).
  // A session is exactly one document, so clearing a session means clearing all of this.
  resetDocument: () => void
}

// Load initial note positions from localStorage
const savedPositions = localStorage.getItem("studybuddy_note_positions")
const initialPositions = savedPositions ? JSON.parse(savedPositions) : {}

const savedWikiHistory = localStorage.getItem("studybuddy_wiki_history")
const initialWikiHistory = savedWikiHistory ? JSON.parse(savedWikiHistory) : {}

const savedChatSessions = localStorage.getItem("studybuddy_chat_sessions")
const initialChatSessions = savedChatSessions ? JSON.parse(savedChatSessions) : []

const savedStudyBuddySessions = localStorage.getItem("studybuddy_sb_sessions")
const initialStudyBuddySessions = savedStudyBuddySessions ? JSON.parse(savedStudyBuddySessions) : []

export const useInteractionStore = create<InteractionStore>((set) => ({
  cursorMode: "DEFAULT",
  regionsOn: false,
  activeSelectionGroup: [],
  activeAnnotationId: null,
  committedAnnotations: [],
  documentId: null,
  blinkTarget: null,
  notePositions: initialPositions,

  setCursorMode: (mode) => set({ cursorMode: mode }),
  toggleRegions: () => set((s) => ({ regionsOn: !s.regionsOn })),
  pushSnippet: (snippet) =>
    set((s) => ({ activeSelectionGroup: [...s.activeSelectionGroup, snippet] })),
  clearGroup: () => set({ activeSelectionGroup: [] }),
  setActiveAnnotation: (id) => set({ activeAnnotationId: id }),
  setDocumentId: (id) => set({ documentId: id }),
  setBlinkTarget: (target) => set({ blinkTarget: target }),
  setAnnotations: (annotations) => set({ committedAnnotations: annotations }),
  addAnnotation: (annotation) =>
    set((s) => ({ committedAnnotations: [...s.committedAnnotations, annotation] })),
  updateAnnotationNote: (id, note) =>
    set((s) => ({
      committedAnnotations: s.committedAnnotations.map((a) =>
        a.annotation_id === id ? { ...a, note_text: note, updated_at: Date.now() / 1000 } : a
      ),
    })),
  removeAnnotation: (id) =>
    set((s) => ({
      committedAnnotations: s.committedAnnotations.filter((a) => a.annotation_id !== id),
    })),
  updateNotePosition: (id, yNorm) =>
    set((s) => {
      const next = { ...s.notePositions, [id]: yNorm }
      localStorage.setItem("studybuddy_note_positions", JSON.stringify(next))
      return { notePositions: next }
    }),

  wikiHistory: initialWikiHistory,
  pushWikiPage: (docId, page) =>
    set((s) => {
      const nextList = [...(s.wikiHistory[docId] || []), page]
      const next = { ...s.wikiHistory, [docId]: nextList }
      localStorage.setItem("studybuddy_wiki_history", JSON.stringify(next))
      return { wikiHistory: next }
    }),
  updateWikiPage: (docId, term, patch) =>
    set((s) => {
      const list = s.wikiHistory[docId] || []
      const nextList = list.map((p) => (p.term === term ? { ...p, ...patch } : p))
      const next = { ...s.wikiHistory, [docId]: nextList }
      localStorage.setItem("studybuddy_wiki_history", JSON.stringify(next))
      return { wikiHistory: next }
    }),

  chatSessions: initialChatSessions,
  activeChatSessionId: null,
  setActiveChatSession: (id) => set({ activeChatSessionId: id }),
  addChatSession: (session) =>
    set((s) => {
      const next = [...s.chatSessions, session]
      localStorage.setItem("studybuddy_chat_sessions", JSON.stringify(next))
      return { chatSessions: next }
    }),
  updateChatSession: (id, messages) =>
    set((s) => {
      const next = s.chatSessions.map((c) => (c.id === id ? { ...c, messages } : c))
      localStorage.setItem("studybuddy_chat_sessions", JSON.stringify(next))
      return { chatSessions: next }
    }),

  studyBuddySessions: initialStudyBuddySessions,
  activeStudyBuddySessionId: null,
  setActiveStudyBuddySession: (id) => set({ activeStudyBuddySessionId: id }),
  addStudyBuddySession: (session) =>
    set((s) => {
      const next = [...s.studyBuddySessions, session]
      localStorage.setItem("studybuddy_sb_sessions", JSON.stringify(next))
      return { studyBuddySessions: next }
    }),
  updateStudyBuddySession: (id, messages) =>
    set((s) => {
      const next = s.studyBuddySessions.map((c) => (c.id === id ? { ...c, messages } : c))
      localStorage.setItem("studybuddy_sb_sessions", JSON.stringify(next))
      return { studyBuddySessions: next }
    }),

  resetDocument: () => {
    localStorage.removeItem("studybuddy_note_positions")
    localStorage.removeItem("studybuddy_wiki_history")
    localStorage.removeItem("studybuddy_chat_sessions")
    localStorage.removeItem("studybuddy_sb_sessions")
    set({
      documentId: null,
      committedAnnotations: [],
      activeAnnotationId: null,
      activeSelectionGroup: [],
      blinkTarget: null,
      notePositions: {},
      wikiHistory: {},
      chatSessions: [],
      activeChatSessionId: null,
      studyBuddySessions: [],
      activeStudyBuddySessionId: null,
    })
  },
}))
