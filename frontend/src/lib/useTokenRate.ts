import { useRef } from "react"

/**
 * Live tokens/second for a streaming text output. Pure (no state/effects): recomputes
 * on each render — which is exactly when a new token has been appended. Approximates
 * tokens as chars/4 (Cerebras deltas vary in length). Returns 0 until ~0.3s elapsed.
 */
export function useTokenRate(text: string, streaming: boolean): number {
  const start = useRef<{ t: number; len: number } | null>(null)
  if (!streaming) {
    start.current = null
    return 0
  }
  if (!start.current) start.current = { t: performance.now(), len: text.length }
  const elapsed = (performance.now() - start.current.t) / 1000
  if (elapsed < 0.3) return 0
  const tokens = Math.max(0, text.length - start.current.len) / 4
  return Math.round(tokens / elapsed)
}
