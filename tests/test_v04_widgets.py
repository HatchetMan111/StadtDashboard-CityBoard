"""Tests v0.4.0: Webcam (RTSP-Resolver), Website-Gating, RSS-Parsing,
neue Widget-Typen."""
from __future__ import annotations

from app.database import SessionLocal
from app.services.rss import parse_feed
from app.services.state import _is_local_url, resolve_elements
from app.services.webcam import cam_key, collect_rtsp_urls


# ── Widget-Typen ────────────────────────────────────────────────────────────
def test_new_widget_types_accepted(admin_client):
    r = admin_client.post("/api/admin/layouts", json={
        "name": "Media-Layout", "orientation": "landscape",
        "elements": [
            {"type": "webcam", "x": 0, "y": 0, "w": 30, "h": 30,
             "config": {"mode": "snapshot", "url": "http://192.168.1.50/img.jpg"}},
            {"type": "website", "x": 40, "y": 0, "w": 50, "h": 40,
             "config": {"url": "https://example.de", "consent_param": "c=1"}},
            {"type": "rss", "x": 0, "y": 60, "w": 90, "h": 30,
             "config": {"url": "", "count": 4}},
        ]})
    assert r.status_code == 200, r.text


def test_webcam_resolver_local_snapshot(admin_client):
    """LAN-Kamera ohne externe Freigabe: resolved_url bleibt gesetzt."""
    db = SessionLocal()
    try:
        from app.models import Layout
        import json as _json

        layout = db.query(Layout).filter_by(is_default=True).first()
        elements = [{
            "type": "webcam", "x": 0, "y": 0, "w": 20, "h": 20,
            "config": {"mode": "snapshot",
                       "url": "http://192.168.10.7/snapshot.jpg"},
        }]
        resolved = resolve_elements(db, _json.loads(_json.dumps(elements)))
        assert resolved[0]["config"]["resolved_url"].startswith("http://192.168.10.7")
        assert not resolved[0]["config"].get("blocked")
        assert layout is not None  # Seed vorhanden
        del layout
    finally:
        db.close()


def test_website_blocked_without_external(admin_client):
    """Öffentliche Webseite ohne Freigabe → blocked-Flag fürs Display."""
    db = SessionLocal()
    try:
        elements = [{"type": "website", "x": 0, "y": 0, "w": 40, "h": 40,
                     "config": {"url": "https://www.stadt-muster.de"}}]
        resolved = resolve_elements(db, elements)
        assert resolved[0]["config"]["blocked"] is True
    finally:
        db.close()


def test_is_local_url():
    assert _is_local_url("rtsp://192.168.1.5:554/stream")
    assert _is_local_url("http://10.0.0.2:8080/video")
    assert _is_local_url("http://kamera.fritz.box/img.jpg")
    assert not _is_local_url("https://www.example.de/feed")
    assert not _is_local_url("nonsense")


def test_collect_rtsp_urls():
    layouts = [
        {"elements": [
            {"type": "webcam", "config": {"mode": "rtsp",
                                          "url": "rtsp://cam1/stream"}},
            {"type": "webcam", "config": {"mode": "snapshot",
                                          "url": "http://x/y.jpg"}},
            {"type": "clock", "config": {}},
        ]},
        {"elements": [
            {"type": "webcam", "config": {"mode": "rtsp",
                                          "url": "rtsp://cam1/stream"}},  # Dupe
        ]},
    ]
    assert collect_rtsp_urls(layouts) == ["rtsp://cam1/stream"]


def test_cam_key_stable():
    assert cam_key("rtsp://a") == cam_key("rtsp://a")
    assert cam_key("rtsp://a") != cam_key("rtsp://b")


# ── RSS-Parser ──────────────────────────────────────────────────────────────
RSS_SAMPLE = """<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>Stadtnews</title>
<item><title>Erste Meldung</title><pubDate>Tue, 25 Aug 2026 10:00:00 +0100</pubDate></item>
<item><title>Zweite Meldung</title></item>
</channel></rss>"""

ATOM_SAMPLE = """<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Atom-Eins</title><updated>2026-08-25T09:00:00Z</updated></entry>
</feed>"""


def test_rss_parse_rss_and_atom():
    items = parse_feed(RSS_SAMPLE)
    assert [i["title"] for i in items] == ["Erste Meldung", "Zweite Meldung"]
    assert items[0]["date"].startswith("Tue")

    atom = parse_feed(ATOM_SAMPLE)
    assert atom[0]["title"] == "Atom-Eins"

    assert parse_feed("<kaputt") == []


def test_rss_fetch_disabled_returns_empty(admin_client):
    """allow_external=false (Seed): Abruf liefert leer & nicht stale."""
    from app.services.rss import fetch_items

    db = SessionLocal()
    try:
        result = fetch_items(db, "https://example.de/rss")
        assert result["items"] == []
        assert result["stale"] is False
    finally:
        db.close()
