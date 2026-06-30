"""Tutor Agent — grounded lessons, HTML5 visuals, sandbox repair.

Every fact in grounded_truth must cite its RAG source.
Visuals go through a server-side syntax pre-flight before being sent to the
client, so students never see a red JavaScript error.
"""
import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.agents.cerebras_client import CerebrasClient
from app.schemas.graph import GroundedPlotSpec, HTML5VisualPayload, NodeData

_PLOTLY_CDN = "https://cdn.plot.ly/plotly-2.35.2.min.js"

_VISUAL_INSTRUCTIONS: Dict[str, str] = {
    "three.js": (
        "Use Three.js r128 via CDN: "
        "<script src='https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'></script>. "
        "Render to a full-page canvas."
    ),
    "canvas": "Use HTML5 <canvas> with requestAnimationFrame. Pure vanilla JS only.",
    "katex": (
        "Use KaTeX via CDN: "
        "<link rel='stylesheet' href='https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css'>"
        "<script src='https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js'></script>. "
        "Render LaTeX with katex.renderToString()."
    ),
    "plot": "Use inline SVG or vanilla Canvas to draw the plot. No external charting libs.",
    "quote": "Display the authoritative quote in a styled <blockquote>. No JS needed.",
}


class LessonPayload(BaseModel):
    anchor: str = Field(description="Conceptual introduction tailored to familiarity level")
    grounded_truth: str = Field(
        description="Facts with inline [Source: X, chunk N] citations from the RAG chunks"
    )
    citations: List[str]
    visual_suggestion: str = Field(
        description="One of: three.js, canvas, katex, plot, quote, none"
    )


class _Flashcard(BaseModel):
    front: str
    back: str


class _FlashcardsPayload(BaseModel):
    cards: List[_Flashcard]


class _MCQOption(BaseModel):
    text: str
    is_correct: bool


class _MCQ(BaseModel):
    question: str
    options: List[_MCQOption]
    explanation: str


class _QuizPayload(BaseModel):
    questions: List[_MCQ]


