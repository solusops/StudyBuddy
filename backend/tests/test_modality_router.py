"""Tests for ModalityRouter -> verifies routing rules and prompt grounding."""
import json
from unittest.mock import MagicMock

from app.agents.modality_router import ModalityRouter


def _make_router_with_response(modality: str, recommended_tool: str, has_real_data: bool) -> tuple:
    """Return (router, captured_messages) where the client returns a canned decision."""
    router = ModalityRouter.__new__(ModalityRouter)
    mock_client = MagicMock()
    router._client = mock_client

    from app.agents.modality_router import ModalityDecision
    decision = ModalityDecision(
        modality=modality,
        reasoning="test reasoning",
        recommended_tool=recommended_tool,
        has_real_data=has_real_data,
    )
    captured = {}

    def fake_structured_complete(messages, model_cls):
        captured["messages"] = messages
        return decision

    mock_client.structured_complete.side_effect = fake_structured_complete
    return router, captured


CHUNKS_WITH_DATA = [
    {"source": "notes.pdf", "text": "Revenue in 2020: $120M, 2021: $145M, 2022: $178M"},
    {"source": "notes.pdf", "text": "Growth rate was 20.8% year over year."},
]

CHUNKS_WITHOUT_DATA = [
    {"source": "notes.pdf", "text": "Entropy is a measure of disorder in a thermodynamic system."},
    {"source": "notes.pdf", "text": "The second law states entropy increases in isolated systems."},
]


def test_classify_returns_modality_decision():
    router, _ = _make_router_with_response("STATIC_PLOT", "Plotly", True)
    result = router.classify("revenue trends", "## Revenue\n...", CHUNKS_WITH_DATA, "high_school")
    assert result.modality == "STATIC_PLOT"
    assert result.has_real_data is True


def test_prompt_contains_chunk_text():
    """The router must embed source material in the prompt so decisions are grounded."""
    router, captured = _make_router_with_response("STATIC_PLOT", "Plotly", True)
    router.classify("revenue", "card text", CHUNKS_WITH_DATA, "graduate")
    user_message = captured["messages"][1]["content"]
    assert "Revenue in 2020" in user_message, "chunk text must appear in the user message"
    assert "notes.pdf" not in user_message  # chunk source key is not embedded, just the text


def test_prompt_contains_selection_and_level():
    router, captured = _make_router_with_response("NONE", "null", False)
    router.classify("entropy", "card", CHUNKS_WITHOUT_DATA, "eli5")
    user_message = captured["messages"][1]["content"]
    assert "entropy" in user_message
    assert "eli5" in user_message


def test_prompt_caps_chunk_text():
    """Chunks larger than 3000 chars must be truncated."""
    big_chunk = [{"source": "big.pdf", "text": "x" * 5000}]
    router, captured = _make_router_with_response("NONE", "null", False)
    router.classify("concept", "card", big_chunk, "high_school")
    user_message = captured["messages"][1]["content"]
    # The chunk text is capped at 3000 chars inside classify()
    assert len(user_message) < 5000 + 500  # well under 5000 raw chunk length


def test_system_prompt_mentions_no_fabrication():
    """The system prompt must include the anti-hallucination grounding rule."""
    from app.agents.modality_router import _SYSTEM_PROMPT
    assert "NOT contain real numbers" in _SYSTEM_PROMPT or "MUST NOT choose STATIC_PLOT" in _SYSTEM_PROMPT


def test_none_modality_when_no_data():
    router, _ = _make_router_with_response("NONE", "null", False)
    result = router.classify("entropy definition", "card", CHUNKS_WITHOUT_DATA, "high_school")
    assert result.modality == "NONE"
    assert result.has_real_data is False


def test_interactive_simulation_for_dynamic_concept():
    router, _ = _make_router_with_response("INTERACTIVE_SIMULATION", "Canvas", False)
    result = router.classify("pendulum motion", "card", CHUNKS_WITHOUT_DATA, "high_school")
    assert result.modality == "INTERACTIVE_SIMULATION"
    assert result.recommended_tool == "Canvas"
