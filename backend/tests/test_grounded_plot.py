"""Tests for TutorAgent.generate_plot — verifies grounded, hallucination-free Plotly output."""
import re
from unittest.mock import MagicMock

from app.agents.tutor_agent import TutorAgent, _PLOTLY_CDN
from app.schemas.graph import GroundedPlotSpec, PlotTrace, HTML5VisualPayload


CHUNKS = [
    {"source": "textbook.pdf", "text": "GDP growth: 2019: 2.3%, 2020: -3.4%, 2021: 5.7%"},
]

SPEC = GroundedPlotSpec(
    title="GDP Growth Rate",
    x_label="Year",
    y_label="Growth (%)",
    traces=[
        PlotTrace(name="GDP", chart_type="bar", x=["2019", "2020", "2021"], y=[2.3, -3.4, 5.7])
    ],
    source_note="[Source: textbook.pdf, chunk 1]",
)


def _make_tutor_returning_spec(spec: GroundedPlotSpec) -> TutorAgent:
    tutor = TutorAgent.__new__(TutorAgent)
    mock_client = MagicMock()
    tutor._client = mock_client
    mock_client.structured_complete.return_value = spec
    return tutor


def test_generate_plot_returns_plotly_type():
    tutor = _make_tutor_returning_spec(SPEC)
    result = tutor.generate_plot("GDP growth", CHUNKS, "high_school")
    assert isinstance(result, HTML5VisualPayload)
    assert result.animation_type == "plotly"


def test_generate_plot_html_contains_cdn():
    tutor = _make_tutor_returning_spec(SPEC)
    result = tutor.generate_plot("GDP growth", CHUNKS, "high_school")
    assert _PLOTLY_CDN in result.html_code


def test_generate_plot_html_contains_real_values():
    tutor = _make_tutor_returning_spec(SPEC)
    result = tutor.generate_plot("GDP growth", CHUNKS, "high_school")
    # x labels
    assert "2019" in result.html_code
    assert "2020" in result.html_code
    assert "2021" in result.html_code
    # y values
    assert "2.3" in result.html_code
    assert "-3.4" in result.html_code
    assert "5.7" in result.html_code


def test_generate_plot_explanation_cites_source():
    tutor = _make_tutor_returning_spec(SPEC)
    result = tutor.generate_plot("GDP growth", CHUNKS, "high_school")
    assert "textbook.pdf" in result.explanation or "Source" in result.explanation


def test_generate_plot_html_no_fabricated_js():
    """HTML is built deterministically — no <script> that could contain hallucinated code."""
    tutor = _make_tutor_returning_spec(SPEC)
    result = tutor.generate_plot("GDP growth", CHUNKS, "high_school")
    # Only one script block for Plotly.newPlot; no other JS functions
    scripts = re.findall(r"<script[^>]*>(.*?)</script>", result.html_code, re.DOTALL)
    # CDN script tag has no body (src attribute only); inline block is the newPlot call
    inline_scripts = [s for s in scripts if s.strip()]
    assert len(inline_scripts) == 1
    assert "Plotly.newPlot" in inline_scripts[0]


def test_generate_plot_prompt_instructs_no_fabrication():
    """The prompt sent to the model must forbid fabricating values."""
    tutor = TutorAgent.__new__(TutorAgent)
    captured = {}
    mock_client = MagicMock()
    tutor._client = mock_client

    def fake_complete(messages, model_cls):
        captured["messages"] = messages
        return SPEC

    mock_client.structured_complete.side_effect = fake_complete
    tutor.generate_plot("GDP growth", CHUNKS, "graduate")

    system_content = captured["messages"][0]["content"]
    assert "fabricate" in system_content.lower() or "only" in system_content.lower()
    assert "textbook.pdf" in system_content  # chunk text embedded


def test_generate_plot_chunks_embedded_in_prompt():
    tutor = TutorAgent.__new__(TutorAgent)
    captured = {}
    mock_client = MagicMock()
    tutor._client = mock_client

    def fake_complete(messages, model_cls):
        captured["messages"] = messages
        return SPEC

    mock_client.structured_complete.side_effect = fake_complete
    tutor.generate_plot("GDP growth", CHUNKS, "high_school")

    system_content = captured["messages"][0]["content"]
    assert "GDP growth: 2019" in system_content


def test_generate_visual_with_chunks_grounds_prompt():
    """generate_visual with chunks must inject SOURCE MATERIAL block."""
    tutor = TutorAgent.__new__(TutorAgent)
    captured = {}
    mock_client = MagicMock()
    tutor._client = mock_client

    fake_visual = HTML5VisualPayload(
        html_code="<html></html>", animation_type="canvas", explanation=""
    )

    def fake_complete(messages, model_cls):
        captured["messages"] = messages
        return fake_visual

    mock_client.structured_complete.side_effect = fake_complete
    tutor.generate_visual("pendulum", "canvas", "high_school", chunks=CHUNKS)

    system_content = captured["messages"][0]["content"]
    assert "SOURCE MATERIAL" in system_content
    assert "GDP growth" in system_content  # chunk text embedded


def test_generate_visual_without_chunks_no_source_block():
    """generate_visual without chunks must NOT inject SOURCE MATERIAL (backward compat)."""
    tutor = TutorAgent.__new__(TutorAgent)
    captured = {}
    mock_client = MagicMock()
    tutor._client = mock_client

    fake_visual = HTML5VisualPayload(
        html_code="<html></html>", animation_type="canvas", explanation=""
    )

    def fake_complete(messages, model_cls):
        captured["messages"] = messages
        return fake_visual

    mock_client.structured_complete.side_effect = fake_complete
    tutor.generate_visual("pendulum", "canvas", "high_school")

    system_content = captured["messages"][0]["content"]
    assert "SOURCE MATERIAL" not in system_content
