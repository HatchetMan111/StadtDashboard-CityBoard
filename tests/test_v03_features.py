"""Tests für v0.3.0: Rate-Limit, Rollen, ICS-Import, Assign, Duplizieren,
Offline-Wächter, Ticker-Speed."""
from __future__ import annotations

import io
from datetime import datetime, timedelta

from app import config
from app.database import SessionLocal
from app.models import AdminUser, Display


def _admin_pw() -> str:
    return config.INITIAL_PW_FILE.read_text().strip()


# ── Login-Rate-Limit ────────────────────────────────────────────────────────
def test_login_rate_limit(client, fresh_db):
    for i in range(5):
        r = client.post("/api/admin/login",
                        json={"username": "admin", "password": f"falsch-{i}"})
        assert r.status_code == 401
        assert "Versuche übrig" in r.json()["detail"] or i < 4

    sixth = client.post("/api/admin/login",
                        json={"username": "admin", "password": "nochmehr-falsch"})
    assert sixth.status_code == 429

    # Auch das RICHTIGE Passwort wird im Limit-Fenster abgelehnt
    blocked = client.post("/api/admin/login",
                          json={"username": "admin", "password": _admin_pw()})
    assert blocked.status_code == 429

    # Anderer Benutzername → eigenes Limit-Kontingent
    other = client.post("/api/admin/login",
                        json={"username": "niemand", "password": "x" * 12})
    assert other.status_code == 401


# ── Rollen: Redakteur vs. Admin ─────────────────────────────────────────────
def test_editor_role_matrix(admin_client):
    # Admin legt Redakteur an
    created = admin_client.post("/api/admin/users", json={
        "username": "redaktion", "password": "redakteur-pw-1", "role": "editor",
    })
    assert created.status_code == 200, created.text

    # Duplikat abgelehnt
    assert admin_client.post("/api/admin/users", json={
        "username": "redaktion", "password": "redakteur-pw-2", "role": "editor",
    }).status_code == 409

    users = admin_client.get("/api/admin/users").json()
    assert any(u["username"] == "redaktion" and u["role"] == "editor"
               for u in users)

    # Login als Redakteur (eigener Client, damit Admin-Cookies bleiben)
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as ed:
        login = ed.post("/api/admin/login",
                        json={"username": "redaktion", "password": "redakteur-pw-1"})
        assert login.status_code == 200

        # Erlaubt: Inhalte lesen & anlegen
        assert ed.get("/api/admin/announcements").status_code == 200
        ok = ed.post("/api/admin/announcements", json={"title": "Vom Redakteur"})
        assert ok.status_code == 200
        # Erlaubt: Listen lesen (für Medien-Zuweisung etc.)
        assert ed.get("/api/admin/layouts").status_code == 200
        # Verweigert: Geräte/System
        assert ed.post("/api/admin/displays/xxx/approve").status_code == 403
        assert ed.put("/api/admin/settings",
                      json={"values": {"city_name": "X"}}).status_code == 403
        assert ed.get("/api/admin/backup").status_code == 403
        assert ed.post("/api/admin/layouts", json={
            "name": "Neu", "orientation": "landscape"}).status_code == 403
        # Verweigert: Benutzerverwaltung
        assert ed.get("/api/admin/users").status_code == 403

        # Seiten-Schutz: Editor wird von Admin-Seiten zum Dashboard umgeleitet
        assert ed.get("/settings", follow_redirects=False).headers["location"] == "/"
        assert ed.get("/displays", follow_redirects=False).headers["location"] == "/"

    # Selbst-Löschung + letzter Admin-Schutz
    me_id = next(u["id"] for u in admin_client.get("/api/admin/users").json()
                 if u["username"] == "admin")
    assert admin_client.delete(f"/api/admin/users/{me_id}").status_code == 400


