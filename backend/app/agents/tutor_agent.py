"""Tutor Agent — grounded lessons, HTML5 visuals, sandbox repair.

Every fact in grounded_truth must cite its RAG source.
Visuals go through a server-side syntax pre-flight before being sent to the
client, so students never see a red JavaScript error.
"""
import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.agents.cerebras_client import CerebrasClient
from app.schemas.graph import HTML5VisualPayload, NodeData

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

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a Cognitive Translator. Use ONLY the provided source material. "
                    "Write a single, flowing lesson — do NOT split into separate sections like "
                    "'Concept' or 'From the Source'. Weave the intuitive explanation and factual "
                    "details together naturally into one coherent narrative.\n\n"
                    "FORMATTING RULES:\n"
                    f"- {math_note}\n"
                    "- Use **bold** for key terms.\n"
                    "- Use bullet points (lines starting with '* ') for lists.\n"
                    "- Do NOT include [Source: X, chunk N] citations in your output — "
                    "the student should not see internal source references.\n"
                    "- Never hallucinate. If something isn't covered in the sources, say so."
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
        self, node_label: str, chunks: List[Dict[str, Any]], familiarity: str
    ) -> _FlashcardsPayload:
        chunk_text = "\n\n".join(
            f"[Source: {c['source']}]\n{c['text']}" for c in chunks
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "Generate 5-10 open-recall flashcards from the source material only. "
                    "front = question/prompt, back = answer with a source citation."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Create flashcards for '{node_label}' at {familiarity} level.\n\n"
                    f"SOURCE:\n{chunk_text}"
                ),
            },
        ]
        return self._client.structured_complete(messages, _FlashcardsPayload)

    def generate_quiz(
        self, node_label: str, chunks: List[Dict[str, Any]], familiarity: str
    ) -> _QuizPayload:
        chunk_text = "\n\n".join(
            f"[Source: {c['source']}]\n{c['text']}" for c in chunks
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "Generate 3-5 multiple-choice questions from the source material only. "
                    "Each question has exactly 1 correct option and 3 distractors. "
                    "Include a brief explanation referencing the source."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Create quiz questions for '{node_label}' at {familiarity} level.\n\n"
                    f"SOURCE:\n{chunk_text}"
                ),
            },
        ]
        return self._client.structured_complete(messages, _QuizPayload)

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
    ) -> HTML5VisualPayload:
        instruction = _VISUAL_INSTRUCTIONS.get(animation_type, "Use plain HTML/CSS.")
        messages = [
            {
                "role": "system",
                "content": (
                    f"Generate a self-contained HTML5 page visualising '{concept}'. "
                    f"{instruction} "
                    "No external URLs except the CDN scripts listed above. "
                    "Inline all CSS. Dark background #0f0f0f."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Create an interactive {animation_type} visualisation of '{concept}' "
                    f"for {familiarity} level students."
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
