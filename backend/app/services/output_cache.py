"""Content-addressed output cache — persist & reuse agent outputs.

Key = sha256(SCHEMA_VERSION | event_name | familiarity | anchor_id | input_fingerprint)
where input_fingerprint = sha256(exact chunk texts + selection_text).

Any change to content, selection, familiarity or anchor naturally misses.
SCHEMA_VERSION bump mass-invalidates all cached entries.
"""
import hashlib
import json
import os
from typing import Any, Optional

SCHEMA_VERSION = "1"
_CACHE_DIR = os.path.expanduser("~/.studybuddy/cache")


class OutputCache:
    def __init__(self) -> None:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        self._mem: dict[str, Any] = {}

    def fingerprint(self, *parts: str) -> str:
        combined = "|".join(parts)
        return hashlib.sha256(combined.encode()).hexdigest()

    def make_key(
        self,
        event_name: str,
        familiarity: str,
        anchor_id: str,
        chunk_texts: list[str],
        selection_text: str = "",
        image_hash: str = "",
    ) -> str:
        fp = self.fingerprint(*chunk_texts, selection_text, image_hash)
        raw = f"{SCHEMA_VERSION}|{event_name}|{familiarity}|{anchor_id}|{fp}"
        return hashlib.sha256(raw.encode()).hexdigest()

    def _path(self, key: str) -> str:
        return os.path.join(_CACHE_DIR, f"{key}.json")

    def get(self, key: str) -> Optional[Any]:
        if key in self._mem:
            return self._mem[key]
        p = self._path(key)
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                val = json.load(f)
            self._mem[key] = val
            return val
        return None

    def put(self, key: str, payload: Any) -> None:
        self._mem[key] = payload
        with open(self._path(key), "w", encoding="utf-8") as f:
            json.dump(payload, f)

    def clear(self) -> int:
        """Dev helper — wipe all cached entries. Returns count deleted."""
        count = 0
        for fname in os.listdir(_CACHE_DIR):
            if fname.endswith(".json"):
                os.remove(os.path.join(_CACHE_DIR, fname))
                count += 1
        self._mem.clear()
        return count
