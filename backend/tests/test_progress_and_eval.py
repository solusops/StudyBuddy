"""Tests for the activity tally + evaluator rubric mapping."""
from unittest.mock import MagicMock

from app.agents.evaluator_agent import EvaluatorAgent, NodeAssessment, _EvaluatorOutput, _RUBRIC
from app.services.progress_service import compute_progress
from app.schemas.journal import JournalEntry, JournalEventType


def _entry(node_id, event_type, **data):
    return JournalEntry(session_id="s", node_id=node_id, event_type=event_type, data=data, timestamp=0.0)


def test_activity_tally_percent_and_complete():
    journal = [
        _entry("n1", JournalEventType.NODE_OPENED),
        _entry("n1", JournalEventType.QUIZ_SUBMIT, was_correct=True),
        _entry("n1", JournalEventType.QUIZ_SUBMIT, was_correct=False),
        _entry("n1", JournalEventType.FLASHCARD_GRADE, grade=3),
        _entry("n1", JournalEventType.FEYNMAN_TURN),
        _entry("n2", JournalEventType.NODE_OPENED),
    ]
    p = compute_progress(journal)
    assert p["n1"]["percent"] == 100
    assert p["n1"]["complete"] is True
    assert p["n1"]["quiz_total"] == 2 and p["n1"]["quiz_correct"] == 1
    # n2 only studied → 1/4
    assert p["n2"]["percent"] == 25
    assert p["n2"]["complete"] is False


def test_evaluator_maps_classification_to_rubric_scores():
    fake = MagicMock()
    fake.structured_complete.return_value = _EvaluatorOutput(
        assessments=[
            NodeAssessment(node_id="n1", classification="sophisticated", reasoning="abstract Qs", evidence=["asked about edge cases"]),
            NodeAssessment(node_id="n2", classification="building_basics", reasoning="what-is Qs", evidence=[]),
        ],
        session_summary="ok",
    )
    journal = MagicMock()
    journal.get_session.return_value = [_entry("n1", JournalEventType.CHAT_TURN)]
    agent = EvaluatorAgent(journal_service=journal, client=fake)
    patches, assessments, summary = agent.evaluate_session("s")
    by_node = {p.node_id: p.score_patch for p in patches}
    assert by_node["n1"] == _RUBRIC["sophisticated"]
    assert by_node["n2"] == _RUBRIC["building_basics"]
    assert assessments[0].reasoning == "abstract Qs"


def test_evaluator_empty_journal():
    journal = MagicMock()
    journal.get_session.return_value = []
    agent = EvaluatorAgent(journal_service=journal, client=MagicMock())
    patches, assessments, summary = agent.evaluate_session("s")
    assert patches == [] and assessments == []
