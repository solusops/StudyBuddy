import { useEffect, useState } from "react"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import { Check } from "lucide-react"
import type { NodeData } from "../../types"
import { useGraphStore } from "../../store/graphStore"

type ConceptNodeType = Node<NodeData, "concept">

// Status colours — all nodes are open/accessible
const STATUS_COLOR: Record<string, { bg: string; border: string; text: string }> = {
  LOCKED:     { bg: "#EEF3F8", border: "#1A3557", text: "#1A3557" },
  ACTIVE:     { bg: "#EEF3F8", border: "#1A3557", text: "#1A3557" },
  MASTERED:   { bg: "#E6F4ED", border: "#2D6A4F", text: "#2D6A4F" },
  STRUGGLING: { bg: "#FEF2E8", border: "#92400E", text: "#92400E" },
  DEGRADED:   { bg: "#FEF3C7", border: "#B45309", text: "#B45309" },
}

// Complexity → size scaling (1-5 maps to visual dimensions)
function getComplexityStyle(complexity: number) {
  const c = Math.max(1, Math.min(5, complexity))

  // Sizing: larger nodes for more complex topics
  const minWidth = 100 + (c - 1) * 20   // 100 → 180
  const maxWidth = 140 + (c - 1) * 20   // 140 → 220
  const padV = 8 + (c - 1) * 2          // 8 → 16 vertical
  const padH = 12 + (c - 1) * 2         // 12 → 20 horizontal

  // Shading: opacity increases with complexity (more complex = denser fill)
  // Root node (depth 0) uses a distinct accent palette
  const opacity = 0.3 + (c - 1) * 0.175  // 0.30 → 1.0

  return { minWidth, maxWidth, padV, padH, opacity }
}

// Root node gets a special accent color scheme
const ROOT_COLORS = {
  bg: "#1A3557",
  border: "#0F2440",
  text: "#FFFFFF",
}

export function ConceptNode({ id, data, selected }: NodeProps<ConceptNodeType>) {
  // Defer animation to next frame so the browser has a "no-animation" frame first.
  // Prevents the same-frame keyframe skip that leaves nodes invisible on first mount.
  const [animate, setAnimate] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setAnimate(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Deterministic activity-tally progress (auto, from PROGRESS_UPDATE) drives the fill.
  const progress = useGraphStore((s) => s.nodeProgress[id])
  const percent = progress?.percent ?? 0
  const complete = !!progress?.complete
  const isRoot = data.depth === 0
  const complexity = data.complexity ?? 3
  const animIndex = (data as Record<string, unknown>)._animIndex as number | undefined
  const animDelay = (animIndex ?? 0) * 0.04  // stagger 40ms per node for fireworks
  const { minWidth, maxWidth, padV, padH, opacity } = getComplexityStyle(complexity)

  // Color selection: root gets accent, others get status-based
  const baseColors = isRoot ? ROOT_COLORS : (STATUS_COLOR[data.status] ?? STATUS_COLOR.ACTIVE)

  // For non-root nodes, modulate background opacity based on complexity
  const bgColor = isRoot
    ? baseColors.bg
    : blendWithOpacity(baseColors.bg, opacity)

  // Font size scales with depth: root=18px, depth1=15px, depth2=14px, depth3+=13px
  const fontSize = isRoot ? 18 : Math.max(13, 16 - data.depth)

  // Border width: root is bolder
  const borderWidth = isRoot ? 2.5 : selected ? 2 : 1.5

  return (
    <>
      {!isRoot && (
        <Handle type="target" position={Position.Top} style={{ background: baseColors.border, width: 8, height: 8 }} />
      )}
      <div
        data-testid={`node-${id}`}
        style={{
          position: "relative",
          overflow: "hidden",
          background: bgColor,
          padding: `${padV}px ${padH}px`,
          borderRadius: isRoot ? 14 : 10,
          minWidth,
          maxWidth,
          border: `${borderWidth}px solid ${complete ? "#2D6A4F" : baseColors.border}`,
          color: baseColors.text,
          cursor: "pointer",
          userSelect: "none",
          boxShadow: complete
            ? "0 0 0 3px rgba(45,106,79,0.35), 0 0 14px rgba(45,106,79,0.45)"
            : isRoot
              ? "0 4px 16px rgba(26,53,87,0.25)"
              : selected
                ? `0 0 0 3px ${baseColors.border}33`
                : "0 1px 4px rgba(26,53,87,0.08)",
          fontFamily: "'Libre Caslon Text', Georgia, serif",
          textAlign: "center",
          transition: "box-shadow 0.3s, transform 0.15s, border-color 0.3s",
          animation: (animate && !isRoot)
            ? `nodePop 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) ${animDelay}s both`
            : "none",
          opacity: (animate && !isRoot) ? undefined : 1,
        }}
      >
        {/* Activity-tally fill — rises from the bottom, animated */}
        {!isRoot && percent > 0 && (
          <div style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
            height: `${percent}%`,
            background: complete ? "rgba(45,106,79,0.22)" : "rgba(74,127,181,0.16)",
            transition: "height 0.7s cubic-bezier(0.22,1,0.36,1), background 0.3s",
            zIndex: 0,
          }} />
        )}
        <div style={{ position: "relative", zIndex: 1, fontWeight: isRoot ? 800 : 700, fontSize, lineHeight: 1.3 }}>
          {data.label}
        </div>
        {!isRoot && (
          <div style={{ position: "relative", zIndex: 1, fontSize: 10, marginTop: 5, opacity: 0.85, textTransform: "uppercase", letterSpacing: "0.03em", fontWeight: 700, color: complete ? "#2D6A4F" : baseColors.text }}>
            {complete ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Check size={12} /> COMPLETED</span> : `${percent}%`}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: baseColors.border, width: 8, height: 8 }} />
    </>
  )
}

/** Blend a hex colour with a white background at a given opacity */
function blendWithOpacity(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const blend = (c: number) => Math.round(c * opacity + 255 * (1 - opacity))
  return `rgb(${blend(r)}, ${blend(g)}, ${blend(b)})`
}


