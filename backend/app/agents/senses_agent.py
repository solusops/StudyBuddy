"""Multimodal vision agent — analyses cropped PDF regions.

Uses Cerebras vision-capable model (gemma-4-31b).
Images must be base64-encoded PNG data URIs — hosted URLs not supported.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.agents.cerebras_client import CerebrasClient

VISION_MODEL_ID = "gemma-4-31b"


class InsightPayload(BaseModel):
    summary: str
    observations: list[str]
    suggested_questions: list[str]


class RegionDescription(BaseModel):
    type: Literal["figure", "plot", "diagram", "table", "equation", "other"]
    caption: str  # one-line description of what the region shows
    extracted_content: str  # LaTeX for equations, markdown table for tables, else a short description


class SensesAgent:
    def __init__(self) -> None:
        self._client = CerebrasClient()

    def analyze_visual_context(
        self,
        image_base64: str,
        region_text: str,
        anchor_label: str,
        familiarity: str,
        document_id: str = "",
    ) -> InsightPayload:
        """Analyse a cropped PDF region image + surrounding text.

        Returns structured observations and self-quiz questions.
        """
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{image_base64}"},
                    },
                    {
                        "type": "text",
                        "text": (
                            f"The student highlighted this region from their study material.\n"
                            f"Concept: '{anchor_label}'\n"
                            f"Surrounding text: {region_text[:500]}\n"
                            f"Familiarity level: {familiarity}\n\n"
                            "Describe what you see in the image, state key observations for "
                            "learning, and provide 2-3 self-quiz questions the student can use."
                        ),
                    },
                ],
            }
        ]
        
        payload = self._client.structured_complete(
            messages, InsightPayload, model=VISION_MODEL_ID
        )
        
        if document_id:
            import asyncio
            import cognee
            memory_text = f"Visual Region Analysis:\nSummary: {payload.summary}\nObservations: {', '.join(payload.observations)}"
            dataset_name = f"visual_memory_{document_id}"
            asyncio.create_task(cognee.add(memory_text, dataset_name=dataset_name))
            
        return payload

    def describe_region(self, image_base64: str, type_hint: str = "") -> RegionDescription:
        """Read a cropped page region and return its type, caption, and extracted content.

        For a formula → LaTeX; for a table → GitHub-markdown table; otherwise a
        short description. Used to make figures/tables/formulas chat- and wiki-ready.
        """
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{image_base64}"},
                    },
                    {
                        "type": "text",
                        "text": (
                            "This is a cropped region from an academic paper"
                            + (f" (likely a {type_hint})" if type_hint else "")
                            + ".\n"
                            "1. Classify its type.\n"
                            "2. Give a one-line caption of what it shows.\n"
                            "3. extracted_content: if it is a mathematical formula, output ONLY "
                            "valid LaTeX. If it is a table, output it as a GitHub-markdown table. "
                            "Otherwise give a 1-2 sentence factual description. "
                            "Transcribe only what is visible — do not invent data."
                        ),
                    },
                ],
            }
        ]
        return self._client.structured_complete(
            messages, RegionDescription, model=VISION_MODEL_ID
        )
