import { create } from "zustand"

export type CursorMode = "DEFAULT" | "NOTE_APPEND"

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
  activeSelectionGroup: SelectionSnippet[]
  activeAnnotationId: string | null
  committedAnnotations: CommittedAnnotation[]
  documentId: string | null

  setCursorMode: (mode: CursorMode) => void
  pushSnippet: (snippet: SelectionSnippet) => void
  clearGroup: () => void
  setActiveAnnotation: (id: string | null) => void
  setDocumentId: (id: string | null) => void
  setAnnotations: (annotations: CommittedAnnotation[]) => void
  addAnnotation: (annotation: CommittedAnnotation) => void
  updateAnnotationNote: (id: string, note: string) => void
  removeAnnotation: (id: string) => void
}

export const useInteractionStore = create<InteractionStore>((set) => ({
  cursorMode: "DEFAULT",
  activeSelectionGroup: [],
  activeAnnotationId: null,
  committedAnnotations: [],
  documentId: null,

  setCursorMode: (mode) => set({ cursorMode: mode }),
  pushSnippet: (snippet) =>
    set((s) => ({ activeSelectionGroup: [...s.activeSelectionGroup, snippet] })),
  clearGroup: () => set({ activeSelectionGroup: [] }),
  setActiveAnnotation: (id) => set({ activeAnnotationId: id }),
  setDocumentId: (id) => set({ documentId: id }),
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
}))
