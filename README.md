# StadtDashboard

**Lokale Open-Source-Plattform für digitale Stadtinformation & Digital Signage.**
Ein City-Dashboard, das sich frei konfigurieren lässt – komplett lokal, air-gap-fähig,
installierbar als Proxmox-LXC mit einem Einzeiler.

- **Admin-Cockpit** – Inhalte, Layouts, Geräte, Zeitpläne, Backup
- **Display-Frontend** – schlanke Vollbild-Ansicht für TV/Monitor/Signage-Player
- **API/Backend** – FastAPI + SQLite, REST + WebSocket, keine externen Cloud-Dienste
- **Drag-&-Drop-Layout-Editor** – Widgets auf die Fläche ziehen, skalieren,
  Medien per Klick zuweisen (Galerie/Bild/QR); Snap-Raster, Führungslinien,
  Undo (Strg+Z), Ebenen
- **Rollen** – Administrator & Redakteur (nur Inhalte)
- **Offline-Wächter** – Webhook/E-Mail, wenn ein Display zu lange schweigt
- **iCal/ICS-Import** – Veranstaltungskalender lokal übernehmen

---

## 🚀 Installation (Proxmox VE)

Auf dem Proxmox-Host ausführen:

```bash
bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/StadtDashboard-CityBoard/main/install/stadtdashboard.sh)"
```

Das Script:

1. erstellt einen **Debian-12-LXC** (Standard: 2 vCPU · 2 GB RAM · 8 GB Disk, `onboot: 1`)
2. installiert App, Python-Umgebung und **systemd-Service** (`Restart=always`)
3. prüft selbst: Service `active`, HTTP-Health-Check OK
4. zeigt am Ende **URL, IP und Initial-Passwort** an

Anpassbar über Umgebungsvariablen:

```bash
CTID=123 PORT=8080 CORES=2 RAM_MB=2048 DISK_GB=8 \
bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/StadtDashboard-CityBoard/main/install/stadtdashboard.sh)"
```

Bei Fehlern gibt das Script die **vollständige Fehlerkette** aus (Exit-Code, Zeile,
Befehl, Service-Status, Journal-Auszug) plus Debug-Hinweis (`bash -x`). Das komplette
Installationslog liegt im Container unter `/var/log/stadtdashboard-install.log`.

> Vor dem ersten Einsatz `REPO_URL`/`RAW_BASE` oben im Script auf dein GitHub-Repo setzen.

---

## 🖥 Erste Schritte

| Schritt | Wo |
|---|---|
| Anmelden (`admin` / Initial-Passwort) | `http://LXC-IP:8080/` – Dashboard zeigt, was noch fehlt |
| Passwort ändern (Warnbanner erscheint bis erledigt) | Einstellungen → Passwort |
| Medien hochladen und **direkt einem Layout zuweisen** (＋ Galerie / Als Bild) | Medien |
| **Layout visuell bauen** mit Drag & Drop + eingebetteter Live-Vorschau | Layouts |
| **Veröffentlichen in 3 Schritten** (URL kopieren → koppeln → Layout zuweisen) | Displays |
| Zeitgesteuerte Layouts (z. B. Nachtmodus 22–6 Uhr) | Zeitpläne |

### Veröffentlichen (kurz)

1. Auf dem TV/Player den Browser öffnen: `http://LXC-IP:8080/display`
   (die genaue URL steht mit Kopier-Button unter **Displays**)
2. Das Gerät erscheint unter **Displays** als „wartet auf Kopplung“ → **Koppeln**
3. Im Gerät das **Layout oder einen Zeitplan** zuweisen – fertig.
   Alle weiteren Änderungen (Medien, Bekanntmachungen, Layout) kommen
   **sofort live** auf die Displays; bei Netzausfall läuft der letzte Stand weiter.

### Vorschau ohne echtes Display

Jedes gespeicherte Layout lässt sich sofort ansehen: Im **Layout-Editor**
(Live-Vorschau-Panel bzw. „Vollbild-Vorschau“) oder aus der **Medien-Seite**
über „▶ Vorschau“. Die Vorschau nutzt exakt dasselbe Rendering wie das echte
Display – inklusive Wetter, Bekanntmachungen und Notfall-Banner.

