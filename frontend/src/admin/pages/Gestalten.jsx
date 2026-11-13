/* Geführte Seite "Layout gestalten": Vorlage wählen → Kategorie → Formular. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../shared/api.js";
import { Btn, Field, Panel, useBusy, useToast } from "../../shared/ui.jsx";

const CATS = [
  { type: "image", icon: "🖼", label: "Bild", desc: "Ein einzelnes Foto/Grafik", slot: "links",
    fields: [{ key: "media_id", label: "Bild", kind: "media", required: true }] },
  { type: "gallery", icon: "🎞", label: "Bilder-Serie", desc: "Mehrere Bilder als Wechsel", slot: "rechts",
    fields: [{ key: "media_ids", label: "Bilder (Klick-Reihenfolge)", kind: "media_multi" },
             { key: "seconds", label: "Wechsel alle (Sek.)", kind: "number", min: 3, max: 120, def: 8 }] },
  { type: "webcam", icon: "🎥", label: "Kamera", desc: "RTSP-Stream oder Bild-URL", slot: "rechts",
    fields: [{ key: "mode", label: "Art", kind: "select", def: "rtsp",
               options: [["rtsp", "RTSP-Stream (Server holt Frames)"], ["snapshot", "Snapshot-Bild-URL"],
                         ["mjpeg", "MJPEG-Stream"], ["hls", "HLS-Stream (.m3u8)"]] },
             { key: "url", label: "URL (rtsp://… bzw. https://…)", kind: "text",
               placeholder: "rtsp://user:pass@kamera.local/stream1" },
             { key: "refresh_seconds", label: "Aktualisierung (Sek.)", kind: "number", min: 5, max: 600, def: 30 },
             { key: "caption", label: "Beschriftung (optional)", kind: "text", def: "Live-Blick" }] },
  { type: "website", icon: "🌐", label: "Webseite", desc: "Seite einbetten (Link genügt)", slot: "mitte-gross",
    fields: [{ key: "url", label: "Link zur Webseite", kind: "text", placeholder: "https://www.beispiel.de" },
             { key: "consent_param", label: "Cookie-/Consent-Parameter (optional)", kind: "text", placeholder: "cookie-consent=1" }] },
  { type: "rss", icon: "📡", label: "RSS-Feed", desc: "Schlagzeilen aus Feed", slot: "links",
    fields: [{ key: "url", label: "Feed-URL", kind: "text", placeholder: "https://…/rss" },
             { key: "count", label: "Anzahl Zeilen", kind: "number", min: 1, max: 12, def: 5 }] },
  { type: "announcements", icon: "📢", label: "Bekanntmachungen", desc: "Zeigt Ihre gepflegten Meldungen", slot: "links",
    fields: [{ key: "count", label: "Anzahl", kind: "number", min: 1, max: 12, def: 4 }] },
  { type: "events", icon: "🎉", label: "Veranstaltungen", desc: "Kommende Termine aus dem Kalender", slot: "rechts",
    fields: [{ key: "count", label: "Anzahl", kind: "number", min: 1, max: 12, def: 5 }] },
  { type: "weather", icon: "🌤", label: "Wetter", desc: "Aktuelle Werte + Bedingung", slot: "oben-rechts", fields: [] },
  { type: "forecast", icon: "🌦", label: "Wetter-Vorhersage", desc: "3-Tage-Vorschau", slot: "oben-rechts", fields: [] },
  { type: "clock", icon: "🕐", label: "Uhr", desc: "Große Uhrzeit", slot: "oben-rechts", fields: [] },
  { type: "date", icon: "📅", label: "Datum", desc: "Langes Datum", slot: "oben-rechts", fields: [] },
  { type: "header", icon: "🏙", label: "Kopf (Stadt + Logo)", desc: "Logo und Stadtname", slot: "oben-links", fields: [] },
  { type: "text", icon: "📝", label: "Text", desc: "Freier Text/Hinweis", slot: "mitte-gross",
    fields: [{ key: "text", label: "Text", kind: "textarea", def: "Willkommen!" }] },
  { type: "qr", icon: "🔳", label: "QR-Code", desc: "Stadt-Website oder eigener Link", slot: "rechts",
    fields: [{ key: "_src", label: "Ziel", kind: "select_qr" },
             { key: "label", label: "Beschriftung", kind: "text", def: "Mehr erfahren" }] },
  { type: "ticker", icon: "📰", label: "Ticker", desc: "Laufband mit Ticker-Text", slot: "unten-band", fields: [] },
];

const SLOT_LABELS = {
  "oben-links": "Oben links", "oben-rechts": "Oben rechts",
  links: "Linke Hälfte", rechts: "Rechte Hälfte", "mitte-gross": "Mitte (groß)",
  "voll-bild": "Ganze Fläche", "unten-band": "Unterer Balken",
};

export default function Gestalten() {
  const toast = useToast();
  const { busy, run } = useBusy();
  const [layouts, setLayouts] = useState([]);
  const [media, setMedia] = useState([]);
  const [presets, setPresets] = useState([]);
  const [layoutId, setLayoutId] = useState("");
  const [showPresets, setShowPresets] = useState(false);
  const [cat, setCat] = useState(null);
  const [slot, setSlot] = useState("");
  const [cfg, setCfg] = useState({});
  const [qrSrc, setQrSrc] = useState("city_website");
  const [qrUrl, setQrUrl] = useState("");
  const [doneUrl, setDoneUrl] = useState("");
  const [done, setDone] = useState(false);
  const [presetBusy, setPresetBusy] = useState("");

  useEffect(() => {
    Promise.all([
      api("/api/admin/layouts"),
      api("/api/admin/media").catch(() => []),
      api("/api/admin/layout-presets"),
    ]).then(([ls, ms, ps]) => {
      setLayouts(ls);
      setMedia(ms);
      setPresets(ps);
      if (ls.length) setLayoutId(String(ls.find((l) => l.is_default)?.id ?? ls[0].id));
    }).catch((e) => toast(e.message, true));
  }, [toast]);

  const portrait = useMemo(
    () => layouts.find((l) => String(l.id) === layoutId)?.orientation === "portrait",
    [layouts, layoutId]);

  const pickCat = (c) => {
    setCat(c);
    setSlot(c.slot);
    setCfg(Object.fromEntries(c.fields.filter((f) => f.def !== undefined).map((f) => [f.key, f.def])));
    setQrSrc("city_website");
    setQrUrl("");
    setDone(false);
  };

  const createFromPreset = (p) => run(async () => {
    const res = await api("/api/admin/layouts/from-preset", {
      method: "POST", body: { preset_id: p.id },
    });
    toast(`Layout „${res.name}" erstellt`);
    const ls = await api("/api/admin/layouts");
    setLayouts(ls);
    setLayoutId(String(res.id));
  }, {});

  const addWidget = () => run(async () => {
    if (!layoutId) { toast("Erst ein Layout in Schritt 1 wählen", true); return; }
    const out = {};
    for (const f of cat.fields) {
      if (f.key === "_src") continue;
      const v = cfg[f.key];
      if (v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)) out[f.key] = v;
    }
    if (cat.type === "qr") {
      if (qrSrc === "custom") {
        if (qrUrl.trim()) { out.url = qrUrl.trim(); }
        else out.setting_key = "city_website";
      } else {
        out.setting_key = "city_website";
      }
    }
    /* Numerische Felder sauber übergeben */
    for (const f of cat.fields) {
      if (f.kind === "number" && out[f.key] !== undefined) out[f.key] = Number(out[f.key]);
    }
    const res = await api(`/api/admin/layouts/${layoutId}/add-widget`, {
      method: "POST", body: { type: cat.type, config: out, slot },
    });
    setDoneUrl(res.preview_url);
    setDone(true);
    toast(`${cat.label} hinzugefügt – ▶ Vorschau ansehen!`);
  });

  const multiIds = cfg.media_ids || [];
  const toggleMulti = (id) =>
    setCfg((c) => {
      const cur = c.media_ids || [];
      return { ...c, media_ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });

  return (
    <>
      <h1>Layout gestalten</h1>
      <p className="subtitle">In drei Schritten zum Display-Inhalt – ohne Koordinaten.</p>

      <Panel title="Schritt 1 · Ziel-Layout wählen">
        <div className="inline" style={{ alignItems: "center" }}>
          <Field label="Aktives Layout" style={{ flex: 1 }}>
            <select value={layoutId} onChange={(e) => setLayoutId(e.target.value)}>
              {!layouts.length && <option value="">– noch keins –</option>}
              {layouts.map((l) =>
                <option key={l.id} value={l.id}>{l.name}{l.is_default ? " (Standard)" : ""}</option>)}
            </select>
          </Field>
          <Btn variant="secondary" onClick={() => setShowPresets((v) => !v)}>➕ Neu aus Vorlage …</Btn>
          <a className="btn secondary" href="/layouts">Im Editor öffnen ↗</a>
        </div>
        {showPresets && (
          <div className="card-grid mt">
            {presets.map((p) => (
              <button key={p.id} className="preset-card" disabled={presetBusy === p.id}
                onClick={() => { setPresetBusy(p.id); createFromPreset(p).finally(() => setPresetBusy("")); }}>
                <strong>{p.name}</strong>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {p.orientation === "portrait" ? "📱 Hochformat" : "🖥 Querformat"} · {p.widget_count} Widgets
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>{p.description}</div>
                <span className="btn small mt" style={{ pointerEvents: "none" }}>Diese Vorlage nutzen</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Schritt 2 · Was soll aufs Display?">
        <div className="card-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))" }}>
          {CATS.map((c) => (
            <button key={c.type} className={"cat-tile" + (cat?.type === c.type ? " sel" : "")}
              onClick={() => pickCat(c)}>
              <span className="ico">{c.icon}</span>
              <strong>{c.label}</strong>
              <span className="muted" style={{ fontSize: 12 }}>{c.desc}</span>
            </button>
          ))}
        </div>
      </Panel>

      {cat && (
        <Panel title={`${cat.icon} ${cat.label} – Angaben`}>
          <div className="inline">
            {cat.fields.map((f) => {
              if (f.kind === "select_qr") {
                return (
                  <React.Fragment key="_src">
                    <Field label="Ziel">
                      <select value={qrSrc} onChange={(e) => setQrSrc(e.target.value)}>
                        <option value="city_website">Stadt-Website (Einstellung)</option>
                        <option value="custom">Eigene URL</option>
                      </select>
                    </Field>
                    {qrSrc === "custom" && (
                      <Field label="URL" style={{ flex: 1 }}>
                        <input value={qrUrl} placeholder="https://…"
                          onChange={(e) => setQrUrl(e.target.value)} />
                      </Field>
                    )}
                  </React.Fragment>
                );
              }
              if (f.kind === "media") {
                return (
                  <Field key={f.key} label="Bild" style={{ flex: 1 }}>
                    {!media.length
                      ? <span className="muted">Noch keine Medien – <a href="/media">erst hochladen</a>.</span>
                      : <select value={cfg[f.key] ?? ""} onChange={(e) =>
                          setCfg((c) => ({ ...c, [f.key]: e.target.value ? Number(e.target.value) : null }))}>
                          <option value="">– wählen –</option>
                          {media.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                        </select>}
                  </Field>
                );
              }
              if (f.kind === "media_multi") {
                return (
                  <Field key={f.key} label={f.label} style={{ flex: 2, minWidth: 280 }}>
                    {!media.length
                      ? <span className="muted">Noch keine Medien – <a href="/media">erst hochladen</a>.</span>
                      : <div className="chips">
                          {media.map((m) => {
                            const on = multiIds.includes(m.id);
                            return (
                              <span key={m.id} className={"chip" + (on ? "" : " add")}
                                onClick={() => toggleMulti(m.id)}>
                                {on ? "✓" : "＋"} <img src={m.thumb_url || m.url} alt="" />{m.title}
                              </span>
                            );
                          })}
                        </div>}
                  </Field>
                );
              }
              if (f.kind === "textarea") {
                return (
                  <Field key={f.key} label={f.label} style={{ flex: 2, minWidth: 260 }}>
                    <textarea rows={3} value={cfg[f.key] ?? f.def ?? ""}
                      onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.value }))} />
                  </Field>
                );
              }
              if (f.kind === "select") {
                return (
                  <Field key={f.key} label={f.label}>
                    <select value={cfg[f.key] ?? f.def ?? ""}
                      onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.value }))}>
                      {f.options.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
                    </select>
                  </Field>
                );
              }
              if (f.kind === "number") {
                return (
                  <Field key={f.key} label={f.label}>
                    <input type="number" min={f.min ?? 0} max={f.max ?? 9999}
                      value={cfg[f.key] ?? f.def ?? ""}
                      onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.value }))} />
                  </Field>
                );
              }
              return (
                <Field key={f.key} label={f.label} style={{ flex: 1, minWidth: 200 }}>
                  <input value={cfg[f.key] ?? f.def ?? ""} placeholder={f.placeholder || ""}
                    onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.value }))} />
                </Field>
              );
            })}
            <Field label="Position">
              <select value={slot} onChange={(e) => setSlot(e.target.value)}>
                {(portrait
                  ? ["oben-links", "oben-rechts", "links", "rechts", "mitte-gross", "unten-band", "voll-bild"]
                  : Object.keys(SLOT_LABELS)
                ).map((s) => <option key={s} value={s}>{SLOT_LABELS[s]}</option>)}
              </select>
            </Field>
            <Btn busy={busy} onClick={addWidget}>Zum Layout hinzufügen</Btn>
          </div>

          {done && (
            <div className="banner-ok mt" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              ✅ Hinzugefügt.
              <a className="btn small" href={doneUrl} target="_blank" rel="noopener">▶ Live-Vorschau</a>
              <a className="btn secondary small" href="/layouts">Im Editor feinjustieren ↗</a>
              <Btn variant="secondary" size="small" onClick={() => setDone(false)}>Weiteres hinzufügen</Btn>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
