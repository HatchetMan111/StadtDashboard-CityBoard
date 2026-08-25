#!/usr/bin/env bash
# ============================================================================
#  StadtDashboard – Proxmox VE Installer (OUTER)
#  Erstellt einen Debian-12-LXC-Container und installiert die App darin
#  (Community-Scripts-Stil). Das eigentliche Setup macht das INNER-Script.
#
#  Einzeiler auf dem Proxmox-Host:
#    bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/StadtDashboard-CityBoard/main/install/stadtdashboard.sh)"
#
#  Update einer bestehenden Installation: dasselbe Kommando mit derselben CT-ID.
# ============================================================================

set -Eeuo pipefail

# ─────────────────────────── Variablen (anpassbar) ──────────────────────────
APP="stadtdashboard"
APP_NAME="StadtDashboard"
VERSION="0.1.0"

REPO_URL="${REPO_URL:-https://github.com/HatchetMan111/StadtDashboard-CityBoard.git}"
RAW_BASE="${RAW_BASE:-https://raw.githubusercontent.com/HatchetMan111/StadtDashboard-CityBoard/main}"

PORT="${PORT:-8080}"            # Web-UI-Port im Container
CTID="${CTID:-}"                # leer → interaktiv abfragen
CORES="${CORES:-2}"
RAM_MB="${RAM_MB:-2048}"
DISK_GB="${DISK_GB:-8}"
STORAGE="${STORAGE:-local-lvm}"
BRIDGE="${BRIDGE:-vmbr0}"
TEMPLATE_SEARCH="debian-12"     # Debian 12 Standard-Templates

# ───────────────────────────── Ausgabe-Helfer ───────────────────────────────
YW='\033[33m'; GN='\033[1;92m'; RD='\033[01;31m'; BL='\033[36m'; CL='\033[m'
BOLD='\033[1m'; DIM='\033[2m'
CM="${GN}✔${CL}"; CROSS="${RD}✘${CL}"; INFO="${BL}ℹ${CL}"
msg_info()  { echo -e " ${INFO} ${1}"; }
msg_ok()    { echo -e " ${CM} ${1}"; }
msg_warn()  { echo -e " ${YW}⚠${CL}  ${1}"; }
msg_fatal() { echo -e " ${CROSS} ${1}" >&2; exit 1; }

on_error() {
  local ec="$1" ln="$2" cmd="$3"
  echo "" >&2
  echo -e "${RD}━━━━━━━━ FEHLERKETTE (Proxmox-Host) ━━━━━━━━${CL}" >&2
  echo -e " Exit-Code : ${ec}" >&2
  echo -e " Zeile     : ${ln}" >&2
  echo -e " Befehl    : ${cmd}" >&2
  if command -v pct >/dev/null 2>&1 && [[ -n "${CTID:-}" ]] && pct status "$CTID" >/dev/null 2>&1; then
    echo -e "${RD}── Container-Status ──${CL}" >&2
    pct status "$CTID" 2>&1 | tail -n 5 >&2 || true
    echo -e "${RD}── Installationslog im Container ──${CL}" >&2
    pct exec "$CTID" -- tail -n 40 "/var/log/${APP}-install.log" 2>&1 | tail -n 40 >&2 || true
  fi
  echo -e "${YW} Debug: Installation im Container manuell ausführen:${CL}" >&2
  echo -e "${YW}   pct enter ${CTID:-<CTID>} && bash -x /tmp/${APP}-inner.sh${CL}" >&2
  echo -e "${RD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}" >&2
  exit "$ec"
}
trap 'on_error $? $LINENO "$BASH_COMMAND"' ERR

require_root() {
  [[ $EUID -eq 0 ]] || msg_fatal "Bitte als root ausführen (z. B. über 'su -')."
}

