#!/usr/bin/env bash
# ============================================================================
#  StadtDashboard – Installation INNERHALB des LXC-Containers
#  Wird vom Outer-Script auf dem Proxmox-Host geladen und via 'pct exec'
#  ausgeführt. Manuell testbar:
#
#    bash -x stadtdashboard-inner.sh [PORT] [REPO_URL] [BRANCH]
#
#  Idempotent: erneuter Aufruf = Update (Code ziehen, Abhängigkeiten,
#  Service neu starten). Daten in /opt/stadtdashboard/data bleiben erhalten.
# ============================================================================

set -Eeuo pipefail

APP="stadtdashboard"
APP_NAME="StadtDashboard"
PORT="${1:-8080}"
REPO_URL="${2:-https://github.com/HatchetMan111/StadtDashboard-CityBoard.git}"
BRANCH="${3:-main}"
APP_DIR="/opt/${APP}"
DATA_DIR="${APP_DIR}/data"
SERVICE_USER="stadtdashboard"
LOG_FILE="/var/log/${APP}-install.log"

exec > >(tee -a "$LOG_FILE") 2>&1

# ───────────────────────────── Ausgabe-Helfer ───────────────────────────────
YW='\033[33m'; GN='\033[1;92m'; RD='\033[01;31m'; BL='\033[36m'; CL='\033[m'
CM="${GN}✔${CL}"; CROSS="${RD}✘${CL}"; INFO="${BL}ℹ${CL}"
msg_info()  { echo -e " ${INFO} ${1}"; }
msg_ok()    { echo -e " ${CM} ${1}"; }
msg_fatal() { echo -e " ${CROSS} ${1}" >&2; exit 1; }

# ───────────────────── Vollständige Fehlermeldungskette ─────────────────────
on_error() {
  local ec="$1" ln="$2" cmd="$3"
  echo "" >&2
  echo -e "${RD}━━━━━━━━ FEHLERKETTE (im Container) ━━━━━━━━${CL}" >&2
  echo -e " Exit-Code : ${ec}" >&2
  echo -e " Zeile     : ${ln}" >&2
  echo -e " Befehl    : ${cmd}" >&2
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "^${APP}.service"; then
    echo -e "${RD}── systemctl status ${APP} ──${CL}" >&2
    systemctl status "${APP}" --no-pager -l 2>&1 | tail -n 25 >&2 || true
    echo -e "${RD}── journalctl -u ${APP} (letzte 40 Zeilen) ──${CL}" >&2
    journalctl -u "${APP}" -n 40 --no-pager 2>&1 | tail -n 40 >&2 || true
  fi
  echo -e "${RD}── Installationslog ──${CL}" >&2
  tail -n 15 "$LOG_FILE" >&2 || true
  echo -e "${YW} Debug: bash -x /tmp/${APP}-inner.sh ${PORT}${CL}" >&2
  echo -e "${RD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}" >&2
  exit "$ec"
}
trap 'on_error $? $LINENO "$BASH_COMMAND"' ERR

export DEBIAN_FRONTEND=noninteractive
# Keine Locale-Warnungen von apt/perl im Container-Log
export LC_ALL=C LANG=C

echo -e "${GN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}"
echo -e "${GN} ${APP_NAME} – Installation im Container${CL}"
echo -e "${GN} Port: ${PORT} · Repo: ${REPO_URL} (${BRANCH})${CL}"
echo -e "${GN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}"

# ───────────────────────── 1. Systempakete ──────────────────────────────────
msg_info "System aktualisieren und Basis-Pakete installieren"
apt-get update -qq
apt-get install -y -qq \
  curl wget git ca-certificates openssl tzdata ffmpeg \
  python3 python3-venv python3-pip >/dev/null
msg_ok "Basis-Pakete installiert"

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "${PORT}/tcp" >/dev/null
  msg_ok "UFW: Port ${PORT}/tcp erlaubt"
fi

# ───────────────────────── 2. Benutzer & Verzeichnisse ──────────────────────
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" \
  --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$APP_DIR" "$DATA_DIR"

# ───────────────────────── 3. Anwendungscode ────────────────────────────────
cd "$APP_DIR"
if [[ -d .git ]]; then
  msg_info "Update: hole neuesten Code (${BRANCH})"
  git remote set-url origin "$REPO_URL" || true
  git fetch --depth 1 origin "$BRANCH"
  git reset --hard "FETCH_HEAD"
