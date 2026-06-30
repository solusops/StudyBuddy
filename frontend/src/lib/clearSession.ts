import { useSessionStore } from "../store/sessionStore"
import { useGraphStore } from "../store/graphStore"
import { useInteractionStore } from "../store/interactionStore"

/**
 * Full session teardown — backend (chunks, graph, journal, annotations, uploaded
 * file) and frontend (Zustand stores + the localStorage they mirror). A session
 * is exactly one input document, so "Clear" means starting over with nothing.
 */
export async function clearSessionEverywhere(sessionId: string | null, documentId?: string | null): Promise<void> {
  await fetch("/session/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId ?? "", document_id: documentId ?? "" }),
  })
  localStorage.removeItem("studybuddy_session")
  useSessionStore.getState().reset()
  useGraphStore.getState().reset()
  useInteractionStore.getState().resetDocument()
}
