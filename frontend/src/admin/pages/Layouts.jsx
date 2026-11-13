/* Layout-Editor: Drag & Drop auf Prozent-Basis, Snap-Raster, Führungslinien,
   Undo (Strg+Z), Widget-Zwischenablage, Hintergrund (Farbe/Bild+Abdunkelung),
   Eigenschaften je Widget-Typ, JSON-Ansicht, Live-Vorschau-iframe.
   DOM-Vertrag (Playwright-E2E): #ed-canvas .ed-el/.sel/.ed-handle/.ed-del,
   #ed-dirty, #layout-save, button[data-widget], #layout-list. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../shared/api.js";
import { Badge, Btn, Empty, Field, Panel, useBusy, useConfirm, useToast } from "../../shared/ui.jsx";

export const ICONS = {
  header: "🏙", clock: "🕐", date: "📅", weather: "🌤", forecast: "🌦", text: "📝",
  image: "🖼", gallery: "🎞", events: "🎉", announcements: "📢", qr: "🔳",
  ticker: "📰", webcam: "🎥", website: "🌐", rss: "📡",
};
export const LABELS = {
  header: "Kopf", clock: "Uhr", date: "Datum", weather: "Wetter", forecast: "Vorhersage",
  text: "Text", image: "Bild", gallery: "Galerie", events: "Veranstaltungen",
  announcements: "Bekanntmachungen", qr: "QR-Code", ticker: "Ticker", webcam: "Kamera",
  website: "Webseite", rss: "RSS-Feed",
};

export const DEFAULTS = {
  header: { x: 3, y: 3, w: 40, h: 11, config: {} },
  clock: { x: 68, y: 3, w: 15, h: 11, config: {} },
  date: { x: 55, y: 3, w: 12, h: 11, config: {} },
  weather: { x: 84, y: 3, w: 13, h: 11, config: {} },
  forecast: { x: 80, y: 15, w: 17, h: 20, config: {} },
  text: { x: 40, y: 40, w: 30, h: 15, config: { text: "Willkommen!" } },
  image: { x: 36, y: 17, w: 38, h: 50, config: { media_id: null } },
  gallery: { x: 36, y: 17, w: 38, h: 62, config: { media_ids: [], seconds: 8 } },
  events: { x: 77, y: 17, w: 20, h: 46, config: { count: 5 } },
  announcements: { x: 3, y: 17, w: 30, h: 62, config: { count: 4 } },
  qr: { x: 77, y: 65, w: 20, h: 19, config: { setting_key: "city_website", url: "", label: "Mehr erfahren" } },
  ticker: { x: 0, y: 91, w: 100, h: 9, config: {} },
  webcam: { x: 60, y: 40, w: 36, h: 34, config: { mode: "snapshot", url: "", refresh_seconds: 30, caption: "Live-Blick" } },
  website: { x: 20, y: 20, w: 60, h: 55, config: { url: "", consent_param: "" } },
  rss: { x: 3, y: 17, w: 30, h: 50, config: { url: "", count: 5, refresh_minutes: 15 } },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clone = (x) => JSON.parse(JSON.stringify(x));

export default function Layouts() {
  const toast = useToast();
  const { busy, run } = useBusy();
  const { confirm, confirmDialog } = useConfirm();

  const [layouts, setLayouts] = useState([]);
  const [media, setMedia] = useState([]);
  const [id, setId] = useState(null);
  const [els, setEls] = useState([]);
  const [sel, setSel] = useState(-1);
  const [bg, setBg] = useState({ mode: "color", color: "#0b1220", dim: 0.35 });
  const [name, setName] = useState("Neues Layout");
  const [orientation, setOrientation] = useState("landscape");
  const [snapStep, setSnapStep] = useState("5");
  const [dirty, setDirty] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [liveOpen, setLiveOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const histRef = useRef([]);
  const dragRef = useRef(null);
  const clipRef = useRef(null);
  const preEditRef = useRef(null);
  const canvasRef = useRef(null);
  const idRef = useRef(null);
  const dirtyRef = useRef(false);
  idRef.current = id;
  dirtyRef.current = dirty;

  const markDirty = useCallback(() => { setDirty(true); }, []);
  const clearDirty = useCallback(() => { setDirty(false); histRef.current = []; }, []);

  const pushHistory = useCallback((snapshot) => {
    histRef.current.push(JSON.stringify(snapshot));
    if (histRef.current.length > 50) histRef.current.shift();
    setDirty(true);
  }, []);

  useEffect(() => {
    const beforeUnload = (e) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  const reloadAll = useCallback(async (keepId) => {
    const [ls, ms] = await Promise.all([
      api("/api/admin/layouts"),
      api("/api/admin/media").catch(() => []),
    ]);
    setLayouts(ls);
    setMedia(ms);
    if (keepId != null && ls.some((l) => l.id === keepId)) {
      loadLayout(ls.find((l) => l.id === keepId));
    } else if (ls.length) {
      loadLayout(ls.find((l) => l.is_default) ?? ls[0]);
    }
  }, []);

  const loadLayout = useCallback((l) => {
    setId(l.id);
    setEls(clone(l.elements || []));
    setBg({ mode: "color", color: "#0b1220", dim: 0.35, ...(l.background || {}) });
    setSel(-1);
    setName(l.name);
    setOrientation(l.orientation);
    clearDirty();
  }, [clearDirty]);

  useEffect(() => { reloadAll().catch((e) => toast(e.message, true)); /* eslint-disable-line */ }, []);

  const confirmDiscard = async () =>
    !dirty || (await confirm("Es gibt ungespeicherte Änderungen. Verwerfen?"));

  /* ── Mutationen ─────────────────────────────────────────────────────── */
  const addWidget = (type) => {
    pushHistory(clone(els));
    setEls((cur) => [...cur, { type, ...clone(DEFAULTS[type]) }]);
    /* Bewusst NICHT selektieren: neue Widgets stehen sofort „fest“
       und werden bei Bedarf per Klick in den Bearbeitungsmodus genommen. */
    toast(`${LABELS[type] || type} hinzugefügt – zum Bearbeiten klicken`);
  };

  const deleteSelected = () => {
    if (sel < 0) return;
    pushHistory(clone(els));
    setEls((cur) => cur.filter((_, i) => i !== sel));
    setSel(-1);
  };

  const undo = () => {
    if (!histRef.current.length) { toast("Nichts zum Rückgängigmachen"); return; }
    const prev = JSON.parse(histRef.current.pop());
    setEls(prev);
    setSel(-1);
  };

  const copySelected = () => {
    if (sel < 0) return false;
    clipRef.current = clone(els[sel]);
    return true;
  };
  const pasteClip = () => {
    if (!clipRef.current) return;
    pushHistory(clone(els));
    const copy = clone(clipRef.current);
    copy.x = clamp(copy.x + 2, 0, 100 - copy.w);
    copy.y = clamp(copy.y + 2, 0, 100 - copy.h);
    setEls((cur) => [...cur, copy]);
    setSel(els.length);
  };

  const moveLayer = (dir) => {
    const j = sel + dir;
    if (sel < 0 || j < 0 || j > els.length - 1) return;
    pushHistory(clone(els));
    setEls((cur) => {
      const next = [...cur];
      [next[sel], next[j]] = [next[j], next[sel]];
      return next;
    });
    setSel(j);
  };

  const duplicateSelected = () => {
    if (sel < 0) return;
    pushHistory(clone(els));
    const copy = clone(els[sel]);
    copy.x = clamp(copy.x + 2, 0, 100 - copy.w);
    copy.y = clamp(copy.y + 2, 0, 100 - copy.h);
    setEls((cur) => { const n = [...cur]; n.splice(sel + 1, 0, copy); return n; });
    setSel(sel + 1);
  };

  const patchEl = (i, patch) => {
    setEls((cur) => cur.map((el, j) => (j === i ? { ...el, ...patch } : el)));
  };

  /* ── Tastatur ───────────────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && /^(input|textarea|select)$/i.test(t.tagName)) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && k === "c") { if (copySelected()) toast("Widget kopiert"); }
      else if ((e.ctrlKey || e.metaKey) && k === "v") { e.preventDefault(); pasteClip(); }
      else if (e.key === "Delete" || e.key === "Backspace") {
        if (selRef.current >= 0) { e.preventDefault(); deleteSelectedRef.current(); }
      } else if (e.key.startsWith("Arrow") && selRef.current >= 0) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        const i = selRef.current;
        pushHistoryRef.current(clone(elsRef.current));
        setEls((cur) => cur.map((el, j) => {
          if (j !== i) return el;
          const c = { ...el };
          if (e.key === "ArrowLeft") c.x = clamp(c.x - step, 0, 100 - c.w);
          else if (e.key === "ArrowRight") c.x = clamp(c.x + step, 0, 100 - c.w);
          else if (e.key === "ArrowUp") c.y = clamp(c.y - step, 0, 100 - c.h);
          else if (e.key === "ArrowDown") c.y = clamp(c.y + step, 0, 100 - c.h);
          return c;
        }));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toast]);
  const selRef = useRef(-1); selRef.current = sel;
  const elsRef = useRef([]); elsRef.current = els;
  const pushHistoryRef = useRef(pushHistory); pushHistoryRef.current = pushHistory;
  const deleteSelectedRef = useRef(deleteSelected); deleteSelectedRef.current = deleteSelected;

  /* ── Drag & Drop (Pointer-Events) ───────────────────────────────────── */
  const snapVal = (v) => {
    const s = Number(snapStep) || 0;
    return s ? Math.round(v / s) * s : Math.round(v);
  };

  const onCanvasPointerDown = (e) => {
    if (e.target.closest(".ed-del")) {
      e.stopPropagation();
      e.preventDefault();
      deleteSelected();
      return;
    }
    const target = e.target.closest(".ed-el");
    if (!target) { setSel(-1); return; }
    const i = Number(target.dataset.i);
    const wasSelected = sel === i;
    setSel(i);
    const canvas = canvasRef.current;
    dragRef.current = {
      i, mode: e.target.classList.contains("ed-handle") ? "resize" : "move",
      startX: e.clientX, startY: e.clientY,
      rect: canvas.getBoundingClientRect(),
      orig: { ...els[i] }, moved: false, wasSelected,
      snapshot: clone(els), histPushed: false,
    };
    e.preventDefault();
  };

  const onWindowPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = ((e.clientX - drag.startX) / drag.rect.width) * 100;
    const dy = ((e.clientY - drag.startY) / drag.rect.height) * 100;
    if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) {
      if (!drag.moved) { drag.moved = true; }
      if (!drag.histPushed) {
        /* Undo-Punkt: Zustand VOR diesem Zug */
        histRef.current.push(JSON.stringify(drag.snapshot));
        if (histRef.current.length > 50) histRef.current.shift();
        drag.histPushed = true;
        setDirty(true);
      }
    }
    const i = drag.i;
    setEls((cur) => cur.map((el, j) => {
      if (j !== i) return el;
      if (drag.mode === "move") {
        return { ...el,
          x: clamp(snapValRef.current(drag.orig.x + dx), 0, 100 - el.w),
          y: clamp(snapValRef.current(drag.orig.y + dy), 0, 100 - el.h) };
      }
      return { ...el,
        w: clamp(snapValRef.current(drag.orig.w + dx), 3, 100 - el.x),
        h: clamp(snapValRef.current(drag.orig.h + dy), 3, 100 - el.y) };
    }));
    setGuides(calcGuides(drag, dx, dy));
  }, []);
  const snapValRef = useRef(snapVal); snapValRef.current = snapVal;

  const calcGuides = (drag, dx, dy) => {
    if (drag.mode !== "move") return { v: false, h: false };
    const cx = drag.orig.x + dx + drag.orig.w / 2;
    const cy = drag.orig.y + dy + drag.orig.h / 2;
    return { v: Math.abs(cx - 50) < 1.2, h: Math.abs(cy - 50) < 1.2 };
  };

  const onWindowPointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setGuides({ v: false, h: false });
    if (!drag.moved && drag.wasSelected) setSel(-1);  // Klick auf Gewähltes = fest setzen
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
    return () => {
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
    };
  }, [onWindowPointerMove, onWindowPointerUp]);

  const [guides, setGuides] = useState({ v: false, h: false });

  /* ── Speichern / Liste ──────────────────────────────────────────────── */
  const save = () => run(async () => {
    const nm = name.trim() || "Layout";
    const current = layouts.find((l) => l.id === id);
    const body = {
      name: nm, orientation, elements: els,
      is_default: current?.is_default || false,
      background: { mode: bg.mode, color: bg.color, media_id: bg.media_id ?? null, dim: bg.dim ?? 0.35 },
    };
    let newId = id;
    if (id) {
      await api(`/api/admin/layouts/${id}`, { method: "PATCH", body });
    } else {
      const res = await api("/api/admin/layouts", { method: "POST", body });
      newId = res.id;
      setId(res.id);
    }
    toast("Layout gespeichert");
    clearDirty();
    setPreviewKey((k) => k + 1);  // iframe auf gespeicherte Version reloaden
    const ls = await api("/api/admin/layouts");
    setLayouts(ls);
    const cur = ls.find((l) => l.id === newId);
    if (cur) { setEls(clone(cur.elements || [])); setBg({ mode: "color", color: "#0b1220", dim: 0.35, ...(cur.background || {}) }); }
  });

  const setDefault = async (l) => {
    await run(async () => {
      await api(`/api/admin/layouts/${l.id}`, {
        method: "PATCH",
        body: { name: l.name, orientation: l.orientation, elements: l.elements, is_default: true },
      });
      toast("Standardlayout gesetzt");
      const ls = await api("/api/admin/layouts");
      setLayouts(ls);
      if (id === l.id) setId(l.id);
    });
  };

  const duplicate = (l) => run(async () => {
    const res = await api(`/api/admin/layouts/${l.id}/duplicate`, { method: "POST" });
    toast(`Kopie „${res.name}" erstellt`);
    const ls = await api("/api/admin/layouts");
    setLayouts(ls);
    loadLayout(ls.find((x) => x.id === res.id));
  });

  const del = async (l) => {
    if (!await confirm("Layout wirklich löschen?")) return;
    try {
      await api(`/api/admin/layouts/${l.id}`, { method: "DELETE" });
      if (id === l.id) { setId(null); setEls([]); setSel(-1); clearDirty(); }
      const ls = await api("/api/admin/layouts");
      setLayouts(ls);
      toast("Gelöscht");
    } catch (err) { toast(err.message, true); }
  };

  const newLayout = async () => {
    if (!await confirmDiscard()) return;
    setId(null); setEls([]); setSel(-1);
    setBg({ mode: "color", color: "#0b1220", dim: 0.35 });
    setName("Neues Layout");
    clearDirty();
  };

  /* ── JSON-Ansicht ───────────────────────────────────────────────────── */
  const openJson = (open) => {
    setJsonOpen(open);
    if (open) setJsonText(JSON.stringify(els, null, 2));
  };
  const importJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) throw new Error("Array erwartet");
      for (const el of parsed) {
        if (!el.type || !DEFAULTS[el.type]) throw new Error(`Unbekannter Typ: ${el.type}`);
        ["x", "y", "w", "h"].forEach((k) => { el[k] = Number(el[k]) || 0; });
        el.config = el.config || {};
      }
      pushHistory(clone(els));
      setEls(parsed);
      setSel(-1);
      toast("JSON übernommen (Strg+Z macht es rückgängig)");
    } catch (err) {
      toast("JSON-Fehler: " + err.message, true);
    }
  };

  /* ── Hintergrund ────────────────────────────────────────────────────── */
  const bgDimPct = Math.round((bg.dim ?? 0.35) * 100);
  const canvasStyle = useMemo(() => {
    if (bg.mode === "image" && bg.media_id) {
      const m = media.find((x) => x.id === Number(bg.media_id));
      if (m) {
        const d = bg.dim ?? 0.35;
        return {
          backgroundImage: `linear-gradient(rgba(0,0,0,${d}),rgba(0,0,0,${d})),url('${m.thumb_url || m.url}')`,
          backgroundColor: "#000",
        };
      }
    }
    return { background: bg.mode === "color" && bg.color ? bg.color : "#0b1220" };
  }, [bg, media]);

  const previewUrl = id ? `/display?preview=${id}` : null;

  return (
    <>
      {confirmDialog}
      <h1>Layouts</h1>
      <p className="subtitle">
        Dashboard zusammenstellen: Widgets aus der Palette auf die Fläche ziehen,
        verschieben, am Griff in der Ecke skalieren und rechts die Inhalte zuweisen.
      </p>

      <div className="grid-2">
        <div>
          <Panel title={`Layouts (${layouts.length})`}>
            <div className="table-wrap">
              <table id="layout-list"><tbody>
                {layouts.map((l) => (
                  <tr key={l.id} className={l.id === id ? "current" : ""}>
                    <td>{l.name} {l.is_default ? <Badge kind="ok">Standard</Badge> : ""}
                      <div className="muted">{l.orientation} · {(l.elements || []).length} Elemente</div></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Btn variant="secondary" size="small" onClick={() => loadLayout(l)}>Laden</Btn>{" "}
                      <Btn variant="secondary" size="small" onClick={() => duplicate(l)}>Duplizieren</Btn>{" "}
                      {!l.is_default && <Btn variant="secondary" size="small" onClick={() => setDefault(l)}>Standard</Btn>}{" "}
                      <Btn variant="danger" size="small" onClick={() => del(l)}>Löschen</Btn>
                    </td>
                  </tr>
                ))}
                {!layouts.length && <tr><td colSpan={2}>
                  <Empty>Noch keine Layouts – lege oben eines an oder nutze auf „Layout gestalten“ eine Vorlage.</Empty>
                </td></tr>}
              </tbody></table>
            </div>
          </Panel>

          <Panel title="Widget hinzufügen">
            <div className="palette">
              {Object.keys(DEFAULTS).map((type) => (
                <Btn key={type} variant="secondary" size="small" data-widget={type}
                  onClick={() => addWidget(type)}>
                  {ICONS[type]} {LABELS[type]}
                </Btn>
              ))}
            </div>
            <p className="muted mt" style={{ fontSize: 13 }}>
              Tipp: Ziehen verschiebt · Griff unten rechts skaliert ·
              Klick wählt aus und zeigt rechts die Eigenschaften.
            </p>
          </Panel>

          <Panel title="Eigenschaften">
            <PropsPanel
              el={sel >= 0 ? els[sel] : null} sel={sel} els={els} media={media}
              patchEl={patchEl} pushHistory={pushHistory}
              onDelete={deleteSelected} onDuplicate={duplicateSelected}
              onLayer={moveLayer} markDirty={markDirty}
            />
          </Panel>
        </div>

        <div>
          <Panel>
            <div className="inline">
              <Field label="Name" style={{ flex: 1 }}>
                <input id="layout-name" value={name}
                  onChange={(e) => { setName(e.target.value); markDirty(); }} />
              </Field>
              <Field label="Format">
                <select id="layout-orientation" value={orientation}
                  onChange={(e) => { setOrientation(e.target.value); markDirty(); }}>
                  <option value="landscape">Querformat</option>
                  <option value="portrait">Hochformat</option>
                </select>
              </Field>
              <Field label="Raster">
                <select id="ed-snap" value={snapStep} onChange={(e) => setSnapStep(e.target.value)}>
                  <option value="">aus</option>
                  <option value="1">1 %</option>
                  <option value="5">5 %</option>
                  <option value="10">10 %</option>
                </select>
              </Field>
              <Btn variant="secondary" id="ed-undo" onClick={undo} title="Strg+Z">↩ Undo</Btn>
              <span id="ed-dirty" className={"badge warn" + (dirty ? "" : " hidden")}>● ungespeichert</span>
              <Btn id="layout-save" busy={busy} onClick={save}>Speichern</Btn>
              <Btn variant="secondary" id="layout-new" onClick={newLayout}>Neu</Btn>
            </div>
          </Panel>

          <Panel title="Hintergrund">
            <div className="inline">
              <Field label="Art">
                <select id="bg-mode" value={bg.mode}
                  onChange={(e) => { setBg((b) => ({ ...b, mode: e.target.value })); markDirty(); }}>
                  <option value="color">Farbe</option>
                  <option value="image">Bild</option>
                </select>
              </Field>
              {bg.mode === "color" && (
                <Field label="Farbe">
                  <input id="bg-color" type="color" value={bg.color || "#0b1220"}
                    onChange={(e) => { setBg((b) => ({ ...b, color: e.target.value })); markDirty(); }} />
                </Field>
              )}
              {bg.mode === "image" && (
                <Field label="Bild" style={{ flex: 1 }}>
                  <select id="bg-media" value={bg.media_id ?? ""}
                    onChange={(e) => { setBg((b) => ({ ...b, media_id: e.target.value ? Number(e.target.value) : undefined })); markDirty(); }}>
                    <option value="">– wählen –</option>
                    {media.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                  </select>
                </Field>
              )}
              {bg.mode === "image" && (
                <Field label={`Abdunkeln (${bgDimPct} %)`}>
                  <input id="bg-dim" type="range" min={0} max={90} step={5} value={bgDimPct}
                    style={{ width: 140 }}
                    onChange={(e) => { setBg((b) => ({ ...b, dim: Number(e.target.value) / 100 })); markDirty(); }} />
                </Field>
              )}
            </div>
            <p className="muted mt" style={{ fontSize: 13 }}>
              Bild-Hintergründe werden automatisch abgedunkelt, damit Widgets lesbar bleiben.
            </p>
          </Panel>

          <Panel>
            <div id="ed-canvas" ref={canvasRef}
              className={"preview-box ed-canvas" + (orientation === "portrait" ? " portrait" : "")}
              style={canvasStyle}
              onPointerDown={onCanvasPointerDown}>
              {els.map((el, i) => (
                <div key={i} data-i={i}
                  className={"ed-el" + (i === sel ? " sel" : "")}
                  style={{ left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%` }}>
                  <span className="ed-badge">{ICONS[el.type] || "▫"} {LABELS[el.type] || el.type}</span>
                  <span className="ed-handle" />
                  <button type="button" className="ed-del" title="Widget löschen">✕</button>
                </div>
              ))}
              {guides.v && <div className="ed-guide v" />}
              {guides.h && <div className="ed-guide h" />}
            </div>
          </Panel>

          <Panel>
            <details className="live-box" open={liveOpen}
              onToggle={(e) => setLiveOpen(e.target.open)}>
              <summary>▶ Live-Vorschau (echtes Display-Rendering)</summary>
              {previewUrl ? (
                <>
                  <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                    Zeigt dieses Layout mit echten Inhalten – aktualisiert sich alle 30 s selbst.
                  </p>
                  <iframe id="ed-preview-frame" key={previewKey} src={previewUrl} title="Live-Vorschau"
                    style={orientation === "portrait"
                      ? { width: "auto", height: "72vh", aspectRatio: "9/16", border: 0,
                          borderRadius: 10, background: "#0b1220", display: "block", margin: "0 auto" }
                      : { width: "100%", aspectRatio: "16/9", border: 0,
                          borderRadius: 10, background: "#0b1220", display: "block" }} />
                  <p style={{ marginTop: 10 }}>
                    <a className="btn secondary small" id="ed-preview-full" href={previewUrl}
                      target="_blank" rel="noopener">Vollbild-Vorschau öffnen ↗</a>
                  </p>
                </>
              ) : (
                <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                  Erst nach dem ersten Speichern verfügbar.
                </p>
              )}
            </details>
          </Panel>

          <Panel>
            <details className="json-box" open={jsonOpen} onToggle={(e) => openJson(e.target.open)}>
              <summary id="ed-json-details">JSON-Ansicht (für Experten)</summary>
              <textarea id="layout-json" className="ed-json" rows={10} style={{ width: "100%", marginTop: 10 }}
                value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
              <p style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <Btn variant="secondary" size="small" id="ed-json-fill"
                  onClick={() => setJsonText(JSON.stringify(els, null, 2))}>Aus Editor füllen</Btn>
                <Btn variant="secondary" size="small" id="ed-json-import" onClick={importJson}>In Editor übernehmen</Btn>
              </p>
            </details>
          </Panel>
        </div>
      </div>
    </>
  );
}

/* ── Eigenschaften-Panel (positions + typspezifisch) ─────────────────── */
function PropsPanel({ el, sel, els, media, patchEl, pushHistory, onDelete, onDuplicate, onLayer, markDirty }) {
  if (!el) {
    return <p className="muted">Kein Element ausgewählt – auf ein Widget klicken.</p>;
  }
  const cfg = el.config || {};
  const setCfg = (key, value) => patchEl(sel, { config: { ...cfg, [key]: value } });
  const commit = () => pushHistory(clone(els));

  const numPos = (k, label) => (
    <Field key={k} label={label}>
      <input type="number" data-pos={k} value={el[k]} min={0} max={100}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (k === "x") patchEl(sel, { x: clamp(v, 0, 100 - el.w) });
          else if (k === "y") patchEl(sel, { y: clamp(v, 0, 100 - el.h) });
          else if (k === "w") patchEl(sel, { w: clamp(v, 3, 100 - el.x) });
          else patchEl(sel, { h: clamp(v, 3, 100 - el.y) });
        }}
        onFocus={(e) => { e.target.dataset.pre = JSON.stringify(els); }}
        onBlur={(e) => {
          const pre = e.target.dataset.pre;
          if (pre) { pushHistory(JSON.parse(pre)); e.target.dataset.pre = ""; }
        }} />
    </Field>
  );

  return (
    <div id="ed-props">
      <p><strong>{ICONS[el.type] || ""} {LABELS[el.type] || el.type}</strong></p>
      <div className="props-grid">
        {numPos("x", "X %")}{numPos("y", "Y %")}{numPos("w", "Breite")}{numPos("h", "Höhe")}
      </div>

      {el.type === "text" && (
        <Field label="Text">
          <textarea rows={3} value={cfg.text || ""}
            onChange={(e) => setCfg("text", e.target.value)}
            onBlur={commit} />
        </Field>
      )}

      {el.type === "image" && (
        <Field label="Medium">
          <select value={cfg.media_id ?? ""}
            onChange={(e) => { pushHistory(clone(els)); setCfg("media_id", e.target.value ? Number(e.target.value) : null); }}>
            <option value="">– Medium wählen –</option>
            {media.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </Field>
      )}

      {el.type === "gallery" && (
        <>
          <div className="chips" style={{ marginTop: 8 }}>
            <strong style={{ fontSize: 12, width: "100%" }}>In Galerie (Reihenfolge = Klick-Reihenfolge):</strong>
            {(cfg.media_ids || []).map((mid, idx) => {
              const m = media.find((x) => x.id === mid);
              return (
                <span key={mid} className="chip" onClick={() => {
                  pushHistory(clone(els));
                  setCfg("media_ids", cfg.media_ids.filter((_, i) => i !== idx));
                }}>
                  {m ? <img src={m.thumb_url || m.url} alt="" /> : null}
                  {m ? m.title : "?"} <span className="x">✕</span>
                </span>
              );
            })}
            {!(cfg.media_ids || []).length && <span className="muted">noch leer</span>}
          </div>
          <div className="chips">
            <strong style={{ fontSize: 12, width: "100%" }}>Verfügbare Medien:</strong>
            {media.filter((m) => !(cfg.media_ids || []).includes(m.id)).map((m) => (
              <span key={m.id} className="chip add" onClick={() => {
                pushHistory(clone(els));
                setCfg("media_ids", [...(cfg.media_ids || []), m.id]);
              }}>
                ＋ <img src={m.thumb_url || m.url} alt="" />{m.title}
              </span>
            ))}
            {!media.length && <span className="muted">Erst <a href="/media">Medien hochladen</a>.</span>}
          </div>
          <Field label="Wechsel alle (Sek.)" className="mt">
            <input type="number" min={3} max={120} value={cfg.seconds ?? 8}
              onChange={(e) => setCfg("seconds", Number(e.target.value))} />
          </Field>
        </>
      )}

      {el.type === "qr" && (
        <>
          <Field label="Ziel">
            <select value={cfg.url ? "custom" : "city_website"}
              onChange={(e) => {
                pushHistory(clone(els));
                if (e.target.value === "custom") setCfg("url", cfg.url || "");
                else patchEl(sel, { config: { ...cfg, setting_key: "city_website", url: "" } });
              }}>
              <option value="city_website">Stadt-Website (Einstellung)</option>
              <option value="custom">Eigene URL</option>
            </select>
          </Field>
          {cfg.url ? (
            <Field label="URL" className="mt">
              <input placeholder="https://…" value={cfg.url || ""}
                onChange={(e) => setCfg("url", e.target.value.trim())} onBlur={commit} />
            </Field>
          ) : null}
          <Field label="Beschriftung" className="mt">
            <input value={cfg.label || ""}
              onChange={(e) => setCfg("label", e.target.value)} onBlur={commit} />
          </Field>
        </>
      )}

      {(el.type === "events" || el.type === "announcements") && (
        <Field label="Anzahl Einträge">
          <input type="number" min={1} max={12} value={cfg.count ?? 5}
            onChange={(e) => setCfg("count", Number(e.target.value))} />
        </Field>
      )}

      {el.type === "webcam" && (
        <>
          <Field label="Modus">
            <select value={cfg.mode || "snapshot"}
              onChange={(e) => { pushHistory(clone(els)); setCfg("mode", e.target.value); }}>
              <option value="snapshot">Snapshot (Bild-URL, aktualisiert sich)</option>
              <option value="mjpeg">MJPEG-Stream (URL)</option>
              <option value="hls">HLS-Stream (.m3u8)</option>
              <option value="rtsp">RTSP-Kamera (Server holt Einzelframes)</option>
            </select>
          </Field>
          <Field label="Quell-URL" className="mt">
            <input placeholder={cfg.mode === "rtsp" ? "rtsp://user:pass@kamera.local/stream1" : "https://…"}
              value={cfg.url || ""} onChange={(e) => setCfg("url", e.target.value.trim())} onBlur={commit} />
          </Field>
          <Field label="Aktualisierung (Sek., snapshot/rtsp)" className="mt">
            <input type="number" min={5} max={600} value={cfg.refresh_seconds ?? 30}
              onChange={(e) => setCfg("refresh_seconds", Number(e.target.value))} onBlur={commit} />
          </Field>
          <Field label="Beschriftung (z. B. „Live-Blick Marktplatz“)" className="mt">
            <input value={cfg.caption || ""} onChange={(e) => setCfg("caption", e.target.value)} onBlur={commit} />
          </Field>
          <p className="muted mt" style={{ fontSize: 12.5 }}>
            RTSP: Der Server zieht alle 60 s ein Einzelbild per ffmpeg
            (datenschutzfreundlich, kein Dauerstream). Erfordert ffmpeg im Container –
            im Installer enthalten.
          </p>
        </>
      )}

      {el.type === "website" && (
        <>
          <Field label="Webseiten-URL">
            <input placeholder="https://www.beispiel.de" value={cfg.url || ""}
              onChange={(e) => setCfg("url", e.target.value.trim())} onBlur={commit} />
          </Field>
          <Field label="Consent-/Cookie-Parameter (an URL angehängt)" className="mt">
            <input placeholder='z. B. "cookie-consent=1"' value={cfg.consent_param || ""}
              onChange={(e) => setCfg("consent_param", e.target.value.trim())} onBlur={commit} />
          </Field>
          <p className="muted mt" style={{ fontSize: 12.5 }}>
            Wichtig: Die Seite muss Einbetten erlauben (keine X-Frame-Options-Sperre).
            Öffentliche (nicht-lokale) Seiten werden nur geladen, wenn „Externe Dienste
            erlauben“ aktiviert ist.
          </p>
        </>
      )}

      {el.type === "rss" && (
        <>
          <Field label="Feed-URL (RSS/Atom)">
            <input placeholder="https://www.stadt.de/news/rss" value={cfg.url || ""}
              onChange={(e) => setCfg("url", e.target.value.trim())} onBlur={commit} />
          </Field>
          <Field label="Anzahl Schlagzeilen" className="mt">
            <input type="number" min={1} max={12} value={cfg.count ?? 5}
              onChange={(e) => setCfg("count", Number(e.target.value))} onBlur={commit} />
          </Field>
          <Field label="Abrufintervall (Minuten)" className="mt">
            <input type="number" min={5} max={240} value={cfg.refresh_minutes ?? 15}
              onChange={(e) => setCfg("refresh_minutes", Number(e.target.value))} onBlur={commit} />
          </Field>
          <p className="muted mt" style={{ fontSize: 12.5 }}>
            Benötigt „Externe Dienste erlauben“ (Einstellungen → Datenschutz);
            ohne Freigabe bleibt das Widget leer.
          </p>
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Btn variant="secondary" size="small" onClick={() => onLayer(1)}>Nach vorn ⬆</Btn>
        <Btn variant="secondary" size="small" onClick={() => onLayer(-1)}>Nach hinten ⬇</Btn>
        <Btn variant="secondary" size="small" onClick={onDuplicate}>Duplizieren</Btn>
        <Btn variant="danger" size="small" onClick={onDelete}>Löschen</Btn>
      </div>
    </div>
  );
}
