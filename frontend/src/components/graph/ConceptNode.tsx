import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import type { NodeData } from "../../types"

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
  const avg = Math.round(
    (data.scores.memory + data.scores.comprehension + data.scores.structure + data.scores.application) / 4
  )
  const isRoot = data.depth === 0
  const complexity = data.complexity ?? 3
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
          background: bgColor,
          padding: `${padV}px ${padH}px`,
          borderRadius: isRoot ? 14 : 10,
          minWidth,
          maxWidth,
          border: `${borderWidth}px solid ${baseColors.border}`,
          color: baseColors.text,
          cursor: "pointer",
          userSelect: "none",
          boxShadow: isRoot
            ? "0 4px 16px rgba(26,53,87,0.25)"
            : selected
              ? `0 0 0 3px ${baseColors.border}33`
              : "0 1px 4px rgba(26,53,87,0.08)",
          fontFamily: "'Libre Caslon Text', Georgia, serif",
          textAlign: "center",
          transition: "box-shadow 0.2s, transform 0.15s",
          animation: "nodePop 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        }}
      >
        <div style={{ fontWeight: isRoot ? 800 : 700, fontSize, lineHeight: 1.3 }}>
          {data.label}
        </div>
        {!isRoot && (
          <div style={{ fontSize: 10, marginTop: 5, opacity: 0.8, textTransform: "uppercase", letterSpacing: "0.03em", fontWeight: 600 }}>
            {data.status === "MASTERED" ? "COMPLETED" : `${avg}%`}
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


