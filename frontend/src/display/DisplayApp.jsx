/* Display-Client (React)
   Ablauf: Registrierung → Warten auf Kopplung → State laden/rendern →
   WebSocket-Live-Updates → Offline-Cache via localStorage.
   Preview-Modus (?preview=LAYOUT_ID): rendert exakt wie ein Display,
   aber ohne Registrierung/Pairing – nur Lesen über die Admin-Session. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./display.css";

const LS_DEVICE = "sb_device";
const LS_STATE = "sb_state_cache";
const POLL_PAIRING_MS = 5000;
const RECONNECT_WS_MS = 5000;
const STATE_REFRESH_MS = 10 * 60 * 1000;
const PING_MS = 25000;

function loadDevice() {
  try { return JSON.parse(localStorage.getItem(LS_DEVICE)); } catch { return null; }
}
function saveDevice(d) { localStorage.setItem(LS_DEVICE, JSON.stringify(d)); }
function cacheState(state) { localStorage.setItem(LS_STATE, JSON.stringify(state)); }
function loadCachedState() {
  try { return JSON.parse(localStorage.getItem(LS_STATE)); } catch { return null; }
}

async function displayApi(path, device) {
  const resp = await fetch(path, {
    headers: device ? { Authorization: `Bearer ${device.token}` } : {},
  });
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtWhen(e) {
  const start = new Date(e.start_at);
  const today = new Date();
  const sameDay = start.toDateString() === today.toDateString();
  const timeStr = start.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
  if (sameDay) return `Heute · ${timeStr}`;
  return `${start.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })} · ${timeStr}`;
}

/* ── Widgets ───────────────────────────────────────────────────────────── */
function Widget({ el, state }) {
  const cfg = el.config || {};
  switch (el.type) {
    case "header": {
      return (
        <div className="widget w-header panel-bg">
          {cfg.logo_url ? <img src={cfg.logo_url} alt="" /> : null}
          <div className="city">{state.city_name || ""}</div>
        </div>
      );
    }
    case "clock": {
      const [time, setTime] = useState(() =>
        new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }));
      useEffect(() => {
        const t = setInterval(() => setTime(
          new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })), 1000);
        return () => clearInterval(t);
      }, []);
      return <div className="widget w-clock"><div className="time">{time}</div></div>;
    }
    case "date":
      return (
        <div className="widget w-date">
          {new Date().toLocaleDateString("de-DE",
            { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
        </div>
      );
    case "weather": {
      const wx = state.weather || {};
      return (
        <div className={"widget w-weather panel-bg" + (wx.stale ? " stale" : "")}>
          <div className="temp">{Math.round(wx.temp_c ?? 0)}°</div>
          <div className="cond"
            dangerouslySetInnerHTML={{
              __html: escapeHtml(wx.condition || "") +
                (wx.temp_max != null
                  ? `<br>↑ ${Math.round(wx.temp_max)}° ↓ ${Math.round(wx.temp_min)}°` : ""),
            }} />
        </div>
      );
    }
    case "forecast": {
      const days = (state.weather || {}).forecast || [];
      return (
        <div className="widget w-forecast">
          {days.slice(0, 4).map((d, i) => (
            <div key={i} className="day">
              <span className="d-label">{d.label || ""}</span>
              <span className="d-max">↑{d.temp_max ?? "?"}°</span>
              <span className="d-min">↓{d.temp_min ?? "?"}°</span>
              <span className="d-cond">{d.condition || ""}</span>
            </div>
          ))}
        </div>
      );
    }
    case "text":
      return <div className="widget w-text panel-bg">{cfg.text || ""}</div>;
    case "image": {
      if (!cfg.url) return null;
      return <div className="widget w-image">{mediaNode(cfg.url, cfg.kind)}</div>;
    }
    case "gallery": {
      const items = cfg.items || [];
      const [idx, setIdx] = useState(0);
      useEffect(() => {
        if (items.length <= 1) return;
        const t = setInterval(() => setIdx((i) => (i + 1) % items.length),
          Math.max(3, Number(cfg.seconds) || 8) * 1000);
        return () => clearInterval(t);
      }, [items.length, cfg.seconds]);
      if (!items.length) return null;
      const cur = items[idx % items.length];
      return <div className="widget w-image">{mediaNode(cur.url, cur.kind)}</div>;
    }
    case "events": {
      const events = (state.events || []).slice(0, Number(cfg.count) || 5);
      return (
        <div className="widget w-events panel-bg">
          <div className="list-title">Veranstaltungen</div>
          {events.map((e) => (
            <div key={e.id} className="item">
              <div className="when">{fmtWhen(e)}</div>
              <div className="what">{e.title}</div>
              {e.location ? <div className="where">{e.location}</div> : null}
            </div>
          )) || null}
          {!events.length && (
            <div className="where" style={{ fontSize: "2.4vmin", color: "#94a3b8" }}>
              Aktuell keine Veranstaltungen.
            </div>
          )}
        </div>
      );
    }
    case "announcements": {
      const anns = (state.announcements || [])
        .filter((a) => a.priority < 4)
        .slice(0, Number(cfg.count) || 4);
      return (
        <div className="widget w-announcements panel-bg">
          <div className="list-title">Aktuelles</div>
          {anns.map((a) => (
            <div key={a.id} className={`item p${a.priority}`}>
              <div className="a-title">{a.title}</div>
              {a.body ? <div className="a-body">{a.body}</div> : null}
            </div>
          ))}
          {!anns.length && (
            <div className="where" style={{ fontSize: "2.4vmin", color: "#94a3b8" }}>Keine Meldungen.</div>
          )}
        </div>
      );
    }
    case "qr": {
      if (!cfg.qr_image) return null;
      return (
        <div className="widget w-qr panel-bg">
          <img src={cfg.qr_image} alt={cfg.label || "QR-Code"} />
          <div className="label">{cfg.label || ""}</div>
        </div>
      );
    }
    case "ticker": {
      if (!state.ticker_text) return null;
      return (
        <div className="widget w-ticker">
          <div className="track" style={{ animationDuration: `${Math.max(10, Number(state.ticker_speed) || 30)}s` }}>
            {state.ticker_text + "   ●   "}
          </div>
        </div>
      );
    }
    case "webcam": {
      const url = cfg.resolved_url || cfg.url;
      if (!url) {
        if (!cfg.blocked) return null;
        return (
          <div className="widget w-webcam">
            <div className="cam-fallback">Kamera deaktiviert – externe Dienste sind im Admin
              nicht freigegeben (lokale Kameras funktionieren immer)</div>
          </div>
        );
      }
      const mode = cfg.mode || "snapshot";
      const [nonce, setNonce] = useState(0);
      useEffect(() => {
        if (mode === "mjpeg") return;
        const t = setInterval(() => setNonce((n) => n + 1),
          Math.max(5, Number(cfg.refresh_seconds) || 30) * 1000);
        return () => clearInterval(t);
      }, [mode, cfg.refresh_seconds]);

      let node;
      if (mode === "hls") {
        node = <HlsVideo url={url} />;
      } else {
        const src = mode === "mjpeg" ? url : `${url}${url.includes("?") ? "&" : "?"}t=${nonce}`;
        node = <img src={src} alt="Kamera" />;
      }
      return (
        <div className="widget w-webcam">
          {node}
          {cfg.caption ? <div className="cam-caption">{cfg.caption}</div> : null}
        </div>
      );
    }
    case "website": {
      let target = cfg.url || "";
      if (!target.startsWith("http")) return null;
      if (cfg.blocked) {
        return (
          <div className="widget w-webcam">
            <div className="cam-fallback">Webseite deaktiviert – externe Dienste sind
              im Admin nicht freigegeben</div>
          </div>
        );
      }
      if (cfg.consent_param) {
        target += (target.includes("?") ? "&" : "?") + cfg.consent_param;
      }
      return (
        <iframe src={target} className="w-website" title="Eingebettete Webseite"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          referrerPolicy="no-referrer" />
      );
    }
    case "rss": {
      const items = cfg.items || [];
      if (!items.length) return null;
      return (
        <div className="widget w-rss panel-bg">
          <div className="list-title">Nachrichten{cfg.stale ? " ◌" : ""}</div>
          {items.map((it, i) => (
            <div key={i} className="item">
              <div className="what">{it.title}</div>
              {it.date ? <div className="when">{it.date}</div> : null}
            </div>
          ))}
        </div>
      );
    }
    default:
      return null;
  }
}

function HlsVideo({ url }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ liveDurationInfinity: true });
      hls.loadSource(url);
      hls.attachMedia(v);
      return () => hls.destroy();
    }
    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = url; // Safari / Smart-TV-Browser nativ
    }
  }, [url]);
  return (
    <video ref={ref} muted autoPlay playsInline />
  );
}

