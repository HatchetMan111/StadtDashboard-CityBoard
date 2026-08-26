"""Tests v0.5.0: Vorlagen, add-widget-Slots, Layout-Hintergrund."""
from __future__ import annotations

from app.database import SessionLocal
from app.layout_presets import PRESETS, preset_layout_copy
from app.models import Layout


# ── Vorlagen ────────────────────────────────────────────────────────────────
def test_presets_exist_and_are_valid():
    assert len(PRESETS) >= 7
    ids = [p["id"] for p in PRESETS]
    assert len(ids) == len(set(ids))
    for p in PRESETS:
        assert p["elements"], f"Vorlage {p['id']} ohne Widgets"
        for el in p["elements"]:
            assert {"type", "x", "y", "w", "h", "config"} <= set(el)


def test_from_preset_creates_layout(admin_client):
    r = admin_client.post("/api/admin/layouts/from-preset",
                          json={"preset_id": "tourismus"})
    assert r.status_code == 200, r.text
    new_id = r.json()["id"]

    layouts = {l["id"]: l for l in admin_client.get("/api/admin/layouts").json()}
    copy = layouts[new_id]
    assert copy["name"] == "Tourismus"
    assert copy["is_default"] is False
    assert copy["background"]["mode"] == "color"

    # Unbekannte Vorlage → 404
    assert admin_client.post("/api/admin/layouts/from-preset",
                             json={"preset_id": "gibts-nicht"}).status_code == 404


def test_editor_can_use_add_widget(admin_client):
    """Redakteure sollen über 'Layout gestalten' Inhalte einfügen können."""
    admin_client.post("/api/admin/users", json={
        "username": "red", "password": "redakteur-pw-9", "role": "editor"})

    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as ed:
        ed.post("/api/admin/login",
                json={"username": "red", "password": "redakteur-pw-9"})
        layout_id = admin_client.get("/api/admin/layouts").json()[0]["id"]

        r = ed.post(f"/api/admin/layouts/{layout_id}/add-widget", json={
            "type": "webcam", "slot": "rechts",
            "config": {"mode": "rtsp", "url": "rtsp://192.168.1.7/live"}})
        assert r.status_code == 200, r.text
        body = r.json()["element"]
        assert body["config"]["url"] == "rtsp://192.168.1.7/live"
        # Slot 'rechts' (Landscape): 53/16/44/64
        assert (body["x"], body["y"]) == (53, 16)

        # Unbekannter Typ → 422
        bad = ed.post(f"/api/admin/layouts/{layout_id}/add-widget", json={
            "type": "zauberwürfel", "slot": "links"})
        assert bad.status_code == 422


def test_add_widget_stacks_when_slot_taken(admin_client):
    layout_id = admin_client.get("/api/admin/layouts").json()[0]["id"]
    for _ in range(3):
        r = admin_client.post(f"/api/admin/layouts/{layout_id}/add-widget",
                              json={"type": "clock", "slot": "oben-links"})
        assert r.status_code == 200
    state = admin_client.get(f"/api/admin/layouts/{layout_id}/state").json()
    clocks = [e for e in state["layout"]["elements"]
              if e["type"] == "clock" and e["x"] == 3]
    ys = sorted(c["y"] for c in clocks)
    assert len(clocks) == 3
    assert len(set(ys)) == 3  # gestapelt statt übereinander


def test_background_roundtrip_and_state(admin_client):
    from PIL import Image
    import io

    buf = io.BytesIO()
    Image.new("RGB", (400, 250), color=(10, 60, 120)).save(buf, "PNG")
    buf.seek(0)
    media_id = admin_client.post(
        "/api/admin/media",
        files={"file": ("bg.png", buf, "image/png")}).json()["id"]

    layouts = admin_client.get("/api/admin/layouts").json()
    layout = next(l for l in layouts if l["is_default"])
    resp = admin_client.patch(f"/api/admin/layouts/{layout['id']}", json={
        "name": layout["name"], "orientation": layout["orientation"],
        "elements": layout["elements"], "is_default": True,
        "background": {"mode": "image", "media_id": media_id, "dim": 0.55},
    })
    assert resp.status_code == 200, resp.text

    d = admin_client.post("/api/display/register", json={"name": "BG"}).json()
    admin_client.post(f"/api/admin/displays/{d['device_id']}/approve")
    state = admin_client.get("/api/display/state",
                             headers={"Authorization":
                                      f"Bearer {d['token']}"}).json()
    bg = state["layout"]["background"]
    assert bg["mode"] == "image"
    assert bg["media_url"].startswith("/media/")
    assert abs(bg["dim"] - 0.55) < 0.001


def test_preset_copy_is_deep():
    a = preset_layout_copy("standard")
    b = preset_layout_copy("standard")
    assert a is not b
    assert a["elements"][0] is not b["elements"][0]

    db = SessionLocal()
    try:
        count = db.query(Layout).count()  # nur damit Import-Pfad steht
        del count
    finally:
        db.close()
