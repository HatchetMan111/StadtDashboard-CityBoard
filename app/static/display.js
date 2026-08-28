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
  let dynamicTimers = [];
  let emergencyTimer = null;
  let lastVersion = null;
  let locked = false;
  let recovering = false;

  /* Einheitliche Intervall-Registry: alle Timer, die Widgets erzeugen,
     landen hier und werden beim nächsten Render komplett geräumt –
     sonst stapeln sich Uhren/Kamera-Refreshs bei jeder Version-Änderung. */
  function dynInterval(fn, ms) {
    const t = setInterval(fn, ms);
    dynamicTimers.push(t);
    return t;
  }

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
  function wipeDevice() {
    device = null;
    localStorage.removeItem(LS_DEVICE);
  }

  function api(path, opts = {}) {
    if (device) {
      opts.headers = { ...(opts.headers || {}),
        Authorization: `Bearer ${device.token}` };
    }
    return fetch(path, opts).then(async resp => {
      if (!resp.ok) {
        const err = new Error(`HTTP ${resp.status}`);
        err.status = resp.status;
        throw err;
      }
      return resp.json();
    });
  }

  /* ── Vorschau-Modus (?preview=LAYOUT_ID) ─────────────────────────────
     Rendert exakt wie ein echtes Display, aber: keine Registrierung,
     kein Pairing, kein localStorage, kein WebSocket – nur Lesen über
     die angemeldete Admin-Session.
     Leiste: blendet sich nach 8 s selbst aus, kommt bei Mausbewegung
     zurück und lässt sich per ✕ dauerhaft für die Sitzung schließen. */
  async function runPreview(layoutId) {
    pairingEl.classList.add("hidden");
    document.body.classList.add("previewing");
    const bar = document.getElementById("preview-bar");
    if (!bar) return;
    bar.classList.remove("hidden");

    let closed = false;
    let hideTimer = null;
    const armHide = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { if (!closed) bar.classList.add("auto-hidden"); },
        8000);
    };
    document.getElementById("preview-close").addEventListener("click", () => {
      closed = true;
      bar.classList.add("hidden");
    });
    document.addEventListener("mousemove", () => {
      if (!closed) { bar.classList.remove("auto-hidden"); armHide(); }
    });
    armHide();

    const tick = async () => {
      try {
        const resp = await fetch(
          `/api/admin/layouts/${encodeURIComponent(layoutId)}/state`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const state = await resp.json();
        staleBadge.classList.add("hidden");
        render(state);
      } catch {
        staleBadge.textContent = "Vorschau nicht verfügbar – im Admin angemeldet?";
        staleBadge.classList.remove("hidden");
      }
    };
    await tick();
    setInterval(tick, 30000);
  }

  /* ── Boot ─────────────────────────────────────────────────────────── */
  async function boot() {
    const previewId = new URLSearchParams(location.search).get("preview");
    if (previewId) {
      await runPreview(previewId);
      return;
    }
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
    const showPairId = () => {
      document.getElementById("pair-id").textContent =
        `Geräte-ID: ${device.device_id.toUpperCase()}`;
    };
    showPairId();
    for (;;) {
      try {
        const status = await api("/api/display/status");
        if (status.approved && status.enabled) break;
      } catch (err) {
        if (err.status === 401) {
          // Token ungültig (z. B. „Token neu" im Admin) → neu registrieren
          wipeDevice();
          await register();
          showPairId();
        }
        /* Server nicht erreichbar oder 403 – weiter warten */
      }
      await new Promise(r => setTimeout(r, POLL_PAIRING_MS));
    }
    pairingEl.classList.add("hidden");
  }

  /* ── Sperr-Screen (Display im Admin deaktiviert) ───────────────────── */
  function showLocked() {
    if (locked) return;
    locked = true;
    clearDynamic();
    if (emergencyTimer) { clearInterval(emergencyTimer); emergencyTimer = null; }
    emergencyBanner.classList.add("hidden");
    stage.className = "";
    stage.style.background = "#0b1220";
    stage.innerHTML = `<div class="locked-screen">
      <div class="lock-icon">🔒</div>
      <h1>Display gesperrt</h1>
      <p>Dieses Display wurde im Admin deaktiviert.<br>
         Sobald es wieder freigegeben wird, erscheinen hier automatisch
         die Inhalte.</p></div>`;
  }
  function unlock() {
    locked = false;
    lastVersion = null;  // Render erzwingen
  }

  /* Token ungültig → Gerät vergessen, neu koppeln, weiterlaufen */
  async function recoverAuth() {
    if (recovering) return;
    recovering = true;
    try {
      wipeDevice();
      await register();
      await waitUntilApproved();
      unlock();
      await refreshState(true);
    } catch { /* Boot-Fallback greift */ } finally {
      recovering = false;
    }
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
      if (locked) unlock();
      staleBadge.classList.add("hidden");
      render(state);
    } catch (err) {
      if (err.status === 403) { showLocked(); return; }   // gesperrt
      if (err.status === 401) { await recoverAuth(); return; }  // Token tot
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
    dynamicTimers.forEach(t => clearInterval(t));
    dynamicTimers = [];
    if (emergencyTimer) clearInterval(emergencyTimer);
  }

  function render(state) {
    if (state.version === lastVersion && !state._force) return;
    lastVersion = state.version;
    clearDynamic();

    stage.className = state.layout.orientation === "portrait" ? "portrait" : "landscape";
    const bg = (state.layout || {}).background || {};
    stage.style.background =
      bg.mode === "color" && bg.color ? bg.color : "#0b1220";
    stage.innerHTML = "";

    // Hintergrundbild + Abdunkelung (damit Widgets lesbar bleiben)
    if (bg.mode === "image" && bg.media_url) {
      const img = document.createElement("img");
      img.className = "bg-layer";
      img.src = bg.media_url;
      img.alt = "";
      const dim = document.createElement("div");
      dim.className = "bg-dim";
      dim.style.opacity = String(Math.min(0.9, Math.max(0, Number(bg.dim) || 0)));
      stage.append(img, dim);
    }

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
        dynInterval(tick, 1000); // Uhr läuft bewusst lokal – auch offline
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
          dynInterval(show,
            Math.max(3, Number(cfg.seconds) || 8) * 1000);
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
        track.style.animationDuration =
          `${Math.max(10, Number(state.ticker_speed) || 30)}s`;
        w.appendChild(track);
        return w;
      }
      case "webcam": {
        const url = cfg.resolved_url || cfg.url;
        if (!url) {
          if (!cfg.blocked) return null;
          const w = widget("w-webcam");
          w.innerHTML =
            '<div class="cam-fallback">Kamera deaktiviert – externe Dienste ' +
            "sind im Admin nicht freigegeben (lokale Kameras funktionieren immer)</div>";
          return w;
        }
        const w = widget("w-webcam");
        const mode = cfg.mode || "snapshot";
        if (mode === "hls") {
          const v = document.createElement("video");
          v.muted = true; v.autoplay = true; v.playsInline = true;
          if (window.Hls && Hls.isSupported()) {
            const hls = new Hls({ liveDurationInfinity: true });
            hls.loadSource(url);
            hls.attachMedia(v);
          } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
            v.src = url; // Safari / Smart-TV-Browser nativ
          } else {
            w.innerHTML =
              '<div class="cam-fallback">HLS wird von diesem Browser nicht unterstützt</div>';
          }
          w.appendChild(v);
        } else {
          // snapshot / rtsp (lokaler ffmpeg-Schnappschuss) / mjpeg
          const img = document.createElement("img");
          img.alt = "Kamera";
          img.src = mode === "mjpeg" ? url : `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
          w.appendChild(img);
          const refresh = Math.max(5, Number(cfg.refresh_seconds) || 30);
          if (mode !== "mjpeg") {
            dynInterval(() => {
              img.src = `${cfg.resolved_url || cfg.url}` +
                `${(cfg.resolved_url || cfg.url).includes("?") ? "&" : "?"}t=${Date.now()}`;
            }, refresh * 1000);
          }
        }
        if (cfg.caption) {
          const cap = document.createElement("div");
          cap.className = "cam-caption";
          cap.textContent = cfg.caption;
          w.appendChild(cap);
        }
        return w;
      }
      case "website": {
        let target = cfg.url || "";
        if (!target.startsWith("http")) return null;
        if (cfg.blocked) {
          const w = widget("w-webcam");
          w.innerHTML =
            '<div class="cam-fallback">Webseite deaktiviert – ' +
            "externe Dienste sind im Admin nicht freigegeben</div>";
          return w;
        }
        if (cfg.consent_param) {
          target += (target.includes("?") ? "&" : "?") + cfg.consent_param;
        }
        const frame = document.createElement("iframe");
        frame.src = target;
        frame.className = "w-website";
        frame.setAttribute("sandbox",
          "allow-scripts allow-same-origin allow-forms allow-popups");
        frame.setAttribute("referrerpolicy", "no-referrer");
        frame.setAttribute("title", "Eingebettete Webseite");
        return frame;
      }
      case "rss": {
        const items = cfg.items || [];
        if (!items.length) return null;
        const w = widget("w-rss panel-bg");
        w.innerHTML = `<div class="list-title">Nachrichten${cfg.stale ? " ◌" : ""}</div>` +
          items.map((it) => `
            <div class="item">
              <div class="what">${escapeHtml(it.title)}</div>
              ${it.date ? `<div class="when">${escapeHtml(it.date)}</div>` : ""}
            </div>`).join("");
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
