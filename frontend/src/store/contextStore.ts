import { create } from "zustand"
import type { SelectionSnippet } from "./interactionStore"

interface ContextStore {
  // Selection context (from Read mode or Annotate mode)
  selectionSnippets: SelectionSnippet[]
  selectionText: string
  surroundingContext: string
  selectionImageBase64?: string
  activeNoteText: string
  familiarity: string

  setSelection: (snippets: SelectionSnippet[], text: string, surrounding: string, imageBase64?: string) => void
  clearSelection: () => void
  setActiveNoteText: (note: string) => void
  setFamiliarity: (f: string) => void
}

export const useContextStore = create<ContextStore>((set) => ({
  selectionSnippets: [],
  selectionText: "",
  surroundingContext: "",
  selectionImageBase64: undefined,
  activeNoteText: "",
  familiarity: "high_school",

  setSelection: (snippets, text, surrounding, imageBase64) =>
    set({ selectionSnippets: snippets, selectionText: text, surroundingContext: surrounding, selectionImageBase64: imageBase64 }),
  clearSelection: () =>
    set({ selectionSnippets: [], selectionText: "", surroundingContext: "", selectionImageBase64: undefined }),
  setActiveNoteText: (note) => set({ activeNoteText: note }),
  setFamiliarity: (f) => set({ familiarity: f }),
}))