else
  rm -rf ./* ./.[!.]* 2>/dev/null || true
  if git clone --depth 1 --branch "$BRANCH" "$REPO_URL" . 2>/dev/null; then
    msg_ok "Code geklont (${BRANCH})"
  else
    msg_info "Git-Klon fehlgeschlagen → versuche Tarball"
    wget -qO /tmp/${APP}.tar.gz "${REPO_URL%/}/archive/refs/heads/${BRANCH}.tar.gz" \
      || msg_fatal "Konnte weder klonen noch Tarball laden: ${REPO_URL}"
    tar -xzf /tmp/${APP}.tar.gz --strip-components=1 -C .
    rm -f /tmp/${APP}.tar.gz
    msg_ok "Code aus Tarball entpackt"
  fi
fi
touch "$APP_DIR/.app-marker"

# ───────────────────────── 4. Python-Umgebung ───────────────────────────────
if [[ ! -x .venv/bin/python ]]; then
  msg_info "Erstelle Python-Virtualenv"
  python3 -m venv .venv
fi
msg_info "Installiere Python-Abhängigkeiten"
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
msg_ok "Python-Abhängigkeiten installiert"

chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

# ───────────────────────── 5. systemd-Service ───────────────────────────────
msg_info "Richte systemd-Service ein"
if [[ -f systemd/stadtdashboard.service ]]; then
  sed "s/--port 8080/--port ${PORT}/" systemd/stadtdashboard.service \
    > "/etc/systemd/system/${APP}.service"
else
  cat > "/etc/systemd/system/${APP}.service" <<EOF
[Unit]
Description=${APP_NAME} – lokale Digital-Signage-Plattform
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${APP_DIR}/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
Environment=SB_DATA_DIR=${DATA_DIR}
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
fi
systemctl daemon-reload
systemctl enable "${APP}.service" >/dev/null 2>&1

# Import-Sanity-Check: faengt Import-/Konfig-Fehler mit vollem Traceback ab,
# BEVOR systemd den Service in eine Crash-Schleife schickt.
msg_info "Prüfe Anwendungs-Import (Python)"
cd "$APP_DIR"
IMPORT_OUT="$("$APP_DIR/.venv/bin/python" -c "from app.main import app; print('OK')" 2>&1 || true)"
if [ "$IMPORT_OUT" != "OK" ]; then
  echo -e "${RD}── Python-Import fehlgeschlagen ──${CL}" >&2
  echo "$IMPORT_OUT" >&2
  msg_fatal "app.main konnte nicht importiert werden (siehe Traceback oben)."
fi
msg_ok "Anwendungs-Import OK"

# Ownership hart setzen (Import-Check lief als root; Datenpfad muss dem
# Service-User gehoeren, sonst: sqlite 'unable to open database file')
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$DATA_DIR"
chmod 750 "$DATA_DIR"

systemctl restart "${APP}.service"
msg_ok "systemd-Service aktiviert (enable + restart)"

# ───────────────────────── 6. Verifikation ──────────────────────────────────
# Bewusst ohne '[[ ]] && break' – unter 'set -E' wuerde jeder nicht-active-Tick
# den ERR-Trap ausloesen. Alle Pruefungen laufen ueber if/then mit || true.
msg_info "Prüfe Service und Web UI"

svc_state="unbekannt"
for _ in $(seq 1 30); do
  svc_state="$(systemctl is-active "${APP}" 2>/dev/null || true)"
  if [ "$svc_state" = "active" ]; then break; fi
  sleep 1
done

if [ "$svc_state" != "active" ]; then
  echo "" >&2
  echo -e "${RD}── Diagnose: Service-Status ist '$svc_state' ──${CL}" >&2
  systemctl status "${APP}" --no-pager -l 2>&1 | tail -n 30 >&2 || true
  echo -e "${RD}── Journal der letzten 50 Zeilen ──${CL}" >&2
  journalctl -u "${APP}" -n 50 --no-pager 2>&1 | tail -n 50 >&2 || true
  msg_fatal "Service '${APP}' ist nicht active (Status: ${svc_state})."
fi
msg_ok "Service ist active"

HEALTH=""
for _ in $(seq 1 20); do
  HEALTH="$(curl -sf --max-time 3 "http://127.0.0.1:${PORT}/healthz" 2>/dev/null || true)"
  if [ -n "$HEALTH" ]; then break; fi
  sleep 1
done

if [ -z "$HEALTH" ]; then
  echo "" >&2
  echo -e "${RD}── Diagnose: Health-Endpoint auf Port ${PORT} nicht erreichbar ──${CL}" >&2
  systemctl is-active "${APP}" 2>&1 | tail -n 1 >&2 || true
  ss -tlnp 2>/dev/null | grep ":${PORT}" >&2 || echo "  (Port ${PORT} lauscht nicht)" >&2
  echo -e "${RD}── Datenverzeichnis ──${CL}" >&2
  ls -la "$DATA_DIR" 2>&1 | tail -n 10 >&2 || true
  curl -sv --max-time 3 "http://127.0.0.1:${PORT}/healthz" 2>&1 | tail -n 8 >&2 || true
  journalctl -u "${APP}" -n 30 --no-pager 2>&1 | tail -n 30 >&2 || true
  msg_fatal "Health-Endpoint antwortet nicht."
fi
msg_ok "Health-Check OK: ${HEALTH}"

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

echo ""
echo -e "${GN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}"
echo -e "${GN} ${APP_NAME} läuft!${CL}"
echo -e "${GN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}"
echo ""
echo -e "  Web UI        : http://${IP}:${PORT}/"
echo -e "  Display       : http://${IP}:${PORT}/display"
echo -e "  Admin-Login   : admin"
if [[ -f "${DATA_DIR}/initial_admin_password.txt" ]]; then
  echo -e "  Init-Passwort : $(cat "${DATA_DIR}/initial_admin_password.txt")"
  echo -e "                  ${YW}(bitte sofort im Admin ändern!)${CL}"
fi
echo ""
