"""v0.6.0: SPA-Umbau-Regressionen + Bugfix-Verifikation
- delete_layout erkennt Referenzen exakt (LIKE-Prefix-Bug: 1 matchte auch 12)
- patch_display validiert orientation/layout_id/schedule_id
- SVG-Auslieferung mit CSP-Sandbox (kein Skript-Ausbruch)
- /api/admin/me für die SPA-Rollensteuerung
"""
from __future__ import annotations

import io

from PIL import Image


def _make_layout(admin_client, name: str) -> int:
    resp = admin_client.post("/api/admin/layouts", json={
        "name": name, "orientation": "landscape", "elements": [],
    })
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _make_schedule(admin_client, name: str, layout_id: int, priority: int = 1) -> int:
    resp = admin_client.post("/api/admin/schedules", json={
        "name": name, "priority": priority,
        "rules": [{"start": "00:00", "end": "23:59", "weekdays": [0, 1, 2, 3, 4, 5, 6],
                   "layout_id": layout_id}],
    })
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def test_delete_layout_prefix_false_positive(admin_client):
    """Layout 12 referenziert → Löschen von Layout 1 muss erlaubt sein
    (vorher: LIKE '%layout_id": 1%' matchte auch 12)."""
    l1 = _make_layout(admin_client, "Eins")
    l12 = _make_layout(admin_client, "Zwoelf")
    _make_schedule(admin_client, "Regeln", l12)

    resp = admin_client.delete(f"/api/admin/layouts/{l1}")
    assert resp.status_code == 200, resp.text

    # Layout 12 selbst bleibt blockiert
    resp = admin_client.delete(f"/api/admin/layouts/{l12}")
    assert resp.status_code == 409


def test_patch_display_validates_references(admin_client):
    d = admin_client.post("/api/display/register", json={"name": "T"}).json()
    admin_client.post(f"/api/admin/displays/{d['device_id']}/approve")

    # Falsche Ausrichtung
    resp = admin_client.patch(f"/api/admin/displays/{d['device_id']}",
                              json={"orientation": "schräg"})
    assert resp.status_code == 400

    # Fremdschlüssel ins Leere
    resp = admin_client.patch(f"/api/admin/displays/{d['device_id']}",
                              json={"layout_id": 99999})
    assert resp.status_code == 400
    resp = admin_client.patch(f"/api/admin/displays/{d['device_id']}",
                              json={"schedule_id": 99999})
    assert resp.status_code == 400

    # Gültige Werte weiterhin OK
    ok = admin_client.patch(f"/api/admin/displays/{d['device_id']}",
                            json={"orientation": "portrait"})
    assert ok.status_code == 200


def test_me_endpoint_role(admin_client):
    me = admin_client.get("/api/admin/me")
    assert me.status_code == 200
    body = me.json()
    assert body["role"] == "admin"
    assert body["username"]
    assert client_unauthorized_me().status_code == 401


def client_unauthorized_me():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        return c.get("/api/admin/me")


def test_svg_upload_gets_csp_sandbox(admin_client):
    buf = io.BytesIO()
    buf.write(b'<svg xmlns="http://www.w3.org/2000/svg">'
              b'<script>alert(1)</script></svg>')
    buf.seek(0)
    resp = admin_client.post("/api/admin/media",
                             files={"file": ("x.svg", buf, "image/svg+xml")})
    assert resp.status_code == 200, resp.text
    media_id = resp.json()["id"]

    served = admin_client.get(f"/media/{media_id}")
    assert served.status_code == 200
    assert served.headers.get("content-security-policy") == "sandbox"


def test_png_upload_has_no_csp(admin_client):
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), color=(10, 200, 30)).save(buf, "PNG")
    buf.seek(0)
    resp = admin_client.post("/api/admin/media",
                             files={"file": ("y.png", buf, "image/png")})
    media_id = resp.json()["id"]
    served = admin_client.get(f"/media/{media_id}")
    assert "content-security-policy" not in served.headers
