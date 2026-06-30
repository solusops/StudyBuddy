"""Tests for the parallel-streaming curriculum building blocks (Phase 3)."""
from app.agents.brain_agent import (
    BrainAgent,
    _ExpansionChild,
    _RootAndSections,
    _SectionExpansion,
    _SectionItem,
)


class _CapturingClient:
    """Captures the messages passed for the multi-doc prompt assertion."""

    def __init__(self):
        self.messages = None

    def structured_complete(self, messages, output_model, model=None):
        self.messages = messages
        return _RootAndSections(root_label="X", sections=[_SectionItem(label="S", source_doc=1)])


def test_multi_doc_prompt_lists_documents_and_section_tagging():
    cap = _CapturingClient()
    brain = BrainAgent(client=cap)
    rs = brain.derive_root_and_sections("structure", "high_school", "", "", ["paperA.pdf", "paperB.pdf"])
    blob = " ".join(m["content"] for m in cap.messages)
    assert "paperA.pdf" in blob and "paperB.pdf" in blob
    assert "source_doc" in blob
    assert rs.sections[0].source_doc == 1


def test_single_doc_prompt_omits_doc_listing():
    cap = _CapturingClient()
    BrainAgent(client=cap).derive_root_and_sections("structure", "high_school", "", "", ["only.pdf"])
    blob = " ".join(m["content"] for m in cap.messages)
    assert "source_doc" not in blob  # no multi-doc tagging instruction for a single paper


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