header() {
  clear 2>/dev/null || true
  echo -e "${GN}${BOLD}"
  cat <<'EOF'
   ____  _             _       ____
  / ___|(_)_ __   __ _| | ___ |  _ \  __ _  ___ _ __ ___
  \___ \| | '_ \ / _` | |/ _ \| | | |/ _` |/ _ \ '_ ` _ \
   ___) | | | | | (_| | |  __/| |_| | (_| |  __/ | | | | |
  |____/|_|_| |_|\__, |_|\___||____/ \__,_|\___|_| |_| |_|
                 |___/
EOF
  echo -e "${CL}${GN}  Digitales Stadt-Dashboard · Open Source · AGPL-3.0${CL}"
  echo ""
  echo -e "  Version      : ${VERSION}"
  echo -e "  Ziel         : Proxmox-LXC (Debian 12)"
  echo -e "  Ressourcen   : ${CORES} vCPU · ${RAM_MB} MB RAM · ${DISK_GB} GB Disk (${STORAGE})"
  echo -e "  Web-UI-Port  : ${PORT}"
  echo ""
}

next_free_ctid() {
  local used candidate=100
  used=$(pct list 2>/dev/null | awk 'NR>1 {print $1}' || true)
  while [[ " ${used} " == *" ${candidate} "* ]]; do candidate=$((candidate + 1)); done
  echo "$candidate"
}

ensure_template() {
  local tmpl
  pveam update >/dev/null 2>&1 || true
  tmpl=$(pveam available --section system 2>/dev/null \
         | awk -v s="$TEMPLATE_SEARCH" 'index($2, s) == 1 {print $2; exit}')
  [[ -n "$tmpl" ]] || msg_fatal "Kein Debian-12-Template gefunden (pveam available leer?)."
  if ! pveam list local 2>/dev/null | grep -q "$tmpl"; then
    msg_info "Lade Container-Template ${tmpl} herunter"
    pveam download local "$tmpl" >/dev/null
  fi
  echo "$tmpl"
}

create_container() {
  local tmpl ip=""
  ROOT_PW="$(openssl rand -base64 12 2>/dev/null || head -c 18 /dev/urandom | base64)"
  tmpl=$(ensure_template)

  msg_info "Erstelle LXC-Container ${CTID} (${APP_NAME})"
  printf '%s\n' "$ROOT_PW" | pct create "$CTID" "local:vztmpl/${tmpl}" \
    --hostname "$APP" \
    --cores "$CORES" \
    --memory "$RAM_MB" \
    --swap 512 \
    --rootfs "${STORAGE}:${DISK_GB}" \
    --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp,firewall=0" \
    --unprivileged 1 \
    --onboot 1 \
    --start 1 \
    --password-stdin >/dev/null
  msg_ok "Container ${CTID} erstellt und gestartet"

  # Root-Passwort des Containers (einmalig ausgegeben)
  msg_info "Warte auf Netzwerk im Container"
  for _ in $(seq 1 30); do
    ip=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}' || true)
    [[ -n "$ip" ]] && break
    sleep 1
  done
  [[ -n "$ip" ]] || msg_fatal "Container hat keine IP erhalten (DHCP prüfen)."
  echo "$ip"
}

push_inner_script() {
  local target="/tmp/${APP}-inner.sh"
  msg_info "Lade Installations-Script für den Container"
  if ! wget -qO "/tmp/${APP}-inner.sh" "${RAW_BASE}/install/${APP}-inner.sh"; then
    msg_fatal "Konnte ${RAW_BASE}/install/${APP}-inner.sh nicht laden."
  fi
  pct push "$CTID" "/tmp/${APP}-inner.sh" "$target" >/dev/null
  pct exec "$CTID" -- chmod +x "$target" >/dev/null
}

run_inner() {
  msg_info "Installation im Container wird ausgeführt (Log: /var/log/${APP}-install.log)"
  pct exec "$CTID" -- bash -lc \
    "bash /tmp/${APP}-inner.sh '${PORT}' '${REPO_URL}' '${BRANCH}'"
}

verify_from_host() {
  local ip="$1" url="http://${1}:${PORT}"
  msg_info "Gegenprüfung vom Host: ${url}/healthz"
  local ok=""
  for _ in $(seq 1 15); do
    if curl -sf --max-time 3 "${url}/healthz" >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  [[ -n "$ok" ]] || msg_fatal "Web-UI unter ${url} antwortet nicht. Log siehe Fehlerkette oben."
  msg_ok "Web-UI erreichbar: ${url}"
}

summary() {
  local ip="$1"
  local pw_hint
  pw_hint=$(pct exec "$CTID" -- cat "/opt/${APP}/data/initial_admin_password.txt" 2>/dev/null || true)
  echo ""
  echo -e "${GN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}"
  echo -e "${GN}  ${APP_NAME} erfolgreich installiert!${CL}"
  echo -e "${GN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}"
  echo ""
  echo -e "  Container-IP : ${BL}${ip}${CL}"
  echo -e "  Web UI       : ${BL}http://${ip}:${PORT}/${CL}"
  echo -e "  Display-URL  : ${BL}http://${ip}:${PORT}/display${CL}"
  echo -e "  Login        : admin"
  if [[ -n "${ROOT_PW:-}" ]]; then
    echo -e "  CT-Root-Passwort: ${ROOT_PW}"
  fi
  if [[ -n "$pw_hint" ]]; then
    echo -e "  Init. Admin-Passwort: ${pw_hint}"
    echo -e "  ${DIM}(steht auch im Container: /opt/${APP}/data/initial_admin_password.txt)${CL}"
  fi
  echo ""
  echo -e "  ${DIM}Update später: dieses Script erneut mit derselben CT-ID ausführen.${CL}"
  echo -e "  ${DIM}Deinstallation: pct stop ${CTID} && pct destroy ${CTID}${CL}"
  echo ""
}

# ─────────────────────────────── Main ───────────────────────────────────────
main() {
  require_root
  command -v pct >/dev/null 2>&1 || msg_fatal "Dieses Script gehört auf einen Proxmox-VE-Host ('pct' fehlt)."
  header

  if [[ -z "$CTID" ]]; then
    local suggestion
    suggestion=$(next_free_ctid)
    read -rp "CT-ID für ${APP_NAME} [${suggestion}]: " input_id || true
    CTID="${input_id:-$suggestion}"
  fi
  [[ "$CTID" =~ ^[0-9]+$ ]] || msg_fatal "Ungültige CT-ID: ${CTID}"

  if pct status "$CTID" >/dev/null 2>&1; then
    msg_warn "Container ${CTID} existiert bereits."
    if pct exec "$CTID" -- test -f "/opt/${APP}/.app-marker" 2>/dev/null; then
      msg_info "Bestehende ${APP_NAME}-Installation erkannt → UPDATE-Modus"
      push_inner_script
      run_inner
      local ip
      ip=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')
      verify_from_host "$ip"
      summary "$ip"
      return 0
    fi
    msg_fatal "CT-ID ${CTID} wird von einem anderen Container verwendet. Bitte andere ID wählen."
  fi

  local ip
  ip=$(create_container)
  push_inner_script
  run_inner
  ip=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')
  verify_from_host "$ip"
  summary "$ip"
}

main "$@"
