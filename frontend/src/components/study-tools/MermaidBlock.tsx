import { useEffect, useRef, useState } from "react"
import mermaid from "mermaid"

mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  themeVariables: {
    primaryColor: "#EEF3F8",
    primaryBorderColor: "#4A7FB5",
    primaryTextColor: "#1A3557",
    lineColor: "#4A7FB5",
    fontFamily: "system-ui, sans-serif",
  },
})

let _seq = 0

interface Props {
  code: string
}

/** Renders a mermaid diagram, falling back to the raw code on syntax error. */
export function MermaidBlock({ code }: Props) {
  const [svg, setSvg] = useState<string>("")
  const [error, setError] = useState<string>("")
  const idRef = useRef(`mmd-${_seq++}`)

  useEffect(() => {
    let cancelled = false
    mermaid
      .render(idRef.current, code)
      .then(({ svg }) => {
        if (!cancelled) {
          setSvg(svg)
          setError("")
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || e))
      })
    return () => {
      cancelled = true
    }
  }, [code])

  if (error) {
    return (
      <pre style={{
        background: "#FAF7F2",
        border: "1px solid #E8E0D5",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 12,
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        color: "#6B7280",
      }}>{code}</pre>
    )
  }

  return (
    <div
      style={{
        margin: "10px 0",
        padding: 8,
        background: "#FFFFFF",
        border: "1px solid #E8E0D5",
        borderRadius: 10,
        overflowX: "auto",
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
