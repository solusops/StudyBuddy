from app.services.journal_service import JournalService
from app.schemas.journal import JournalEntry, JournalEventType


def test_append_and_retrieve():
    svc = JournalService()
    entry = JournalEntry(
        session_id="s1",
        node_id="n1",
        event_type=JournalEventType.CHAT_TURN,
        data={"role": "student", "content": "explain entropy"},
    )
    svc.append(entry)
    journal = svc.get_session("s1")
    assert len(journal) == 1
    assert journal[0].event_type == JournalEventType.CHAT_TURN


def test_separate_sessions_isolated():
    svc = JournalService()
    svc.append(
        JournalEntry(session_id="A", node_id="n1", event_type=JournalEventType.QUIZ_SUBMIT, data={})
    )
    svc.append(
        JournalEntry(session_id="B", node_id="n1", event_type=JournalEventType.QUIZ_SUBMIT, data={})
    )
    assert len(svc.get_session("A")) == 1
    assert len(svc.get_session("B")) == 1


def test_clear_session():
    svc = JournalService()
    svc.append(
        JournalEntry(session_id="s1", node_id="n1", event_type=JournalEventType.NODE_OPENED, data={})
    )
    svc.clear_session("s1")
    assert svc.get_session("s1") == []
