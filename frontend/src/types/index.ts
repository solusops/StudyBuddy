export type NodeStatus = "LOCKED" | "ACTIVE" | "MASTERED" | "STRUGGLING" | "DEGRADED"
export type FamiliarityLevel = "eli5" | "high_school" | "graduate" | "expert"
export type AnimationType = "three.js" | "canvas" | "katex" | "plot" | "quote" | "plotly"

export interface NodeScores {
  memory: number
  comprehension: number
  structure: number
  application: number
}

export interface NodeData {
  // Index signature lets NodeData satisfy @xyflow/react's `Record<string, unknown>`
  // node-data constraint (React Flow v12).
  [key: string]: unknown
  id: string
  label: string
  description: string
  status: NodeStatus
  depth: number
  complexity: number
  scores: NodeScores
  parent_id: string | null
  children_ids: string[]
  document_ids?: string[]
}

export interface KnowledgeEdge {
  source: string
  target: string
  relationship: "prerequisite" | "related" | "builds-on"
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
  explanation?: string
}

export interface Flashcard {
  front: string
  back: string
  source_location?: any
  source_chunk_text?: string
}

export interface MCQOption {
  text: string
  is_correct: boolean
}

export interface MCQ {
  question: string
  options: MCQOption[]
  explanation: string
  source_location?: any
  source_chunk_text?: string
}

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
  selectionText?: string
  selectionImageBase64?: string
}

export interface ChatSession {
  id: string
  messages: ChatMessage[]
  title?: string
  documentId?: string | null
  timestamp?: number
  createdAt?: number
  updatedAt?: number
}

export interface VisualOffer {
  modality: "STATIC_PLOT" | "INTERACTIVE_SIMULATION"
  recommended_tool: string
  label: string
}

export interface ScholarPaper {
  title: string
  authors: string
  year: number | null
  cited_by: number
  url: string
}

export interface WikiPage {
  term: string
  content: string
  streaming: boolean
  visual?: HTML5VisualPayload | null
  visualLoading?: boolean
  visualOffer?: VisualOffer | null
  papers?: ScholarPaper[]
  imageBase64?: string
  recallGenerated?: boolean
  videos?: Array<{ video_id: string; title: string; channel: string; thumbnail: string; url: string }>
  videosLoading?: boolean
  activeVideoId?: string
  videoSummary?: { video_id: string; summary: string; key_points?: string[] }
}

export interface WSMessage {
  type: string
  data: Record<string, unknown>
}

// Annotation types (mirroring backend schemas/annotation.py)
export interface AnnotationBox {
  page: number
  x: number
  y: number
  w: number
  h: number
}

export interface AnnotationSnippet {
  page_number: number
  text: string
  boxes: AnnotationBox[]
}

export interface StudentAnnotation {
  annotation_id: string
  document_id: string
  session_id: string
  target_snippets: AnnotationSnippet[]
  note_text: string | null
  image_base64?: string | null
  created_at: number
  updated_at: number
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
