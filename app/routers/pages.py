"""Seiten-Auslieferung: React-SPA (Admin) + Display-Client als statische
Build-Artefakte aus app/spa/ (committed – der Container braucht kein Node).
API bleibt unter /api/*, WebSocket unter /ws/*."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse

from .. import config

SPA_DIR = Path(__file__).resolve().parent.parent / "spa"

router = APIRouter(tags=["pages"])

# Admin-Client-Routen (SPA-Router matcht dieselben Pfade)
SPA_ROUTES = {
    "/", "/login", "/displays", "/announcements", "/events", "/media",
    "/gestalten", "/layouts", "/schedules", "/settings", "/datenschutz", "/konto",
}


def _spa_page(filename: str) -> FileResponse:
    return FileResponse(
        SPA_DIR / filename,
        media_type="text/html",
        headers={"Cache-Control": "no-cache"},  # Updates landen sofort
    )


@router.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "app": config.APP_NAME, "version": config.VERSION}


@router.get("/display")
def display_page():
    return _spa_page("display.html")


@router.get("/", include_in_schema=False)
async def root() -> FileResponse:
    """Dashboard: SPA-Shell; die App leitet ohne Session selbst zu /login."""
    return _spa_page("index.html")


for _route in SPA_ROUTES:
    if _route == "/":
        continue  # oben explizit registriert

    def _make(path: str):
        async def page() -> FileResponse:
            return _spa_page("index.html")
        return page

    router.get(_route, include_in_schema=False)(_make(_route))
