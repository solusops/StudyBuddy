import katex from "katex"
import "katex/dist/katex.min.css"
import { splitFencedBlocks } from "../../lib/chatBlocks"
import { MermaidBlock } from "../study-tools/MermaidBlock"
import { PlotlyBlock } from "../study-tools/PlotlyBlock"

function renderMath(text: string): string {
  const tex = (src: string, display: boolean) => {
    try {
      return katex.renderToString(src, { displayMode: display, throwOnError: false })
    } catch {
      return display ? `$$${src}$$` : `$${src}$`
    }
  }
  return text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => tex(m, true))
    .replace(/\$([^$\n]+?)\$/g, (_, m) => tex(m, false))
}

function renderInline(text: string): string {
  let r = renderMath(text)
  r = r.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  r = r.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#3b82f6;text-decoration:underline">$1</a>')
  return r
}

function renderProse(text: string) {
  const cleaned = text.replace(/\[Source:\s*[^\]]*\]/gi, "")
  const lines = cleaned.split(/\r?\n/)
  const out: React.ReactNode[] = []
  let bullets: string[] = []
  const flush = (k: string | number) => {
    if (bullets.length) {
      out.push(
        <ul key={`u-${k}`} style={{ margin: "0 0 12px", paddingLeft: 22, lineHeight: 1.75 }}>
          {bullets.map((b, i) => <li key={i} dangerouslySetInnerHTML={{ __html: renderInline(b) }} />)}
        </ul>
      )
      bullets = []
    }
  }
  lines.forEach((line, i) => {
    const t = line.trim()
    if (!t) return
    const h = t.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flush(i)
      const level = h[1].length
      const size = level === 1 ? 26 : level === 2 ? 20 : 17
      out.push(
        <div key={i} style={{ fontFamily: "var(--font-serif)", color: "#1A3557", fontSize: size, fontWeight: 700, margin: level === 1 ? "4px 0 14px" : "20px 0 8px", borderBottom: level <= 2 ? "1px solid #E8E0D5" : "none", paddingBottom: level <= 2 ? 4 : 0 }}
          dangerouslySetInnerHTML={{ __html: renderInline(h[2]) }} />
      )
      return
    }
    if (t.startsWith("* ") || t.startsWith("- ")) { bullets.push(t.replace(/^[*-]\s*/, "")); return }
    flush(i)
    out.push(<p key={i} style={{ margin: "0 0 12px", lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: renderInline(t) }} />)
  })
  flush("end")
  return out
}

/** Renders report/markdown text with KaTeX math + intercepted mermaid/plotly blocks. */
export function ReportMarkdown({ text }: { text: string }) {
  return (
    <>
      {splitFencedBlocks(text).map((b, i) => {
        if (b.type === "mermaid") return <MermaidBlock key={i} code={b.content} />
        if (b.type === "plotly") return <PlotlyBlock key={i} spec={b.content} />
        return <div key={i}>{renderProse(b.content)}</div>
      })}
    </>
  )
}
