/* StadtDashboard Display-Client
   Ablauf: Registrierung → Warten auf Kopplung → State laden/rendern →
   WebSocket-Live-Updates → Offline-Cache via localStorage. */
(function () {
  "use strict";

  const LS_DEVICE = "sb_device";
  const LS_STATE = "sb_state_cache";
  const POLL_PAIRING_MS = 5000;
  const RECONNECT_WS_MS = 5000;
  const STATE_REFRESH_MS = 10 * 60 * 1000;
  const PING_MS = 25000;

  const stage = document.getElementById("stage");
  const pairingEl = document.getElementById("pairing");
  const staleBadge = document.getElementById("stale-badge");
  const emergencyBanner = document.getElementById("emergency-banner");

  let device = null;
  let ws = null;
  let wsTimer = null;
  let galleryTimers = [];
  let emergencyTimer = null;
  let lastVersion = null;

  /* ── Speicher ─────────────────────────────────────────────────────── */
  function loadDevice() {
    try { return JSON.parse(localStorage.getItem(LS_DEVICE)); }
    catch { return null; }
  }
  function saveDevice(d) { localStorage.setItem(LS_DEVICE, JSON.stringify(d)); }
  function cacheState(state) { localStorage.setItem(LS_STATE, JSON.stringify(state)); }
  function loadCachedState() {
    try { return JSON.parse(localStorage.getItem(LS_STATE)); } catch { return null; }
  }

  function api(path, opts = {}) {
    if (device) {
      opts.headers = { ...(opts.headers || {}),
        Authorization: `Bearer ${device.token}` };
    }
    return fetch(path, opts).then(async resp => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    });
  }

  /* ── Boot ─────────────────────────────────────────────────────────── */
  async function boot() {
    device = loadDevice();
    if (!device) await register();
    await waitUntilApproved();
    start();
  }

  async function register() {
    const resp = await fetch("/api/display/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resolution: `${window.screen.width}x${window.screen.height}`,
        orientation: window.innerWidth > window.innerHeight
          ? "landscape" : "portrait",
      }),
    });
    if (!resp.ok) throw new Error("Registrierung fehlgeschlagen: HTTP " + resp.status);
    device = await resp.json();
    saveDevice(device);
  }

  async function waitUntilApproved() {
    pairingEl.classList.remove("hidden");
    document.getElementById("pair-id").textContent =
      `Geräte-ID: ${device.device_id.toUpperCase()}`;
    for (;;) {
      try {
        const status = await api("/api/display/status");
        if (status.approved && status.enabled) break;
      } catch { /* Server nicht erreichbar – weiter warten */ }
      await new Promise(r => setTimeout(r, POLL_PAIRING_MS));
    }
    pairingEl.classList.add("hidden");
  }

  async function start() {
    await refreshState(true);
    connectWs();
    setInterval(() => refreshState(false), STATE_REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshState(false);
    });
  }

  /* ── State laden & rendern ────────────────────────────────────────── */
  async function refreshState(useCacheOnFail) {
    try {
      const state = await api("/api/display/state");
      cacheState(state);
      staleBadge.classList.add("hidden");
      render(state);
    } catch {
      if (useCacheOnFail) {
        const cached = loadCachedState();
        if (cached) {
          staleBadge.classList.remove("hidden");
          render(cached);
        }
      } else {
        staleBadge.classList.remove("hidden");
      }
    }
  }

  function clearDynamic() {
    galleryTimers.forEach(t => clearInterval(t));
    galleryTimers = [];
    if (emergencyTimer) clearInterval(emergencyTimer);
  }

  function render(state) {
    if (state.version === lastVersion && !state._force) return;
    lastVersion = state.version;
    clearDynamic();

    stage.className = state.layout.orientation === "portrait" ? "portrait" : "landscape";
    stage.innerHTML = "";

    for (const el of state.layout.elements || []) {
      const node = buildWidget(el, state);
      if (node) {
        node.style.left = el.x + "%";
        node.style.top = el.y + "%";
        node.style.width = el.w + "%";
        node.style.height = el.h + "%";
        stage.appendChild(node);
      }
    }
    renderEmergency(state.emergency || []);
  }

  /* ── Widgets ──────────────────────────────────────────────────────── */
  function widget(cls, extra = "") {
    const div = document.createElement("div");
    div.className = `widget ${cls} ${extra}`.trim();
    return div;
  }

  function buildWidget(el, state) {
    const cfg = el.config || {};
    switch (el.type) {
      case "header": {
        const w = widget("w-header panel-bg");
        if (cfg.logo_url) {
          const img = document.createElement("img");
          img.src = cfg.logo_url; img.alt = "";
          w.appendChild(img);
        }
        const city = document.createElement("div");
        city.className = "city";
        city.textContent = state.city_name || "";
        w.appendChild(city);
        return w;
      }
      case "clock": {
        const w = widget("w-clock");
        const time = document.createElement("div");
        time.className = "time";
        const tick = () => {
          time.textContent = new Date().toLocaleTimeString("de-DE",
            { hour: "2-digit", minute: "2-digit" });
        };
        tick();
        setInterval(tick, 1000); // Uhr läuft bewusst lokal – auch offline
        w.appendChild(time);
        return w;
      }
      case "date": {
        const w = widget("w-date");
        w.textContent = new Date().toLocaleDateString("de-DE",
          { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
        return w;
      }
      case "weather": {
        const wx = state.weather || {};
        const w = widget("w-weather panel-bg", wx.stale ? "stale" : "");
        const temp = document.createElement("div");
        temp.className = "temp";
        temp.textContent = `${Math.round(wx.temp_c ?? 0)}°`;
        const cond = document.createElement("div");
        cond.className = "cond";
        cond.innerHTML =
          `${escapeHtml(wx.condition || "")}` +
          (wx.temp_max != null
            ? `<br>↑ ${Math.round(wx.temp_max)}° ↓ ${Math.round(wx.temp_min)}°` : "");
        w.append(temp, cond);
        return w;
      }
      case "forecast": {
        const wx = state.weather || {};
        const days = wx.forecast || [];
        const w = widget("w-forecast");
        for (const d of days.slice(0, 4)) {
          const day = document.createElement("div");
          day.className = "day";
          day.innerHTML = `<span class="d-label">${escapeHtml(d.label || "")}</span>
            <span class="d-max">↑${d.temp_max ?? "?"}°</span>
            <span class="d-min">↓${d.temp_min ?? "?"}°</span>
            <span class="d-cond">${escapeHtml(d.condition || "")}</span>`;
          w.appendChild(day);
        }
        return w;
      }
      case "text": {
        const w = widget("w-text panel-bg");
        w.textContent = cfg.text || "";
        return w;
      }
      case "image": {
        if (!cfg.url) return null;
        const w = widget("w-image");
        w.appendChild(mediaNode(cfg.url, cfg.kind));
        return w;
      }
      case "gallery": {
        const items = cfg.items || [];
        if (!items.length) return null;
        const w = widget("w-image");
        let idx = 0;
        const show = () => {
          w.innerHTML = "";
          w.appendChild(mediaNode(items[idx].url, items[idx].kind));
          idx = (idx + 1) % items.length;
        };
        show();
        if (items.length > 1) {
          galleryTimers.push(setInterval(show,
            Math.max(3, Number(cfg.seconds) || 8) * 1000));
        }
        return w;
      }
      case "events": {
        const events = (state.events || []).slice(0, Number(cfg.count) || 5);
        const w = widget("w-events panel-bg");
        w.innerHTML = `<div class="list-title">Veranstaltungen</div>` +
          (events.map(e => `
            <div class="item">
              <div class="when">${fmtWhen(e)}</div>
              <div class="what">${escapeHtml(e.title)}</div>
              ${e.location ? `<div class="where">${escapeHtml(e.location)}</div>` : ""}
            </div>`).join("") ||
            `<div class="where" style="font-size:2.4vmin;color:#94a3b8">
               Aktuell keine Veranstaltungen.</div>`);
        return w;
      }
      case "announcements": {
        const anns = (state.announcements || [])
          .filter(a => a.priority < 4)
          .slice(0, Number(cfg.count) || 4);
        const w = widget("w-announcements panel-bg");
        w.innerHTML = `<div class="list-title">Aktuelles</div>` +
          (anns.map(a => `
            <div class="item p${a.priority}">
              <div class="a-title">${escapeHtml(a.title)}</div>
              ${a.body ? `<div class="a-body">${escapeHtml(a.body)}</div>` : ""}
            </div>`).join("") ||
            `<div class="where" style="font-size:2.4vmin;color:#94a3b8">
               Keine Meldungen.</div>`);
        return w;
      }
      case "qr": {
        if (!cfg.qr_image) return null;
        const w = widget("w-qr panel-bg");
        const img = document.createElement("img");
        img.src = cfg.qr_image; img.alt = cfg.label || "QR-Code";
        const label = document.createElement("div");
        label.className = "label";
        label.textContent = cfg.label || "";
        w.append(img, label);
        return w;
      }
      case "ticker": {
        if (!state.ticker_text) return null;
        const w = widget("w-ticker");
        const track = document.createElement("div");
        track.className = "track";
        track.textContent = state.ticker_text + "   ●   ";
        w.appendChild(track);
        return w;
      }
      default:
        return null;
    }
  }

  function mediaNode(url, kind) {
    if (kind === "video") {
      const v = document.createElement("video");
      v.src = url; v.autoplay = true; v.muted = true; v.loop = true;
      v.playsInline = true;
      return v;
    }
    const img = document.createElement("img");
    img.src = url; img.alt = ""; img.loading = "eager";
    return img;
  }

  function fmtWhen(e) {
    const start = new Date(e.start_at);
    const today = new Date();
    const sameDay = start.toDateString() === today.toDateString();
    const timeStr = start.toLocaleTimeString("de-DE",
      { hour: "2-digit", minute: "2-digit" }) + " Uhr";
    if (sameDay) return `Heute · ${timeStr}`;
    return `${start.toLocaleDateString("de-DE",
      { weekday: "short", day: "2-digit", month: "2-digit" })} · ${timeStr}`;
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g,
      c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;",
              '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ── Notfall-Banner (rotiert durch alle aktiven Notfälle) ─────────── */
  function renderEmergency(items) {
    if (emergencyTimer) clearInterval(emergencyTimer);
    if (!items.length) {
      emergencyBanner.classList.add("hidden");
      return;
    }
    let i = 0;
    const textEl = document.getElementById("emergency-text");
    const show = () => {
      const item = items[i % items.length];
      textEl.textContent = `⚠ ${item.title}` +
        (item.body ? ` — ${item.body}` : "");
      emergencyBanner.classList.remove("hidden");
      i += 1;
    };
    show();
    if (items.length > 1) {
      emergencyTimer = setInterval(show, 8000);
    }
  }

  /* ── WebSocket (Live-Updates + Heartbeat) ─────────────────────────── */
  function connectWs() {
    clearTimeout(wsTimer);
    const proto = location.protocol === "https:" ? "wss://" : "ws://";
    ws = new WebSocket(`${proto}${location.host}/ws/display/${device.device_id}` +
      `?token=${encodeURIComponent(device.token)}`);

    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "reload") refreshState(false);
      } catch { /* ignorieren */ }
    };

    ws.onopen = () => {
      staleBadge.classList.add("hidden");
    };

    ws.onclose = () => {
      wsTimer = setTimeout(connectWs, RECONNECT_WS_MS);
    };

    const ping = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, PING_MS);
    ws.addEventListener("close", () => clearInterval(ping));
  }

  boot().catch(err => {
    pairingEl.querySelector("p").textContent =
      "Server nicht erreichbar. Neuer Versuch in Kürze … (" + err.message + ")";
    setTimeout(boot, 5000);
  });
})();
