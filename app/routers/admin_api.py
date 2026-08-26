"""Admin-REST-API: Auth, Rollen, Displays, Inhalte, Layouts, Zeitplaene,
Einstellungen, Backup, ICS-Import."""
from __future__ import annotations

import io
import json
import logging
import sqlite3
import tempfile
import time as _time
import zipfile
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from .. import config
from ..auth import (
    SESSION_COOKIE,
    SESSION_TTL_SECONDS,
    create_session,
    hash_password,
    require_admin,
    require_full_admin,
    verify_password,
)
from ..database import get_db
from ..models import (
    AdminUser,
    Announcement,
    Display,
    Event,
    Layout,
    MediaItem,
    Schedule,
    Setting,
)
from ..seed import DEFAULT_SETTINGS, get_setting, set_setting
from ..services import weather as weather_svc
from ..services.state import (
    _rule_matches,
    build_state,
    now_local,
    pick_layout,
    resolve_elements,
)
from ..ws import manager

router = APIRouter(prefix="/api/admin", tags=["admin"])
log = logging.getLogger("stadtdashboard.admin")

# ── Login-Rate-Limit (pro Host+Benutzer, gleitendes Fenster) ───────────────
RATE_LIMIT_MAX = 5
RATE_LIMIT_WINDOW = 60.0
_login_failures: dict[str, list[float]] = {}


def _rate_limited(key: str) -> tuple[bool, int]:
    now = _time.monotonic()
    attempts = [t for t in _login_failures.get(key, []) if now - t < RATE_LIMIT_WINDOW]
    _login_failures[key] = attempts
    return len(attempts) >= RATE_LIMIT_MAX, RATE_LIMIT_MAX - len(attempts)


def reset_rate_limit() -> None:
    """Für Tests/Verwaltung: Zähler zurücksetzen."""
    _login_failures.clear()


async def notify_displays() -> None:
    await manager.broadcast({"type": "reload"})


# ── Auth ────────────────────────────────────────────────────────────────────
class LoginIn(BaseModel):
    username: str
    password: str


class PasswordIn(BaseModel):
    old: str
    new: str = Field(min_length=8)


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)) -> Response:
    host = request.client.host if request.client else "local"
    key = f"{host}|{body.username}"
    limited, remaining = _rate_limited(key)
    if limited:
        log.warning("login.rate_limited key=%s", key)
        raise HTTPException(
            status_code=429,
            detail="Zu viele Fehlversuche – bitte in einer Minute erneut versuchen.",
        )
    user = db.query(AdminUser).filter_by(username=body.username).first()
    if not user or not verify_password(body.password, user.password_hash):
        _login_failures.setdefault(key, []).append(_time.monotonic())
        left = RATE_LIMIT_MAX - len(_login_failures[key])
        log.warning("login.failed username=%s verbleibende_versuche=%s",
                    body.username, max(0, left))
        raise HTTPException(status_code=401,
                            detail=f"Benutzer oder Passwort falsch ({max(0, left)} Versuche übrig)")
    _login_failures.pop(key, None)  # erfolgreicher Login resettet den Zähler
    resp = Response(content='{"ok": true}', media_type="application/json")
    resp.set_cookie(
        SESSION_COOKIE,
        create_session(user.username),
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
    )
    return resp


# ── Benutzerverwaltung (nur volle Admins) ──────────────────────────────────
class UserIn(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8)
    role: str = Field(pattern="^(admin|editor)$")


@router.get("/users")
def list_users(db: Session = Depends(get_db), _u=Depends(require_full_admin)) -> list[dict]:
    return [
        {"id": u.id, "username": u.username, "role": getattr(u, "role", "admin")}
        for u in db.query(AdminUser).order_by(AdminUser.id.asc()).all()
    ]


