"""Browser-E2E für den Layout-Editor (Playwright/Chromium).

Deckt genau die gemeldeten Probleme ab:
  1. Neu hinzugefügtes Widget ist NICHT im „Bearbeiten-Modus“ (unselektiert).
  2. Klick wählt aus; **Klick auf gewähltes Widget setzt es fest** (deselektiert).
  3. Drag platziert zuverlässig; nach dem Loslassen folgt das Widget NICHT
     weiter dem Cursor (Regression: stuck-drag durch endDrag-Crash).
  4. Löschen per ✕-Button und Entf-Taste.
"""
from __future__ import annotations

import tempfile
import time
import urllib.request

import pytest
from playwright.sync_api import sync_playwright

PORT = 18099
BASE = f"http://127.0.0.1:{PORT}"


@pytest.fixture(scope="module")
def live_server():
    import os
    import subprocess

    data_dir = tempfile.mkdtemp(prefix="sb-browser-")
    env = {**os.environ, "SB_DATA_DIR": data_dir}
    proc = subprocess.Popen(
        [".venv/bin/python", "-m", "uvicorn", "app.main:app",
         "--port", str(PORT)],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(40):
        try:
            with urllib.request.urlopen(f"{BASE}/healthz", timeout=1) as r:
                if r.status == 200:
                    break
        except Exception:
            time.sleep(0.5)
    else:
        proc.terminate()
        pytest.fail("Server startete nicht")
    yield {"base": BASE, "data_dir": data_dir}
    proc.terminate()
    proc.wait(timeout=5)


@pytest.fixture(scope="module")
def admin_page(live_server):
    from pathlib import Path

    pw_file = Path(live_server["data_dir"]) / "initial_admin_password.txt"
    password = pw_file.read_text().strip()

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1500, "height": 950})
        page.goto(f"{BASE}/login")
        page.fill("#username", "admin")
        page.fill("#password", password)
        page.click("#login-form button[type=submit]")
        page.wait_for_url(f"{BASE}/")
        yield {"page": page, "browser": browser}
        browser.close()


def _ed_count(page) -> int:
    return page.locator("#ed-canvas .ed-el").count()


def test_editor_full_flow(admin_page):
    page = admin_page["page"]
    page.goto(f"{BASE}/layouts")
    page.wait_for_selector("#ed-canvas .ed-el")

    before = _ed_count(page)

    # 1) Palette: hinzufügen OHNE Bearbeiten-Modus
    page.click('button[data-widget="clock"]')
    assert _ed_count(page) == before + 1
    assert page.locator("#ed-canvas .ed-el.sel").count() == 0, \
        "Neues Widget darf nicht automatisch selektiert sein"

    # 2) Klick selektiert …
    last = page.locator("#ed-canvas .ed-el").last
    last.click()
    assert page.locator("#ed-canvas .ed-el.sel").count() == 1

    # … und zweiter Klick ohne Bewegung setzt es wieder fest
    last.click()
    assert page.locator("#ed-canvas .ed-el.sel").count() == 0, \
        "Klick auf gewähltes Widget muss es 'fest setzen' (deselektieren)"

    # 3) Drag platziert zuverlässig & klebt danach NICHT am Cursor
    last.click()  # wieder wählen
    box = page.locator("#ed-canvas .ed-el.sel").bounding_box()
    cx = box["x"] + box["width"] / 2
    cy = box["y"] + box["height"] / 2
    left_before = page.locator("#ed-canvas .ed-el.sel").evaluate(
        "el => parseFloat(el.style.left)")

    page.mouse.move(cx, cy)
    page.mouse.down()
    page.mouse.move(cx + 120, cy + 80, steps=12)
    page.mouse.up()

    sel = page.locator("#ed-canvas .ed-el.sel")
    assert sel.count() == 1
    left_after = sel.evaluate("el => parseFloat(el.style.left)")
    top_after = sel.evaluate("el => parseFloat(el.style.top)")
    assert abs(left_after - left_before) >= 15, \
        "Drag muss die Position deutlich ändern"

    # REGRESSION (stuck-drag): Mausbewegung ohne gedrückte Taste darf nichts mehr verschieben
    page.mouse.move(cx + 300, cy + 200, steps=6)
    assert sel.evaluate("el => parseFloat(el.style.left)") == left_after

    # Positionen liegen am 5-%-Raster (Standard-Snap)
    assert abs(left_after % 5) < 0.01

    # 4) Entf-Taste löscht das gewählte Widget zuverlässig
    page.keyboard.press("Delete")
    assert _ed_count(page) == before

    # 5) ✕-Button am Widget löscht ebenfalls
    page.locator("#ed-canvas .ed-el").first.click()
    assert page.locator("#ed-canvas .ed-el.sel .ed-del").count() == 1
    assert page.locator("#ed-canvas .ed-el.sel .ed-del").is_visible()
    page.locator("#ed-canvas .ed-del:visible").click()
    assert _ed_count(page) == before - 1


def test_editor_save_persists(admin_page):
    page = admin_page["page"]
    page.goto(f"{BASE}/layouts")
    page.wait_for_selector("#ed-canvas .ed-el")

    before = _ed_count(page)
    page.click('button[data-widget="text"]')
    assert page.locator("#ed-dirty").is_visible()  # Dirty-Marker erscheint
    page.click("#layout-save")
    page.wait_for_function(
        "document.getElementById('ed-dirty').classList.contains('hidden')")

    page.reload()
    page.wait_for_selector("#ed-canvas .ed-el")
    assert _ed_count(page) == before + 1
