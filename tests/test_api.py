"""End-to-end-API-Tests für StadtDashboard."""
from __future__ import annotations

import io
import zipfile
from datetime import datetime, timedelta

from app.services.state import build_state, pick_layout


def _register_display(admin_client):
    resp = admin_client.post("/api/display/register", json={
        "name": "Rathaus Eingang",
        "resolution": "1920x1080",
        "orientation": "landscape",
    })
    assert resp.status_code == 200
    return resp.json()


def _auth(token: str):
    return {"Authorization": f"Bearer {token}"}


# ── Grundlagen ──────────────────────────────────────────────────────────────
def test_healthz(client):
    resp = client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["app"] == "StadtDashboard"


def test_admin_pages_redirect_to_login(client, fresh_db):
    assert client.get("/", follow_redirects=False).status_code == 303
    assert client.get("/displays", follow_redirects=False).headers["location"] == "/login"


def test_admin_api_requires_auth(client, fresh_db):
    assert client.get("/api/admin/displays").status_code == 401


def test_login_flow(client, fresh_db):
    bad = client.post("/api/admin/login",
                      json={"username": "admin", "password": "falsch"})
    assert bad.status_code == 401

    from app import config

    good = client.post("/api/admin/login", json={
        "username": "admin",
        "password": config.INITIAL_PW_FILE.read_text().strip(),
    })
    assert good.status_code == 200
    assert client.get("/api/admin/displays").status_code == 200


def test_password_change(admin_client):
    from app import config

    current = config.INITIAL_PW_FILE.read_text().strip()
    # Zu kurzes neues Passwort → Validierungsfehler 422
    resp = admin_client.put("/api/admin/password",
                            json={"old": current, "new": "abc"})
    assert resp.status_code == 422

    # Falsches altes Passwort → 400
    resp = admin_client.put("/api/admin/password",
                            json={"old": "falsch", "new": "sicheres-passwort-1"})
    assert resp.status_code == 400

    # Erfolgreicher Wechsel + Login mit neuem Passwort
    resp = admin_client.put("/api/admin/password",
                            json={"old": current, "new": "sicheres-passwort-1"})
    assert resp.status_code == 200
    client = admin_client
    client.post("/api/admin/logout")
    login = client.post("/api/admin/login",
                        json={"username": "admin", "password": "sicheres-passwort-1"})
    assert login.status_code == 200


def test_initial_password_lifecycle(admin_client):
    """Initial-Passwort wird als aktiv gemeldet und nach Änderung entsorgt."""
    from app import config

    assert config.INITIAL_PW_FILE.exists()
    status = admin_client.get("/api/admin/status").json()
    assert status["initial_password_active"] is True
    assert status["app"] == "StadtDashboard"

    current = config.INITIAL_PW_FILE.read_text().strip()
    resp = admin_client.put("/api/admin/password",
                            json={"old": current, "new": "neues-sicheres-pw"})
    assert resp.status_code == 200

    assert not config.INITIAL_PW_FILE.exists()
    status_after = admin_client.get("/api/admin/status").json()
    assert status_after["initial_password_active"] is False


# ── Display-Kopplung ────────────────────────────────────────────────────────
def test_display_pairing_flow(admin_client):
    d = _register_display(admin_client)
    headers = _auth(d["token"])

    assert admin_client.get("/api/display/status", headers=headers).json()["approved"] is False
    assert admin_client.get("/api/display/state", headers=headers).status_code == 403

    assert admin_client.get("/api/display/state").status_code == 401  # ohne Token

    resp = admin_client.post(f"/api/admin/displays/{d['device_id']}/approve")
    assert resp.status_code == 200

    state = admin_client.get("/api/display/state", headers=headers)
    assert state.status_code == 200
    body = state.json()
    assert body["display"]["name"] == "Rathaus Eingang"
    assert body["layout"]["elements"], "Standardlayout sollte Elemente haben"
    assert body["city_name"]

    # Sperren blockiert den Zustand
    admin_client.patch(f"/api/admin/displays/{d['device_id']}",
                       json={"enabled": False})
    assert admin_client.get("/api/display/state", headers=headers).status_code == 403

    # Token-Zurücksetzen erzwingt neue Kopplung: altes Token wird ungültig (401)
    admin_client.patch(f"/api/admin/displays/{d['device_id']}", json={"enabled": True})
    admin_client.post(f"/api/admin/displays/{d['device_id']}/revoke")
    assert admin_client.get("/api/display/state", headers=headers).status_code == 401