@router.post("/users")
def create_user(
    body: UserIn, db: Session = Depends(get_db), _u=Depends(require_full_admin),
) -> dict:
    if db.query(AdminUser).filter_by(username=body.username).first():
        raise HTTPException(status_code=409, detail="Benutzer existiert bereits")
    u = AdminUser(username=body.username, password_hash=hash_password(body.password),
                  role=body.role)
    db.add(u)
    db.commit()
    log.info("user.created username=%s role=%s", u.username, u.role)
    return {"id": u.id}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int, request_user: AdminUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    if getattr(request_user, "role", "admin") != "admin":
        raise HTTPException(status_code=403, detail="Nur Administratoren")
    target = db.get(AdminUser, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Nicht gefunden")
    if target.id == request_user.id:
        raise HTTPException(status_code=400, detail="Man kann sich nicht selbst löschen")
    if getattr(target, "role", "admin") == "admin" and \
            db.query(AdminUser).filter(AdminUser.role == "admin").count() <= 1:
        raise HTTPException(status_code=400, detail="Letzter Administrator kann nicht gelöscht werden")
    db.delete(target)
    db.commit()
    return {"ok": True}


@router.post("/logout")
def logout() -> Response:
    resp = Response(content='{"ok": true}', media_type="application/json")
    resp.delete_cookie(SESSION_COOKIE)
    return resp


@router.put("/password")
def change_password(
    body: PasswordIn, request_user: AdminUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    if not verify_password(body.old, request_user.password_hash):
        raise HTTPException(status_code=400, detail="Altes Passwort ist falsch")
    request_user.password_hash = hash_password(body.new)
    db.commit()
    # Initial-Passwort-Datei entsorgen: Gilt ab jetzt als geaendert.
    try:
        config.INITIAL_PW_FILE.unlink(missing_ok=True)
    except OSError as exc:
        log.warning("Initial-Passwort-Datei konnte nicht entfernt werden: %s", exc)
    log.info("admin.password_changed user=%s", request_user.username)
    return {"ok": True}


@router.get("/status")
def admin_status(
    request_user: AdminUser = Depends(require_admin), db: Session = Depends(get_db)
) -> dict:
    """Bootstrap-Status: wird noch das Initial-Passwort verwendet?"""
    initial_active = False
    if config.INITIAL_PW_FILE.exists():
        try:
            initial_pw = config.INITIAL_PW_FILE.read_text().strip()
            initial_active = verify_password(initial_pw, request_user.password_hash)
        except OSError:
            pass
    return {
        "app": config.APP_NAME,
        "version": config.VERSION,
        "initial_password_active": initial_active,
    }


# ── Displays ────────────────────────────────────────────────────────────────
def _display_online(display: Display) -> bool:
    return bool(
        display.last_seen
        and display.last_seen
        >= datetime.utcnow() - timedelta(seconds=config.DISPLAY_ONLINE_SECONDS)
    )


@router.get("/displays")
def list_displays(db: Session = Depends(get_db), _u=Depends(require_admin)) -> list[dict]:
    out = []
    for d in db.query(Display).order_by(Display.created_at.asc()).all():
        eff = pick_layout(db, d)
        out.append({
            "id": d.id, "name": d.name, "location": d.location,
            "resolution": d.resolution, "orientation": d.orientation,
            "approved": d.approved, "enabled": d.enabled,
            "online": _display_online(d),
            "last_seen": d.last_seen.isoformat(timespec="seconds") if d.last_seen else None,
            "layout_id": d.layout_id, "schedule_id": d.schedule_id,
            "effective_layout": {"id": eff.id, "name": eff.name} if eff else None,
        })
    return out


class DisplayPatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    location: str | None = Field(default=None, max_length=120)
    enabled: bool | None = None
    orientation: str | None = None
    layout_id: int | None = None
    schedule_id: int | None = None


@router.patch("/displays/{device_id}")
async def patch_display(
    device_id: str, body: DisplayPatch,
    db: Session = Depends(get_db), _u=Depends(require_full_admin),
) -> dict:
    d = db.get(Display, device_id)
    if not d:
        raise HTTPException(status_code=404, detail="Display nicht gefunden")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(d, key, value)
    db.commit()
    await notify_displays()
    return {"ok": True}


@router.post("/displays/{device_id}/approve")
def approve_display(
    device_id: str, db: Session = Depends(get_db), _u=Depends(require_full_admin),
) -> dict:
    d = db.get(Display, device_id)
    if not d:
        raise HTTPException(status_code=404, detail="Display nicht gefunden")
    d.approved = True
    db.commit()
    log.info("display.approved display_id=%s", device_id)
    return {"ok": True}


@router.post("/displays/{device_id}/revoke")
def revoke_display(
    device_id: str, db: Session = Depends(get_db), _u=Depends(require_full_admin),
) -> dict:
    """Token zuruecksetzen → Display muss neu gekoppelt werden."""
    import secrets as _secrets

    d = db.get(Display, device_id)
    if not d:
        raise HTTPException(status_code=404, detail="Display nicht gefunden")
    d.token = _secrets.token_hex(24)
    d.approved = False
    db.commit()
    log.info("display.revoked display_id=%s", device_id)
    return {"ok": True}


@router.delete("/displays/{device_id}")
def delete_display(
    device_id: str, db: Session = Depends(get_db), _u=Depends(require_full_admin),
) -> dict:
    d = db.get(Display, device_id)
    if not d:
        raise HTTPException(status_code=404, detail="Display nicht gefunden")
    db.delete(d)
    db.commit()
    return {"ok": True}


# ── Bekanntmachungen ────────────────────────────────────────────────────────
class AnnouncementIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = ""
    priority: int = Field(default=1, ge=1, le=5)
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    active: bool = True
    qr_url: str = ""


@router.get("/announcements")
def list_announcements(db: Session = Depends(get_db), _u=Depends(require_admin)) -> list[dict]:
    rows = (
        db.query(Announcement)
        .order_by(Announcement.priority.desc(), Announcement.created_at.desc())
        .all()
    )
    now = now_local()
    return [
        {
            **{k: getattr(a, k) for k in
               ("id", "title", "body", "priority", "active", "qr_url")},
            "valid_from": a.valid_from.isoformat(timespec="minutes") if a.valid_from else "",
            "valid_until": a.valid_until.isoformat(timespec="minutes") if a.valid_until else "",
            "currently_valid": bool(
                a.active
                and (not a.valid_from or now >= a.valid_from)
                and (not a.valid_until or now <= a.valid_until)
            ),
        }
        for a in rows
    ]


@router.post("/announcements")
async def create_announcement(
    body: AnnouncementIn, db: Session = Depends(get_db), _u=Depends(require_admin),
) -> dict:
    a = Announcement(**body.model_dump())
    db.add(a)
    db.commit()
    await notify_displays()
    return {"id": a.id}


@router.patch("/announcements/{item_id}")
async def update_announcement(
    item_id: int, body: AnnouncementIn,
    db: Session = Depends(get_db), _u=Depends(require_admin),
) -> dict:
    a = db.get(Announcement, item_id)
    if not a:
        raise HTTPException(status_code=404, detail="Nicht gefunden")
    for key, value in body.model_dump().items():
        setattr(a, key, value)
    db.commit()
    await notify_displays()
    return {"ok": True}


@router.delete("/announcements/{item_id}")
async def delete_announcement(
    item_id: int, db: Session = Depends(get_db), _u=Depends(require_admin),
) -> dict:
    a = db.get(Announcement, item_id)
    if a:
        db.delete(a)
        db.commit()
        await notify_displays()
    return {"ok": True}


# ── Veranstaltungen ─────────────────────────────────────────────────────────
class EventIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    start_at: datetime
    end_at: datetime | None = None
    location: str = ""
    category: str = "Allgemein"
    website: str = ""
    featured: bool = False


@router.get("/events")
def list_events(db: Session = Depends(get_db), _u=Depends(require_admin)) -> list[dict]:
    rows = db.query(Event).order_by(Event.start_at.asc()).all()
    return [
        {
            **{k: getattr(e, k) for k in
               ("id", "title", "description", "location", "category", "website",
                "featured")},
            "start_at": e.start_at.isoformat(timespec="minutes"),
            "end_at": e.end_at.isoformat(timespec="minutes") if e.end_at else "",
        }
        for e in rows
    ]


@router.post("/events")
async def create_event(
    body: EventIn, db: Session = Depends(get_db), _u=Depends(require_admin),
) -> dict:
    e = Event(**body.model_dump())
    db.add(e)
    db.commit()
    await notify_displays()
    return {"id": e.id}


@router.patch("/events/{item_id}")
async def update_event(
    item_id: int, body: EventIn,
    db: Session = Depends(get_db), _u=Depends(require_admin),
) -> dict:
    e = db.get(Event, item_id)
    if not e:
        raise HTTPException(status_code=404, detail="Nicht gefunden")
    for key, value in body.model_dump().items():
        setattr(e, key, value)
    db.commit()
    await notify_displays()
    return {"ok": True}


@router.delete("/events/{item_id}")
async def delete_event(
    item_id: int, db: Session = Depends(get_db), _u=Depends(require_admin),
) -> dict:
    e = db.get(Event, item_id)
    if e:
        db.delete(e)
        db.commit()
        await notify_displays()
    return {"ok": True}


# ── Veranstaltungs-Import (iCal/ICS, lokal geparsed) ───────────────────────
class IcsImportIn(BaseModel):
    url: str | None = None
    ics_text: str | None = None


MAX_IMPORT_EVENTS = 500


@router.post("/events/import")
async def import_events(
    body: IcsImportIn, db: Session = Depends(get_db), _u=Depends(require_admin),
) -> dict:
    """Importiert VEVENTs aus einer ICS-Datei (Text/Feld) oder URL.

    Datenschutz: URL-Import ist ein externer Abruf und nur bei aktiviertem
    'allow_external' erlaubt. Datei-Upload funktioniert immer lokal.
    Duplikate (gleicher Titel + gleicher Start) werden übersprungen.
    """
    text = (body.ics_text or "").strip()
    if not text and body.url:
        if get_setting(db, "allow_external", "false") != "true":
            raise HTTPException(
                status_code=400,
                detail="URL-Import benötigt aktivierten externen Zugriff "
                       "(Einstellungen → Datenschutz). ICS-Datei-Upload geht immer.",
            )
        try:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as c:
                resp = await c.get(body.url)
                resp.raise_for_status()
                text = resp.text
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=400,
                                detail=f"Kalender-URL nicht abrufbar: {exc}")
    if not text:
        raise HTTPException(status_code=400,
                            detail="Weder ICS-Text noch URL übergeben.")

    from icalendar import Calendar

    try:
        cal = Calendar.from_ical(text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400,
                            detail=f"ICS konnte nicht gelesen werden: {exc}")

    tz = ZoneInfo(config.TIMEZONE)
    now = now_local()
    imported = dupes = past = skipped = 0

    for comp in cal.walk("VEVENT"):
        title = str(comp.get("SUMMARY", "")).strip()
        dtstart = comp.get("DTSTART")
        if not title or dtstart is None or not getattr(dtstart.dt, "year", None):
            skipped += 1
            continue
        start = dtstart.dt
        if isinstance(start, date) and not isinstance(start, datetime):
            start = datetime.combine(start, time.min)
        if start.tzinfo is not None:
            start = start.astimezone(tz).replace(tzinfo=None)

        end = None
        dtend = comp.get("DTEND")
        if dtend is not None and getattr(dtend.dt, "year", None):
            end = dtend.dt
            if isinstance(end, date) and not isinstance(end, datetime):
                end = datetime.combine(end, time.min)
            if getattr(end, "tzinfo", None) is not None:
                end = end.astimezone(tz).replace(tzinfo=None)

        if start < now - timedelta(hours=2):
            past += 1
            continue

        exists = (
            db.query(Event)
            .filter(Event.title == title[:200], Event.start_at == start)
            .first()
        )
        if exists:
            dupes += 1
            continue
        if imported + db.query(Event).count() >= MAX_IMPORT_EVENTS:
            break

        db.add(Event(
            title=title[:200],
            description=str(comp.get("DESCRIPTION", ""))[:2000],
            start_at=start, end_at=end,
            location=str(comp.get("LOCATION", ""))[:200],
        ))
        imported += 1

    db.commit()
    await notify_displays()
    log.info("events.imported imported=%s dupes=%s past=%s invalid=%s",
             imported, dupes, past, skipped)
    return {"imported": imported, "duplicates": dupes, "past": past,
            "invalid": skipped}


# ── Medien ──────────────────────────────────────────────────────────────────
@router.get("/media")
def list_media(db: Session = Depends(get_db), _u=Depends(require_admin)) -> list[dict]:
    rows = db.query(MediaItem).order_by(MediaItem.created_at.desc()).all()
    return [
        {
            **{k: getattr(m, k) for k in ("id", "title", "mime", "kind", "size")},
            "original_name": m.original_name,
            "url": f"/media/{m.id}",
            "thumb_url": f"/media/{m.id}/thumb" if m.kind == "image" else "",
        }
        for m in rows
    ]


ALLOWED_EXT = config.ALLOWED_IMAGE_EXT | config.ALLOWED_VIDEO_EXT


@router.post("/media")
async def upload_media(
    file: UploadFile = File(...),
    title: str = "",
    db: Session = Depends(get_db), _u=Depends(require_admin),
) -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"Dateityp '{suffix or '?'}' nicht erlaubt. Erlaubt: "
                   f"{', '.join(sorted(ALLOWED_EXT))}",
        )

    limit = config.MAX_UPLOAD_MB * 1024 * 1024
    payload = await file.read(limit + 1)
    if len(payload) > limit:
        raise HTTPException(
            status_code=413, detail=f"Datei groesser als {config.MAX_UPLOAD_MB} MB"
        )

    kind = "video" if suffix in config.ALLOWED_VIDEO_EXT else "image"
    filename = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{config_upload_token()}{suffix}"
    dest = config.UPLOAD_DIR / filename
    dest.write_bytes(payload)

    width = height = 0
    thumb_name = None
    if kind == "image" and suffix != ".svg":
        try:
            from PIL import Image

            with Image.open(dest) as img:
                width, height = img.size
                thumb = img.convert("RGB") if img.mode not in ("RGB", "RGBA") else img.copy()
                thumb.thumbnail((640, 640))
                thumbs_dir = config.UPLOAD_DIR / "thumbs"
                thumbs_dir.mkdir(exist_ok=True)
                thumb_name = f"{Path(filename).stem}.jpg"
                thumb.save(thumbs_dir / thumb_name, "JPEG", quality=80)
        except Exception as exc:  # noqa: BLE001
            log.warning("thumbnail fehlgeschlagen %s: %s", filename, exc)

    item = MediaItem(
        filename=filename, original_name=file.filename or filename,
        title=title or Path(file.filename or "Bild").stem, mime=file.content_type or "",
        kind=kind, size=len(payload), width=width, height=height,
    )
    db.add(item)
    db.commit()
    await notify_displays()
    return {"id": item.id, "kind": kind}


