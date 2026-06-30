from typing import Any, Dict, List, Optional
from app.agents.cerebras_client import CerebrasClient
from app.schemas.graph import NodeData

class StudyBuddyAgent:
    def __init__(self, client: Optional[CerebrasClient] = None) -> None:
        self._client = client or CerebrasClient()

    async def generate_initial_question(
        self,
        node: NodeData,
        chunks: List[Dict[str, Any]],
        familiarity: str
    ):
        chunk_text = "\n\n".join(
            f"[Chunk {c.get('chunk_index', i)}]\n{c['text']}"
            for i, c in enumerate(chunks)
        )
        
        messages = [
            {
                "role": "system",
                "content": (
                    f"You are a Study Buddy. You are helping the user learn a concept at a {familiarity} level. "
                    "Start the learning session by asking one broad, conceptually engaging question "
                    "to test their foundational understanding of the concept based on the source material. "
                    "Make it feel like a real-time conversational interview. "
                    "Do NOT provide the answer. Just ask the question."
                )
            },
            {
                "role": "user",
                "content": f"Topic: {node.label}\n\nSOURCE:\n{chunk_text}"
            }
        ]
        
        async for token in self._client.stream_complete(messages):
            yield token

    async def evaluate_and_ask_next(
        self,
        node: NodeData,
        chunks: List[Dict[str, Any]],
        familiarity: str,
        history: List[Dict[str, str]],
        student_answer: str
    ):
        chunk_text = "\n\n".join(
            f"[Chunk {c.get('chunk_index', i)}]\n{c['text']}"
            for i, c in enumerate(chunks)
        )
        
        formatted_history = []
        for msg in history:
            role = "assistant" if msg["role"] == "study_buddy" else "user"
            formatted_history.append({"role": role, "content": msg["content"]})
        
        formatted_history.append({"role": "user", "content": student_answer})
        
        messages = [
            {
                "role": "system",
                "content": (
                    f"You are a Study Buddy tutoring a student on the topic of '{node.label}' at a {familiarity} level. "
                    "You must evaluate their latest answer. "
                    "If they are wrong, correct them gently and explain why using the source material. "
                    "If they are right, affirm it. "
                    "Then, ALWAYS ask a NEW, narrower follow-up question or a cross-question to deepen their understanding. "
                    "Make it feel like a real-time conversational interview. Keep your response conversational and concise. "
                    "Do NOT use lazy phrasing like 'according to the text'."
                    f"\n\nSOURCE MATERIAL:\n{chunk_text}"
                )
            }
        ]
        messages.extend(formatted_history)
        
        async for token in self._client.stream_complete(messages):
            yield token
