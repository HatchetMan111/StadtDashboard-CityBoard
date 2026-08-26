"""Vorlagen, Widget-Standardwerte und Slot-Positionen für 'Layout gestalten'.

Slots sind bewusst grob benannt ("oben-links", "rechts", "mitte-gross" …),
damit der geführte Ablauf ohne Koordinaten auskommt. Für Hochformat existiert
eine eigene Map.
"""
from __future__ import annotations

import copy

# ── Widget-Grundkonfiguration (Server-Seite; Spiegel von admin.js DEFAULTS) ─
WIDGET_DEFAULTS: dict[str, dict] = {
    "header": {"x": 3, "y": 3, "w": 40, "h": 11, "config": {}},
    "clock": {"x": 68, "y": 3, "w": 15, "h": 11, "config": {}},
    "date": {"x": 55, "y": 3, "w": 12, "h": 11, "config": {}},
    "weather": {"x": 84, "y": 3, "w": 13, "h": 11, "config": {}},
    "forecast": {"x": 80, "y": 15, "w": 17, "h": 20, "config": {}},
    "text": {"x": 40, "y": 40, "w": 30, "h": 15,
             "config": {"text": "Willkommen!"}},
    "image": {"x": 36, "y": 17, "w": 38, "h": 50, "config": {"media_id": None}},
    "gallery": {"x": 36, "y": 17, "w": 38, "h": 62,
                "config": {"media_ids": [], "seconds": 8}},
    "events": {"x": 77, "y": 17, "w": 20, "h": 46, "config": {"count": 5}},
    "announcements": {"x": 3, "y": 17, "w": 30, "h": 62, "config": {"count": 4}},
    "qr": {"x": 77, "y": 65, "w": 20, "h": 19,
           "config": {"setting_key": "city_website", "url": "",
                      "label": "Mehr erfahren"}},
    "ticker": {"x": 0, "y": 91, "w": 100, "h": 9, "config": {}},
    "webcam": {"x": 60, "y": 40, "w": 36, "h": 34,
               "config": {"mode": "rtsp", "url": "", "refresh_seconds": 30,
                          "caption": "Live-Blick"}},
    "website": {"x": 20, "y": 20, "w": 60, "h": 55,
                "config": {"url": "", "consent_param": ""}},
    "rss": {"x": 3, "y": 17, "w": 30, "h": 50,
            "config": {"url": "", "count": 5, "refresh_minutes": 15}},
}

# ── Slots (Prozent) ─────────────────────────────────────────────────────────
SLOTS_LANDSCAPE = {
    "oben-links": (3, 3, 42, 24),
    "oben-rechts": (55, 3, 42, 24),
    "links": (3, 16, 44, 64),
    "rechts": (53, 16, 44, 64),
    "mitte-gross": (18, 14, 64, 70),
    "voll-bild": (0, 0, 100, 100),
    "unten-band": (0, 86, 100, 11),
}
SLOTS_PORTRAIT = {
    "oben-links": (5, 2, 90, 12),
    "oben-rechts": (5, 15, 90, 10),
    "links": (5, 26, 90, 26),
    "rechts": (5, 54, 90, 22),
    "mitte-gross": (10, 20, 80, 60),
    "voll-bild": (0, 0, 100, 100),
    "unten-band": (0, 87, 100, 13),
}
SLOT_LABELS = {
    "oben-links": "Oben links", "oben-rechts": "Oben rechts",
    "links": "Linke Hälfte", "rechts": "Rechte Hälfte",
    "mitte-gross": "Mitte (groß)", "voll-bild": "Ganze Fläche",
    "unten-band": "Unterer Balken",
}


def slot_rect(slot: str, orientation: str) -> tuple[int, int, int, int]:
    table = SLOTS_PORTRAIT if orientation == "portrait" else SLOTS_LANDSCAPE
    x, y, w, h = table.get(slot) or table["rechts"]
    return x, y, w, h


def _el(wtype: str, x=None, y=None, w=None, h=None, **cfg_overrides):
    base = copy.deepcopy(WIDGET_DEFAULTS[wtype])
    base["type"] = wtype
    if x is not None:
        base["x"] = x
    if y is not None:
        base["y"] = y
    if w is not None:
        base["w"] = w
    if h is not None:
        base["h"] = h
    for k, v in cfg_overrides.items():
        if k.endswith("__"):
            key = k[:-2]
            base["config"][key] = v
        else:
            raise KeyError(f"Nur config-Overrides mit '__' Suffix: {k}")
    return base


def _bg_color(color: str) -> dict:
    return {"mode": "color", "color": color}


def _bg_image(media_id: int | None, dim: float = 0.4) -> dict:
    return {"mode": "image", "media_id": media_id, "dim": dim}