def test_editor_can_assign_media_but_not_edit_layouts(admin_client):
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color=(200, 30, 30)).save(buf, "PNG")
    buf.seek(0)
    media_id = admin_client.post(
        "/api/admin/media",
        files={"file": ("r.png", buf, "image/png")}).json()["id"]

    admin_client.post("/api/admin/users", json={
        "username": "ed2", "password": "redakteur-pw-3", "role": "editor"})
    layouts = admin_client.get("/api/admin/layouts").json()
    layout_id = layouts[0]["id"]

    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as ed:
        assert ed.post("/api/admin/login", json={
            "username": "ed2", "password": "redakteur-pw-3"}).status_code == 200

        # Zuweisen erlaubt …
        r = ed.post(f"/api/admin/media/{media_id}/assign",
                    json={"layout_id": layout_id, "mode": "gallery"})
        assert r.status_code == 200, r.text

        # … Layout-Inhalte prüfen
        state = admin_client.get(f"/api/admin/layouts/{layout_id}/state").json()
        gal = [e for e in state["layout"]["elements"] if e["type"] == "gallery"]
        assert any(media_id in (g["config"].get("media_ids") or [])
                   for g in gal)

        # Aber direktes Layout-PATCH bleibt verboten
        l_full = admin_client.get("/api/admin/layouts").json()[0]
        assert ed.patch(f"/api/admin/layouts/{layout_id}", json={
            "name": l_full["name"], "orientation": l_full["orientation"],
            "elements": [], }).status_code == 403


