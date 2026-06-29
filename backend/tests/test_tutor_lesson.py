import pytest
from unittest.mock import MagicMock
from app.agents.tutor_agent import TutorAgent
from app.schemas.graph import NodeData

class AsyncIterator:
    def __init__(self, items):
        self.items = items
    def __aiter__(self):
        return self
    async def __anext__(self):
        if not self.items:
            raise StopAsyncIteration
        return self.items.pop(0)

@pytest.mark.asyncio
async def test_stream_lesson_content_only():
    tutor = TutorAgent.__new__(TutorAgent)
    mock_client = MagicMock()
    tutor._client = mock_client
    
    mock_client.stream_complete.return_value = AsyncIterator(["This ", "is ", "a ", "lesson."])
    
    node = NodeData(id="n1", label="Smart Pace", status="ACTIVE")
    chunks = [{"source": "adam.pdf", "text": "Adam optimizer uses moment estimation."}]
    
    tokens = []
    async for token in tutor.stream_lesson(node, chunks, "high_school", "content_only"):
        tokens.append(token)
        
    assert "".join(tokens) == "This is a lesson."
    mock_client.stream_complete.assert_called_once()
    messages = mock_client.stream_complete.call_args[0][0]
    assert len(messages) == 2
    assert "Smart Pace" in messages[1]["content"]
    assert "Base the lesson on the provided source material" in messages[0]["content"]

@pytest.mark.asyncio
async def test_stream_lesson_net_support():
    tutor = TutorAgent.__new__(TutorAgent)
    mock_client = MagicMock()
    tutor._client = mock_client
    
    mock_client.stream_complete.return_value = AsyncIterator(["This ", "is ", "web ", "lesson."])
    
    node = NodeData(id="n1", label="Smart Pace", status="ACTIVE")
    chunks = [{"source": "adam.pdf", "text": "Adam optimizer uses moment estimation."}]
    web_context = "Smart Pace is a new dynamic step size method."
    
    tokens = []
    async for token in tutor.stream_lesson(
        node, chunks, "high_school", "net_support", web_context=web_context
    ):
        tokens.append(token)
        
    assert "".join(tokens) == "This is web lesson."
    mock_client.stream_complete.assert_called_once()
    messages = mock_client.stream_complete.call_args[0][0]
    assert "WEB SOURCE MATERIAL:" in messages[1]["content"]
    assert "Smart Pace is a new dynamic step size method." in messages[1]["content"]
    assert "Ground your explanation in the provided source material and the web source material" in messages[0]["content"]
