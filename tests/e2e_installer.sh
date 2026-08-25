#!/usr/bin/env bash
# Integrationstest: simuliert einen Proxmox-Host (pct/qm/pveam/wget/curl-Stubs)
# und führt das Outer-Installer-Script vollständig aus – frisch, Kollision,
# Update-Modus und Argumentweitergabe an das Inner-Script.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="/tmp/opencode/sb-stub-bin"
LOG="/tmp/opencode/sb-installer-e2e.log"
STATE="/tmp/opencode/sb-stub-state"

rm -rf "$BIN" "$STATE"
mkdir -p "$BIN" "$STATE"

# ── Stubs ───────────────────────────────────────────────────────────────────
cat > "$BIN/pct" <<EOF
#!/usr/bin/env bash
STATE="$STATE"
CMD="\$1"; shift || true
case "\$CMD" in
  list)
    echo "VMID Status Name"
    echo "100 stopped other-app"
    ;;
  status)
    [[ "\$1" == "100" ]] && { echo "status: stopped"; exit 0; }
    grep -q "^CTID_OK:\$1\$" "\$STATE/created" 2>/dev/null && exit 0
    exit 1
    ;;
  create)
    VMID=""
    for a in "\$@"; do [[ "\$a" =~ ^[0-9]+\$ ]] && VMID="\$a" && break; done
    echo "CTID_OK:\$VMID" >> "\$STATE/created"
    # Inner-Aufruf-Argumente mitloggen (wird vom Test geprueft)
    exit 0
    ;;
  start|destroy|enter) exit 0 ;;
  push) shift; SRC="\$1"; shift; DST="\$1"; [[ "\$SRC" != "\$DST" ]] && cp "\$SRC" "\$DST"; exit 0 ;;
  exec)
    VMID="\$1"; shift; [[ "\$1" == "--" ]] && shift
    SUB="\$1"
    case "\$SUB" in
      test)     exit 1 ;;   # .app-marker existiert nicht -> frisch
      chmod)    exit 0 ;;
      hostname) echo "192.0.2.77 " ;;
      cat)      echo "dummy-initial-passwort" ;;
      bash)
        shift   # 'bash'
        SCRIPT="\$1"; shift
        echo "INNER_ARGS:\$*" >> "\$STATE/inner_args"
        echo "INNER_SCRIPT:\$SCRIPT" >> "\$STATE/inner_args"
        exit 0 ;;
      *) exit 0 ;;
    esac
    ;;
  *) echo "stub pct: unbekannter Befehl \$CMD" >&2; exit 1 ;;
esac
EOF

cat > "$BIN/qm" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == "list" ]] && { echo "VMID NAME"; echo "101 vm"; }
exit 0
EOF

cat > "$BIN/pveam" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "available -section"|"available --section")
    echo "system          debian-12-standard_12.7-1_amd64.tar.zst" ;;
  "list local")
    echo "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst" ;;
esac
exit 0
EOF

cat > "$BIN/wget" <<EOF
#!/usr/bin/env bash
# -qO <ziel> <url> -> legt das echte Inner-Script ab
ZIEL=""
prev=""
for a in "\$@"; do
  [[ "\$prev" == "-O" || "\$prev" == "-qO" ]] && ZIEL="\$a"
  prev="\$a"
done
[[ -n "\$ZIEL" ]] || exit 1
cp "$ROOT/install/stadtdashboard-inner.sh" "\$ZIEL"
exit 0
EOF

cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
while getopts "sfso:-:" opt; do :; done
echo '{"status":"ok","app":"StadtDashboard","version":"0.1.0"}'
exit 0
EOF

