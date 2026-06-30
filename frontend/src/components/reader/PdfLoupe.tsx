import { useEffect, useRef } from "react"

const SIZE = 190      // loupe diameter (display px)
const ZOOM = 2.2      // magnification

interface Props {
  active: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Magnifier loupe for the canvas-rendered PDF. When the Loupe mode is active, a
 * circular lens follows the cursor and shows a zoomed bitmap of the page region
 * under it (drawn from the page's <canvas>). Non-interactive; off by default.
 */
export function PdfLoupe({ active, containerRef }: Props) {
  const loupeRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const container = containerRef.current
    const loupe = loupeRef.current
    if (!active || !container || !loupe) return
    const ctx = loupe.getContext("2d")
    if (!ctx) return

    const hide = () => { loupe.style.display = "none" }

    const onMove = (e: MouseEvent) => {
      const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const pageEl = target?.closest?.("[data-page-number]") as HTMLElement | null
      const canvas = pageEl?.querySelector?.("canvas.react-pdf__Page__canvas") as HTMLCanvasElement | null
      if (!canvas) { hide(); return }

      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      const sx = (e.clientX - rect.left) * scaleX
      const sy = (e.clientY - rect.top) * scaleY
      const srcW = (SIZE / ZOOM) * scaleX
      const srcH = (SIZE / ZOOM) * scaleY

      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.save()
      ctx.beginPath()
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = "#FFFFFF"
      ctx.fillRect(0, 0, SIZE, SIZE)
      try {
        ctx.drawImage(canvas, sx - srcW / 2, sy - srcH / 2, srcW, srcH, 0, 0, SIZE, SIZE)
      } catch { /* region out of bounds */ }
      ctx.restore()
      // crosshair
      ctx.strokeStyle = "rgba(26,53,87,0.35)"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(SIZE / 2 - 8, SIZE / 2); ctx.lineTo(SIZE / 2 + 8, SIZE / 2)
      ctx.moveTo(SIZE / 2, SIZE / 2 - 8); ctx.lineTo(SIZE / 2, SIZE / 2 + 8)
      ctx.stroke()

      loupe.style.display = "block"
      // Position above-right of the cursor, clamped to viewport.
      const left = Math.min(window.innerWidth - SIZE - 8, e.clientX + 18)
      const top = Math.max(8, e.clientY - SIZE - 18)
      loupe.style.left = `${left}px`
      loupe.style.top = `${top}px`
    }

    container.addEventListener("mousemove", onMove)
    container.addEventListener("mouseleave", hide)
    return () => {
      container.removeEventListener("mousemove", onMove)
      container.removeEventListener("mouseleave", hide)
      hide()
    }
  }, [active, containerRef])

  if (!active) return null
  return (
    <canvas
      ref={loupeRef}
      width={SIZE}
      height={SIZE}
      style={{
        position: "fixed",
        display: "none",
        pointerEvents: "none",
        zIndex: 3000,
        borderRadius: "50%",
        border: "3px solid #1A3557",
        boxShadow: "0 6px 22px rgba(26,53,87,0.4)",
        background: "#FFFFFF",
      }}
    />
  )
}
