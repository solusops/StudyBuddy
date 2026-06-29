import { useEffect, useRef, useState } from "react"
// plotly.js-dist-min ships a prebuilt bundle (no extra build config needed).
import Plotly from "plotly.js-dist-min"

interface Props {
  /** Raw JSON string: a Plotly spec `{ data: [...], layout: {...} }`. */
  spec: string
}

const DARK_LAYOUT = {
  paper_bgcolor: "#FFFFFF",
  plot_bgcolor: "#FAF7F2",
  font: { color: "#1A3557", family: "system-ui, sans-serif" },
  margin: { t: 30, r: 16, b: 40, l: 48 },
}

/** Renders a Plotly chart from a JSON spec, falling back to raw text on parse error. */
export function PlotlyBlock({ spec }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>("")

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let parsed: { data?: unknown; layout?: Record<string, unknown> }
    try {
      parsed = JSON.parse(spec)
    } catch (e) {
      setError(String(e))
      return
    }
    if (!parsed || !Array.isArray(parsed.data)) {
      setError("Plotly spec missing a `data` array")
      return
    }
    setError("")
    Plotly.newPlot(el, parsed.data as unknown[], { ...DARK_LAYOUT, ...(parsed.layout || {}) }, {
      responsive: true,
      displayModeBar: false,
    })
    return () => {
      Plotly.purge(el)
    }
  }, [spec])

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
      }}>{spec}</pre>
    )
  }

  return (
    <div
      ref={ref}
      style={{
        margin: "10px 0",
        minHeight: 280,
        background: "#FFFFFF",
        border: "1px solid #E8E0D5",
        borderRadius: 10,
      }}
    />
  )
}
