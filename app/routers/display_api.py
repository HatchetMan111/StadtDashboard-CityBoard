"""Oeffentliche API fuer Display-Clients: Registrierung, Status, Zustand, WebSocket."""
from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import config
from ..auth import get_display_by_token, require_approved_display
from ..database import SessionLocal, get_db
from ..models import Display
from ..services.state import build_state, now_local
from ..ws import manager

router = APIRouter(tags=["display"])
log = logging.getLogger("stadtdashboard.display")


@router.get("/webcam/{key}.jpg")
def webcam_frame(key: str):
    """Liefert den letzten RTSP-Schnappschuss (lokal erzeugt, kein Stream)."""
    if not key.replace("-", "").isalnum() or len(key) < 8 or len(key) > 32:
        raise HTTPException(status_code=400, detail="Ungültiger Key")
    from ..services.webcam import WEBCAM_DIR

    path = WEBCAM_DIR / f"{key}.jpg"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Noch kein Bild verfügbar")
    return FileResponse(path, media_type="image/jpeg",
                        headers={"Cache-Control": "no-store"})


@router.get("/media/{item_id}")
def media_file(item_id: int, db: Session = Depends(get_db)):
    from ..models import MediaItem

    item = db.get(MediaItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Medium nicht gefunden")
    path = config.UPLOAD_DIR / item.filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Datei fehlt")
    return FileResponse(path, media_type=item.mime or "application/octet-stream")


@router.get("/media/{item_id}/thumb")
def media_thumb(item_id: int, db: Session = Depends(get_db)):
    from pathlib import Path

    from ..models import MediaItem

    item = db.get(MediaItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Medium nicht gefunden")
    if item.kind == "image" and not item.filename.lower().endswith(".svg"):
        path = config.UPLOAD_DIR / "thumbs" / f"{Path(item.filename).stem}.jpg"
        if path.is_file():
            return FileResponse(path, media_type="image/jpeg")
    path = config.UPLOAD_DIR / item.filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Datei fehlt")
    return FileResponse(path)


def touch(display: Display) -> None:
    display.last_seen = datetime.utcnow()


class RegisterIn(BaseModel):
    device_id: str | None = None
    token: str | None = None
    name: str | None = Field(default=None, max_length=120)
    resolution: str | None = Field(default=None, max_length=20)
    orientation: str | None = Field(default=None, max_length=12)
    app_version: str | None = Field(default=None, max_length=20)


class RegisterOut(BaseModel):
    device_id: str
    token: str
    approved: bool


@router.post("/api/display/register", response_model=RegisterOut)
def register_display(body: RegisterIn, db: Session = Depends(get_db)) -> RegisterOut:
    """Registriert ein Geraet (idempotent bei bekannter ID+Token-Kombi)."""
    if body.device_id and body.token:
        existing = db.get(Display, body.device_id)
        if existing and secrets.compare_digest(existing.token, body.token):
            touch(existing)
            db.commit()
            return RegisterOut(
                device_id=existing.id, token=existing.token, approved=existing.approved
            )

    device_id = uuid.uuid4().hex[:16]
    display = Display(
        id=device_id,
        token=secrets.token_hex(24),
        name=(body.name or f"Display {device_id[:6].upper()}"),
        resolution=body.resolution or "",
        orientation=body.orientation or "landscape",
        app_version=body.app_version or "",
    )
    db.add(display)
    db.commit()
    log.info("display.registered display_id=%s name=%s", display.id, display.name)
    return RegisterOut(device_id=display.id, token=display.token, approved=False)


@router.get("/api/display/status")
def display_status(request: Request, db: Session = Depends(get_db)) -> dict:
    display = get_display_by_token(db, request.headers.get("authorization"))
    return {
        "device_id": display.id,
        "name": display.name,
        "approved": display.approved,
        "enabled": display.enabled,
        "orientation": display.orientation,
    }


@router.get("/api/display/state")
def display_state(request: Request, db: Session = Depends(get_db)) -> dict:
    display = get_display_by_token(db, request.headers.get("authorization"))
    require_approved_display(display)
    touch(display)
    db.commit()
    state = build_state(db, display)
    state["display"] = {"id": display.id, "name": display.name}
    return state


@router.websocket("/ws/display/{device_id}")
async def display_ws(websocket: WebSocket, device_id: str, token: str = "") -> None:
    db = SessionLocal()
    try:
        display = db.get(Display, device_id)
        if (
            display is None
            or not token
            or not secrets.compare_digest(display.token, token)
            or not display.approved
            or not display.enabled
        ):
            await websocket.close(code=4401)
            return

        await websocket.accept()
        await manager.connect(device_id, websocket)
        touch(display)
        db.commit()
        log.info("display.connected display_id=%s", device_id)

        state = build_state(db, display)
        await websocket.send_json({"type": "hello", "version": state["version"]})

        while True:
            try:
                msg = await websocket.receive_json()
            except WebSocketDisconnect:
                break
            if isinstance(msg, dict) and msg.get("type") == "ping":
                touch(display)
                db.commit()
                try:
                    await websocket.send_json({"type": "pong"})
                except Exception:  # noqa: BLE001
                    break
    except Exception as exc:  # noqa: BLE001
        log.warning("ws error display_id=%s: %s", device_id, exc)
        try:
            await websocket.close(code=1011)
        except Exception:  # noqa: BLE001
            pass
    finally:
        manager.disconnect(device_id)
        try:
            d = db.get(Display, device_id)
            if d:
                touch(d)
                db.commit()
        except Exception:  # noqa: BLE001
            pass
        db.close()
