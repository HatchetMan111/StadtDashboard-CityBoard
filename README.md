# StadtDashboard

**Lokale Open-Source-Plattform für digitale Stadtinformation & Digital Signage.**
Ein City-Dashboard, das sich frei konfigurieren lässt – komplett lokal, air-gap-fähig,
installierbar als Proxmox-LXC mit einem Einzeiler.

- **Admin-Cockpit** – Inhalte, Layouts, Geräte, Zeitpläne, Backup
- **Display-Frontend** – schlanke Vollbild-Ansicht für TV/Monitor/Signage-Player
- **API/Backend** – FastAPI + SQLite, REST + WebSocket, keine externen Cloud-Dienste
- **Drag-&-Drop-Layout-Editor** – Widgets auf die Fläche ziehen, skalieren,
  Medien per Klick zuweisen (Galerie/Bild/QR)

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
| Anmelden (`admin` / Initial-Passwort) | `http://LXC-IP:8080/` |
| Passwort ändern (Pflicht-Hinweis erscheint im Dashboard) | Einstellungen → Passwort |
| Stadtname, Logo, Ticker, Wetter pflegen | Einstellungen |
| Bekanntmachung mit Priorität + Gültigkeit anlegen | Bekanntmachungen |
| **Layout visuell bauen**: Widgets ziehen/skalieren, Medien zuweisen | Layouts |
| Display koppeln: am Gerät `/display` öffnen → erscheint als „wartet“ → **Koppeln** | Displays |
| Zeitgesteuerte Layouts (z. B. Nachtmodus 22–6 Uhr) | Zeitpläne |
| Vollbild am TV: Browser im Kiosk-Modus auf `/display` | – |

Das Display rendert **lokal im Browser**, cached den letzten Zustand in
`localStorage` und läuft bei Netzausfall weiter (Uhr, Kalender, Bilder; Wetter wird
als „ggf. veraltet“ markiert). Live-Updates kommen per WebSocket.

### Widgets (V1)
Kopf (Logo + Stadt) · Uhr · Datum · Wetter · Vorhersage · Text · Bild ·
Bildergalerie · Veranstaltungen · Bekanntmachungen · QR-Code · Ticker ·
Notfall-Banner (automatisch bei Priorität ≥ „Wichtig“)

Layouts sind JSON mit Prozent-Koordinaten → funktionieren in Querformat,
Hochformat (1080×1920) und 4K ohne Sonderbehandlung.

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
pytest .................. 20 passed (inkl. Passwort-Lifecycle, Pairing, Scheduler)
Installer-E2E ........... 5/5 (Stub-Proxmox: Create/Kollision/Update/404)
uvicorn Boot ............ healthz/login/display/layouts 200 · Static 200
bash -n + shellcheck .... outer/inner/e2e fehlerfrei
```

Ein echter LXC-Durchlauf muss auf einem Proxmox-Host erfolgen:
Installer starten → Reboot des CT → Web UI wieder erreichbar (systemd + `onboot: 1`).

## 🗺 Roadmap

- **V1.1:** Karte (statisch/OSM-Adapter), Webcam-Snapshot, iCal/ICS-Import, Rollen
- **V2:** Drag-&-Drop-Layout-Builder, HLS/Video, Health-Monitoring, OIDC/LDAP