def config_upload_token() -> str:
    import secrets

    return secrets.token_hex(6)


@router.delete("/media/{item_id}")
async def delete_media(
    item_id: int, db: Session = Depends(get_db), _u=Depends(require_admin),
) -> dict:
    m = db.get(MediaItem, item_id)
    if not m:
        raise HTTPException(status_code=404, detail="Nicht gefunden")
    try:
        (config.UPLOAD_DIR / m.filename).unlink(missing_ok=True)
        (config.UPLOAD_DIR / "thumbs" / f"{Path(m.filename).stem}.jpg").unlink(missing_ok=True)
    except OSError as exc:
        log.warning("Datei konnte nicht geloescht werden: %s", exc)
    db.delete(m)
    db.commit()
    await notify_displays()
    return {"ok": True}


# ── Medium einem Layout zuweisen (auch für Redakteure) ─────────────────────
class AssignIn(BaseModel):
    layout_id: int
    mode: str = Field(pattern="^(gallery|image)$")

    @field_validator("mode")
    @classmethod
    def known_mode(cls, v: str) -> str:
        if v not in ("gallery", "image"):
            raise ValueError("mode muss gallery oder image sein")
        return v


@router.post("/media/{item_id}/assign")
async def assign_media(
    item_id: int, body: AssignIn,
    db: Session = Depends(get_db), _u=Depends(require_admin),
) -> dict:
    """Hängt ein Medium ins erste passende Widget eines Layouts
    (Galerie-Liste bzw. Bild-Widget); legt das Widget bei Bedarf an.
    Bewusst für Redakteure freigegeben – Inhalt, kein Gerätedesign."""
    m = db.get(MediaItem, item_id)
    if not m:
        raise HTTPException(status_code=404, detail="Medium nicht gefunden")
    l_ = db.get(Layout, body.layout_id)
    if not l_:
        raise HTTPException(status_code=404, detail="Layout nicht gefunden")

    els = json.loads(json.dumps(l_.elements or []))
    target = next((e for e in els if e.get("type") == body.mode), None)
    if target is None:
        target = (
            {"type": "gallery", "x": 36, "y": 17, "w": 38, "h": 62,
             "config": {"media_ids": [], "seconds": 8}}
            if body.mode == "gallery"
            else {"type": "image", "x": 36, "y": 17, "w": 38, "h": 50,
                  "config": {"media_id": None}}
        )
        els.append(target)

    if body.mode == "gallery":
        ids = target["config"].setdefault("media_ids", [])
        if item_id not in ids:
            ids.append(item_id)
    else:
        target["config"]["media_id"] = item_id

    l_.elements = els
    db.commit()
    await notify_displays()
    log.info("media.assigned media=%s layout=%s mode=%s", item_id, l_.id, body.mode)
    return {"ok": True}


