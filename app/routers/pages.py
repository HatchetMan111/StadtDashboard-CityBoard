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
    "/displays": "displays.html",
    "/announcements": "announcements.html",
    "/events": "events.html",
    "/media": "media.html",
    "/layouts": "layouts.html",
    "/schedules": "schedules.html",
    "/settings": "settings.html",
    "/datenschutz": "datenschutz.html",
}


for route_path, template_name in PAGES.items():

    def _make_page(template: str):
        def page(
            request: Request, db: Session = Depends(get_db), user=Depends(optional_admin)
        ):
            if not user:
                return RedirectResponse("/login", status_code=303)
            return templates.TemplateResponse(request, template, _ctx(request, user))

        return page

    router.get(route_path)(_make_page(template_name))


@router.get("/display")
def display_page(request: Request):
    return templates.TemplateResponse(request, "display.html", {"request": request})
