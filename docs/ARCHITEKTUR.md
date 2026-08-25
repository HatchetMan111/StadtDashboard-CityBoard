# Architektur

## Ebenen

StadtDashboard trennt konsequent drei Ebenen:

1. **Content** – was gezeigt wird: Bekanntmachungen, Veranstaltungen, Medien, Texte
2. **Presentation** – wie es gezeigt wird: Layouts (Widget-JSON), Zeitpläne
3. **Devices** – wo es gezeigt wird: Displays mit eigenem Token, Kopplung, Sperrung

## Datenmodell (SQLite)

| Tabelle | Zweck |
|---|---|
| `admin_users` | Admin-Zugang (scrypt-Hash) |
| `displays` | Geraete: ID, Token, Name, Ort, Orientierung, Layout-/Zeitplan-Zuweisung, `last_seen` |
| `layouts` | Widget-Liste mit x/y/w/h in Prozent + config |
| `announcements` | Prioritaet 1–5, Gueltigkeitsfenster, QR-Ziel |
| `events` | Lokaler Veranstaltungskalender |
| `media_items` | Uploads (Bilder/Video), Thumbnails via Pillow |
| `schedules` | Regeln: Zeitfenster + Wochentage → Layout, Prioritaet |
| `settings` | Key-Value (Stadt, Wetter, Datenschalter) |

Alle Zeitangaben sind naive lokale Zeiten der konfigurierten Zeitzone
(`SB_TZ`, Standard `Europe/Berlin`) – Kommunen planen in "Wanduhr-Zeit".

## Display-Protokoll

```
Display-Browser
  │ POST /api/display/register          → device_id + token (localStorage)
  │ GET  /api/display/status            → polling bis approved (5 s)
  │ GET  /api/display/state             → voller Render-Zustand (+ version-Hash)
  │ WS   /ws/display/{id}?token=…       → hello, reload-Push, ping/pong (25 s)
  ▼
Offline: localStorage-Cache + lokale Uhr; Badge "ggf. veraltet"
```

Der Server rendert nichts Bildliches – er synchronisiert Daten. Das Display
rendert lokal (bandbreitenschonend, offlinefähig).

## Layout-Auswahl (Scheduler)

1. Zeitplan des Displays (falls gesetzt), Regeln nach Priorität
2. sonst globale Zeitpläne nach Priorität (höchste gewinnt)
3. sonst layout_id des Displays
4. sonst Standardlayout (`is_default`)

Über-Nacht-Fenster (22:00–06:00) werden unterstützt.

## Prioritätslogik Bekanntmachungen

| Prio | Bedeutung | Anzeige |
|---|---|---|
| 5 | Notfall | rotes pulsierendes Banner auf JEDEM Layout |
| 4 | Wichtig | ebenfalls Banner |
| 1–3 | Info/Kampagne/Veranstaltung | im Widget `announcements` |

Abgelaufene oder zukünftige Meldungen werden serverseitig gefiltert.

## Sicherheit (V1)

- Admin: Session-Cookie (`HttpOnly`, `SameSite=Lax`, HMAC-signiert, 12 h TTL),
  scrypt-Passwort-Hashes, Login-Rate-Hinweis über strukturierte Logs
- Displays: individuelles Bearer-Token; Koppeln/Sperren/Token-Rotation im Admin
- Uploads: MIME-/Endungs-Allowlist, Größenlimit (25 MB), UUID-Dateinamen
- systemd-Härtung: `ProtectSystem=full`, `ReadWritePaths=data`, `NoNewPrivileges`
- Bewusst NICHT in V1: CSRF-Tokens für alle Mutationen (SameSite+JSON-Only),
  TLS (empfohlen: Reverse Proxy Caddy/Nginx im LAN)

## Konfiguration

Umgebungsvariablen (systemd-Unit): `SB_PORT` (Default 8080), `SB_DATA_DIR`,
`SB_TZ`, `SB_MAX_UPLOAD_MB`.