# ── Layouts ─────────────────────────────────────────────────────────────────
WIDGET_TYPES = {
    "header", "clock", "date", "weather", "forecast", "text", "image", "gallery",
    "events", "announcements", "qr", "ticker", "webcam", "website", "rss",
}


class LayoutElement(BaseModel):
    type: str
    x: int = Field(ge=0, le=100)
    y: int = Field(ge=0, le=100)
    w: int = Field(ge=1, le=100)
    h: int = Field(ge=1, le=100)
    config: dict = {}

    @field_validator("type")
    @classmethod
    def known_type(cls, v: str) -> str:
        if v not in WIDGET_TYPES:
            raise ValueError(f"Unbekannter Widget-Typ: {v}")
        return v


class LayoutIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    orientation: str = "landscape"
    elements: list[LayoutElement] = []
    background: dict = {}
    is_default: bool = False


@router.get("/layouts")
def list_layouts(db: Session = Depends(get_db), _u=Depends(require_admin)) -> list[dict]:
    return [
        {
            **{k: getattr(l, k) for k in ("id", "name", "orientation", "elements",
                                          "is_default", "background")},
            "updated_at": l.updated_at.isoformat(timespec="seconds"),
        }
        for l in db.query(Layout).order_by(Layout.id.asc()).all()
    ]


