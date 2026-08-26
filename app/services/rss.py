"""RSS-/News-Feeds als externe Quelle – bewusst datenschutzfreundlich:

Abruf NUR wenn allow_external aktiviert ist, sonst leere Liste mit stale-Markierer.
Antwort wird pro URL gecacht (Setting rss_cache:<sha1>), damit Displays nicht
jede Anfrage nach außen schicken.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
import xml.etree.ElementTree as ET

import httpx
from sqlalchemy.orm import Session

from ..seed import get_setting, set_setting

log = logging.getLogger("stadtdashboard.rss")


def _cache_key(url: str) -> str:
    return "rss_cache:" + hashlib.sha1(url.encode()).hexdigest()[:16]


def parse_feed(text: str, limit: int = 8) -> list[dict]:
    """Minimal-Parser für RSS 2.x und Atom (Titel + Datum), kein Extra-Deps."""
    items: list[dict] = []
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return items

    def _strip(tag: str) -> str:
        return tag.rsplit("}", 1)[-1]

    # RSS 2.x
    for item in root.iter():
        if _strip(item.tag) != "item":
            continue
        title = date = None
        for child in item:
            name = _strip(child.tag)
            if name == "title" and child.text:
                title = child.text.strip()
            elif name == "pubDate" and child.text:
                date = child.text.strip()
        if title:
            items.append({"title": title[:200], "date": date})

    # Atom (falls kein RSS gefunden)
    if not items:
        for entry in root.iter():
            if _strip(entry.tag) != "entry":
                continue
            title = updated = None
            for child in entry:
                name = _strip(child.tag)
                if name == "title" and child.text:
                    title = child.text.strip()
                elif name in ("updated", "published") and child.text:
                    updated = child.text.strip()[:16].replace("T", " ")
            if title:
                items.append({"title": title[:200], "date": updated})

    return items[:limit]


def fetch_items(db: Session, url: str, refresh_minutes: int = 15,
                count: int = 6) -> dict:
    """Liefert {'items': [...], 'stale': bool} – niemals eine Exception."""
    empty = {"items": [], "stale": False}
    if not url or get_setting(db, "allow_external", "false") != "true":
        return empty

    key = _cache_key(url)
    raw = get_setting(db, key, "")
    cache = None
    if raw:
        try:
            cache = json.loads(raw)
        except ValueError:
            cache = None
    max_age = max(5, refresh_minutes) * 60
    if cache and time.time() - float(cache.get("fetched_at", 0)) < max_age:
        return {"items": cache.get("items", [])[:count], "stale": False}

    try:
        resp = httpx.get(url, timeout=6.0,
                         headers={"User-Agent": "StadtDashboard/0.4"})
        resp.raise_for_status()
        items = parse_feed(resp.text, limit=max(count, 10))
        set_setting(db, key, json.dumps({"fetched_at": time.time(), "items": items}))
        db.commit()
        return {"items": items[:count], "stale": False}
    except Exception as exc:  # noqa: BLE001 – Feed-Fehler darf Display nie crashen
        log.warning("RSS-Abruf fehlgeschlagen (%s): %s", url, exc)
        if cache:
            return {"items": cache.get("items", [])[:count], "stale": True}
        return {**empty, "stale": True}