# ── Vorlagen ────────────────────────────────────────────────────────────────
PRESETS: list[dict] = [
    {
        "id": "standard",
        "name": "Standard (16:9)",
        "description": "Alles im Blick: Uhr, Wetter, Bekanntmachungen, "
                       "Bildergalerie und Veranstaltungen.",
        "orientation": "landscape",
        "background": _bg_color("#0b1220"),
        "elements": [
            _el("header"), _el("clock"), _el("weather"),
            _el("announcements"), _el("gallery"), _el("events"),
            _el("qr"), _el("ticker"),
        ],
    },
    {
        "id": "tourismus",
        "name": "Tourismus",
        "description": "Großes Bild / Galerie links, Veranstaltungen rechts, "
                       "QR zur Stadt-Website.",
        "orientation": "landscape",
        "background": _bg_color("#101b2d"),
        "elements": [
            _el("header", 3, 3, 40, 10),
            _el("weather", 84, 3, 13, 10),
            _el("gallery", 3, 15, 58, 58),
            _el("events", 63, 15, 34, 44, count__=4),
            _el("qr", 63, 61, 34, 21),
            _el("ticker"),
        ],
    },
    {
        "id": "rathaus",
        "name": "Rathaus-Info",
        "description": "Bekanntmachungen prominent, dazu Termine – ideal für "
                       "Foyer und Wartebereiche.",
        "orientation": "landscape",
        "background": _bg_color("#16233d"),
        "elements": [
            _el("header", 3, 3, 40, 10),
            _el("date", 55, 3, 14, 10),
            _el("clock", 70, 3, 13, 10),
            _el("weather", 84, 3, 13, 10),
            _el("announcements", 3, 15, 46, 66, count__=6),
            _el("events", 51, 15, 46, 66, count__=8),
            _el("ticker"),
        ],
    },
    {
        "id": "abendprogramm",
        "name": "Abendprogramm",
        "description": "Große Uhr, darunter die kommenden Termine – ruhig und "
                       "lesbar für den Abend.",
        "orientation": "landscape",
        "background": _bg_color("#05070f"),
        "elements": [
            _el("clock", 35, 6, 30, 24),
            _el("weather", 67, 8, 18, 18),
            _el("events", 20, 34, 60, 52, count__=7),
            _el("ticker"),
        ],
    },
    {
        "id": "kamera-fokus",
        "name": "Kamera-Fokus",
        "description": "Eine Kamera fast im Vollbild mit Ticker darunter. "
                       "RTSP-URL einfach im Widget hinterlegen.",
        "orientation": "landscape",
        "background": _bg_color("#000000"),
        "elements": [
            _el("webcam", 0, 0, 100, 88,
                mode__="rtsp", caption__="Live-Blick"),
            _el("ticker", 0, 88, 100, 12),
        ],
    },
    {
        "id": "willkommen",
        "name": "Willkommen",
        "description": "Begrüßungstext groß in der Mitte mit QR daneben.",
        "orientation": "landscape",
        "background": _bg_color("#123047"),
        "elements": [
            _el("header", 25, 6, 50, 14),
            _el("text", 18, 26, 64, 38, text__="Herzlich willkommen!"),
            _el("qr", 41, 68, 18, 24),
        ],
    },
    {
        "id": "news-kiosk",
        "name": "News-Kiosk",
        "description": "RSS-Schlagzeilen, Bekanntmachungen und Termine – "
                       "für Warte- und Durchgangsbereiche.",
        "orientation": "landscape",
        "background": _bg_color("#14181f"),
        "elements": [
            _el("header", 3, 3, 45, 10),
            _el("clock", 82, 3, 15, 10),
            _el("rss", 3, 15, 40, 66, count__=6),
            _el("announcements", 46, 15, 51, 34, count__=3),
            _el("events", 46, 51, 51, 30, count__=4),
            _el("ticker"),
        ],
    },
    {
        "id": "info-hochformat",
        "name": "Info (Hochformat)",
        "description": "Für Stadtsäulen / Portrait-Displays: Galerie oben, "
                       "Meldungen und Termine unten.",
        "orientation": "portrait",
        "background": _bg_color("#0b1220"),
        "elements": [
            _el("header", 5, 2, 90, 8),
            _el("clock", 5, 11, 42, 8),
            _el("weather", 50, 11, 45, 8),
            _el("gallery", 5, 21, 90, 35),
            _el("announcements", 5, 58, 90, 20, count__=3),
            _el("events", 5, 79, 58, 13, count__=3),
            _el("qr", 66, 78, 29, 14),
        ],
    },
]

PRESET_IDS = [p["id"] for p in PRESETS]


def get_preset(preset_id: str) -> dict | None:
    for p in PRESETS:
        if p["id"] == preset_id:
            return p
    return None


def preset_layout_copy(preset_id: str, name: str | None = None) -> dict:
    """Erzeugt ein frisches Layout-Dict aus einer Vorlage."""
    preset = get_preset(preset_id)
    if preset is None:
        raise KeyError(preset_id)
    return {
        "name": name or preset["name"],
        "orientation": preset["orientation"],
        "elements": copy.deepcopy(preset["elements"]),
        "background": copy.deepcopy(preset.get("background") or {}),
        "is_default": False,
    }
