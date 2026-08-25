"""Wetter-Provider-Abstraktion.

Modi:
  manual      – Werte werden im Admin eingetragen (keine externe Verbindung)
  open_meteo  – optionaler externer Abruf (benoetigt allow_external=true)

Bei API-Fehlern wird der letzte Cache als 'veraltet' markiert geliefert,
nie ein harter Ausfall.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timedelta

import httpx
from sqlalchemy.orm import Session

from ..seed import get_setting, set_setting

log = logging.getLogger("stadtdashboard.weather")

WEATHER_CODES = {
    0: "Klar", 1: "Überwiegend klar", 2: "Teils wolkig", 3: "Bedeckt",
    45: "Nebel", 48: "Reifnebel", 51: "Leichter Niesel", 53: "Niesel",
    55: "Starker Niesel", 61: "Leichter Regen", 63: "Regen", 65: "Starker Regen",
    71: "Leichter Schneefall", 73: "Schneefall", 75: "Starker Schneefall",
    80: "Regenschauer", 81: "Schauer", 82: "Heftige Schauer",
    95: "Gewitter", 96: "Gewitter m. Hagel", 99: "Schweres Gewitter",
}


def code_text(code: int) -> str:
    return WEATHER_CODES.get(int(code), "Wetter")


def _manual(db: Session, stale: bool = False) -> dict:
    try:
        temp = float(get_setting(db, "weather_manual_temp", "0"))
    except ValueError:
        temp = 0.0
    return {
        "source": "manual", "stale": stale,
        "temp_c": round(temp, 1),
        "condition": get_setting(db, "weather_manual_condition", ""),
        "temp_max": None, "temp_min": None,
        "forecast": [],
    }


def _cache_fresh(cache: dict | None, interval_minutes: int) -> bool:
    if not cache or "fetched_at" not in cache:
        return False
    age = time.time() - float(cache["fetched_at"])
    return age < interval_minutes * 60


def current_weather(db: Session) -> dict:
    mode = get_setting(db, "weather_mode", "manual")
    allow_external = get_setting(db, "allow_external", "false") == "true"

    if mode != "open_meteo" or not allow_external:
        return _manual(db)

    lat, lon = get_setting(db, "weather_lat"), get_setting(db, "weather_lon")
    if not lat or not lon:
        return {**_manual(db), "note": "Keine Koordinaten gesetzt"}

    interval = max(5, int(get_setting(db, "weather_interval_minutes", "30") or 30))
    cache = None
    raw = get_setting(db, "weather_cache", "")
    if raw:
        try:
            cache = json.loads(raw)
        except ValueError:
            cache = None
    if _cache_fresh(cache, interval):
        return cache["data"]

    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        "&current=temperature_2m,weather_code"
        "&daily=temperature_max,temperature_min,weather_code"
        "&forecast_days=4&timezone=auto&units=metric"
    )
    try:
        resp = httpx.get(url, timeout=6.0)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # noqa: BLE001 – Wetter darf niemals das Display brechen
        log.warning("open-meteo fehlgeschlagen: %s", exc)
        stale_data = (cache or {}).get("data")
        if stale_data:
            return {**stale_data, "stale": True}
        return _manual(db, stale=True)

    current = data.get("current", {})
    daily = data.get("daily", {})
    forecast = []
    dates = daily.get("time", []) or []
    tmax = daily.get("temperature_max", []) or []
    tmin = daily.get("temperature_min", []) or []
    codes = daily.get("weather_code", []) or []
    for i, day in enumerate(dates[:4]):
        forecast.append({
            "date": day,
            "label": _day_label(day),
            "temp_max": round(tmax[i]) if i < len(tmax) else None,
            "temp_min": round(tmin[i]) if i < len(tmin) else None,
            "condition": code_text(codes[i] if i < len(codes) else -1),
        })

    result = {
        "source": "open_meteo", "stale": False,
        "temp_c": round(float(current.get("temperature_2m", 0.0)), 1),
        "condition": code_text(current.get("weather_code", -1)),
        "temp_max": forecast[1]["temp_max"] if len(forecast) > 1 else None,
        "temp_min": forecast[1]["temp_min"] if len(forecast) > 1 else None,
        "forecast": forecast[1:4],
    }
    payload = json.dumps({"fetched_at": time.time(), "data": result})
    set_setting(db, "weather_cache", payload)
    db.commit()
    return result


def _day_label(iso_day: str) -> str:
    names = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
    try:
        d = datetime.fromisoformat(iso_day)
        return names[d.weekday()]
    except ValueError:
        return iso_day
