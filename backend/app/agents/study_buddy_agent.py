from typing import Any, Dict, List, Optional
from app.agents.cerebras_client import CerebrasClient
from app.schemas.graph import NodeData

class StudyBuddyAgent:
    def __init__(self, client: Optional[CerebrasClient] = None) -> None:
        self._client = client or CerebrasClient()

    async def generate_initial_question(
        self,
        node_label: str,
        chunks: List[Dict[str, Any]],
        familiarity: str,
        student_profile: str = ""
    ):
        chunk_text = "\n\n".join(
            f"[Chunk {c.get('chunk_index', i)}]\n{c['text']}"
            for i, c in enumerate(chunks)
        )
        
        messages = [
            {
                "role": "system",
                "content": (
                    "You are Study Buddy, an expert tutor utilizing the Socratic method and active recall. "
                    f"Your goal is to guide the user to master the topic at a {familiarity} level "
                    "through a conversational interview.\n\n"
                    f"STUDENT PROFILE:\n{student_profile if student_profile else 'Unknown (First time user)'}\n\n"
                    "INSTRUCTIONS:\n"
                    "1. Welcome the student. If their name is unknown, kindly ask for it to personalize future sessions. If known, greet them by name. Introduce the core concept in 1-2 short sentences using the source material.\n"
                    "2. Ask ONE conceptually engaging, open-ended question to test their understanding. DO NOT ask multiple questions.\n"
                    "3. Frame the question like a real-world interview (e.g. 'Can you explain why...', 'How would you apply...').\n"
                    "4. Keep your response conversational, encouraging, and concisely formatted.\n"
                    "5. Do NOT give away the answer to your question.\n"
                    "6. NEVER use lazy phrasing like 'Based on the text', 'According to the source', or 'The provided data says'."
                )
            },
            {
                "role": "user",
                "content": f"Topic: {node_label}\n\nSOURCE:\n{chunk_text}"
            }
        ]
        
        async for token in self._client.stream_complete(messages):
            yield token

    async def evaluate_and_ask_next(
        self,
        node_label: str,
        chunks: List[Dict[str, Any]],
        familiarity: str,
        history: List[Dict[str, str]],
        student_answer: str,
        student_profile: str = ""
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
                    f"You are Study Buddy tutoring a student on '{node_label}' at a {familiarity} level using Socratic questioning. "
                    "Evaluate their answer based on the SOURCE MATERIAL.\n\n"
                    f"STUDENT PROFILE:\n{student_profile if student_profile else 'Unknown'}\n\n"
                    "INSTRUCTIONS:\n"
                    "1. If they are wrong or missing nuance, use scaffolding: gently point out the gap and ask a leading question to help them discover the answer themselves.\n"
                    "2. If they are right, affirm it enthusiastically and briefly summarize why they are right.\n"
                    "3. ALWAYS ask exactly ONE NEW, narrower follow-up question (probing question) to push their understanding deeper.\n"
                    "4. Maintain a conversational, encouraging tone. Format with short, visually readable paragraphs.\n"
                    "5. NEVER use lazy phrasing like 'according to the text', 'the text mentions', or 'in the source material'."
                    f"\n\nSOURCE MATERIAL:\n{chunk_text}"
                )
            }
        ]
        messages.extend(formatted_history)
        
        async for token in self._client.stream_complete(messages):
            yield token
