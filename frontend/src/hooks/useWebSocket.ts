import { useCallback, useEffect, useRef } from "react"
import { useGraphStore } from "../store/graphStore"
import { useSessionStore } from "../store/sessionStore"
import type { Flashcard, MCQ, NodeData, NodePatch, WSMessage } from "../types"

// Electron prod: file:// → direct localhost. Web demo: VITE_API_URL → Railway. Dev: Vite proxy.
const _API_URL = import.meta.env.VITE_API_URL as string | undefined
const WS_BASE = window.location.protocol === "file:"
  ? "ws://127.0.0.1:8765"
  : _API_URL
    ? _API_URL.replace(/^http/, "ws")
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`

export function useWebSocket(sessionId: string | null) {
  const ws = useRef<WebSocket | null>(null)
  const pending = useRef<string[]>([])
  const { applyNodePatch, addNode, addEdge, setNodeProgress, setAssessment, replaceGraphData } = useGraphStore()
  const {
    setLesson,
    setVisual,
    setFlashcards,
    setQuizQuestions,
    appendLessonToken,
    commitLesson,
    appendChatToken,
    commitChatResponse,
    appendStudyBuddyToken,
    commitStudyBuddyResponse,
  } = useSessionStore()

  const sendEvent = useCallback(
    (type: string, data: Record<string, unknown> = {}) => {
      const payload = JSON.stringify({ type, data })
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(payload)
      } else {
        // Socket not open yet -> buffer and flush on open (avoids dropping BUILD_GRAPH).
        pending.current.push(payload)
      }
    },
    []
  )

  useEffect(() => {
    if (!sessionId) return

    const socket = new WebSocket(`${WS_BASE}/ws/${sessionId}`)
    ws.current = socket

    socket.onopen = () => {
      while (pending.current.length > 0) {
        const msg = pending.current.shift()
        if (msg) socket.send(msg)
      }
    }

    socket.onmessage = (event) => {
      const msg: WSMessage = JSON.parse(event.data)

      switch (msg.type) {
        case "LESSON_TOKEN":
          appendLessonToken((msg.data as { token: string }).token)
          break
        case "LESSON_DONE": {
          const payload = msg.data as { visual_suggestion: string; web_sources?: { title: string; url: string }[] }
          commitLesson(payload.visual_suggestion ?? "canvas", payload.web_sources)
          break
        }
        case "LESSON_PAYLOAD":
          setLesson(msg.data as unknown as Parameters<typeof setLesson>[0])
          break
        case "VISUAL_PAYLOAD":
          setVisual(msg.data as unknown as Parameters<typeof setVisual>[0])
          break
        case "FLASHCARDS_READY": {
          const payload = msg.data as { cards: Flashcard[] }
          setFlashcards(payload.cards)
          break
        }
        case "QUIZ_READY": {
          const payload = msg.data as { questions: MCQ[] }
          setQuizQuestions(payload.questions)
          break
        }
        case "CHAT_TOKEN":
          appendChatToken((msg.data as { token: string }).token)
          break
        case "CHAT_TOOL":
          window.dispatchEvent(new CustomEvent("chat-tool", { detail: msg.data }))
          break
        case "CHAT_DONE":
          commitChatResponse()
          break
        case "STUDY_BUDDY_TOKEN":
          appendStudyBuddyToken((msg.data as { token: string }).token)
          break
        case "STUDY_BUDDY_DONE":
          commitStudyBuddyResponse()
          break
        case "STUDY_BUDDY_TRANSCRIBED":
          window.dispatchEvent(new CustomEvent("study-buddy-transcribed", { detail: { text: (msg.data as { text: string }).text } }))
          break
        case "SCORE_PATCH":
          applyNodePatch(msg.data as unknown as NodePatch)
          break
        case "GRAPH_NODE_ADDED":
          addNode(msg.data as unknown as NodeData)
          break
        case "GRAPH_EDGE_ADDED": {
          const e = msg.data as { source: string; target: string; relationship?: string }
          addEdge(e.source, e.target, e.relationship)
          break
        }
        case "GRAPH_CLEANUP_DONE": {
          const payload = msg.data as { nodes: NodeData[]; edges: { source: string; target: string; relationship?: string }[] }
          replaceGraphData(payload.nodes, payload.edges)
          break
        }
        case "GRAPH_BUILD_DONE":
          window.dispatchEvent(new CustomEvent("graph-build-done", { detail: msg.data }))
          break
        case "PROGRESS_UPDATE":
          setNodeProgress((msg.data as { nodes: Array<{ node_id: string; percent: number; complete: boolean }> }).nodes)
          break
        case "NODE_ASSESSMENT":
          setAssessment(msg.data as unknown as Parameters<typeof setAssessment>[0])
          window.dispatchEvent(new CustomEvent("node-assessment", { detail: msg.data }))
          break
        case "EVALUATION_DONE":
          window.dispatchEvent(new CustomEvent("evaluation-done", { detail: msg.data }))
          break
        case "QUIZ_FEEDBACK":
          // Handled inside QuizTool via sessionStore
          break
        case "SESSION_COMPLETE":
          // Handled in StudyPage
          window.dispatchEvent(new CustomEvent("session-complete", { detail: msg.data }))
          break
        case "WIKI_DEEPDIVE_VIDEOS":
          window.dispatchEvent(new CustomEvent("wiki-deepdive-videos", { detail: msg.data }))
          break
        case "WIKI_DEEPDIVE_SUMMARY":
          window.dispatchEvent(new CustomEvent("wiki-deepdive-summary", { detail: msg.data }))
          break
        case "WIKI_TOKEN":
          window.dispatchEvent(new CustomEvent("wiki-token", { detail: { token: msg.data.token } }))
          break
        case "WIKI_DONE":
          window.dispatchEvent(new CustomEvent("wiki-done", {}))
          break
        case "WIKI_VISUAL_AVAILABLE":
          window.dispatchEvent(new CustomEvent("wiki-visual-available", { detail: msg.data }))
          break
        case "WIKI_FURTHER_READING":
          window.dispatchEvent(new CustomEvent("wiki-further-reading", { detail: msg.data }))
          break
        case "WIKI_VISUAL_START":
          window.dispatchEvent(new CustomEvent("wiki-visual-start", { detail: msg.data }))
          break
        case "WIKI_VISUAL_PAYLOAD":
          window.dispatchEvent(new CustomEvent("wiki-visual-payload", { detail: msg.data }))
          break
        case "REPORT_PROGRESS":
          window.dispatchEvent(new CustomEvent("report-progress", { detail: msg.data }))
          break
        case "REPORT_TOKEN":
          window.dispatchEvent(new CustomEvent("report-token", { detail: msg.data }))
          break
        case "REPORT_DONE":
          window.dispatchEvent(new CustomEvent("report-done", { detail: msg.data }))
          break
        case "REPORT_SECTION_VISUAL":
          window.dispatchEvent(new CustomEvent("report-section-visual", { detail: msg.data }))
          break
        case "ERROR":
          window.dispatchEvent(new CustomEvent("ws-error", { detail: msg.data }))
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
