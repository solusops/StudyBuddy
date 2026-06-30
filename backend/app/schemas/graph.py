from __future__ import annotations
from typing import Literal, Optional, List, Dict, Any
from pydantic import BaseModel, Field

NodeStatus = Literal["LOCKED", "ACTIVE", "MASTERED", "STRUGGLING", "DEGRADED"]


class NodeScores(BaseModel):
    memory: int = Field(0, ge=0, le=100)
    comprehension: int = Field(0, ge=0, le=100)
    structure: int = Field(0, ge=0, le=100)
    application: int = Field(0, ge=0, le=100)


class NodeData(BaseModel):
    id: str
    label: str
    description: str = ""
    status: NodeStatus = "LOCKED"
    depth: int = 1
    complexity: int = Field(3, ge=1, le=5, description="Conceptual density: 1=simple, 5=very complex")
    scores: NodeScores = Field(default_factory=NodeScores)
    parent_id: Optional[str] = None
    children_ids: List[str] = Field(default_factory=list)
    # Which uploaded paper(s) this node draws from — scopes its lessons/RAG. Empty = all.
    document_ids: List[str] = Field(default_factory=list)


class KnowledgeEdge(BaseModel):
    id: str
    source: str
    target: str
    edge_type: Literal["prerequisite", "related", "contains"] = "prerequisite"


class NodePatch(BaseModel):
    node_id: str
    status: Optional[NodeStatus] = None
    updated_description: Optional[str] = None
    new_children: Optional[List[str]] = Field(None, description="IDs of newly generated sub-topics")
    score_patch: Optional[Dict[str, int]] = None  # keys: memory|comprehension|structure|application


class HTML5VisualPayload(BaseModel):
    html_code: str = Field(description="Self-contained HTML5/CSS/JS code with inline styles.")
    animation_type: Literal["three.js", "canvas", "katex", "plot", "quote", "plotly"]
    explanation: str = Field("", description="A 2-3 sentence explanation describing exactly what the visualization demonstrates, how to use the interactive elements/sliders, and how it connects to the study material.")


class PlotTrace(BaseModel):
    name: str
    chart_type: Literal["bar", "scatter", "line"]
    x: List[str]
    y: List[float]


class GroundedPlotSpec(BaseModel):
    title: str
    x_label: str
    y_label: str
    traces: List[PlotTrace]
    source_note: str


class ExternalAction(BaseModel):
    action_type: Literal["YOUTUBE_FETCH", "GENERATE_FLASHCARDS"]
    parameters: Dict[str, Any]


class OrchestratorAction(BaseModel):
    intent: Literal["UPDATE_GRAPH", "GENERATE_VISUAL", "STREAM_CHAT", "TOOL_CALL"]
    chat_stream_response: str = ""
    graph_patches: Optional[List[NodePatch]] = None
    visual_payload: Optional[HTML5VisualPayload] = None
    tool_execution: Optional[ExternalAction] = None
