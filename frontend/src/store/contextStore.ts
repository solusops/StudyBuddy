import { create } from "zustand"
import type { SelectionSnippet } from "./interactionStore"

interface ContextStore {
  // Selection context (from Read mode or Annotate mode)
  selectionSnippets: SelectionSnippet[]
  selectionText: string
  surroundingContext: string
  activeNoteText: string
  familiarity: string

  setSelection: (snippets: SelectionSnippet[], text: string, surrounding: string) => void
  clearSelection: () => void
  setActiveNoteText: (note: string) => void
  setFamiliarity: (f: string) => void
}

export const useContextStore = create<ContextStore>((set) => ({
  selectionSnippets: [],
  selectionText: "",
  surroundingContext: "",
  activeNoteText: "",
  familiarity: "high_school",

  setSelection: (snippets, text, surrounding) =>
    set({ selectionSnippets: snippets, selectionText: text, surroundingContext: surrounding }),
  clearSelection: () =>
    set({ selectionSnippets: [], selectionText: "", surroundingContext: "" }),
  setActiveNoteText: (note) => set({ activeNoteText: note }),
  setFamiliarity: (f) => set({ familiarity: f }),
}))