@router.get("/layouts/{item_id}/state")
def layout_preview_state(
    item_id: int, db: Session = Depends(get_db), _u=Depends(require_admin),
) -> dict:
    """Vorschau-Zustand fuer das Admin-Layout-Preview (ohne Display-Token)."""
    layout = db.get(Layout, item_id)
    if not layout:
        raise HTTPException(status_code=404, detail="Layout nicht gefunden")

    class _PreviewDisplay:  # minimal-Stub
        id = "preview"
        name = "Vorschau"
        layout_id = item_id
        schedule_id = None

    state = build_state(db, _PreviewDisplay())  # type: ignore[arg-type]
    state["layout"]["orientation"] = layout.orientation
    state["layout"]["elements"] = resolve_elements(db, layout.elements)
    return state


@router.post("/layouts")
async def create_layout(
    body: LayoutIn, db: Session = Depends(get_db), _u=Depends(require_full_admin),
) -> dict:
    l_ = Layout(
        name=body.name, orientation=body.orientation,
        elements=[e.model_dump() for e in body.elements],
        background=body.background or {},
    )
    if body.is_default:
        db.query(Layout).update({Layout.is_default: False})
        l_.is_default = True
    db.add(l_)
    db.commit()
    await notify_displays()
    return {"id": l_.id}


