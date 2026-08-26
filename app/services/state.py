"""Baut den Anzeige-Zustand fuer Displays: Layout-Auswahl (Zeitplan),
aktive Bekanntmachungen, Veranstaltungen, Wetter, aufgeloeste Widget-Daten.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from urllib.parse import urlparse

from sqlalchemy.orm import Session

from .. import config
from ..models import Announcement, Display, Event, Layout, MediaItem, Schedule
from ..seed import get_setting
from . import weather as weather_svc
from .qrcode_svc import qr_data_url


def _is_local_url(url: str) -> bool:
    """LAN-Adressen gelten als lokal – für Kameras/Intranet-Seiten gedacht."""
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    if not host:
        return False
    if host in ("localhost",) or host.endswith(
            (".local", ".lan", ".internal", ".box", ".home", ".corp")):
        return True
    parts = host.split(".")
    if len(parts) == 4 and all(p.isdigit() for p in parts):
        a, b = int(parts[0]), int(parts[1])
        if a == 10 or a == 127 or (a == 192 and b == 168) \
                or (a == 172 and 16 <= b <= 31):
            return True
    return False


def _external_allowed(db) -> bool:
    return get_setting(db, "allow_external", "false") == "true"


def now_local() -> datetime:
    tz = ZoneInfo(config.TIMEZONE)
    return datetime.now(tz).replace(tzinfo=None)


def _rule_matches(rule: dict, now: datetime) -> bool:
    weekdays = rule.get("weekdays")
    if weekdays is not None and now.weekday() not in set(weekdays):
        return False
    start = parse_hhmm(rule.get("start", "00:00"))
    end = parse_hhmm(rule.get("end", "23:59"))
    minutes = now.hour * 60 + now.minute
    if start <= end:
        return start <= minutes < end
    # Uebernacht-Fenster (z.B. 22:00-06:00)
    return minutes >= start or minutes < end


def parse_hhmm(value: str) -> int:
    try:
        h, m = str(value).split(":", 1)
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return 0


def pick_layout(db: Session, display: Display | None = None) -> Layout | None:
    """Display-Zeitplan > globale Zeitplaene nach Prioritaet > Standardlayout."""
    query = db.query(Schedule).order_by(Schedule.priority.desc(), Schedule.id.asc())
    schedules = query.all()
    if display is not None and display.schedule_id:
        schedules = [s for s in schedules if s.id == display.schedule_id] or schedules

    now = now_local()
    for schedule in schedules:
        for rule in schedule.rules or []:
            if _rule_matches(rule, now):
                layout = db.get(Layout, rule.get("layout_id"))
                if layout:
                    return layout

    if display is not None and display.layout_id:
        layout = db.get(Layout, display.layout_id)
        if layout:
            return layout

    default = db.query(Layout).filter_by(is_default=True).first()
    return default or db.query(Layout).first()


def active_announcements(db: Session, now: datetime) -> list[Announcement]:
    rows = (
        db.query(Announcement)
        .filter(Announcement.active.is_(True))
        .order_by(Announcement.priority.desc(), Announcement.created_at.desc())
        .all()
    )
    result = []
    for a in rows:
        if a.valid_from and now < a.valid_from:
            continue
        if a.valid_until and now > a.valid_until:
            continue
        result.append(a)
    return result


def upcoming_events(db: Session, now: datetime, limit: int = 12) -> list[Event]:
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    rows = (
        db.query(Event)
        .filter(
            (Event.start_at >= now - timedelta(hours=2))
            | ((Event.end_at != None) & (Event.end_at >= day_start))  # noqa: E711
        )
        .order_by(Event.featured.desc(), Event.start_at.asc())
        .limit(limit)
        .all()
    )
    return rows


def media_url(item: MediaItem) -> str:
    return f"/media/{item.id}"


def resolve_elements(db: Session, elements: list[dict]) -> list[dict]:
    out = []
    for el in elements or []:
        el = dict(el)
        cfg = dict(el.get("config") or {})
        etype = el.get("type")

        if etype == "image" and cfg.get("media_id"):
            item = db.get(MediaItem, cfg["media_id"])
            cfg["url"] = media_url(item) if item else ""
            cfg["kind"] = item.kind if item else "image"

        if etype == "gallery":
            urls = []
            for mid in cfg.get("media_ids", [])[:20]:
                item = db.get(MediaItem, mid)
                if item:
                    urls.append({"url": media_url(item), "kind": item.kind})
            cfg["items"] = urls

        if etype == "qr":
            key = cfg.get("setting_key", "")
            url = cfg.get("url") or (get_setting(db, key) if key else "")
            if url and url.startswith(("http://", "https://", "mailto:", "/")):
                cfg["resolved_url"] = url
                cfg["qr_image"] = qr_data_url(url)

        if etype == "webcam":
            mode = cfg.get("mode", "snapshot")
            url = (cfg.get("url") or "").strip()
            if mode == "rtsp" and url.startswith("rtsp://"):
                from .webcam import cam_path

                path = cam_path(url)
                cfg["resolved_url"] = f"/webcam/{cam_key(url)}.jpg" if path.is_file() else ""
            else:
                if url and not _is_local_url(url) and not _external_allowed(db):
                    cfg["blocked"] = True
                    cfg["resolved_url"] = ""
                else:
                    cfg["resolved_url"] = url

        if etype == "website":
            url = (cfg.get("url") or "").strip()
            if url and not _is_local_url(url) and not _external_allowed(db):
                cfg["blocked"] = True

        if etype == "rss":
            from . import rss as rss_svc

            feed = rss_svc.fetch_items(
                db, (cfg.get("url") or "").strip(),
                refresh_minutes=int(cfg.get("refresh_minutes") or 15),
                count=int(cfg.get("count") or 6),
            )
            cfg["items"] = feed["items"]
            cfg["stale"] = feed["stale"]

        if etype == "header":
            logo_id = get_setting(db, "logo_media_id", "")
            if logo_id.isdigit() and db.get(MediaItem, int(logo_id)):
                cfg["logo_url"] = f"/media/{logo_id}"

        el["config"] = cfg
        out.append(el)
    return out


def build_state(db: Session, display: Display | None = None) -> dict:
    now = now_local()
    layout = pick_layout(db, display)
    announcements = active_announcements(db, now)
    emergency = [a for a in announcements if a.priority >= 4]

    # Hintergrund auflösen (Farbe oder Bild mit Abdunkelung)
    bg_in = dict(getattr(layout, "background", None) or {})
    background = {"mode": bg_in.get("mode", "color"), "color": bg_in.get("color", "")}
    if background["mode"] == "image" and bg_in.get("media_id"):
        item = db.get(MediaItem, bg_in["media_id"])
        if item:
            background["media_url"] = media_url(item)
            background["thumb_url"] = f"/media/{item.id}/thumb"
        else:
            background["mode"] = "color"
            background["color"] = "#0b1220"
    background["dim"] = float(bg_in.get("dim", 0.35))

    state = {
        "app": config.APP_NAME,
        "version_server": config.VERSION,
        "timezone": config.TIMEZONE,
        "server_time": now.isoformat(timespec="seconds"),
        "city_name": get_setting(db, "city_name", ""),
        "ticker_text": get_setting(db, "ticker_text", ""),
        "ticker_speed": _int_setting(db, "ticker_speed_seconds", 30),
        "scene_seconds": _int_setting(db, "scene_seconds", 12),
        "weather": weather_svc.current_weather(db),
        "announcements": [
            {
                "id": a.id, "title": a.title, "body": a.body,
                "priority": a.priority, "qr_url": a.qr_url or "",
            }
            for a in announcements[:20]
        ],
        "emergency": [
            {"id": a.id, "title": a.title, "body": a.body} for a in emergency
        ],
        "events": [
            {
                "id": e.id, "title": e.title, "description": e.description,
                "start_at": e.start_at.isoformat(timespec="minutes"),
                "end_at": e.end_at.isoformat(timespec="minutes") if e.end_at else None,
                "location": e.location, "category": e.category,
                "website": e.website, "featured": e.featured,
            }
            for e in upcoming_events(db, now)
        ],
        "layout": {
            "id": layout.id if layout else None,
            "name": layout.name if layout else "",
            "orientation": layout.orientation if layout else "landscape",
            "background": background,
            "elements": resolve_elements(db, layout.elements) if layout else [],
        },
    }

    digest = hashlib.md5(
        json.dumps(state, sort_keys=True, default=str).encode()
    ).hexdigest()
    state["version"] = digest
    return state


def _int_setting(db: Session, key: str, default: int) -> int:
    try:
        return max(3, int(get_setting(db, key, str(default))))
    except ValueError:
        return default
