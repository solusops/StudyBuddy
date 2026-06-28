import { useEffect, useRef, useState } from "react"
import type { HTML5VisualPayload } from "../../types"

const API_BASE = "http://127.0.0.1:8000"

// Wraps the visual HTML with an onerror handler that posts SANDBOX_ERROR to parent
function wrapHtml(htmlCode: string): string {
  const errorScript = `<script>window.onerror=function(m,s,l){window.parent.postMessage({type:'SANDBOX_ERROR',error:m+' (line '+l+')'},'*');return true};</script>`
  return `<!DOCTYPE html><html><head>${errorScript}</head><body style="margin:0;background:#0f0f0f">${htmlCode}</body></html>`
}

interface Props {
  visual: HTML5VisualPayload | null
  nodeId: string
  animationType?: string
}

export function VisualSandbox({ visual, nodeId, animationType = "canvas" }: Props) {
  const [srcDoc, setSrcDoc] = useState<string>("")
  const [repairing, setRepairing] = useState(false)

  useEffect(() => {
    if (visual) {
      setSrcDoc(wrapHtml(visual.html_code))
      setRepairing(false)
    }
  }, [visual])

  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      if (e.data?.type !== "SANDBOX_ERROR" || !visual) return
      setRepairing(true)
      try {
        const resp = await fetch(`${API_BASE}/sandbox/repair`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            original_html: visual.html_code,
            error_message: e.data.error,
            node_id: nodeId,
            animation_type: animationType,
          }),
        })
        const data = await resp.json()
        setSrcDoc(wrapHtml(data.visual.html_code))
      } catch {
        // Repair failed — show static error
        setSrcDoc(`<html><body style="color:white;background:#0f0f0f;padding:16px">Visual unavailable.</body></html>`)
      } finally {
        setRepairing(false)
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [visual, nodeId, animationType])

  if (!visual && !repairing) {
    return (
      <div style={{ color: "#64748b", padding: 24, textAlign: "center" }}>
        No visual generated yet.
      </div>
    )
  }

  return (
    <div style={{ position: "relative", width: "100%", height: 380, borderRadius: 8, overflow: "hidden" }}>
      {repairing && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            fontSize: 14,
          }}
        >
          Repairing visual…
        </div>
      )}
      <iframe
        title="visual-sandbox"
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        style={{ width: "100%", height: "100%", border: "none", background: "#0f0f0f" }}
      />
    </div>
  )
}
