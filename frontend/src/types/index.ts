export type NodeStatus = "LOCKED" | "ACTIVE" | "MASTERED" | "STRUGGLING" | "DEGRADED"
export type FamiliarityLevel = "eli5" | "high_school" | "graduate" | "expert"
export type AnimationType = "three.js" | "canvas" | "katex" | "plot" | "quote"

export interface NodeScores {
  memory: number
  comprehension: number
  structure: number
  application: number
}

export interface NodeData {
  id: string
  label: string
  description: string
  status: NodeStatus
  depth: number
  scores: NodeScores
  parent_id: string | null
  children_ids: string[]
}

export interface KnowledgeEdge {
  id: string
  source: string
  target: string
  edge_type: "prerequisite" | "related" | "contains"
}

export interface NodePatch {
  node_id: string
  status?: NodeStatus
  updated_description?: string
  new_children?: string[]
  score_patch?: Partial<NodeScores>
}

export interface LessonPayload {
  anchor: string
  grounded_truth: string
  citations: string[]
  visual_suggestion: string
}

export interface HTML5VisualPayload {
  html_code: string
  animation_type: AnimationType
}

export interface Flashcard {
  front: string
  back: string
}

export interface MCQOption {
  text: string
  is_correct: boolean
}

export interface MCQ {
  question: string
  options: MCQOption[]
  explanation: string
}

export interface WSMessage {
  type: string
  data: Record<string, unknown>
}

// Electron IPC bridge (injected by preload.js)
declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean
      saveFile: (path: string, content: string) => Promise<{ success: boolean; filePath: string }>
      getHomeDir: () => Promise<string>
      selectFolder: (opts?: { title?: string }) => Promise<string | null>
      listFiles: (folderPath: string) => Promise<Array<{ name: string; path: string }>>
      readFile: (filePath: string) => Promise<string>          // base64
      getFileUrl: (filePath: string) => Promise<string>        // file:// URL
    }
  }
}