function mediaNode(url, kind) {
  if (kind === "video") {
    return <video src={url} autoPlay muted loop playsInline />;
  }
  return <img src={url} alt="" loading="eager" />;
}

/* ── Notfall-Banner (rotiert durch alle aktiven Notfälle) ──────────────── */
function EmergencyBanner({ items }) {
  const [i, setI] = useState(0);
  useEffect(() => { setI(0); }, [items]);
  useEffect(() => {
    if (items.length <= 1) return;
    const t = setInterval(() => setI((n) => n + 1), 8000);
    return () => clearInterval(t);
  }, [items.length]);
  if (!items.length) return null;
  const item = items[i % items.length];
  return (
    <div id="emergency-banner">
      <span id="emergency-text">⚠ {item.title}{item.body ? ` — ${item.body}` : ""}</span>
    </div>
  );
}

/* ── Haupt-App ─────────────────────────────────────────────────────────── */
export default function DisplayApp() {
  const params = new URLSearchParams(window.location.search);
  const previewId = params.get("preview");

  /* Preview-Modus: Leiste, State-Polling, kein Pairing/WS. */
  if (previewId) return <PreviewApp layoutId={previewId} />;
  return <DisplayRuntime />;
}

function PreviewApp({ layoutId }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(false);
  const [closed, setClosed] = useState(false);
  const [autoHidden, setAutoHidden] = useState(false);
  const hideTimer = useRef(null);

  const armHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setAutoHidden(true), 8000);
  }, []);

  useEffect(() => {
    document.body.classList.add("previewing");
    const tick = async () => {
      try {
        const resp = await fetch(`/api/admin/layouts/${encodeURIComponent(layoutId)}/state`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        setState(await resp.json());
        setError(false);
      } catch {
        setError(true);
      }
    };
    tick();
    const t = setInterval(tick, 30000);
    armHide();
    return () => clearInterval(t);
  }, [layoutId, armHide]);

  useEffect(() => {
    const onMove = () => { if (!closed) { setAutoHidden(false); armHide(); } };
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  }, [closed, armHide]);

  return (
    <>
      <Stage state={state} />
      {!closed && (
        <div id="preview-bar" className={autoHidden ? "auto-hidden" : ""}>
          <strong>Vorschau</strong>
          <span className="muted-p">zeigt exakt, was das Display rendert</span>
          <a href="/layouts">Im Editor bearbeiten ↗</a>
          <button type="button" title="Leiste ausblenden"
            onClick={() => setClosed(true)}>✕</button>
        </div>
      )}
      {error && <div id="stale-badge">Vorschau nicht verfügbar – im Admin angemeldet?</div>}
    </>
  );
}

