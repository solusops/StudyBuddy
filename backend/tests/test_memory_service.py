"""Tests for the lightweight local MemoryService (cluster + trajectory)."""
from app.services.memory_service import MemoryService

_DOC = "test_doc_hash_xyz"


def _clean(m: MemoryService):
    m.flush_cluster(_DOC)
    import os
    p = m._traj_path(_DOC)
    if os.path.exists(p):
        os.remove(p)


def test_cluster_push_read_flush_roundtrip():
    m = MemoryService()
    _clean(m)
    assert m.read_cluster(_DOC) == []
    m.push_insights(_DOC, [{"concept": "A", "summary": "s"}])
    m.push_insights(_DOC, [{"concept": "B", "summary": "t"}])
    cluster = m.read_cluster(_DOC)
    assert [c["concept"] for c in cluster] == ["A", "B"]
    m.flush_cluster(_DOC)
    assert m.read_cluster(_DOC) == []


def test_trajectory_is_append_only_and_persists():
    m = MemoryService()
    _clean(m)
    m.append_trajectory(_DOC, {"node_id": "n1", "classification": "building_basics"})
    m.append_trajectory(_DOC, {"node_id": "n1", "classification": "comfortable"})
    traj = m.read_trajectory(_DOC)
    assert len(traj) == 2
    assert traj[0]["classification"] == "building_basics"
    assert "ts" in traj[0]
    # trajectory is NOT removed by a cluster flush
    m.flush_cluster(_DOC)
    assert len(m.read_trajectory(_DOC)) == 2
    _clean(m)


def test_empty_document_id_is_noop():
    m = MemoryService()
    m.push_insights("", [{"x": 1}])
    assert m.read_cluster("") == []
    m.append_trajectory("", {"a": 1})
    assert m.read_trajectory("") == []
