"""Multimodal vision agent — analyses cropped PDF regions.

Uses Cerebras vision-capable model (llama-4-scout-17b-16e-instruct).
Images must be base64-encoded PNG data URIs — hosted URLs not supported.
"""
from __future__ import annotations

from pydantic import BaseModel

from app.agents.cerebras_client import CerebrasClient

VISION_MODEL_ID = "llama-4-scout-17b-16e-instruct"


class InsightPayload(BaseModel):
    summary: str
    observations: list[str]
    suggested_questions: list[str]


class SensesAgent:
    def __init__(self) -> None:
        self._client = CerebrasClient()

    def analyze_visual_context(
        self,
        image_base64: str,
        region_text: str,
        anchor_label: str,
        familiarity: str,
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
        return self._client.structured_complete(
            messages, InsightPayload, model=VISION_MODEL_ID
        )
