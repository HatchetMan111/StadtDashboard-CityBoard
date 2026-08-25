"""StadtDashboard – FastAPI-Anwendung."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .database import init_db
from .routers import admin_api, display_api, pages

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("stadtdashboard")

app = FastAPI(title=config.APP_NAME, version=config.VERSION, docs_url=None, redoc_url=None)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    log.info("%s v%s gestartet (Port %s)", config.APP_NAME, config.VERSION, config.PORT)


STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

app.include_router(pages.router)
app.include_router(display_api.router)
app.include_router(admin_api.router)


@app.exception_handler(500)
async def on_500(request: Request, exc: Exception) -> JSONResponse:
    """Volle Fehlermeldungskette im Log statt nur der letzten Zeile."""
    log.exception("Interner Fehler bei %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Interner Fehler: {exc.__class__.__name__}: {exc}"},
    )