function DisplayRuntime() {
  const [device, setDevice] = useState(loadDevice());
  const [state, setState] = useState(() => loadCachedState());
  const [phase, setPhase] = useState("boot");     // boot | pairing | live | locked
  const [stale, setStale] = useState(false);
  const [bootError, setBootError] = useState("");
  const deviceRef = useRef(null);
  deviceRef.current = device;
  const stateRef = useRef(null);
  stateRef.current = state;

  const register = useCallback(async () => {
    const resp = await fetch("/api/display/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resolution: `${window.screen.width}x${window.screen.height}`,
        orientation: window.innerWidth > window.innerHeight ? "landscape" : "portrait",
      }),
    });
    if (!resp.ok) throw new Error("Registrierung fehlgeschlagen: HTTP " + resp.status);
    const d = await resp.json();
    setDevice(d);
    saveDevice(d);
    return d;
  }, []);

  /* Token ungültig → Gerät vergessen, neu koppeln, weiterlaufen */
  const recoverAuth = useCallback(async () => {
    try {
      localStorage.removeItem(LS_DEVICE);
      setDevice(null);
      await register();
      setPhase("pairing");
    } catch { /* Boot-Fallback greift */ }
  }, [register]);

  const refreshState = useCallback(async () => {
    try {
      const s = await displayApi("/api/display/state", deviceRef.current);
      cacheState(s);
      setState(s);
      setStale(false);
      setPhase("live");
    } catch (err) {
      if (err.status === 403) { setPhase("locked"); return; }   // gesperrt
      if (err.status === 401) { await recoverAuth(); return; }  // Token tot
      setStale(true);   // Netz weg → letzter Stand bleibt stehen
    }
  }, [recoverAuth]);

  /* Boot: registrieren → auf Kopplung warten → live */
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        if (!deviceRef.current) await register();
      } catch (err) {
        setBootError("Server nicht erreichbar. Neuer Versuch in Kürze … (" + err.message + ")");
        setTimeout(() => window.location.reload(), 5000);
        return;
      }
      setPhase("pairing");
      for (;;) {
        if (stop) return;
        try {
          const status = await displayApi("/api/display/status", deviceRef.current);
          if (status.approved && status.enabled) break;
        } catch (err) {
          if (err.status === 401) {
            /* Token ungültig (z. B. „Token neu" im Admin) → neu registrieren */
            localStorage.removeItem(LS_DEVICE);
            setDevice(null);
            await register();
          }
          /* Server nicht erreichbar oder 403 – weiter warten */
        }
        await new Promise((r) => setTimeout(r, POLL_PAIRING_MS));
      }
      if (stop) return;
      await refreshState();
    })();
    return () => { stop = true; };
  }, [register, refreshState]);

  /* Live-Loop: periodisches Refresh + WS-Updates */
  useEffect(() => {
    if (phase !== "live") return;
    const refresh = setInterval(refreshState, STATE_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshState();
    };
    document.addEventListener("visibilitychange", onVisible);

    let ws = null;
    let wsTimer = null;
    const connect = () => {
      const d = deviceRef.current;
      if (!d) return;
      const proto = window.location.protocol === "https:" ? "wss://" : "ws://";
      ws = new WebSocket(`${proto}${window.location.host}/ws/display/${d.device_id}` +
        `?token=${encodeURIComponent(d.token)}`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "reload") refreshState();
        } catch { /* ignorieren */ }
      };
      ws.onopen = () => setStale(false);
      ws.onclose = (ev) => {
        if (ev.code === 4401) refreshState();  // Token entzogen → Selbstheilung
        wsTimer = setTimeout(connect, RECONNECT_WS_MS);
      };
    };
    connect();
    const ping = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, PING_MS);

    return () => {
      clearInterval(refresh);
      clearInterval(ping);
      clearTimeout(wsTimer);
      document.removeEventListener("visibilitychange", onVisible);
      if (ws) { ws.onclose = null; ws.close(); }
    };
  }, [phase, refreshState]);

  if (phase === "locked") {
    return (
      <>
        <div id="stage" style={{ background: "#0b1220" }}>
          <div className="locked-screen">
            <div className="lock-icon">🔒</div>
            <h1>Display gesperrt</h1>
            <p>Dieses Display wurde im Admin deaktiviert.<br />
              Sobald es wieder freigegeben wird, erscheinen hier automatisch
              die Inhalte.</p>
          </div>
        </div>
      </>
    );
  }

  if (phase !== "live") {
    return (
      <>
        <div id="stage" className="landscape" />
        <div id="pairing">
          <div className="pair-card">
            <h1>StadtDashboard</h1>
            {bootError
              ? <p>{bootError}</p>
              : <p>Dieses Display wartet auf Freigabe.</p>}
            <p className="muted">Im Admin unter <strong>Displays</strong> mit „Koppeln“ freigeben.</p>
            <code id="pair-id">
              {device ? `Geräte-ID: ${device.device_id.toUpperCase()}` : "Geräte-ID: …"}
            </code>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Stage state={state} />
      <EmergencyBanner items={state?.emergency || []} />
      {stale && <div id="stale-badge">Daten ggf. veraltet – Offline-Modus</div>}
    </>
  );
}

/* Rendert den State auf die Bühne; im Pairing unsichtbar vorgewärmt. */
function Stage({ state, hidden }) {
  const bg = (state?.layout || {}).background || {};
  const style = useMemo(() => ({
    background: bg.mode === "color" && bg.color ? bg.color : "#0b1220",
    ...(hidden ? { visibility: "hidden" } : {}),
  }), [bg.mode, bg.color, hidden]);

  return (
    <div id="stage" className={state?.layout?.orientation === "portrait" ? "portrait" : "landscape"} style={style}>
      {bg.mode === "image" && bg.media_url && (
        <>
          <img className="bg-layer" src={bg.media_url} alt="" />
          <div className="bg-dim" style={{ opacity: String(Math.min(0.9, Math.max(0, Number(bg.dim) || 0))) }} />
        </>
      )}
      {(state?.layout?.elements || []).map((el, i) => {
        const node = <Widget el={el} state={state} />;
        return (
          <div key={`${el.type}-${i}`} className="abs"
            style={{ left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%` }}>
            {node}
          </div>
        );
      })}
    </div>
  );
}
