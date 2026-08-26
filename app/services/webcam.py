"""Webcam-Quellen.

Modi im Widget:
  snapshot / mjpeg / hls – URL wird direkt vom Browser geladen (1 Frame bzw.
                           Stream); keine Server-Beteiligung.
  rtsp                   – Browser können RTSP nicht abspielen. Der Server zieht
                           zyklisch EIN Einzelframe per ffmpeg und legt es lokal
                           unter data/webcams/<hash>.jpg ab; das Widget zeigt
                           dieses Bild an (datenschutzfreundlich: kein Dauers-
                           tream, keine Aufzeichnung, nur ein Frame).

Der ffmpeg-Prozess wird mit Timeout ausgeführt und killt sich selbst;
schlägt er fehl, bleibt das alte Bild stehen.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from pathlib import Path

from .. import config

log = logging.getLogger("stadtdashboard.webcam")

WEBCAM_DIR = config.DATA_DIR / "webcams"
SCAN_INTERVAL_SECONDS = 60


def cam_key(url: str) -> str:
    return hashlib.sha1(url.encode()).hexdigest()[:16]


def cam_path(url: str) -> Path:
    return WEBCAM_DIR / f"{cam_key(url)}.jpg"


def ensure_dir() -> None:
    WEBCAM_DIR.mkdir(parents=True, exist_ok=True)


async def grab_frame(rtsp_url: str, timeout_s: int = 12) -> bool:
    """Zieht ein einzelnes Frame aus einem RTSP-Stream (ffmpeg)."""
    ensure_dir()
    final = cam_path(rtsp_url)
    tmp = final.with_suffix(".tmp.jpg")
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-rtsp_transport", "tcp",
        "-stimeout", str(timeout_s * 1_000_000),
        "-i", rtsp_url,
        "-frames:v", "1", "-q:v", "4",
        str(tmp),
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            await asyncio.wait_for(proc.wait(), timeout=timeout_s + 3)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            log.warning("ffmpeg timeout für %s", rtsp_url)
            return False
    except FileNotFoundError:
        log.error("ffmpeg nicht installiert – RTSP-Widgets bleiben ohne Bild")
        return False
    except Exception as exc:  # noqa: BLE001
        log.warning("ffmpeg Fehler (%s): %s", rtsp_url, exc)
        return False

    if tmp.is_file() and tmp.stat().st_size > 1024:
        tmp.replace(final)
        return True
    tmp.unlink(missing_ok=True)
    return False


def collect_rtsp_urls(layouts: list[dict]) -> list[str]:
    """Extrahiert alle eindeutigen RTSP-URLs aus Webcam-Widgets."""
    urls: list[str] = []
    for layout in layouts:
        for el in layout.get("elements") or []:
            if el.get("type") != "webcam":
                continue
            cfg = el.get("config") or {}
            url = (cfg.get("url") or "").strip()
            if cfg.get("mode") == "rtsp" and url.startswith("rtsp://"):
                if url not in urls:
                    urls.append(url)
    return urls


async def loop(get_layouts) -> None:
    """Dauer-Task: aktualisiert RTSP-Schnappschüsse aller konfigurierten Kameras."""
    while True:
        try:
            layouts = await get_layouts()
            urls = collect_rtsp_urls(layouts)
            for url in urls:
                ok = await grab_frame(url)
                if not ok:
                    log.info("Kein neues Frame von %s (altes Bild bleibt)", url)
        except Exception as exc:  # noqa: BLE001
            log.exception("Webcam-Lauf fehlgeschlagen: %s", exc)
        await asyncio.sleep(SCAN_INTERVAL_SECONDS)
