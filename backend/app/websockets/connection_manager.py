"""WebSocket connection registry.

Completely stateless about message content -> just tracks live sockets and
broadcasts typed envelopes. Isolated so routers and handlers never import
fastapi.WebSocket directly.
"""
from typing import Dict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._active: Dict[str, WebSocket] = {}

    async def connect(self, session_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._active[session_id] = ws

    def disconnect(self, session_id: str) -> None:
        self._active.pop(session_id, None)

    async def send(self, session_id: str, msg_type: str, data: dict) -> None:
        ws = self._active.get(session_id)
        if ws:
            await ws.send_json({"type": msg_type, "data": data})

    def is_connected(self, session_id: str) -> bool:
        return session_id in self._active
