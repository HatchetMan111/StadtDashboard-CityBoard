"""Seed: Admin-Benutzer, Standard-Layouts, Grundeinstellungen (idempotent)."""
from __future__ import annotations

import logging
import secrets

from sqlalchemy.orm import Session

from . import config
from .auth import hash_password
from .models import AdminUser, Layout, Setting

log = logging.getLogger("stadtdashboard.seed")

DEFAULT_SETTINGS = {
    "city_name": "Musterstadt",
    "city_website": "https://www.musterstadt.de",
    "ticker_text": "",
    "logo_media_id": "",
    "weather_mode": "manual",  # manual | open_meteo
    "weather_manual_temp": "21.0",
    "weather_manual_condition": "Sonnig",
    "weather_lat": "",
    "weather_lon": "",
    "weather_interval_minutes": "30",
    "allow_external": "false",
    "scene_seconds": "12",
}

LANDSCAPE_ELEMENTS = [
    {"type": "header", "x": 3, "y": 3, "w": 40, "h": 11, "config": {}},
    {"type": "clock", "x": 68, "y": 3, "w": 15, "h": 11, "config": {}},
    {"type": "weather", "x": 84, "y": 3, "w": 13, "h": 11, "config": {}},
    {"type": "announcements", "x": 3, "y": 17, "w": 30, "h": 62, "config": {"count": 4}},
    {"type": "gallery", "x": 36, "y": 17, "w": 38, "h": 62,
     "config": {"media_ids": [], "seconds": 8}},
    {"type": "events", "x": 77, "y": 17, "w": 20, "h": 46, "config": {"count": 5}},
    {"type": "qr", "x": 77, "y": 65, "w": 20, "h": 19,
     "config": {"setting_key": "city_website", "label": "Stadt-Website"}},
    {"type": "ticker", "x": 0, "y": 91, "w": 100, "h": 9, "config": {}},
]

PORTRAIT_ELEMENTS = [
    {"type": "header", "x": 5, "y": 2, "w": 90, "h": 8, "config": {}},
    {"type": "clock", "x": 5, "y": 11, "w": 42, "h": 8, "config": {}},
    {"type": "weather", "x": 50, "y": 11, "w": 45, "h": 8, "config": {}},
    {"type": "gallery", "x": 5, "y": 21, "w": 90, "h": 35,
     "config": {"media_ids": [], "seconds": 8}},
    {"type": "announcements", "x": 5, "y": 58, "w": 90, "h": 20, "config": {"count": 3}},
    {"type": "events", "x": 5, "y": 80, "w": 58, "h": 12, "config": {"count": 3}},
    {"type": "qr", "x": 66, "y": 78, "w": 29, "h": 14,
     "config": {"setting_key": "city_website", "label": "Mehr erfahren"}},
]


def get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.get(Setting, key)
    return row.value if row is not None else DEFAULT_SETTINGS.get(key, default)


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(Setting, key)
    if row is None:
        db.add(Setting(key=key, value=value))
    else:
        row.value = value


def seed_if_empty(db: Session) -> None:
    changed = False

    if db.query(AdminUser).count() == 0:
        password = secrets.token_urlsafe(12)
        db.add(AdminUser(username="admin", password_hash=hash_password(password)))
        config.INITIAL_PW_FILE.write_text(password + "\n")
        try:
            config.INITIAL_PW_FILE.chmod(0o600)
        except OSError:
            pass
        log.warning(
            "Erster Start: Admin-Benutzer 'admin' erstellt. Passwort steht in %s",
            config.INITIAL_PW_FILE,
        )
        changed = True

    if db.query(Layout).count() == 0:
        db.add(Layout(name="Standard (16:9)", orientation="landscape",
                      elements=LANDSCAPE_ELEMENTS, is_default=True))
        db.add(Layout(name="Standard (Hochformat)", orientation="portrait",
                      elements=PORTRAIT_ELEMENTS))
        changed = True

    for key, value in DEFAULT_SETTINGS.items():
        if db.get(Setting, key) is None:
            db.add(Setting(key=key, value=value))
            changed = True

    if changed:
        db.commit()
