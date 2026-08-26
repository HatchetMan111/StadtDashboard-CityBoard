"""Server-seitig gerenderte Seiten: Admin-UI, Login, Display-Client."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from .. import config
from ..auth import optional_admin
from ..database import get_db

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

router = APIRouter(tags=["pages"])


def _ctx(request: Request, user) -> dict:
    return {
        "request": request,
        "user": user.username if user else None,
        "role": getattr(user, "role", "admin") if user else None,
        "app_name": config.APP_NAME,
        "version": config.VERSION,
    }


@router.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "app": config.APP_NAME, "version": config.VERSION}


@router.get("/login")
def login_page(request: Request, user=Depends(optional_admin)):
    if user:
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse(request, "login.html", _ctx(request, None))


@router.get("/")
def dashboard(request: Request, db: Session = Depends(get_db), user=Depends(optional_admin)):
    if not user:
        return RedirectResponse("/login", status_code=303)
    return templates.TemplateResponse(request, "dashboard.html", _ctx(request, user))


PAGES = {
    "/displays": ("displays.html", True),
    "/announcements": ("announcements.html", False),
    "/events": ("events.html", False),
    "/media": ("media.html", False),
    "/gestalten": ("gestalten.html", False),
    "/layouts": ("layouts.html", True),
    "/schedules": ("schedules.html", True),
    "/settings": ("settings.html", True),
    "/datenschutz": ("datenschutz.html", True),
}


for route_path, (template_name, admin_only) in PAGES.items():

    def _make_page(template: str, needs_admin: bool):
        def page(
            request: Request, db: Session = Depends(get_db), user=Depends(optional_admin)
        ):
            if not user:
                return RedirectResponse("/login", status_code=303)
            if needs_admin and getattr(user, "role", "admin") != "admin":
                return RedirectResponse("/", status_code=303)
            return templates.TemplateResponse(request, template, _ctx(request, user))

        return page

    router.get(route_path)(_make_page(template_name, admin_only))


@router.get("/konto")
def konto_page(
    request: Request, db: Session = Depends(get_db), user=Depends(optional_admin)
):
    """Passwort ändern – für alle Rollen."""
    if not user:
        return RedirectResponse("/login", status_code=303)
    return templates.TemplateResponse(request, "konto.html", _ctx(request, user))


@router.get("/display")
def display_page(request: Request):
    return templates.TemplateResponse(request, "display.html", {"request": request})
