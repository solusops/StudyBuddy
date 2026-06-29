// Splits a chat message into prose and fenced diagram/plot blocks so the
// renderer can hand mermaid/plotly segments to dedicated components while
// everything else flows through the existing line-based markdown renderer.

export type ChatBlock =
  | { type: "text"; content: string }
  | { type: "mermaid"; content: string }
  | { type: "plotly"; content: string }

// Languages we intercept. "json" is treated as a plotly spec only when it
// parses to an object with a `data` array (handled at render time); here we
// just tag the fence by its declared language.
const INTERCEPT = new Set(["mermaid", "plotly"])

const FENCE_RE = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g

/**
 * Parse a message into ordered segments. Fenced blocks whose language is
 * `mermaid` or `plotly` become their own typed segment; all other text
 * (including non-intercepted code fences) stays as `text`.
 */
export function splitFencedBlocks(message: string): ChatBlock[] {
  const blocks: ChatBlock[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  FENCE_RE.lastIndex = 0
  while ((match = FENCE_RE.exec(message)) !== null) {
    const lang = match[1].toLowerCase()
    if (!INTERCEPT.has(lang)) continue

    if (match.index > lastIndex) {
      const before = message.slice(lastIndex, match.index)
      if (before.trim()) blocks.push({ type: "text", content: before })
    }

    blocks.push({ type: lang as "mermaid" | "plotly", content: match[2].trim() })
    lastIndex = FENCE_RE.lastIndex
  }

  if (lastIndex < message.length) {
    const rest = message.slice(lastIndex)
    if (rest.trim()) blocks.push({ type: "text", content: rest })
  }

  // A message with no intercepted fences is a single text block.
  if (blocks.length === 0 && message.trim()) {
    blocks.push({ type: "text", content: message })
  }

  return blocks
}
