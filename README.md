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

## 🎨 Layout gestalten (geführt) & Vorlagen

Neue Seite **„Layout gestalten“** – bewusst ohne Koordinaten:

1. **Ziel-Layout wählen** – oder **„Neu aus Vorlage“**: 8 fertige Designs
   (Standard, Tourismus, Rathaus-Info, Abendprogramm, Kamera-Fokus,
   Willkommen, News-Kiosk, Info-Hochformat)
2. **Kategorie wählen**: 🖼 Bild · 🎞 Bilder-Serie · 🎥 Kamera (RTSP-URL
   direkt eingeben) · 🌐 Webseite (Link) · 📡 RSS · 📢 Bekanntmachungen ·
   🎉 Veranstaltungen · 🌤 Wetter · 🕐 Uhr · 📅 Datum · 🏙 Kopf ·
   📝 Text · 🔳 QR · 📰 Ticker
3. **Nur die Felder ausfüllen, die die Kategorie braucht** (z. B. bei
   Kamera: RTSP-URL + Beschriftung), Position als verständlichen Slot
   wählen („Rechte Hälfte“, „Unterer Balken“ …) → hinzufügen →
   **Live-Vorschau** öffnen

Feinjustierung (freies Ziehen, Hintergrund) bleibt im klassischen Editor.

### Hintergrund pro Layout
Im Editor wählbar: **Farbe** oder **Bild mit Abdunkelung** (Prozent) –
damit Widgets auf Fotos lesbar bleiben. Gilt für Display und Live-Vorschau.

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
pytest .................. 48 passed (Vorlagen, Add-Widget-Slots, Background-
                          Roundtrip, Rollen-Matrix, ICS, Rate-Limit …)

## 🧭 UX & Stabilität (v0.5.1)

**Behobene Bugs**
- `/konto`: Passwort-Formular hatte keinen Submit-Handler (lief ins Leere)
- `/gestalten`: admin.js doppelt geladen → Widgets/Vorlagen wurden
  **zweimal** angelegt
- Editor: Wechsel/Laden verwirft ungespeicherte Änderungen jetzt nur
  nach Rückfrage
- Display: Uhr-Intervalle stapelten sich bei jedem Layout-Reload
  (CPU-Leak im Dauerbetrieb) – jetzt zentrale Timer-Verwaltung

**Verbessert**
- Displays: 401 → Gerät registriert sich automatisch neu; 403 →
  klarer Sperr-Screen, Selbstheilung bei Entsperrung
- Doppelklick-Schutz (Busy-State) für alle speichernden Buttons
  (Uploads, ICS-Import, Layout-/Zeitplan-Speichern, Vorlagen …)
- Mediathek: Mehrfach-Upload, Suchfeld, Löschen warnt vor
  verwendenden Widgets; Veranstaltungsliste mit Suche + „Vergangene
  ausblenden"
- Displays-Seite: Layout-/Zeitplan-Auswahl aktualisiert „Jetzt aktiv"
  sofort; Sperr-Toggle aus Datenzustand; Modal schließt per ESC/
  Backdrop-Klick
- Bekanntmachungen/Veranstaltungen: Bearbeiten abbrechen + Zeilen-
  Markierung, kein unnötiger Re-Fetch
- Editor: Pfeiltasten-Nudging (Shift = 5 %), Widget kopieren/einfügen
  (Strg+C/Strg+V, layoutübergreifend), Empty-States
- Mobile: Sidebar wird zur Top-Leiste, Tabellen horizontal scrollbar
- Toasts: klickbar schließbar, Fehler bleiben 8 s, Screenreader-Status
Browser-E2E (Playwright). 2 passed – Editor-Flow im echten Chromium:
                          Add→Klick→Drag→„fest setzen“→Entf/✕→Persistenz
Installer-E2E ........... 5/5 (Stub-Proxmox: Create/Kollision/Update/404)
bash -n + shellcheck .... outer/inner/e2e fehlerfrei
```

Browser-Tests benötigen einmalig: `pip install -r requirements-dev.txt && playwright install chromium`


Ein echter LXC-Durchlauf muss auf einem Proxmox-Host erfolgen:
Installer starten → Reboot des CT → Web UI wieder erreichbar (systemd + `onboot: 1`).

## 🗺 Roadmap

- **V1.1:** Karte (statisch/OSM-Adapter), Webcam-Snapshot, iCal/ICS-Import, Rollen
- **V2:** Drag-&-Drop-Layout-Builder, HLS/Video, Health-Monitoring, OIDC/LDAP