Das Display rendert **lokal im Browser**, cached den letzten Zustand in
`localStorage` und läuft bei Netzausfall weiter (Uhr, Kalender, Bilder; Wetter wird
als „ggf. veraltet“ markiert). Live-Updates kommen per WebSocket.

### Widgets (V1)
Kopf (Logo + Stadt) · Uhr · Datum · Wetter · Vorhersage · Text · Bild ·
Bildergalerie · Veranstaltungen · Bekanntmachungen · QR-Code · Ticker ·
**Kamera** (Snapshot/MJPEG/HLS sowie **RTSP** – Server holt per ffmpeg
Einzelframes, datenschutzfreundlich ohne Dauersream) ·
**Webseite** (iFrame mit optionalem Consent-/Cookie-URL-Parameter) ·
**RSS-Feed** (RSS/Atom, gecached, nur bei aktiviertem externem Zugriff) ·
Notfall-Banner (automatisch bei Priorität ≥ „Wichtig“)

Layouts sind JSON mit Prozent-Koordinaten → funktionieren in Querformat,
Hochformat (1080×1920) und 4K ohne Sonderbehandlung. Der Drag-&-Drop-Editor
bietet Snap-Raster, Führungslinien, Undo (Strg+Z), Ebenen und Löschen direkt
am Widget (✕ oder Entf-Taste).

---

## 🔒 Datenschutz

- Standardmäßig **null externe Verbindungen**: keine CDNs, keine externen Fonts,
  keine Karten-Tiles, kein Tracking.
- Open-Meteo-Wetterabruf ist optional und durch den Schalter
  *Einstellungen → Externe Dienste erlauben* gesperrt (Status sichtbar unter „Datenschutz“).
- QR-Codes werden serverseitig generiert – keine Tracking-Dienste.
- Jedes Display hat ein eigenes Gerätetoken: koppelbar, sperrbar, zurücksetzbar.

## 💾 Backup / Update / Deinstallation

```bash
# Backup: Admin → Einstellungen → „Backup herunterladen“ (DB + Settings + Medien)

# Update: Installer erneut mit derselben CT-ID ausführen (erkennt Bestand → UPDATE-Modus)
bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/StadtDashboard-CityBoard/main/install/stadtdashboard.sh)"

# Deinstallation:
pct stop <CTID> && pct destroy <CTID>
```

Daten liegen ausschließlich in `/opt/stadtdashboard/data/`
(SQLite-DB `stadtdashboard.db`, `uploads/`, `secret.key`).

---

## 🏗 Architektur

```
Browser (Admin) ─┐                       ┌─ WebSocket (Live-Updates, Heartbeat)
                 ├─ FastAPI (Port 8080) ──┤
Display-Browser ─┘        │              └─ REST (/api/display/*, /api/admin/*)
                          ▼
                    SQLite + Uploads (/opt/stadtdashboard/data)
```

* **Backend:** Python/FastAPI, SQLAlchemy 2, scrypt-Passwort-Hashing,
  HMAC-signierte Sessions, Gerätetoken je Display
* **Frontend:** serverseitige Templates + Vanilla JS/CSS – bewusst ohne Build-Kette
  und ohne externe Abhängigkeiten
* **Scheduling:** Server wählt je Uhrzeit/Wochentag/Priorität das Layout;
  Displays rendern nur noch
* Lizenz: **AGPL-3.0**

Details: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)

## ✅ Verifikation

```
pytest .................. 40 passed (Widgets/RSS/Webcam-Gating, Rollen-Matrix,
                          ICS, Rate-Limit, Notifier, Scheduler, Backup …)
Installer-E2E ........... 5/5 (Stub-Proxmox: Create/Kollision/Update/404)
bash -n + shellcheck .... outer/inner/e2e fehlerfrei
```

Ein echter LXC-Durchlauf muss auf einem Proxmox-Host erfolgen:
Installer starten → Reboot des CT → Web UI wieder erreichbar (systemd + `onboot: 1`).

## 🗺 Roadmap

- **V1.1:** Karte (statisch/OSM-Adapter), Webcam-Snapshot, iCal/ICS-Import, Rollen
- **V2:** Drag-&-Drop-Layout-Builder, HLS/Video, Health-Monitoring, OIDC/LDAP
