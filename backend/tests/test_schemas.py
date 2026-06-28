from app.schemas.graph import NodeData, NodePatch, OrchestratorAction, HTML5VisualPayload
from app.schemas.session import FamiliarityLevel, Session
from app.schemas.journal import JournalEntry, JournalEventType


def test_node_patch_roundtrip():
    patch = NodePatch(node_id="n1", status="MASTERED")
    assert patch.model_dump()["node_id"] == "n1"


def test_orchestrator_action_requires_intent():
    action = OrchestratorAction(intent="STREAM_CHAT", chat_stream_response="hello")
    assert action.graph_patches is None


def test_familiarity_level_values():
    assert FamiliarityLevel.ELI5 == "eli5"
    assert FamiliarityLevel.EXPERT == "expert"


def test_journal_entry_chat():
    entry = JournalEntry(
        session_id="s1",
        node_id="n1",
        event_type=JournalEventType.CHAT_TURN,
        data={"role": "student", "content": "What is entropy?", "citations": []},
    )
    assert entry.event_type == JournalEventType.CHAT_TURN


def test_node_scores_defaults_zero():
    node = NodeData(id="n1", label="Test")
    assert node.scores.memory == 0
    assert node.status == "LOCKED"
