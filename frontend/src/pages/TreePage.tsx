import { useCallback, useEffect, useState } from "react"
import katex from "katex"
import "katex/dist/katex.min.css"
import { KnowledgeGraph } from "../components/graph/KnowledgeGraph"
import { Check, X, ArrowLeft, ArrowRight } from "lucide-react"
import { ReportView } from "../components/panel/ReportView"
import { EvaluationView } from "../components/panel/EvaluationView"
import { useTokenRate } from "../lib/useTokenRate"
import { clearSessionEverywhere } from "../lib/clearSession"
import { ConfirmDialog } from "../components/overlay/ConfirmDialog"
import { useGraphStore } from "../store/graphStore"
import { useSessionStore } from "../store/sessionStore"
import { useInteractionStore } from "../store/interactionStore"
import type { AppSession } from "../App"
import type { NodeData } from "../types"
import type { Edge, Node } from "@xyflow/react"

interface Props {
  session: AppSession | null
  sendEvent: (type: string, data?: Record<string, unknown>) => void
  onBack: () => void
  onStartStudying: () => void
  onNeedSetup: () => void
}

export function TreePage({ session, sendEvent, onBack, onStartStudying, onNeedSetup }: Props) {
  const { nodes, setGraph } = useGraphStore()
  const { streamingLesson, lessonStreaming, lesson, lessonCache, lessonWebSources, setLesson, knowledgeMode, setActiveNode } = useSessionStore()
  const { isDemoMode } = useInteractionStore()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refinementText, setRefinementText] = useState("")
  const [isRefining, setIsRefining] = useState(false)
  const [refineError, setRefineError] = useState("")
  const [isPushing, setIsPushing] = useState(false)
  const [pushDone, setPushDone] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [showEval, setShowEval] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const selectedNode = nodes.find((n) => n.id === selectedId)
  const lessonRate = useTokenRate(streamingLesson, lessonStreaming)

  const applyGraph = (rawNodes: NodeData[], rawEdges?: any[]) => {
    const flowNodes: Node<NodeData>[] = rawNodes.map((n, i) => ({
      id: n.id,
      type: "concept",
      position: { x: i * 200, y: 0 },
      data: { ...n, _animIndex: i },
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

  // On first mount: restored session → seed nodes. Otherwise stream via BUILD_GRAPH,
  // but ONLY when the store is empty -> so navigating back to the tree doesn't wipe and
  // regenerate it. The backend reuses (replays) a graph already built for this PDF.
  useEffect(() => {
    if (useGraphStore.getState().nodes.length > 0) return  // already populated -> keep it
    if (session?.nodes?.length) {
      applyGraph(session.nodes, session.edges)
    } else if (session?.sessionId) {
      sendEvent("BUILD_GRAPH", {
        familiarity: session.familiarity ?? "high_school",
        topic: session.topic ?? "",
        document_id: session.documentId ?? "",
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refresh deterministic node progress (activity tally) on every visit to the graph.
  useEffect(() => {
    if (session?.sessionId) sendEvent("PROGRESS_REQUEST", {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleNodeClick = useCallback(
    (id: string, label: string) => {
      setSelectedId(id)
      setActiveNode(id, label)
      const cached = lessonCache[id]
      if (cached) {
        // Restore from cache -> no WS round-trip, no token cost
        setLesson({ anchor: "", grounded_truth: cached, citations: [], visual_suggestion: "canvas" })
      } else {
        sendEvent("LEARN_NODE", {
          node_id: id,
          node_label: label,
          familiarity: session?.familiarity ?? "high_school",
          knowledge_mode: knowledgeMode,
        })
      }
    },
    [sendEvent, session?.familiarity, lessonCache, setLesson, knowledgeMode, setActiveNode]
  )



  // Refine tree with student guidance -> sends current graph as context
  const refineTree = async () => {
    if (!refinementText.trim() || !session) return
    setRefineError("")
    setIsRefining(true)
    try {
      const { nodes: currentNodes, edges: currentEdges } = useGraphStore.getState()
      const resp = await fetch("/library/refine-tree", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: session.sessionId,
          user_feedback: refinementText,
          familiarity: session.familiarity,
          document_id: session.documentId ?? "",
          current_nodes: currentNodes.map((n) => ({
            id: n.data.id,
            label: n.data.label,
            description: n.data.description,
            depth: n.data.depth,
            complexity: n.data.complexity,
            parent_id: n.data.parent_id,
          })),
          current_edges: currentEdges.map((e) => ({
            source: e.source,
            target: e.target,
            relationship: (e.data as Record<string, string> | undefined)?.relationship ?? "prerequisite",
          })),
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

  // Render lesson text with KaTeX math, bold, bullets, and citation stripping
  const renderLesson = (text: string) => {
    // Strip [Source: X, chunk N] citations -> internal metadata, not student-facing
    const cleaned = text.replace(/\[Source:\s*[^\]]*\]/gi, "")

    return cleaned.split(/\n\n+/).map((para, pi) => {
      const trimmed = para.trim()
      if (!trimmed) return null

      // Handle bullet list lines
      if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
        const items = trimmed.split(/\n/).filter((l) => l.trim())
        return (
          <ul key={pi} style={{ margin: "0 0 12px", paddingLeft: 20, lineHeight: 1.75 }}>
            {items.map((item, li) => (
              <li key={li} dangerouslySetInnerHTML={{ __html: renderInline(item.replace(/^[*-]\s*/, "")) }} />
            ))}
          </ul>
        )
      }

      return (
        <p key={pi} style={{ margin: "0 0 12px", lineHeight: 1.75 }}
          dangerouslySetInnerHTML={{ __html: renderInline(trimmed) }} />
      )
    })
  }

  // Render inline content: $$display math$$, $inline math$, **bold**
  const renderInline = (text: string): string => {
    // Process display math $$...$$ first
    let result = text.replace(/\$\$([^$]+)\$\$/g, (_match, tex) => {
      try {
        return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false })
      } catch { return tex }
    })
    // Process inline math $...$
    result = result.replace(/\$([^$]+)\$/g, (_match, tex) => {
      try {
        return katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false })
      } catch { return tex }
    })
    // Process **bold**
    result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    return result
  }

  const pushSession = () => {
    if (isPushing || isDemoMode || !session) return
    setIsPushing(true)
    setPushDone(false)
    setShowEval(true)  // open the Evaluation window to show reasoned scores + trajectory
    const onDone = () => { setIsPushing(false); setPushDone(true) }
    window.addEventListener("evaluation-done", onDone, { once: true })
    sendEvent("EVALUATE_SESSION", {
      topic: session.topic,
      familiarity: session.familiarity,
      document_id: session.documentId ?? "",
      content_files: session.contentFiles ?? [],
    })
  }

  const clearSession = async () => {
    await clearSessionEverywhere(session?.sessionId ?? null, session?.documentId ?? null)
    setShowClearConfirm(false)
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
          aria-label="Back to Start"
          title="Back to Start"
        >
          <ArrowLeft size={16} />
        </button>
        <span style={{ fontFamily: "'Libre Caslon Text', Georgia, serif", fontWeight: 700, color: "#1A3557", fontSize: 17, flex: 1 }}>
          {nodes.find((n) => n.data.depth === 0)?.data.label || session?.topic || "Knowledge Tree"}
        </span>
        <span style={{ color: "#9CA3AF", fontSize: 14 }}>
          Click a node to explore · edit its description · refine the whole tree below
        </span>
        {/* Compile Report -> amalgamates your notes across the paper into one document */}
        <button
          onClick={() => setShowReport(true)}
          title="Compile a report from your notes on this paper"
          style={{
            background: "#1A3557",
            color: "#FAF7F2",
            border: "none",
            borderRadius: 6,
            padding: "4px 12px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Compile Report
        </button>

        {/* Evaluation -> reasoned scores + learning trajectory */}
        <button
          onClick={() => setShowEval(true)}
          title="See reasoned mastery scores and your learning trajectory"
          style={{
            background: "transparent",
            color: "#1A3557",
            border: "1px solid #1A3557",
            borderRadius: 6,
            padding: "4px 12px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Evaluation
        </button>

        {/* Push */}
        <button
          onClick={pushSession}
          disabled={isPushing || isDemoMode}
          title={isDemoMode ? "Disabled in demo mode" : "Evaluate work against skill tree"}
          style={{
            background: isPushing ? "#E8E0D5" : isDemoMode ? "#E8E0D5" : "#1A3557",
            color: isPushing ? "#9CA3AF" : isDemoMode ? "#D1D5DB" : "#FAF7F2",
            border: "none",
            borderRadius: 6,
            padding: "4px 12px",
            fontSize: 14,
            fontWeight: 600,
            cursor: isPushing || isDemoMode ? "not-allowed" : "pointer",
          }}
        >
          {isPushing ? "Evaluating…" : pushDone ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Pushed <Check size={14} /></span> : "Push"}
        </button>

        {/* Clear */}
        <button
          onClick={() => setShowClearConfirm(true)}
          title="Delete session and start fresh"
          style={{ background: "transparent", color: "#9CA3AF", border: "1px solid #E8E0D5", borderRadius: 6, padding: "4px 12px", fontSize: 14, cursor: "pointer" }}
        >
          Clear
        </button>
      </div>

      {showClearConfirm && (
        <ConfirmDialog
          title="Clear this session?"
          message="This permanently deletes your curriculum tree, lessons, flashcards, quiz progress, notes, and the uploaded document for this session. This cannot be undone."
          confirmLabel="Clear everything"
          onConfirm={clearSession}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}

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
              </div>
              <button
                onClick={() => setSelectedId(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 18, padding: 0, lineHeight: 1 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Lesson content */}
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#6B7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Lesson
                </label>
                {lessonStreaming && (
                  <div style={{ fontSize: 15, color: "#1A1A2E", fontFamily: "'Libre Caslon Text', Georgia, serif" }}>
                    {renderLesson(streamingLesson)}
                    <span style={{ display: "inline-block", width: 2, height: "1em", background: "#1A3557", marginLeft: 2, animation: "blink 1s step-end infinite", verticalAlign: "text-bottom" }} />
                    {lessonRate > 0 && <span className="ts-badge">{lessonRate} t/s</span>}
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
                {!lessonStreaming && lessonWebSources.length > 0 && (
                  <div style={{ marginTop: 16, borderTop: "1px solid #E8E0D5", paddingTop: 12 }}>
                    <h4 style={{
                      fontFamily: "'Libre Caslon Text', Georgia, serif",
                      color: "#1A3557",
                      fontSize: 13,
                      fontWeight: 700,
                      margin: "0 0 8px 0",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}>
                      Web Sources
                    </h4>
                    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                      {lessonWebSources.map((s, i) => (
                        <li key={i} style={{ fontSize: 13, lineHeight: 1.4 }}>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#3b82f6", textDecoration: "underline", fontWeight: 600 }}
                          >
                            {s.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Study tools shortcut -> dynamic text based on progress */}
              <button
                onClick={onStartStudying}
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
                {(selectedNode.data.scores.memory > 0 || selectedNode.data.scores.comprehension > 0 || selectedNode.data.scores.structure > 0 || selectedNode.data.scores.application > 0)
                  ? <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>Continue Studying <ArrowRight size={16} /></span>
                  : <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>Start Studying <ArrowRight size={16} /></span>}
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
            {isRefining ? "Refining…" : "Refine"}
          </button>
        </div>
        {refineError && <p style={{ color: "#EF4444", fontSize: 14, margin: 0 }}>{refineError}</p>}
      </div>

      {showReport && (
        <ReportView session={session} sendEvent={sendEvent} onClose={() => setShowReport(false)} />
      )}
      {showEval && (
        <EvaluationView session={session} sendEvent={sendEvent} onClose={() => setShowEval(false)} />
      )}
    </div>
  )
}
