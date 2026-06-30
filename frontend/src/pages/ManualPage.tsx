import { useCallback, useEffect, useState } from "react"
import { PDFReader } from "../components/reader/PDFReader"
import { ScientificFigurePanel } from "../components/reader/ScientificFigurePanel"
import { FileText, Check } from "lucide-react"
import { useGraphStore } from "../store/graphStore"
import { useSessionStore } from "../store/sessionStore"
import { useInteractionStore } from "../store/interactionStore"
import { useContextStore } from "../store/contextStore"
import { saveMarkdownFile, sanitizeFilename } from "../lib/fileSystem"
import type { AppSession } from "../App"
import type { NodeData } from "../types"
import type { Edge, Node } from "@xyflow/react"

interface Props {
  session: AppSession | null
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  onShowTree: () => void
  onNeedSetup: () => void
}

export function ManualPage({ session, sendEvent, onShowTree, onNeedSetup }: Props) {
  const { setGraph } = useGraphStore()
  const { setSession, activeNodeId, activeNodeLabel, setActiveNode } = useSessionStore()
  const { documentId, setDocumentId } = useInteractionStore()

  // -- Session bootstrap ------------------------------------------------
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [topic, setTopic] = useState("Study Buddy")
  const [isIndexing, setIsIndexing] = useState(false)
  const [contentFiles, setContentFiles] = useState<string[]>([])
  const [activePDFPath, setActivePDFPath] = useState<string | null>(null)
  const [activePDFUrl, setActivePDFUrl] = useState<string | null>(null)

  // For the right panel — seed from sessionStore if coming from TreePage node selection
  const [activeConcept, setActiveConcept] = useState<string | null>(activeNodeLabel || null)
  const [concepts, setConcepts] = useState<string[]>([])

  const isElectron = typeof window !== "undefined" && !!window.electronAPI

  useEffect(() => {
    if (session) {
      // Session passed from setup modal
      applySession(session)
    } else {
      // Auto-resume from configured library
      resumeSession()
    }
  }, [])

  const applySession = async (s: AppSession) => {
    setSessionId(s.sessionId)
    setTopic(s.topic)
    setSession(s.sessionId, s.topic, s.familiarity, s.knowledgeMode)
    if (s.documentId) {
      setDocumentId(s.documentId)
    }
    applyNodes(s.nodes)
    setContentFiles(s.contentFiles)
    setIsIndexing(true)
    if (s.contentFiles.length > 0) {
      await loadFirstPDF(s.contentFiles[0])
    }
    // Check indexing status handled by useEffect
  }

  const resumeSession = async () => {
    try {
      const statusResp = await fetch("/library/status")
      const status = await statusResp.json()
      if (!status.configured || !status.content_files.length) {
        onNeedSetup()
        return
      }

      // Create a new session
      const sessionResp = await fetch("/session/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: "Study Session", familiarity: "high_school" }),
      })
      const { session_id } = await sessionResp.json()
      setSessionId(session_id)
      setSession(session_id, "Study Session", "high_school")

      if (status.document_id) {
        setDocumentId(status.document_id)
      }

      // Generate tree
      const startResp = await fetch("/library/start-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id, familiarity: "high_school" }),
      })
      const { nodes, document_id } = await startResp.json()
      applyNodes(nodes)
      setContentFiles(status.content_files)
      setTopic(status.content_files[0]?.replace(/\.[^.]+$/, "") || "Study Session")

      if (document_id) {
        setDocumentId(document_id)
      }

      if (status.content_files.length > 0) {
        await loadFirstPDF(status.content_files[0])
      }
    } catch {
      onNeedSetup()
    }
  }

  const applyNodes = (nodes: NodeData[]) => {
    const flowNodes: Node<NodeData>[] = nodes.map((n, i) => ({
      id: n.id,
      type: "concept",
      position: { x: i * 200, y: 0 },
      data: { ...n, _animIndex: i },
    }))
    const edges: Edge[] = nodes.flatMap((n) =>
      (n.children_ids ?? []).map((cid) => ({
        id: `${n.id}-${cid}`,
        source: n.id,
        target: cid,
        type: "smoothstep",
      }))
    )
    setGraph(flowNodes, edges)
  }

  const loadFirstPDF = async (filename: string) => {
    const status = await fetch("/library/status").then((r) => r.json())
    const folder = status.content_folder
    if (!folder) return
    const filePath = `${folder}/${filename}`.replace(/\\/g, "/")
    setActivePDFPath(filePath)

    if (isElectron) {
      const url = await window.electronAPI!.getFileUrl(filePath)
      setActivePDFUrl(url)
    } else {
      // Browser mode — backend serves uploaded files via /library/file/{name}
      setActivePDFUrl(`/library/file/${encodeURIComponent(filename)}`)
    }
  }

  useEffect(() => {
    if (!isIndexing) return
    const timeout = setTimeout(() => setIsIndexing(false), 3000)
    return () => clearTimeout(timeout)
  }, [isIndexing])

  // -- WebSocket -- sendEvent is provided by parent App (single connection) --

  // Listen for session complete
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail
      const home = isElectron ? await window.electronAPI!.getHomeDir() : "~"
      await saveMarkdownFile(
        `${home}/.studybuddy/summaries/${sanitizeFilename(topic)}_Summary.md`,
        detail.markdown
      )
    }
    window.addEventListener("session-complete", handler)
    return () => window.removeEventListener("session-complete", handler)
  }, [topic, isElectron])

  // -- Concept highlighting -----------------------------------------------
  const handlePageTextReady = useCallback(
    async (_pageNum: number, text: string) => {
      if (!text.trim() || concepts.length > 0) return  // already have concepts
      try {
        const resp = await fetch("/library/highlight-concepts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page_text: text, familiarity: "high_school" }),
        })
        const { concepts: found } = await resp.json()
        setConcepts((prev) => {
          const merged = [...new Set([...prev, ...found])]
          return merged.slice(0, 30)  // cap for performance
        })
      } catch { /* ignore */ }
    },
    [concepts.length]
  )

  const handleConceptClick = useCallback(
    (concept: string) => {
      setActiveConcept(concept)
      // Pick a node id so node-scoped tools (Chat) stay usable.
      const { nodes } = useGraphStore.getState()
      const match = nodes.find((n) =>
        n.data.label.toLowerCase().includes(concept.toLowerCase()) ||
        concept.toLowerCase().includes(n.data.label.toLowerCase())
      )
      const nodeId = match?.id ?? `concept-${concept.toLowerCase().replace(/\s+/g, "-")}`
      setActiveNode(nodeId, concept)
      // Transfer context exactly like a manual text selection, then open Infinite Wiki
      // (it auto-fires on the new selection; Chat also picks up the context chip).
      useContextStore.getState().setSelection([], concept, "")
      window.dispatchEvent(new CustomEvent("studybuddy-open-tool", { detail: { tool: "Infinite Wiki" } }))
    },
    [setActiveNode]
  )

  const [isPushing, setIsPushing] = useState(false)
  const [pushDone, setPushDone] = useState(false)
  const [commitDone, setCommitDone] = useState(false)

  const commitSession = async () => {
    const { nodes, edges } = useGraphStore.getState()
    const { lessonCache } = useSessionStore.getState()
    await fetch("/session/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        topic,
        familiarity: "high_school",
        nodes: nodes.map((n) => n.data),
        content_files: contentFiles,
      }),
    })
    const toSave = {
      sessionId,
      topic,
      familiarity: "high_school",
      nodes: nodes.map((n) => n.data),
      edges: edges.map((e) => ({ source: e.source, target: e.target, relationship: (e.data as Record<string, string> | undefined)?.relationship ?? "prerequisite" })),
      contentFiles,
      lessonCache,
    }
    localStorage.setItem("studybuddy_session", JSON.stringify(toSave))
    setCommitDone(true)
    setTimeout(() => setCommitDone(false), 2500)
  }

  const pushSession = async () => {
    if (isPushing) return
    setIsPushing(true)
    setPushDone(false)
    const onDone = () => { setIsPushing(false); setPushDone(true) }
    window.addEventListener("evaluation-done", onDone, { once: true })
    sendEvent("EVALUATE_SESSION", { topic, familiarity: "high_school" })
  }

  const clearSession = async () => {
    await fetch("/session/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    })
    localStorage.removeItem("studybuddy_session")
    onNeedSetup()
  }

  // -- Render -------------------------------------------------------------
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#FAF7F2" }}>
      {/* Top bar */}
      <div style={{
        height: 48,
        background: "#FFFFFF",
        borderBottom: "1px solid #E8E0D5",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 12,
        flexShrink: 0,
      }}>
        {/* App name */}
        <span style={{ fontFamily: "'Libre Caslon Text', Georgia, serif", fontWeight: 700, color: "#1A3557", fontSize: 17, marginRight: 8 }}>
          Study Buddy
        </span>

        {/* Document title */}
        <span style={{ color: "#1A1A2E", fontSize: 15, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {topic}
        </span>

        {/* Indexing badge */}
        {isIndexing && (
          <span style={{
            background: "#EEF3F8",
            color: "#4A7FB5",
            fontSize: 13,
            padding: "3px 10px",
            borderRadius: 20,
            fontWeight: 500,
          }}>
            Indexing documents…
          </span>
        )}

        {/* File tabs */}
        <div style={{ display: "flex", gap: 4 }}>
          {contentFiles.slice(0, 3).map((f) => (
            <button
              key={f}
              onClick={() => loadFirstPDF(f)}
              style={{
                background: activePDFPath?.endsWith(f) ? "#EEF3F8" : "transparent",
                color: activePDFPath?.endsWith(f) ? "#1A3557" : "#6B7280",
                border: "1px solid",
                borderColor: activePDFPath?.endsWith(f) ? "#1A3557" : "#E8E0D5",
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 13,
                cursor: "pointer",
                fontWeight: activePDFPath?.endsWith(f) ? 600 : 400,
                maxWidth: 120,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {f.replace(/\.[^.]+$/, "")}
            </button>
          ))}
        </div>

        {/* Tree button */}
        <button
          onClick={onShowTree}
          style={{
            background: "transparent",
            color: "#1A3557",
            border: "1.5px solid #1A3557",
            borderRadius: 8,
            padding: "5px 14px",
            fontSize: 14,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Tree
        </button>

        {/* Commit */}
        <button
          onClick={commitSession}
          disabled={commitDone}
          title="Save progress to disk"
          style={{
            background: commitDone ? "#E6F4ED" : "transparent",
            color: "#2D6A4F",
            border: "1px solid #2D6A4F",
            borderRadius: 8,
            padding: "5px 14px",
            fontSize: 14,
            cursor: commitDone ? "default" : "pointer",
            fontWeight: 600,
            transition: "background 0.2s",
          }}
        >
          {commitDone ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Saved <Check size={14} /></span> : "Commit"}
        </button>

        {/* Push */}
        <button
          onClick={pushSession}
          disabled={isPushing}
          title="Evaluate work against skill tree"
          style={{
            background: isPushing ? "#E8E0D5" : "#1A3557",
            color: isPushing ? "#9CA3AF" : "#FAF7F2",
            border: "none",
            borderRadius: 8,
            padding: "5px 14px",
            fontSize: 14,
            cursor: isPushing ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {isPushing ? "Evaluating…" : pushDone ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Pushed <Check size={14} /></span> : "Push"}
        </button>

        {/* Clear */}
        <button
          onClick={clearSession}
          title="Delete session and start fresh"
          style={{
            background: "transparent",
            color: "#9CA3AF",
            border: "1px solid #E8E0D5",
            borderRadius: 8,
            padding: "5px 14px",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Clear
        </button>
      </div>

      {/* Main split view */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: PDF viewer */}
        {activePDFUrl ? (
          <PDFReader
            fileUrl={activePDFUrl}
            concepts={concepts}
            onPageTextReady={handlePageTextReady}
            onConceptClick={handleConceptClick}
            documentId={documentId || undefined}
            sessionId={sessionId || undefined}
          />
        ) : (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const file = Array.from(e.dataTransfer.files).find((f) => f.name.endsWith(".pdf"))
              if (file) {
                const url = URL.createObjectURL(file)
                setActivePDFUrl(url)
                setActivePDFPath(file.name)
              }
            }}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 16,
              color: "#9CA3AF",
              border: "2px dashed #E8E0D5",
              margin: 24,
              borderRadius: 16,
              cursor: "default",
            }}
          >
            <div style={{ opacity: 0.4 }}><FileText size={40} /></div>
            <p style={{ margin: 0, fontSize: 16, fontFamily: "'Libre Caslon Text', Georgia, serif", color: "#6B7280", textAlign: "center" }}>
              {isElectron ? "Loading document…" : "Drop a PDF here to view it"}
            </p>
            {!isElectron && (
              <p style={{ margin: 0, fontSize: 14, color: "#D1C9C0", textAlign: "center", maxWidth: 320 }}>
                Or open in Electron for automatic PDF loading from your library.
              </p>
            )}
          </div>
        )}

        {/* Right: Scientific figure panel */}
        <ScientificFigurePanel
          activeConcept={activeConcept}
          activeNodeId={activeNodeId}
          sendEvent={sendEvent}
        />
      </div>
    </div>
  )
}
