from app.services.graph_state import GraphStateManager
from app.schemas.graph import NodeData, NodePatch


def test_apply_patch_updates_status():
    mgr = GraphStateManager()
    node = NodeData(id="n1", label="Entropy")
    mgr.add_node("s1", node)
    patched = mgr.apply_node_patch("s1", NodePatch(node_id="n1", status="MASTERED"))
    assert patched.status == "MASTERED"


def test_score_patch_is_monotone():
    mgr = GraphStateManager()
    node = NodeData(id="n1", label="Entropy")
    node.scores.memory = 70
    mgr.add_node("s1", node)
    # Attempt to decrease memory from 70 to 30 — must be clamped
    patched = mgr.apply_node_patch("s1", NodePatch(node_id="n1", score_patch={"memory": 30}))
    assert patched.scores.memory == 70


def test_score_patch_increases():
    mgr = GraphStateManager()
    mgr.add_node("s1", NodeData(id="n1", label="Entropy"))
    patched = mgr.apply_node_patch("s1", NodePatch(node_id="n1", score_patch={"memory": 80}))
    assert patched.scores.memory == 80


def test_new_children_appended():
    mgr = GraphStateManager()
    mgr.add_node("s1", NodeData(id="n1", label="Root"))
    mgr.apply_node_patch("s1", NodePatch(node_id="n1", new_children=["n2", "n3"]))
    node = mgr.get_node("s1", "n1")
    assert "n2" in node.children_ids
    assert "n3" in node.children_ids


def test_duplicate_children_not_added():
    mgr = GraphStateManager()
    mgr.add_node("s1", NodeData(id="n1", label="Root", children_ids=["n2"]))
    mgr.apply_node_patch("s1", NodePatch(node_id="n1", new_children=["n2", "n3"]))
    node = mgr.get_node("s1", "n1")
    assert node.children_ids.count("n2") == 1
