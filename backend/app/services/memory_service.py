"""Lightweight local memory (the 'cognee' role) -> disk-backed, no external deps.

Two roles, both under ~/.studybuddy/cognee/ (per CLAUDE.md, local only):

- Ephemeral per-PDF report clusters: scratch memory holding each processed note-insight
  while a report is being compiled, FLUSHED when the report session ends.
- Persistent learning trajectory: append-only per-PDF history of evaluation snapshots
  (classification + reasoning + scores over time). Never flushed.

Swappable for a real LanceDB/Cognee backend later without changing callers.
"""
from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, List

_BASE = os.path.expanduser("~/.studybuddy/cognee")
_CLUSTERS = os.path.join(_BASE, "clusters")
_TRAJ = os.path.join(_BASE, "trajectory")


class MemoryService:
    def __init__(self) -> None:
        os.makedirs(_CLUSTERS, exist_ok=True)
        os.makedirs(_TRAJ, exist_ok=True)

    # -- Ephemeral report cluster ------------------------------------- #

    def _cluster_path(self, document_id: str) -> str:
        return os.path.join(_CLUSTERS, f"{document_id}.json")

    def push_insights(self, document_id: str, insights: List[Dict[str, Any]]) -> None:
        if not document_id:
            return
        existing = self.read_cluster(document_id)
        existing.extend(insights)
        with open(self._cluster_path(document_id), "w", encoding="utf-8") as f:
            json.dump(existing, f)

    def read_cluster(self, document_id: str) -> List[Dict[str, Any]]:
        if not document_id:
            return []
        p = self._cluster_path(document_id)
        if not os.path.exists(p):
            return []
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []

    def flush_cluster(self, document_id: str) -> None:
        if not document_id:
            return
        p = self._cluster_path(document_id)
        if os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass

    # -- Persistent trajectory ---------------------------------------- #

    def _traj_path(self, document_id: str) -> str:
        return os.path.join(_TRAJ, f"{document_id}.json")

    def append_trajectory(self, document_id: str, snapshot: Dict[str, Any]) -> None:
        if not document_id:
            return
        items = self.read_trajectory(document_id)
        items.append({**snapshot, "ts": time.time()})
        with open(self._traj_path(document_id), "w", encoding="utf-8") as f:
            json.dump(items, f)

    def read_trajectory(self, document_id: str) -> List[Dict[str, Any]]:
        if not document_id:
            return []
        p = self._traj_path(document_id)
        if not os.path.exists(p):
            return []
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
