"""Offline-Wächter: meldet Displays, die zu lange nichts gemeldet haben.

Kanaele (optional, einzeln konfigurierbar):
  – generischer Webhook (JSON {"text": "..."}, kompatibel mit ntfy/Slack/Discord)
  – E-Mail via SMTP

Pruefintervall: 60 s. Pro Offline-Episode wird maximal einmal benachrichtigt;
sobald das Display wieder online ist, wird es rearmt.
"""
from __future__ import annotations

import asyncio
import logging
import smtplib
from datetime import timedelta
from email.message import EmailMessage

import httpx

from ..database import SessionLocal
from ..models import Display
from ..seed import get_setting

log = logging.getLogger("stadtdashboard.notifier")

CHECK_INTERVAL_SECONDS = 60
_notified: set[str] = set()


def collect_offline_displays(db, threshold_minutes: int, now) -> list[Display]:
    """Approved+aktivierte Displays, deren last_seen aelter als Schwelle ist."""
    limit = now - timedelta(minutes=max(1, threshold_minutes))
    rows = (
        db.query(Display)
        .filter(Display.approved.is_(True), Display.enabled.is_(True))
        .all()
    )
    return [d for d in rows if d.last_seen and d.last_seen < limit]


def _message_for(display: Display) -> str:
    from .state import now_local

    return (
        f"⚠ StadtDashboard: Display '{display.name}' "
        f"({display.location or 'ohne Ort'}) ist offline. "
        f"Letzte Meldung: {display.last_seen} UTC."
    )


async def _send_webhook(url: str, text: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(url, json={"text": text})
        log.info("notify.webhook gesendet")
    except Exception as exc:  # noqa: BLE001 – Benachrichtigung darf nicht crashen
        log.warning("Webhook fehlgeschlagen: %s", exc)


async def _send_mail(settings: dict[str, str], subject: str, body: str) -> None:
    if not settings.get("smtp_host") or not settings.get("notify_email_to"):
        return
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.get("smtp_from") or settings["smtp_user"]
    msg["To"] = settings["notify_email_to"]
    msg.set_content(body)

    def _send() -> None:
        port = int(settings.get("smtp_port") or 587)
        with smtplib.SMTP(settings["smtp_host"], port, timeout=10) as smtp:
            try:
                smtp.starttls()
            except smtplib.SMTPException:
                pass  # Server ohne STARTTLS (z. B. lokaler Relay auf 25)
            if settings.get("smtp_user"):
                smtp.login(settings["smtp_user"], settings.get("smtp_pass", ""))
            smtp.send_message(msg)

    try:
        await asyncio.to_thread(_send)
        log.info("notify.mail gesendet an %s", settings["notify_email_to"])
    except Exception as exc:  # noqa: BLE001
        log.warning("E-Mail-Versand fehlgeschlagen: %s", exc)


def _settings_snapshot(db) -> dict[str, str]:
    keys = [
        "notify_enabled", "offline_threshold_minutes", "notify_webhook_url",
        "smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from",
        "notify_email_to",
    ]
    return {k: get_setting(db, k, "") for k in keys}


async def check_and_notify() -> int:
    """Ein Prüflauf. Gibt die Anzahl neu benachrichtigter Displays zurück."""
    from .state import now_local

    db = SessionLocal()
    try:
        cfg = _settings_snapshot(db)
        threshold = int(cfg.get("offline_threshold_minutes") or 10)
        offline = collect_offline_displays(db, threshold, now_local())

        # Rearm: wieder online gemeldete Displays aus dem Merk-Satz entfernen
        online_ids = {d.id for d in (
            db.query(Display)
            .filter(Display.approved.is_(True), Display.enabled.is_(True))
            .all()
        )} - {d.id for d in offline}
        _notified.difference_update(online_ids)

        newly = [d for d in offline if d.id not in _notified]
        if not cfg.get("notify_enabled") == "true":
            _notified.update(d.id for d in offline)
            return 0

        sent = 0
        webhook_url = cfg.get("notify_webhook_url", "").strip()
        mail_ready = bool(cfg.get("smtp_host")) and bool(cfg.get("notify_email_to"))
        for display in newly:
            text_msg = _message_for(display)
            if webhook_url:
                await _send_webhook(webhook_url, text_msg)
            if mail_ready:
                await _send_mail(cfg, "StadtDashboard: Display offline",
                                 text_msg)
            _notified.add(display.id)
            sent += 1
        return sent
    finally:
        db.close()


async def loop() -> None:
    """Dauer-Task; bricht nie ab (Fehler werden geloggt)."""
    while True:
        try:
            await check_and_notify()
        except Exception as exc:  # noqa: BLE001
            log.exception("Notifier-Lauf fehlgeschlagen: %s", exc)
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