def test_register_is_idempotent_with_same_token(admin_client):
    first = _register_display(admin_client)
    again = admin_client.post("/api/display/register", json={
        "device_id": first["device_id"], "token": first["token"]}).json()
    assert again["device_id"] == first["device_id"]


def test_websocket_hello_after_approval(admin_client):
    d = _register_display(admin_client)
    admin_client.post(f"/api/admin/displays/{d['device_id']}/approve")
    with admin_client.websocket_connect(
        f"/ws/display/{d['device_id']}?token={d['token']}"
    ) as ws:
        msg = ws.receive_json()
        assert msg["type"] == "hello"
        assert msg["version"]


# ── Bekanntmachungen ────────────────────────────────────────────────────────
def test_announcement_validity_and_emergency(admin_client):
    now = datetime.now()
    past = {"title": "Alt", "priority": 3, "active": True,
            "valid_from": (now - timedelta(days=5)).isoformat(),
            "valid_until": (now - timedelta(days=1)).isoformat()}
    future = {"title": "Zukunft", "priority": 2, "active": True,
              "valid_from": (now + timedelta(days=1)).isoformat()}
    emergency = {"title": "Straßensperrung", "body": "Innenstadt gesperrt",
                 "priority": 5, "active": True}

    for payload in (past, future, emergency):
        r = admin_client.post("/api/admin/announcements", json=payload)
        assert r.status_code == 200, r.text

    d = _register_display(admin_client)
    admin_client.post(f"/api/admin/displays/{d['device_id']}/approve")
    state = admin_client.get("/api/display/state",
                             headers=_auth(d["token"])).json()

    titles = [a["title"] for a in state["announcements"]]
    assert "Straßensperrung" in titles
    assert "Alt" not in titles          # abgelaufen
    assert "Zukunft" not in titles      # noch nicht gültig
    assert state["emergency"][0]["title"] == "Straßensperrung"


def test_announcement_crud(admin_client):
    created = admin_client.post(
        "/api/admin/announcements",
        json={"title": "Testmeldung", "priority": 1}).json()
    items = admin_client.get("/api/admin/announcements").json()
    assert any(i["id"] == created["id"] for i in items)

    upd = admin_client.patch(f"/api/admin/announcements/{created['id']}",
                             json={"title": "Geändert", "priority": 4,
                                   "body": "", "active": False,
                                   "valid_from": None, "valid_until": None,
                                   "qr_url": ""})
    assert upd.status_code == 200
    titles = {i["id"]: i["title"] for i in
              admin_client.get("/api/admin/announcements").json()}
    assert titles[created["id"]] == "Geändert"

    assert admin_client.delete(f"/api/admin/announcements/{created['id']}").status_code == 200


# ── Zeitplan/Layout-Auswahl ─────────────────────────────────────────────────
def test_schedule_priority_picks_matching_layout(admin_client):
    layouts = {l["name"]: l["id"]
               for l in admin_client.get("/api/admin/layouts").json()}
    default_id = next(lid for lid in layouts.values())  # Standard ist zuerst angelegt

    evening_id = admin_client.post("/api/admin/layouts", json={
        "name": "Abendprogramm", "orientation": "landscape", "elements": [],
    }).json()["id"]

    sched = admin_client.post("/api/admin/schedules", json={
        "name": "Abend", "priority": 10,
        "rules": [{"start": "00:00", "end": "23:59",
                   "weekdays": [0, 1, 2, 3, 4, 5, 6], "layout_id": evening_id}],
    })
    assert sched.status_code == 200, sched.text

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        chosen = pick_layout(db)
        assert chosen.id == evening_id

        # Ohne passenden Zeitplan greift das Standardlayout:
        db.delete(db.get(type(chosen), chosen.id))
        db.commit()
        fallback = pick_layout(db)
        assert fallback.id != evening_id
    finally:
        db.close()


# ── QR im Layout ────────────────────────────────────────────────────────────
def test_qr_widget_resolved_in_state(admin_client):
    layouts = admin_client.get("/api/admin/layouts").json()
    layout = next(l for l in layouts if l["is_default"])
    layout["elements"].append({
        "type": "qr", "x": 70, "y": 70, "w": 20, "h": 20,
        "config": {"url": "https://example.de", "label": "Info"},
    })
    resp = admin_client.patch(f"/api/admin/layouts/{layout['id']}",
                              json={"name": layout["name"],
                                    "orientation": layout["orientation"],
                                    "elements": layout["elements"],
                                    "is_default": True})
    assert resp.status_code == 200, resp.text

    d = _register_display(admin_client)
    admin_client.post(f"/api/admin/displays/{d['device_id']}/approve")
    state = admin_client.get("/api/display/state",
                             headers=_auth(d["token"])).json()
    qr_widgets = [e for e in state["layout"]["elements"] if e["type"] == "qr"]
    assert qr_widgets and qr_widgets[-1]["config"]["qr_image"].startswith(
        "data:image/png;base64,")