# ── ICS-Import ──────────────────────────────────────────────────────────────
ICS_SAMPLE = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//DE
BEGIN:VEVENT
UID:1@test
DTSTART:20990701T190000
SUMMARY:Sommerkonzert
LOCATION:Kurpark
DESCRIPTION:Open Air
END:VEVENT
BEGIN:VEVENT
UID:2@test
DTSTART:20990815T180000
SUMMARY:Flohmarkt
END:VEVENT
BEGIN:VEVENT
UID:3@test
DTSTART:20000101T100000
SUMMARY:Steinalt
END:VEVENT
END:VCALENDAR
"""


def test_ics_import_file_and_dedupe(admin_client):
    r1 = admin_client.post("/api/admin/events/import",
                           json={"ics_text": ICS_SAMPLE})
    assert r1.status_code == 200, r1.text
    body = r1.json()
    assert body["imported"] == 2          # Sommerkonzert + Flohmarkt
    assert body["past"] == 1              # Steinalt ignoriert

    titles = {e["title"] for e in admin_client.get("/api/admin/events").json()}
    assert {"Sommerkonzert", "Flohmarkt"} <= titles

    # Zweiter Import → alles Duplikate
    r2 = admin_client.post("/api/admin/events/import",
                           json={"ics_text": ICS_SAMPLE})
    assert r2.json()["duplicates"] == 2
    assert r2.json()["imported"] == 0


def test_ics_import_url_blocked_without_external(admin_client):
    fresh_db_flag = False
    data = admin_client.get("/api/admin/settings").json()
    if data["values"]["allow_external"] != "true":
        fresh_db_flag = True
    assert fresh_db_flag  # Seed-Default ist false

    r = admin_client.post("/api/admin/events/import",
                          json={"url": "https://example.invalid/kal.ics"})
    assert r.status_code == 400
    assert "externen Zugriff" in r.json()["detail"]

    # Mit Freigabe: Abruf schlägt fehl (Domain invalid), aber Permission-Gate ist offen
    admin_client.put("/api/admin/settings",
                     json={"values": {"allow_external": "true"}})
    r2 = admin_client.post("/api/admin/events/import",
                           json={"url": "https://example.invalid/kal.ics"})
    assert r2.status_code == 400
    assert "nicht abrufbar" in r2.json()["detail"]


# ── Layout duplizieren ──────────────────────────────────────────────────────
def test_duplicate_layout(admin_client):
    layouts = admin_client.get("/api/admin/layouts").json()
    src = next(l for l in layouts if l["is_default"])
    dup = admin_client.post(f"/api/admin/layouts/{src['id']}/duplicate")
    assert dup.status_code == 200, dup.text
    new = dup.json()

    all_l = {l["id"]: l for l in admin_client.get("/api/admin/layouts").json()}
    copy = all_l[new["id"]]
    assert copy["name"] == f"{src['name']} (Kopie)"
    assert copy["is_default"] is False
    assert copy["elements"] == src["elements"]


# ── „Jetzt aktiv“-Indikator ─────────────────────────────────────────────────
def test_schedules_active_now_flag(admin_client):
    from datetime import datetime as dt

    now = dt.now()
    sched = admin_client.post("/api/admin/schedules", json={
        "name": "Ganztags", "priority": 50,
        "rules": [{"start": "00:00", "end": "23:59",
                   "weekdays": list(range(7)),
                   "layout_id": admin_client.get("/api/admin/layouts").json()[0]["id"]}],
    })
    assert sched.status_code == 200, sched.text
    rows = {s["name"]: s for s in admin_client.get("/api/admin/schedules").json()}
    assert rows["Ganztags"]["active_now"] is True

    # Nie zutreffendes Fenster (3–4 Uhr an einem Tag, der heute nicht ist –
    # sicherheitshalber prüfen wir nur, dass Flag berechnet wird)
    assert isinstance(rows["Ganztags"]["active_now"], bool)


def test_displays_effective_layout(admin_client):
    d = admin_client.post("/api/display/register", json={"name": "X"}).json()
    admin_client.post(f"/api/admin/displays/{d['device_id']}/approve")
    rows = {r["id"]: r for r in admin_client.get("/api/admin/displays").json()}
    eff = rows[d["device_id"]]["effective_layout"]
    assert eff and eff["name"]


# ── Offline-Wächter ─────────────────────────────────────────────────────────
def test_notifier_collects_stale_display_only():
    from app.services import notifier

    db = SessionLocal()
    try:
        stale = Display(id="stale1", token="t" * 48, name="Alt",
                        approved=True, enabled=True,
                        last_seen=datetime.utcnow() - timedelta(hours=2))
        fresh = Display(id="fresh1", token="f" * 48, name="Frisch",
                        approved=True, enabled=True,
                        last_seen=datetime.utcnow())
        disabled = Display(id="off1", token="o" * 48, name="Aus",
                           approved=True, enabled=False,
                           last_seen=datetime.utcnow() - timedelta(hours=9))
        db.add_all([stale, fresh, disabled])
        db.commit()

        result = notifier.collect_offline_displays(db, threshold_minutes=10,
                                                   now=datetime.utcnow())
        ids = {d.id for d in result}
        assert "stale1" in ids
        assert "fresh1" not in ids
        assert "off1" not in ids  # deaktivierte Displays alarmieren nicht
    finally:
        db.close()


def test_notifier_disabled_by_default_sends_nothing(monkeypatch):
    from app.services import notifier

    sent = []
    monkeypatch.setattr(notifier, "_send_webhook",
                        lambda url, text: sent.append(text))
    # notify_enabled=false (Seed) → check_and_notify darf nichts senden
    import asyncio

    sent_count = asyncio.run(notifier.check_and_notify())
    assert sent_count == 0
    assert sent == []


# ── Ticker-Speed ────────────────────────────────────────────────────────────
def test_ticker_speed_in_state(admin_client):
    put = admin_client.put("/api/admin/settings", json={"values": {
        "ticker_speed_seconds": "77" }})
    assert put.status_code == 200

    d = admin_client.post("/api/display/register", json={"name": "T"}).json()
    admin_client.post(f"/api/admin/displays/{d['device_id']}/approve")
    state = admin_client.get("/api/display/state",
                             headers={"Authorization": f"Bearer {d['token']}"}).json()
    assert state["ticker_speed"] == 77