# ── Vorlagen & geführtes Hinzufügen (Layout gestalten) ─────────────────────
@router.get("/layout-presets")
def list_presets(_u=Depends(require_admin)) -> list[dict]:
    """Statische Vorlagen aus dem Code – ohne Elemente für schlanke Antworten."""
    from ..layout_presets import PRESETS

    return [
        {k: p[k] for k in ("id", "name", "description", "orientation",
                           "background")}
        | {"widget_count": len(p["elements"])}
        for p in PRESETS
    ]


class FromPresetIn(BaseModel):
    preset_id: str
    name: str | None = Field(default=None, max_length=120)


@router.post("/layouts/from-preset")
async def create_from_preset(
    body: FromPresetIn, db: Session = Depends(get_db),
    _u=Depends(require_full_admin),
) -> dict:
    """Neues Layout aus einer Vorlage erstellen."""
    from ..layout_presets import preset_layout_copy

    try:
        data = preset_layout_copy(body.preset_id, body.name)
    except KeyError:
        raise HTTPException(status_code=404,
                            detail=f"Unbekannte Vorlage: {body.preset_id}")
    l_ = Layout(**data)
    db.add(l_)
    db.commit()
    await notify_displays()
    return {"id": l_.id, "name": l_.name}


class AddWidgetIn(BaseModel):
    type: str
    config: dict = {}
    slot: str = "rechts"

    @field_validator("type")
    @classmethod
    def known_type(cls, v: str) -> str:
        if v not in WIDGET_TYPES:
            raise ValueError(f"Unbekannter Widget-Typ: {v}")
        return v


