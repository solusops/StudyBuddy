"""Tests for the parallel-streaming curriculum building blocks (Phase 3)."""
from app.agents.brain_agent import (
    BrainAgent,
    _ExpansionChild,
    _RootAndSections,
    _SectionExpansion,
    _SectionItem,
)


class _FakeClient:
    """Returns canned structured output based on the requested model."""

    def structured_complete(self, messages, output_model, model=None):
        if output_model is _RootAndSections:
            return _RootAndSections(
                root_label="Optimization",
                root_description="Methods to minimize loss",
                sections=[_SectionItem(label="Gradient Descent"), _SectionItem(label="Adam")],
            )
        if output_model is _SectionExpansion:
            return _SectionExpansion(
                children=[_ExpansionChild(label="Learning Rate"), _ExpansionChild(label="Momentum")]
            )
        raise AssertionError(f"unexpected model {output_model}")


def test_derive_root_and_sections():
    brain = BrainAgent(client=_FakeClient())
    rs = brain.derive_root_and_sections("doc structure", "high_school", "Optimization")
    assert rs.root_label == "Optimization"
    assert [s.label for s in rs.sections] == ["Gradient Descent", "Adam"]


def test_expand_section():
    brain = BrainAgent(client=_FakeClient())
    exp = brain.expand_section("Gradient Descent", "doc structure", "high_school")
    assert len(exp.children) == 2
    assert exp.children[0].label == "Learning Rate"
    # relationship defaults are valid
    assert exp.children[0].relationship in {"prerequisite", "related", "builds-on"}
