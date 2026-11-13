import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtSize } from "../../shared/api.js";
import { Btn, Empty, Field, Panel, useBusy, useConfirm, useToast } from "../../shared/ui.jsx";

export default function Media() {
  const toast = useToast();
  const { busy, run } = useBusy();
  const { confirm, confirmDialog } = useConfirm();
  const fileRef = useRef(null);
  const [media, setMedia] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [layoutId, setLayoutId] = useState("");
  const [query, setQuery] = useState("");
  const [lastAssigned, setLastAssigned] = useState({});

  const reload = useCallback(async () => {
    const [items, ls] = await Promise.all([
      api("/api/admin/media"),
      api("/api/admin/layouts").catch(() => []),
    ]);
    setMedia(items);
    setLayouts(ls);
    if (ls.length && !layoutId) setLayoutId(String(ls.find((l) => l.is_default)?.id ?? ls[0].id));
  }, [layoutId]);

  useEffect(() => { reload().catch((e) => toast(e.message, true)); /* eslint-disable-line */ }, []);

  const upload = () => run(async () => {
    const files = [...fileRef.current.files];
    if (!files.length) { toast("Keine Datei gewählt", true); return; }
    let ok = 0, failed = 0;
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        await api("/api/admin/media", { method: "POST", body: fd });
        ok += 1;
      } catch (err) {
        failed += 1;
        toast(`${file.name}: ${err.message}`, true);
      }
    }
    if (ok) toast(`${ok} Datei(en) hochgeladen` + (failed ? ` – ${failed} fehlgeschlagen` : ""));
    fileRef.current.value = "";
    await reload();
  });

  const assign = (m, mode) => run(async () => {
    if (!layoutId) { toast("Erst ein Layout wählen", true); return; }
    await api(`/api/admin/media/${m.id}/assign`, {
      method: "POST", body: { layout_id: Number(layoutId), mode },
    });
    setLastAssigned((s) => ({ ...s, [m.id]: Number(layoutId) }));
    toast(mode === "gallery" ? "Zur Galerie hinzugefügt – ▶ Vorschau unten" : "Als Bild gesetzt – ▶ Vorschau unten");
  });

  const del = async (m) => {
    if (!await confirm(`„${m.title || m.original_name}" wirklich löschen?\n\n` +
      "Hinweis: Bilder/Galerien, die dieses Medium verwenden, zeigen danach nichts mehr an.")) return;
    try {
      await api(`/api/admin/media/${m.id}`, { method: "DELETE" });
      setLastAssigned((s) => { const c = { ...s }; delete c[m.id]; return c; });
      await reload();
      toast("Gelöscht");
    } catch (err) { toast(err.message, true); }
  };

  const q = query.trim().toLowerCase();
  const visible = q
    ? media.filter((m) => (m.title || "").toLowerCase().includes(q) || (m.mime || "").toLowerCase().includes(q))
    : media;

  return (
    <>
      {confirmDialog}
      <h1>Medien</h1>
      <p className="subtitle">
        Bilder und Videos für die Displays – alles bleibt lokal gespeichert.
        Bei jedem Medium: <strong>Layout wählen</strong> und direkt
        <strong> „＋ Galerie“</strong> oder <strong>„Als Bild“</strong> zuweisen,
        dann per <strong>▶ Vorschau</strong> ansehen.
      </p>

      <Panel title="Hochladen">
        <div className="inline">
          <Field label="Dateien (JPG, PNG, GIF, WebP, SVG, MP4, WebM · max. 25 MB · Mehrfachauswahl)" style={{ flex: 1 }}>
            <input type="file" multiple ref={fileRef}
              accept=".jpg,.jpeg,.png,.gif,.webp,.svg,.mp4,.webm" />
          </Field>
          <Btn busy={busy} onClick={upload}>Hochladen</Btn>
        </div>
      </Panel>

      <Panel title="Zuweisen an Layout">
        <div className="inline" style={{ alignItems: "center" }}>
          <Field label="Layout">
            <select value={layoutId} onChange={(e) => setLayoutId(e.target.value)}>
              {!layouts.length && <option value="">– noch keine Layouts –</option>}
              {layouts.map((l) =>
                <option key={l.id} value={l.id}>{l.name}{l.is_default ? " (Standard)" : ""}</option>)}
            </select>
          </Field>
          <span className="muted" style={{ flex: 1, fontSize: 13 }}>
            Gilt für alle Zuweisungen unten – „＋ Galerie“ hängt das Medium an die erste
            Galerie des Layouts (legt eine an, falls keine existiert), „Als Bild“ setzt es
            in das erste Bild-Widget.
          </span>
        </div>
      </Panel>

      <Panel>
        <input type="search" placeholder="🔎 Medien durchsuchen …" style={{ maxWidth: 340 }}
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </Panel>

      <div className="media-grid">
        {visible.map((m) => (
          <div className="media-item" key={m.id}>
            {m.kind === "image"
              ? <img src={m.thumb_url || m.url} alt="" loading="lazy" />
              : <video src={m.url} preload="metadata" />}
            <div className="meta">
              <strong title={m.title}>{m.title}</strong>
              <div className="muted">{fmtSize(m.size)} · {m.mime}</div>
            </div>
            <div className="actions">
              <Btn variant="secondary" size="small" onClick={() => assign(m, "gallery")}>＋ Galerie</Btn>
              <Btn variant="secondary" size="small" onClick={() => assign(m, "image")}>Als Bild</Btn>
              {lastAssigned[m.id] &&
                <a className="btn small" target="_blank" rel="noopener"
                  href={`/display?preview=${lastAssigned[m.id]}`}>▶ Vorschau</a>}
              <Btn variant="danger" size="small" onClick={() => del(m)}>Löschen</Btn>
            </div>
          </div>
        ))}
      </div>
      {!visible.length && (
        <Empty>{q ? `Kein Medium passt zu „${q}“.` : "Noch keine Medien hochgeladen."}</Empty>
      )}
    </>
  );
}
