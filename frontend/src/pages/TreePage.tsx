import { KnowledgeGraph } from "../components/graph/KnowledgeGraph"
import type { NodeData } from "../types"

interface Props {
  nodes: NodeData[]
  onBack: () => void
}

export function TreePage({ onBack }: Props) {
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
          style={{
            background: "transparent",
            color: "#1A3557",
            border: "none",
            cursor: "pointer",
            fontSize: 20,
            padding: "0 8px 0 0",
            lineHeight: 1,
          }}
          aria-label="Back to reading"
        >
          ←
        </button>
        <span style={{ fontFamily: "Georgia, serif", fontWeight: 700, color: "#1A3557", fontSize: 15 }}>
          Knowledge Tree
        </span>
        <span style={{ color: "#9CA3AF", fontSize: 12, marginLeft: 4 }}>
          Click a node to study it
        </span>
      </div>

      {/* Tree canvas */}
      <div style={{ flex: 1 }}>
        <KnowledgeGraph
          onNodeClick={(id, label) => {
            // Selecting a node in tree takes user back to manual view
            onBack()
          }}
        />
      </div>
    </div>
  )
}
