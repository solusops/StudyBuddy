"""Modality Router -> decides WHAT kind of visual (if any) to generate for a wiki term.

Runs before TutorAgent writes any code, so the decision is grounded in
the student's source material rather than made implicitly by a keyword list.

Decision rules (enforced in the prompt):
  STATIC_PLOT          -> source chunks contain concrete numeric data, datasets,
                         distributions, or explicit mathematical functions.
  INTERACTIVE_SIMULATION -> concept is a dynamic physical/parameterized process
                           that benefits from adjustable parameters or animation.
  NONE                 -> purely theoretical/philosophical content with no data
                         or dynamic system; skip visual generation entirely.
"""
from __future__ import annotations

from typing import List, Literal

from pydantic import BaseModel

from app.agents.cerebras_client import CerebrasClient

_MAX_CHUNK_CHARS = 3000  # mirrors BrainAgent.extract_curriculum cap


class ModalityDecision(BaseModel):
    modality: Literal["STATIC_PLOT", "INTERACTIVE_SIMULATION", "NONE"]
    reasoning: str
    recommended_tool: Literal["Plotly", "Three.js", "Canvas", "null"]
    has_real_data: bool


_SYSTEM_PROMPT = """\
You are the Visualization Router for a student research assistant.
Your job is to classify the best visual modality for a concept the student selected,
based ONLY on the provided source material.

RULES -> follow them strictly:
1. Choose STATIC_PLOT when the SOURCE MATERIAL contains concrete numeric data,
   explicit datasets, statistical distributions, or named mathematical functions
   with actual coefficients/values. Set has_real_data=true.
   Recommended tool: Plotly.
2. Choose INTERACTIVE_SIMULATION when the concept is a dynamic physical process,
   a system whose behaviour changes with adjustable parameters, or a topological /
   mechanical interaction that is best understood by animation.
   Recommended tool: Three.js (3D molecules/anatomy) or Canvas (physics/chem 2D).
3. Choose NONE when the selected concept is purely theoretical, philosophical,
   definitional, or policy-based -> no data and no dynamic system to animate.
   Recommended tool: null.

CRITICAL: If the SOURCE MATERIAL does NOT contain real numbers, tables, or
explicit datasets, you MUST NOT choose STATIC_PLOT.
Set has_real_data=false and choose INTERACTIVE_SIMULATION or NONE instead.

Output a single JSON object matching the schema. One sentence for reasoning.\
"""


class ModalityRouter:
    def __init__(self) -> None:
        self._client = CerebrasClient()

    def classify(
        self,
        selection_text: str,
        card_markdown: str,
        chunks: List[dict],
        familiarity: str,
    ) -> ModalityDecision:
        chunk_text = "\n\n".join(c["text"] for c in chunks)
        if len(chunk_text) > _MAX_CHUNK_CHARS:
            chunk_text = chunk_text[:_MAX_CHUNK_CHARS]

        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"SELECTED CONCEPT: {selection_text}\n"
                    f"STUDENT LEVEL: {familiarity}\n\n"
                    f"SOURCE MATERIAL:\n{chunk_text}\n\n"
                    f"WIKI CARD SUMMARY:\n{card_markdown[:800]}"
                ),
            },
        ]
        return self._client.structured_complete(messages, ModalityDecision)