def test_layout_rejects_unknown_widget_type(admin_client):
    resp = admin_client.post("/api/admin/layouts", json={
        "name": "Kaputt", "orientation": "landscape",
        "elements": [{"type": "webcam", "x": 0, "y": 0, "w": 10, "h": 10}]})
    assert resp.status_code == 422


# ── Medien ──────────────────────────────────────────────────────────────────
def test_media_upload_list_delete(admin_client):
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (64, 48), color=(30, 120, 200)).save(buf, "PNG")
    buf.seek(0)

    up = admin_client.post("/api/admin/media",
                           files={"file": ("testbild.png", buf, "image/png")})
    assert up.status_code == 200, up.text
    media_id = up.json()["id"]

    listed = admin_client.get("/api/admin/media").json()
    assert any(m["id"] == media_id for m in listed)

    served = admin_client.get(f"/media/{media_id}")
    assert served.status_code == 200
    thumb = admin_client.get(f"/media/{media_id}/thumb")
    assert thumb.status_code == 200
    assert thumb.headers["content-type"] == "image/jpeg"

    rejected = admin_client.post(
        "/api/admin/media",
        files={"file": ("boese.exe", io.BytesIO(b"MZ"), "application/x-msdownload")})
    assert rejected.status_code == 400

    assert admin_client.delete(f"/api/admin/media/{media_id}").status_code == 200
    assert admin_client.get(f"/media/{media_id}").status_code == 404


# ── Veranstaltungen ─────────────────────────────────────────────────────────
def test_upcoming_events_in_state(admin_client):
    now = datetime.now()
    admin_client.post("/api/admin/events", json={
        "title": "Konzert", "start_at": (now + timedelta(hours=3)).isoformat(),
        "location": "Marktplatz", "category": "Musik"})
    admin_client.post("/api/admin/events", json={
        "title": "Vor einem Jahr", "start_at": (now - timedelta(days=365)).isoformat()})

    d = _register_display(admin_client)
    admin_client.post(f"/api/admin/displays/{d['device_id']}/approve")
    state = admin_client.get("/api/display/state",
                             headers=_auth(d["token"])).json()
    titles = [e["title"] for e in state["events"]]
    assert "Konzert" in titles
    assert "Vor einem Jahr" not in titles


# ── Einstellungen & Datenschutz-Schalter ────────────────────────────────────
def test_settings_roundtrip_blocks_external(admin_client):
    put = admin_client.put("/api/admin/settings", json={"values": {
        "city_name": "Teststadt",
        "allow_external": "true",
        "weather_mode": "open_meteo",
    }})
    assert put.status_code == 200

    data = admin_client.get("/api/admin/settings").json()
    assert data["values"]["city_name"] == "Teststadt"
    assert data["values"]["allow_external"] == "true"


# ── Backup ──────────────────────────────────────────────────────────────────
def test_backup_download(admin_client):
    resp = admin_client.get("/api/admin/backup")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    assert "stadtdashboard.db" in names
    assert "settings.json" in names


# ── State-Version (Change-Detection) ────────────────────────────────────────
def test_state_version_changes_on_content_update(admin_client):
    d = _register_display(admin_client)
    admin_client.post(f"/api/admin/displays/{d['device_id']}/approve")
    headers = _auth(d["token"])

    v1 = admin_client.get("/api/display/state", headers=headers).json()["version"]
    admin_client.post("/api/admin/announcements",
                      json={"title": "Neu!", "priority": 1})
    v2 = admin_client.get("/api/display/state", headers=headers).json()["version"]
    assert v1 != v2


# ── Unit: Scheduler-Fensterlogik ────────────────────────────────────────────
def test_rule_matches_overnight_window():
    from app.services.state import _rule_matches

    rule = {"start": "22:00", "end": "06:00", "weekdays": None}
    assert _rule_matches(rule, datetime(2026, 8, 25, 23, 30))
    assert _rule_matches(rule, datetime(2026, 8, 25, 3, 0))
    assert not _rule_matches(rule, datetime(2026, 8, 25, 12, 0))
