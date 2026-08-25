"""WebSocket-Verbindungsmanagement fuer Displays."""
from __future__ import annotations

import logging

from fastapi import WebSocket

log = logging.getLogger("stadtdashboard.ws")


class ConnectionManager:
    def __init__(self) -> None:
        self.active: dict[str, WebSocket] = {}

    @property
    def connected_ids(self) -> list[str]:
        return list(self.active.keys())

    async def connect(self, device_id: str, websocket: WebSocket) -> None:
        self.active[device_id] = websocket

    def disconnect(self, device_id: str) -> None:
        self.active.pop(device_id, None)

    async def send_to(self, device_id: str, payload: dict) -> None:
        ws = self.active.get(device_id)
        if ws is None:
            return
        try:
            await ws.send_json(payload)
        except Exception as exc:  # noqa: BLE001
            log.debug("send_to %s fehlgeschlagen: %s", device_id, exc)

    async def broadcast(self, payload: dict) -> None:
        for device_id in list(self.active.keys()):
            await self.send_to(device_id, payload)


manager = ConnectionManager()