@router.post("/layouts/{item_id}/add-widget")
async def add_widget(
    item_id: int, body: AddWidgetIn,
    db: Session = Depends(get_db), _u=Depends(require_admin),
) -> dict:
    """Geführtes Hinzufügen ('Layout gestalten'): Widget mit Slot-Position
    ans Layout anhängen. Bewusst für Redakteure offen – das ist der
    Inhalts-Pfad ohne klassischen Editor."""
    from ..layout_presets import WIDGET_DEFAULTS, slot_rect

    l_ = db.get(Layout, item_id)
    if not l_:
        raise HTTPException(status_code=404, detail="Layout nicht gefunden")

    base = json.loads(json.dumps(WIDGET_DEFAULTS.get(body.type, {"config": {}})))
    cfg = {**base.get("config", {}), **(body.config or {})}
    x, y, w, h = slot_rect(body.slot, l_.orientation)

    # Stapeln: Ziel-Slot suchen, der nicht exakt belegt ist (Schrittweite 5 %)
    els = json.loads(json.dumps(l_.elements or []))
    max_y = max(0, 100 - h)
    yy = min(y, max_y)
    while any(int(e.get("x", 0)) == int(x) and int(e.get("y", 0)) == int(yy)
              for e in els) and yy < max_y:
        yy = min(yy + 5, max_y)
    y = yy

    element = {"type": body.type, "x": x, "y": y, "w": w, "h": h, "config": cfg}
    els.append(element)
    l_.elements = els
    db.commit()
    await notify_displays()
    log.info("layout.add_widget layout=%s type=%s slot=%s",
             item_id, body.type, body.slot)
    return {
        "ok": True, "element": element,
        "preview_url": f"/display?preview={l_.id}",
    }


@router.patch("/layouts/{item_id}")
async def update_layout(
    item_id: int, body: LayoutIn,
    db: Session = Depends(get_db), _u=Depends(require_full_admin),
) -> dict:
    l_ = db.get(Layout, item_id)
    if not l_:
        raise HTTPException(status_code=404, detail="Layout nicht gefunden")
    if l_.is_default and not body.is_default and db.query(Layout).count() == 1:
        raise HTTPException(status_code=400, detail="Es muss ein Standardlayout geben")
    l_.name = body.name
    l_.orientation = body.orientation
    l_.elements = [e.model_dump() for e in body.elements]
    l_.background = body.background or {}
    if body.is_default and not l_.is_default:
        db.query(Layout).update({Layout.is_default: False})
        l_.is_default = True
    db.commit()
    await notify_displays()
    return {"ok": True}


@router.delete("/layouts/{item_id}")
async def delete_layout(
    item_id: int, db: Session = Depends(get_db), _u=Depends(require_full_admin),
) -> dict:
    l_ = db.get(Layout, item_id)
    if not l_:
        raise HTTPException(status_code=404, detail="Layout nicht gefunden")
    if l_.is_default:
        raise HTTPException(status_code=400, detail="Standardlayout kann nicht geloescht werden")
    used = (
        db.query(Schedule).filter(Schedule.rules.like(f'%\"layout_id\": {item_id}%')).count()
        + db.query(Display).filter(Display.layout_id == item_id).count()
    )
    if used:
        raise HTTPException(status_code=409, detail="Layout wird noch verwendet")
    db.delete(l_)
    db.commit()
    await notify_displays()
    return {"ok": True}


@router.post("/layouts/{item_id}/duplicate")
async def duplicate_layout(
    item_id: int, db: Session = Depends(get_db), _u=Depends(require_full_admin),
) -> dict:
    """Legt eine 1:1-Kopie als neues (Nicht-Standard-)Layout an."""
    l_ = db.get(Layout, item_id)
    if not l_:
        raise HTTPException(status_code=404, detail="Layout nicht gefunden")
    copy = Layout(
        name=f"{l_.name} (Kopie)", orientation=l_.orientation,
        elements=json.loads(json.dumps(l_.elements or [])), is_default=False,
        background=json.loads(json.dumps(l_.background or {})),
    )
    db.add(copy)
    db.commit()
    await notify_displays()
    log.info("layout.duplicated from=%s to=%s", item_id, copy.id)
    return {"id": copy.id, "name": copy.name}


# ── Zeitpläne ───────────────────────────────────────────────────────────────
class ScheduleRule(BaseModel):
    start: str = "00:00"
    end: str = "23:59"
    weekdays: list[int] = [0, 1, 2, 3, 4, 5, 6]
    layout_id: int


class ScheduleIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    priority: int = Field(default=1, ge=1, le=100)
    rules: list[ScheduleRule] = []


