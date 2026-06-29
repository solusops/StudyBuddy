import { useCallback, useEffect, useRef } from "react"
import { useGraphStore } from "../store/graphStore"
import { useSessionStore } from "../store/sessionStore"
import type { Flashcard, MCQ, NodePatch, WSMessage } from "../types"

// In dev, Vite proxies /ws/* to the backend. In Electron prod, use direct localhost.
const WS_BASE = window.location.protocol === "file:"
  ? "ws://127.0.0.1:8000"
  : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`

export function useWebSocket(sessionId: string | null) {
  const ws = useRef<WebSocket | null>(null)
  const { applyNodePatch } = useGraphStore()
  const {
    setLesson,
    setVisual,
    setFlashcards,
    setQuizQuestions,
    appendChatToken,
    commitChatResponse,
    appendFeynmanToken,
    commitFeynmanResponse,
  } = useSessionStore()

  const sendEvent = useCallback(
    (type: string, data: Record<string, unknown> = {}) => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type, data }))
      }
    },
    []
  )

  useEffect(() => {
    if (!sessionId) return

    const socket = new WebSocket(`${WS_BASE}/ws/${sessionId}`)
    ws.current = socket

    socket.onmessage = (event) => {
      const msg: WSMessage = JSON.parse(event.data)

      switch (msg.type) {
        case "LESSON_PAYLOAD":
          setLesson(msg.data as unknown as Parameters<typeof setLesson>[0])
          break
        case "VISUAL_PAYLOAD":
          setVisual(msg.data as unknown as Parameters<typeof setVisual>[0])
          break
        case "FLASHCARDS_READY":
          setFlashcards((msg.data as { cards: Flashcard[] }).cards)
          break
        case "QUIZ_READY":
          setQuizQuestions((msg.data as { questions: MCQ[] }).questions)
          break
        case "CHAT_TOKEN":
          appendChatToken((msg.data as { token: string }).token)
          break
        case "CHAT_DONE":
          commitChatResponse()
          break
        case "FEYNMAN_TOKEN":
          appendFeynmanToken((msg.data as { token: string }).token)
          break
        case "FEYNMAN_DONE":
          commitFeynmanResponse()
          break
        case "SCORE_PATCH":
          applyNodePatch(msg.data as unknown as NodePatch)
          break
        case "QUIZ_FEEDBACK":
          // Handled inside QuizTool via sessionStore
          break
        case "SESSION_COMPLETE":
          // Handled in StudyPage
          window.dispatchEvent(new CustomEvent("session-complete", { detail: msg.data }))
          break
        case "INFINITY_WIKI_RESULT":
          window.dispatchEvent(new CustomEvent("infinity-wiki-result", { detail: msg.data }))
          break
      }
    }

    return () => {
      socket.close()
      ws.current = null
    }
  }, [sessionId])

  return { sendEvent }
}