class TutorAgent:
    def __init__(self, client: Optional[CerebrasClient] = None) -> None:
        self._client = client or CerebrasClient()

    # ------------------------------------------------------------------ #
    # Lesson                                                               #
    # ------------------------------------------------------------------ #

    async def stream_lesson(
        self,
        node: NodeData,
        chunks: List[Dict[str, Any]],
        familiarity: str,
        knowledge_mode: str = "content_only",
        web_context: str = "",
    ):
        """Async generator that yields lesson text tokens for streaming to the client."""
        chunk_text = "\n\n".join(
            f"[Source: {c['source']}, chunk {c.get('chunk_index', i)}]\n{c['text']}"
            for i, c in enumerate(chunks)
        )
        # Familiarity-aware math formatting instruction
        if familiarity in ("graduate", "expert"):
            math_note = (
                "You may use LaTeX math notation with $...$ for inline math and $$...$$ for display math. "
                "Use proper LaTeX commands (e.g. \\frac{a}{b}, \\sqrt{x}, \\hat{m}_t)."
            )
        else:
            math_note = (
                "Describe all mathematical concepts in plain words and simple notation. "
                "Do NOT use LaTeX $ delimiters or complex formulas. "
                "For example, say 'a divided by b' instead of $\\frac{a}{b}$."
            )

        if knowledge_mode == "net_support":
            grounding = (
                "Ground your explanation in the provided source material and the web source material. "
                "Draw on your expert knowledge to fully explain the topic, give intuition and analogies, "
                "and fill any gaps the source doesn't cover. Do NOT refuse to teach the requested topic under "
                "any circumstances. If the topic is not discussed in the source material, use the web source "
                "and your own knowledge to teach it fully. Do not fabricate source claims."
            )
        else:
            grounding = (
                "Base the lesson on the provided source material when possible. Teach the topic clearly and "
                "relate it to the theme of the material. "
                "IMPORTANT: If the requested topic is not mentioned or discussed in the source material, "
                "do NOT refuse to teach it and do NOT just talk about other topics from the source (e.g. do not just "
                "talk about Adam). Instead, explain the requested topic clearly using your own general knowledge, "
                "and explain how it relates generally to the themes of the source material. Never invent false claims "
                "about what the source says."
            )
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a Cognitive Translator and tutor. Your job is to TEACH the requested "
                    f"topic — do NOT refuse, and do NOT state that the topic is not mentioned in the text. "
                    f"Teach it anyway. {grounding}\n\n"
                    "Write a single, flowing lesson — do NOT split into separate sections like "
                    "'Concept' or 'From the Source'. Weave the intuitive explanation and factual "
                    "details together naturally into one coherent narrative.\n\n"
                    "FORMATTING RULES:\n"
                    f"- {math_note}\n"
                    "- Use **bold** for key terms.\n"
                    "- Use bullet points (lines starting with '* ') for lists.\n"
                    "- Do NOT include [Source: X, chunk N] citations or Web source URLs in your output — "
                    "the student should not see internal source or web reference links."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Teach '{node.label}' at {familiarity} level.\n\n"
                    f"SOURCE MATERIAL:\n{chunk_text}"
                ),
            },
        ]
        if web_context:
            messages[-1]["content"] += f"\n\nWEB SOURCE MATERIAL:\n{web_context}"

        async for token in self._client.stream_complete(messages):
            yield token

    def generate_lesson(
        self,
        node: NodeData,
        chunks: List[Dict[str, Any]],
        familiarity: str,
    ) -> LessonPayload:
        chunk_text = "\n\n".join(
            f"[Source: {c['source']}, chunk {c.get('chunk_index', i)}]\n{c['text']}"
            for i, c in enumerate(chunks)
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a Cognitive Translator. Use ONLY the provided source material. "
                    "Every fact in grounded_truth MUST have an inline citation like "
                    "[Source: X, chunk N]. Never hallucinate. If the source doesn't cover "
                    "something, say so explicitly."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Teach '{node.label}' at {familiarity} level.\n\n"
                    f"SOURCE MATERIAL:\n{chunk_text}\n\n"
                    "Write anchor (intuitive intro), grounded_truth (cited facts), "
                    "and pick a visual_suggestion."
                ),
            },
        ]
        return self._client.structured_complete(messages, LessonPayload)

    # ------------------------------------------------------------------ #
    # Flashcards + Quiz                                                   #
    # ------------------------------------------------------------------ #

    def generate_flashcards(
        self, node_label: str, chunks: List[Dict[str, Any]], familiarity: str, images_base64: Optional[List[str]] = None
    ) -> _FlashcardsPayload:
        chunk_text = "\n\n".join(
            f"[Source: {c['source']}]\n{c['text']}" for c in chunks
        )
        user_content: List[Dict[str, Any]] = [
            {
                "type": "text",
                "text": (
                    f"Create flashcards specifically focused on the concept '{node_label}' at the {familiarity} level.\n\n"
                    f"SOURCE:\n{chunk_text}"
                ),
            }
        ]
        if images_base64:
            for img in images_base64:
                user_content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img}"}})

        messages = [
            {
                "role": "system",
                "content": (
                    f"Generate 5-10 open-recall flashcards specifically about the topic requested, using the source material and any provided images. "
                    "front = question/prompt, back = answer with a source citation."
                ),
            },
            {
                "role": "user",
                "content": user_content,
            },
        ]
        return self._client.structured_complete(messages, _FlashcardsPayload, model="gemma-4-31b")

    def generate_quiz(
        self, node_label: str, chunks: List[Dict[str, Any]], familiarity: str, images_base64: Optional[List[str]] = None
    ) -> _QuizPayload:
        chunk_text = "\n\n".join(
            f"[Source: {c['source']}]\n{c['text']}" for c in chunks
        )
        user_content: List[Dict[str, Any]] = [
            {
                "type": "text",
                "text": (
                    f"Create quiz questions specifically about the concept '{node_label}' at the {familiarity} level.\n\n"
                    f"SOURCE:\n{chunk_text}"
                ),
            }
        ]
        if images_base64:
            for img in images_base64:
                user_content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img}"}})

        messages = [
            {
                "role": "system",
                "content": (
                    "Generate exactly 5 multiple-choice questions specifically about the topic requested, using the source material and any provided images. "
                    "Each question has exactly 1 correct option and 3 distractors. "
                    "Include a brief explanation referencing the source."
                ),
            },
            {
                "role": "user",
                "content": user_content,
            },
        ]
        return self._client.structured_complete(messages, _QuizPayload, model="gemma-4-31b")

    # ------------------------------------------------------------------ #
    # Visuals                                                             #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _syntax_preflight(html_code: str) -> Optional[str]:
        """Return error string if any <script> block has a syntax error, else None."""
        scripts = re.findall(r"<script[^>]*>(.*?)</script>", html_code, re.DOTALL)
        for script in scripts:
            try:
                compile(script, "<visual>", "exec")
            except SyntaxError as exc:
                return str(exc)
        return None

    def generate_visual(
        self,
        concept: str,
        animation_type: str,
        familiarity: str,
        chunks: Optional[List[Dict[str, Any]]] = None,
    ) -> HTML5VisualPayload:
        instruction = _VISUAL_INSTRUCTIONS.get(animation_type, "Use plain HTML/CSS.")
        grounding_block = ""
        if chunks:
            chunk_text = "\n\n".join(
                f"[{c.get('source', '?')}]: {c['text']}" for c in chunks
            )[:3000]
            grounding_block = (
                f"\n\nSOURCE MATERIAL (ground every quantity, relationship, and label "
                f"in this text only — do not invent data):\n{chunk_text}"
            )
        messages = [
            {
                "role": "system",
                "content": (
                    f"Generate a self-contained HTML5 page visualising '{concept}'. "
                    f"{instruction} "
                    "No external URLs except the CDN scripts listed above. "
                    "Inline all CSS. Dark background #0f0f0f. "
                    "Provide a clear, contextual explanation in the 'explanation' field of the schema for the student, "
                    "explaining what is shown, what the interactive controls/sliders do, and how it helps them understand this concept."
                    f"{grounding_block}"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Create an interactive {animation_type} visualisation of '{concept}' "
                    f"for {familiarity} level students. "
                    "Fill the 'explanation' field of the schema with a 2-3 sentence guide explaining what it represents, "
                    "how to interact with it, and what it demonstrates."
                ),
            },
        ]
        result = self._client.structured_complete(messages, HTML5VisualPayload)
        error = self._syntax_preflight(result.html_code)
        if error:
            result = self.repair_visual(result.html_code, f"SyntaxError: {error}")
        return result

    def repair_visual(
        self, original_html: str, error_message: str
    ) -> HTML5VisualPayload:
        messages = [
            {
                "role": "system",
                "content": (
                    "You are debugging a self-contained HTML5 visualisation. "
                    "Fix the JavaScript error and return the corrected complete HTML."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Error: {error_message}\n\n"
                    f"Original code:\n{original_html}\n\nFix the error."
                ),
            },
        ]
        return self._client.structured_complete(messages, HTML5VisualPayload)

    def generate_plot(
        self,
        concept: str,
        chunks: List[Dict[str, Any]],
        familiarity: str,
    ) -> HTML5VisualPayload:
        """Extract real data from RAG chunks and build a grounded Plotly chart.

        The model fills a strict GroundedPlotSpec; Python then assembles the HTML
        deterministically — no model-written JavaScript, no hallucinated numbers.
        """
        chunk_text = "\n\n".join(
            f"[{c.get('source', '?')}]: {c['text']}" for c in chunks
        )[:3000]

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a data extraction assistant. "
                    "Read the SOURCE MATERIAL and extract any numeric data, tables, "
                    "datasets, or explicit mathematical functions into plot traces. "
                    "Use ONLY numbers and labels found verbatim in the source. "
                    "Do NOT fabricate or estimate values. "
                    "If the source has multiple series or categories, create one trace per series. "
                    "Set source_note to a citation like '[Source: <label>, chunk N]'."
                    f"\n\nSOURCE MATERIAL:\n{chunk_text}"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Extract the data for '{concept}' at {familiarity} level "
                    "into a GroundedPlotSpec. Use only the numbers present in the source."
                ),
            },
        ]
        spec: GroundedPlotSpec = self._client.structured_complete(messages, GroundedPlotSpec)

        # Build self-contained HTML deterministically from the validated spec.
        traces_js = []
        for trace in spec.traces:
            x_js = "[" + ", ".join(f'"{v}"' for v in trace.x) + "]"
            y_js = "[" + ", ".join(str(v) for v in trace.y) + "]"
            traces_js.append(
                f"{{name: {_js_str(trace.name)}, type: {_js_str(trace.chart_type)}, "
                f"x: {x_js}, y: {y_js}, marker: {{color: '#4A7FB5'}}}}"
            )
        traces_array = "[" + ", ".join(traces_js) + "]"
        layout_js = (
            f"{{title: {{text: {_js_str(spec.title)}, font: {{color: '#e2e8f0'}}}}, "
            f"xaxis: {{title: {_js_str(spec.x_label)}, color: '#94a3b8'}}, "
            f"yaxis: {{title: {_js_str(spec.y_label)}, color: '#94a3b8'}}, "
            f"paper_bgcolor: '#0f0f0f', plot_bgcolor: '#1e293b', "
            f"font: {{color: '#e2e8f0'}}}}"
        )
        html_code = (
            f"<!DOCTYPE html><html><head>"
            f'<script src="{_PLOTLY_CDN}"></script>'
            f"<style>body{{margin:0;background:#0f0f0f}}#plot{{width:100%;height:100vh}}</style>"
            f"</head><body>"
            f'<div id="plot"></div>'
            f"<script>Plotly.newPlot('plot', {traces_array}, {layout_js}, "
            f"{{responsive: true, displayModeBar: false}});</script>"
            f"</body></html>"
        )
        return HTML5VisualPayload(
            html_code=html_code,
            animation_type="plotly",
            explanation=f"{spec.source_note} — {spec.title}: {spec.y_label} vs {spec.x_label}.",
        )


def _js_str(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'