@router.get("/schedules")
def list_schedules(db: Session = Depends(get_db), _u=Depends(require_admin)) -> list[dict]:
    now = now_local()
    return [
        {
            **{k: getattr(s, k) for k in ("id", "name", "priority", "rules")},
            "active_now": any(_rule_matches(r, now) for r in (s.rules or [])),
        }
        for s in db.query(Schedule).order_by(Schedule.priority.desc()).all()
    ]


@router.post("/schedules")
async def create_schedule(
    body: ScheduleIn, db: Session = Depends(get_db), _u=Depends(require_full_admin),
) -> dict:
    for rule in body.rules:
        if not db.get(Layout, rule.layout_id):
            raise HTTPException(status_code=400, detail="Regel verweist auf unbekanntes Layout")
    s = Schedule(
        name=body.name, priority=body.priority,
        rules=[r.model_dump() for r in body.rules],
    )
    db.add(s)
    db.commit()
    await notify_displays()
    return {"id": s.id}


@router.patch("/schedules/{item_id}")
async def update_schedule(
    item_id: int, body: ScheduleIn,
    db: Session = Depends(get_db), _u=Depends(require_full_admin),
) -> dict:
    s = db.get(Schedule, item_id)
    if not s:
        raise HTTPException(status_code=404, detail="Nicht gefunden")
    s.name = body.name
    s.priority = body.priority
    s.rules = [r.model_dump() for r in body.rules]
    db.commit()
    await notify_displays()
    return {"ok": True}


@router.delete("/schedules/{item_id}")
async def delete_schedule(
    item_id: int, db: Session = Depends(get_db), _u=Depends(require_full_admin),
) -> dict:
    s = db.get(Schedule, item_id)
    if s:
        db.query(Display).filter(Display.schedule_id == item_id).update(
            {Display.schedule_id: None}
        )
        db.delete(s)
        db.commit()
        await notify_displays()
    return {"ok": True}


# ── Einstellungen & Datenschutz ─────────────────────────────────────────────
SETTING_KEYS = list(DEFAULT_SETTINGS.keys())


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), _u=Depends(require_full_admin)) -> dict:
    values = {key: get_setting(db, key, "") for key in SETTING_KEYS}
    weather_cache_raw = get_setting(db, "weather_cache", "")
    cache_info = {}
    if weather_cache_raw:
        try:
            cache_info = {
                "cached": True,
                "fetched_at": datetime.fromtimestamp(
                    json.loads(weather_cache_raw)["fetched_at"]
                ).isoformat(timespec="seconds"),
            }
        except (ValueError, KeyError):  # noqa: PERF203
            cache_info = {}
    return {"values": values, "weather_cache": cache_info}


class SettingsIn(BaseModel):
    values: dict[str, str]


@router.put("/settings")
async def put_settings(
    body: SettingsIn, db: Session = Depends(get_db), _u=Depends(require_full_admin),
) -> dict:
    changed_external = False
    for key, value in body.values.items():
        if key not in SETTING_KEYS:
            continue
        if key == "allow_external":
            value = "true" if value == "true" else "false"
            if value != get_setting(db, "allow_external"):
                changed_external = True
        set_setting(db, key, value[:2000])
    if changed_external:
        # Cache verwerfen, wenn externe Dienste deaktiviert wurden
        set_setting(db, "weather_cache", "")
    db.commit()
    await notify_displays()
    return {"ok": True}


@router.post("/weather/refresh")
def refresh_weather(db: Session = Depends(get_db), _u=Depends(require_full_admin)) -> dict:
    set_setting(db, "weather_cache", "")
    db.commit()
    return weather_svc.current_weather(db)


# ── Backup ──────────────────────────────────────────────────────────────────
@router.get("/backup")
def download_backup(db: Session = Depends(get_db), _u=Depends(require_full_admin)):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Datenbank ueber SQLite-Backup-API konsistent sichern
        with tempfile.NamedTemporaryFile(suffix=".db") as tmp:
            src = sqlite3.connect(str(config.DB_PATH))
            dst = sqlite3.connect(tmp.name)
            with dst:
                src.backup(dst)
            dst.close()
            src.close()
            zf.write(tmp.name, "stadtdashboard.db")

        settings = {row.key: row.value for row in db.query(Setting).all()}
        zf.writestr("settings.json", json.dumps(settings, indent=2, ensure_ascii=False))

        for path in sorted(config.UPLOAD_DIR.rglob("*")):
            if path.is_file():
                zf.write(path, f"uploads/{path.relative_to(config.UPLOAD_DIR)}")

    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=stadtdashboard-{stamp}.zip"},
    )
