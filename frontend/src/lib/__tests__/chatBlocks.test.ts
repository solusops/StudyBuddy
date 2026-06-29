import { describe, expect, it } from "vitest"
import { splitFencedBlocks } from "../chatBlocks"

describe("splitFencedBlocks", () => {
  it("returns a single text block when there are no fences", () => {
    const blocks = splitFencedBlocks("Just some prose about RNA.")
    expect(blocks).toEqual([{ type: "text", content: "Just some prose about RNA." }])
  })

  it("extracts a mermaid block", () => {
    const msg = "Here is the flow:\n```mermaid\ngraph TD; A-->B;\n```\nThat shows it."
    const blocks = splitFencedBlocks(msg)
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toEqual({ type: "text", content: "Here is the flow:\n" })
    expect(blocks[1]).toEqual({ type: "mermaid", content: "graph TD; A-->B;" })
    expect(blocks[2].type).toBe("text")
  })

  it("extracts a plotly block", () => {
    const msg = '```plotly\n{"data":[{"x":[1],"y":[2]}]}\n```'
    const blocks = splitFencedBlocks(msg)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({ type: "plotly", content: '{"data":[{"x":[1],"y":[2]}]}' })
  })

  it("handles multiple intercepted blocks in order", () => {
    const msg = "intro\n```mermaid\nA-->B\n```\nmid\n```plotly\n{}\n```\nend"
    const types = splitFencedBlocks(msg).map((b) => b.type)
    expect(types).toEqual(["text", "mermaid", "text", "plotly", "text"])
  })

  it("leaves non-intercepted code fences inside text", () => {
    const msg = "look:\n```python\nprint('hi')\n```"
    const blocks = splitFencedBlocks(msg)
    // The python fence is not intercepted, so the whole message stays as text.
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe("text")
    expect(blocks[0].content).toContain("print('hi')")
  })

  it("does not split an unclosed (still-streaming) fence", () => {
    const msg = "building diagram:\n```mermaid\ngraph TD; A-->"
    const blocks = splitFencedBlocks(msg)
    // No closing fence yet — stays as text until the block completes.
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe("text")
  })

  it("is case-insensitive on the language tag", () => {
    const msg = "```Mermaid\ngraph TD; A-->B\n```"
    const blocks = splitFencedBlocks(msg)
    expect(blocks[0].type).toBe("mermaid")
  })
})