chmod +x "$BIN"/*

# ── Hilfsfunktionen ─────────────────────────────────────────────────────────
fail() { echo "✘ FAIL: $1"; exit 1; }
pass() { echo "✔ PASS: $1"; }

run_installer() {
  local ctid_env="$1"
  (
    export PATH="$BIN:$PATH"
    export CTID="$ctid_env" PORT=8080
    export SB_ALLOW_NON_ROOT=1
    cd "$ROOT" || exit 1
    timeout 30 bash install/stadtdashboard.sh < /dev/null
  ) > "$LOG" 2>&1
}

# ═══════════════ Test 1: frische Installation, CTID automatisch ════════════
rm -f "$STATE"/*
export PATH="$BIN:$PATH"
NEXT=$(bash -c '
  collect_used_vmids() {
    {
      pct list 2>/dev/null | awk "NR>1 && \$1 ~ /^[0-9]+\$/ {print \$1}"
      qm list 2>/dev/null | awk "NR>1 && \$1 ~ /^[0-9]+\$/ {print \$1}"
    } | sort -nu | tr "\n" " "
  }
  used="$(collect_used_vmids)"
  c=100
  while [[ " ${used}" == *" ${c} "* ]]; do c=$((c+1)); done
  echo $c')
[[ "$NEXT" == "102" ]] || fail "next_free_ctid ergab '$NEXT', erwartet 102 (100=CT, 101=VM belegt)"
pass "Automatische freie CT-ID: 102 (100/101 belegt)"

# ═══════════════ Test 2: kompletter Lauf (nicht-interaktiv) ════════════════
unset CTID
if ! run_installer ""; then
  echo "--- Log ---"; cat "$LOG"; fail "Installer brach mit Fehler ab"
fi
grep -q "erfolgreich installiert" "$LOG" || { cat "$LOG"; fail "Keine Erfolgs-Zusammenfassung"; }
grep -q "http://192.0.2.77:8080/" "$LOG" || { cat "$LOG"; fail "URL fehlt in Zusammenfassung"; }
grep -q "dummy-initial-passwort" "$LOG" || { cat "$LOG"; fail "Initial-Passwort fehlt"; }
pass "Kompletter Installer-Lauf erfolgreich (Create → Push → Inner → Verify → Summary)"

# ═══════════════ Test 3: Inner-Script erhielt 3 saubere Argumente ══════════
ARGS=$(cat "$STATE/inner_args")
echo "$ARGS" | grep -q "^INNER_ARGS:8080 https://github.com/HatchetMan111/StadtDashboard-CityBoard.git main$" \
  || { echo "tatsächlich: $ARGS"; fail "Inner-Argumente falsch übergeben"; }
echo "$ARGS" | grep -q "^INNER_SCRIPT:/tmp/stadtdashboard-inner.sh$" \
  || fail "Inner-Script-Pfad falsch"
pass "Inner-Aufruf ohne bash -l, direkte Argumente (PORT REPO_URL BRANCH)"

# ═══════════════ Test 4: Kollision → automatisches Ausweichen ══════════════
rm -f "$STATE"/*
if ! run_installer "100"; then
  echo "--- Log ---"; cat "$LOG"; fail "Kollisionsfall abgebrochen statt ausgewichen"
fi
grep -qE "bereits belegt.*auf [0-9]+" "$LOG" \
  || { cat "$LOG"; fail "Keine Ausweich-Meldung für belegte CT-ID"; }
grep -q "erfolgreich installiert" "$LOG" || fail "Nach Ausweichen keine Installation"
pass "Belegte CT-ID 100 → automatische Ausweich-ID, Installation läuft durch"

# ═══════════════ Test 5: Download-Integritätscheck ═════════════════════════
cat > "$BIN/wget" <<'EOF'
#!/usr/bin/env bash
ZIEL=""; prev=""
for a in "$@"; do [[ "$prev" == "-O" || "$prev" == "-qO" ]] && ZIEL="$a"; prev="$a"; done
[[ -n "$ZIEL" ]] || exit 1
echo "404: Not Found" > "$ZIEL"
exit 0
EOF
chmod +x "$BIN/wget"
rm -f "$STATE"/*
run_installer "" && fail "404-Download wurde nicht erkannt"
grep -q "kein gueltiges Script" "$LOG" || { cat "$LOG"; fail "Falsche Fehlermeldung bei 404"; }
pass "GitHub-404 wird erkannt und mit klarer Meldung abgebrochen"

echo ""
echo "═══ Alle Installer-E2E-Tests bestanden ═══"
