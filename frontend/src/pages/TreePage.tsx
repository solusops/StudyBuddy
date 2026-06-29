import { useCallback, useEffect, useState, Fragment } from "react"
import { KnowledgeGraph } from "../components/graph/KnowledgeGraph"
import { useGraphStore } from "../store/graphStore"
import { useSessionStore } from "../store/sessionStore"
import type { AppSession } from "../App"
import type { NodeData } from "../types"
import type { Edge, Node } from "@xyflow/react"

interface Props {
  session: AppSession | null
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  onBack: () => void
  onNeedSetup: () => void
}

export function TreePage({ session, sendEvent, onBack, onNeedSetup }: Props) {
  const { nodes, setGraph } = useGraphStore()
  const { streamingLesson, lessonStreaming, lesson, lessonCache, setLesson } = useSessionStore()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editedLabel, setEditedLabel] = useState("")
  const [editedDesc, setEditedDesc] = useState("")
  const [editedStatus, setEditedStatus] = useState<NodeData["status"]>("ACTIVE")
  const [refinementText, setRefinementText] = useState("")
  const [isRefining, setIsRefining] = useState(false)
  const [refineError, setRefineError] = useState("")
  const [isPushing, setIsPushing] = useState(false)
  const [pushDone, setPushDone] = useState(false)
  const [commitDone, setCommitDone] = useState(false)

  const selectedNode = nodes.find((n) => n.id === selectedId)

  const applyGraph = (rawNodes: NodeData[], rawEdges?: Array<{source: string; target: string; relationship: string}>) => {
    const flowNodes: Node<NodeData>[] = rawNodes.map((n, i) => ({
      id: n.id,
      type: "concept",
      position: { x: i * 200, y: 0 },
      data: n,
    }))
    // Use explicit AI-generated edges if provided; fall back to children_ids
    const flowEdges: Edge[] = rawEdges?.length
      ? rawEdges.map((e) => ({
          id: `${e.source}-${e.target}`,
          source: e.source,
          target: e.target,
          type: "smoothstep",
          data: { relationship: e.relationship },
        }))
      : rawNodes.flatMap((n) =>
          (n.children_ids ?? []).map((cid) => ({
            id: `${n.id}-${cid}`,
            source: n.id,
            target: cid,
            type: "smoothstep",
          }))
        )
    setGraph(flowNodes, flowEdges)
  }

  // Seed the graph store from session nodes on first mount
  useEffect(() => {
    if (session?.nodes?.length) {
      applyGraph(session.nodes, session.edges)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When node is selected, pre-fill the description edit box
  useEffect(() => {
    if (selectedNode) {
      setEditedLabel(selectedNode.data.label)
      setEditedDesc(selectedNode.data.description)
      setEditedStatus(selectedNode.data.status)
    }
  }, [selectedId])

  const handleNodeClick = useCallback(
    (id: string, label: string) => {
      setSelectedId(id)
      const cached = lessonCache[id]
      if (cached) {
        // Restore from cache — no WS round-trip, no token cost
        setLesson({ anchor: "", grounded_truth: cached, citations: [], visual_suggestion: "canvas" })
      } else {
        sendEvent("LEARN_NODE", {
          node_id: id,
          node_label: label,
          familiarity: session?.familiarity ?? "high_school",
        })
      }
    },
    [sendEvent, session?.familiarity, lessonCache, setLesson]
  )

  // Apply local description edit to the graph store
  const applyNodeEdit = () => {
    if (!selectedId) return
    const { nodes: storeNodes, edges } = useGraphStore.getState()
    const updated = storeNodes.map((n) =>
      n.id === selectedId
        ? { ...n, data: { ...n.data, label: editedLabel, description: editedDesc, status: editedStatus } }
        : n
    )
    setGraph(updated, edges)
  }

  // Regenerate tree with student guidance
  const refineTree = async () => {
    if (!refinementText.trim() || !session) return
    setRefineError("")
    setIsRefining(true)
    try {
      const resp = await fetch("/library/refine-tree", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: session.sessionId,
          user_feedback: refinementText,
          familiarity: session.familiarity,
        }),
      })
      if (!resp.ok) {
        const e = await resp.json()
        throw new Error(e.detail || "Refinement failed")
      }
      const { nodes: newNodes, edges: newEdges } = await resp.json()
      applyGraph(newNodes, newEdges)
      setRefinementText("")
      setSelectedId(null)
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsRefining(false)
    }
  }

  const lessonText = lessonStreaming ? streamingLesson : (lesson?.grounded_truth ?? "")

  // Render markdown-ish lesson text: **bold**, paragraph breaks
  const renderLesson = (text: string) => {
    return text.split(/\n\n+/).map((para, pi) => {
      const parts = para.split(/(\*\*[^*]+\*\*)/g)
      return (
        <p key={pi} style={{ margin: "0 0 12px", lineHeight: 1.75 }}>
          {parts.map((part, i) =>
            part.startsWith("**") && part.endsWith("**")
              ? <strong key={i}>{part.slice(2, -2)}</strong>
              : <Fragment key={i}>{part}</Fragment>
          )}
        </p>
      )
    })
  }

  const commitSession = async () => {
    const { nodes, edges } = useGraphStore.getState()
    const { lessonCache } = useSessionStore.getState()
    await fetch("/session/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: session?.sessionId,
        topic: session?.topic ?? "Study Session",
        familiarity: session?.familiarity ?? "high_school",
        nodes: nodes.map((n) => n.data),
        content_files: session?.contentFiles ?? [],
      }),
    })
    // Persist full session state — nodes, edges, lessonCache — to localStorage
    const toSave = {
      sessionId: session?.sessionId,
      topic: session?.topic ?? "Study Session",
      familiarity: session?.familiarity ?? "high_school",
      nodes: nodes.map((n) => n.data),
      edges: edges.map((e) => ({ source: e.source, target: e.target, relationship: (e.data as Record<string, string> | undefined)?.relationship ?? "prerequisite" })),
      contentFiles: session?.contentFiles ?? [],
      lessonCache,
    }
    localStorage.setItem("studybuddy_session", JSON.stringify(toSave))
    setCommitDone(true)
    setTimeout(() => setCommitDone(false), 2500)
  }

  const pushSession = () => {
    if (isPushing || !session) return
    setIsPushing(true)
    setPushDone(false)
    const onDone = () => { setIsPushing(false); setPushDone(true) }
    window.addEventListener("evaluation-done", onDone, { once: true })
    sendEvent("EVALUATE_SESSION", { topic: session.topic, familiarity: session.familiarity })
  }

  const clearSession = async () => {
    await fetch("/session/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: session?.sessionId }),
    })
    localStorage.removeItem("studybuddy_session")
    onNeedSetup()
  }

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
        <button
          onClick={onBack}
          style={{ background: "transparent", color: "#1A3557", border: "none", cursor: "pointer", fontSize: 20, padding: "0 8px 0 0", lineHeight: 1 }}
          aria-label="Back to reading"
        >
          ←
        </button>
        <span style={{ fontFamily: "'Libre Caslon Text', Georgia, serif", fontWeight: 700, color: "#1A3557", fontSize: 17, flex: 1 }}>
          {session?.topic || "Knowledge Tree"}
        </span>
        <span style={{ color: "#9CA3AF", fontSize: 14 }}>
          Click a node to explore · edit its description · refine the whole tree below
        </span>
        {/* Commit */}
        <button
          onClick={commitSession}
          disabled={commitDone}
          title="Save progress to disk"
          style={{
            background: commitDone ? "#E6F4ED" : "transparent",
            color: commitDone ? "#2D6A4F" : "#2D6A4F",
            border: "1px solid #2D6A4F",
            borderRadius: 6,
            padding: "4px 12px",
            fontSize: 14,
            fontWeight: 600,
            cursor: commitDone ? "default" : "pointer",
            transition: "background 0.2s",
          }}
        >
          {commitDone ? "Saved ✓" : "Commit"}
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
            borderRadius: 6,
            padding: "4px 12px",
            fontSize: 14,
            fontWeight: 600,
            cursor: isPushing ? "not-allowed" : "pointer",
          }}
        >
          {isPushing ? "Evaluating…" : pushDone ? "Pushed ✓" : "Push"}
        </button>

        {/* Clear */}
        <button
          onClick={clearSession}
          title="Delete session and start fresh"
          style={{ background: "transparent", color: "#9CA3AF", border: "1px solid #E8E0D5", borderRadius: 6, padding: "4px 12px", fontSize: 14, cursor: "pointer" }}
        >
          Clear
        </button>
      </div>

      {/* Main area: graph + sliding node panel */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Knowledge graph */}
        <div style={{ flex: 1 }}>
          <KnowledgeGraph onNodeClick={handleNodeClick} />
        </div>

        {/* Sliding node panel */}
        {selectedNode && (
          <div style={{
            width: 360,
            display: "flex",
            flexDirection: "column",
            background: "#FFFFFF",
            borderLeft: "1px solid #E8E0D5",
            overflow: "hidden",
            flexShrink: 0,
          }}>
            {/* Panel header */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #E8E0D5", display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1A3557", fontFamily: "'Libre Caslon Text', Georgia, serif" }}>
                  {selectedNode.data.label}
                </h3>
                <span style={{
                  display: "inline-block", marginTop: 4, fontSize: 13, fontWeight: 500,
                  color: selectedNode.data.status === "MASTERED" ? "#2D6A4F" : selectedNode.data.status === "ACTIVE" ? "#1A3557" : "#9CA3AF",
                  background: selectedNode.data.status === "MASTERED" ? "#E6F4ED" : selectedNode.data.status === "ACTIVE" ? "#EEF3F8" : "#F3F0ED",
                  borderRadius: 4, padding: "2px 8px",
                }}>
                  {selectedNode.data.status}
                </span>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 18, padding: 0, lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Editable label */}
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#6B7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Label
                </label>
                <input
                  value={editedLabel}
                  onChange={(e) => setEditedLabel(e.target.value)}
                  style={{
                    width: "100%",
                    background: "#FAF7F2",
                    border: "1px solid #E8E0D5",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 15,
                    color: "#1A1A2E",
                    boxSizing: "border-box",
                    fontFamily: "'Libre Caslon Text', Georgia, serif",
                    outline: "none",
                  }}
                />
              </div>

              {/* Status picker */}
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#6B7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Status
                </label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["ACTIVE", "MASTERED", "STRUGGLING", "DEGRADED", "LOCKED"] as NodeData["status"][]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setEditedStatus(s)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: editedStatus === s ? "2px solid #1A3557" : "1.5px solid #E8E0D5",
                        background: editedStatus === s ? "#EEF3F8" : "transparent",
                        color: editedStatus === s ? "#1A3557" : "#6B7280",
                        fontSize: 13,
                        fontWeight: editedStatus === s ? 600 : 400,
                        cursor: "pointer",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Editable description */}
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#6B7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Description
                </label>
                <textarea
                  value={editedDesc}
                  onChange={(e) => setEditedDesc(e.target.value)}
                  rows={3}
                  style={{
                    width: "100%",
                    background: "#FAF7F2",
                    border: "1px solid #E8E0D5",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 15,
                    color: "#1A1A2E",
                    resize: "vertical",
                    boxSizing: "border-box",
                    fontFamily: "'Libre Caslon Text', Georgia, serif",
                    outline: "none",
                  }}
                />
              </div>

              {/* Apply button — shows when any field changed */}
              {(editedLabel !== selectedNode.data.label || editedDesc !== selectedNode.data.description || editedStatus !== selectedNode.data.status) && (
                <button
                  onClick={applyNodeEdit}
                  style={{
                    background: "#1A3557",
                    color: "#FAF7F2",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 14px",
                    fontSize: 14,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Apply changes
                </button>
              )}

              {/* Lesson content */}
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#6B7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Lesson
                </label>
                {lessonStreaming && (
                  <div style={{ fontSize: 15, color: "#1A1A2E", fontFamily: "'Libre Caslon Text', Georgia, serif" }}>
                    {renderLesson(streamingLesson)}
                    <span style={{ display: "inline-block", width: 2, height: "1em", background: "#1A3557", marginLeft: 2, animation: "blink 1s step-end infinite", verticalAlign: "text-bottom" }} />
                  </div>
                )}
                {!lessonStreaming && lessonText && (
                  <div style={{ fontSize: 15, color: "#1A1A2E", fontFamily: "'Libre Caslon Text', Georgia, serif" }}>
                    {renderLesson(lessonText)}
                  </div>
                )}
                {!lessonStreaming && !lessonText && (
                  <p style={{ color: "#9CA3AF", fontSize: 15, margin: 0 }}>Loading lesson…</p>
                )}
              </div>

              {/* Study tools shortcut */}
              <button
                onClick={onBack}
                style={{
                  background: "transparent",
                  color: "#1A3557",
                  border: "1.5px solid #1A3557",
                  borderRadius: 8,
                  padding: "9px 0",
                  fontSize: 15,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontFamily: "'Libre Caslon Text', Georgia, serif",
                }}
              >
                Open study tools →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom: curriculum refinement bar */}
      <div style={{
        borderTop: "1px solid #E8E0D5",
        background: "#FFFFFF",
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#9CA3AF", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Refine curriculum
            </label>
            <textarea
              value={refinementText}
              onChange={(e) => setRefinementText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) refineTree() }}
              placeholder='e.g. "Focus more on thermodynamics", "The tree is missing fluid dynamics", "Too many sub-nodes for chapter 1"'
              rows={2}
              style={{
                width: "100%",
                background: "#FAF7F2",
                border: "1px solid #E8E0D5",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 15,
                color: "#1A1A2E",
                resize: "none",
                boxSizing: "border-box",
                outline: "none",
                fontFamily: "system-ui, sans-serif",
              }}
            />
          </div>
          <button
            onClick={refineTree}
            disabled={isRefining || !refinementText.trim()}
            style={{
              background: isRefining || !refinementText.trim() ? "#E8E0D5" : "#1A3557",
              color: isRefining || !refinementText.trim() ? "#9CA3AF" : "#FAF7F2",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 15,
              fontWeight: 600,
              cursor: isRefining || !refinementText.trim() ? "not-allowed" : "pointer",
              flexShrink: 0,
              alignSelf: "flex-end",
            }}
          >
            {isRefining ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
        {refineError && <p style={{ color: "#EF4444", fontSize: 14, margin: 0 }}>{refineError}</p>}
      </div>
    </div>
  )
}
