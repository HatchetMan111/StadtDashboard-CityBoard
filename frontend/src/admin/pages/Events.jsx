import React, { useMemo, useState } from "react";
import { api, fmtDT } from "../../shared/api.js";
import { Badge, Btn, Field, Panel, useBusy, useToast } from "../../shared/ui.jsx";
import CrudList from "./CrudList.jsx";

export default function Events() {
  const toast = useToast();
  const { busy, run } = useBusy();
  const [icsResult, setIcsResult] = useState("");
  const [search, setSearch] = useState("");
  const [hidePast, setHidePast] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const importIcs = (file, url) => run(async () => {
    if (!file && !url) { toast("Bitte ICS-Datei wählen oder URL eingeben", true); return; }
    setIcsResult("Importiere …");
    try {
      const body = file ? { ics_text: await file.text() } : { url };
      const res = await api("/api/admin/events/import", { method: "POST", body });
      setIcsResult(
        `${res.imported} importiert · ${res.duplicates} Duplikate übersprungen · ` +
        `${res.past} vergangene ignoriert` + (res.invalid ? ` · ${res.invalid} ungültig` : ""));
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setIcsResult("Fehler: " + err.message);
      toast(err.message, true);
    }
  });

  const filterFn = useMemo(() => (items) => {
    const q = search.trim().toLowerCase();
    return items.filter((e) => {
      if (hidePast && new Date(e.start_at) < new Date(Date.now() - 3 * 3600 * 1000)) return false;
      if (!q) return true;
      return [e.title, e.description, e.location, e.category]
        .some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [search, hidePast]);

  return (
    <>
      <h1>Veranstaltungen</h1>
      <p className="subtitle">Lokaler Veranstaltungskalender für die Displays.</p>

      <Panel title="Aus Kalender importieren (iCal/ICS)">
        <div className="inline">
          <Field label="ICS-Datei">
            <input type="file" accept=".ics,text/calendar"
              onChange={(e) => { if (e.target.files[0]) importIcs(e.target.files[0], null); }} />
          </Field>
          <Field label="… oder URL (benötigt aktivierten externen Zugriff)" style={{ flex: 1 }}>
            <input placeholder="https://www.stadt.de/veranstaltungen.ics" id="ics-url" />
          </Field>
          <Btn busy={busy} onClick={() =>
            importIcs(null, document.getElementById("ics-url").value.trim())}>
            URL importieren
          </Btn>
        </div>
        <p className="muted mt" style={{ fontSize: 13 }}>
          Duplikate (gleicher Titel + Start) werden übersprungen; vergangene Termine
          bleiben außen vor. Datei-Import funktioniert ohne externe Freigabe.
        </p>
        {icsResult && <p className="mt" style={{ fontWeight: 600 }}>{icsResult}</p>}
      </Panel>

      <CrudList
        key={refreshKey}
        title="Neu anlegen"
        endpoint="/api/admin/events"
        filterFn={filterFn}
        extraToolbar={
          <Panel className="filter-panel">
            <div className="inline" style={{ alignItems: "center" }}>
              <Field label="Suche" style={{ flex: 1, minWidth: 220 }}>
                <input type="search" placeholder="🔎 Titel, Ort, Kategorie …"
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </Field>
              <label className="checkbox">
                <input type="checkbox" checked={hidePast}
                  onChange={(e) => setHidePast(e.target.checked)} />
                Vergangene ausblenden
              </label>
            </div>
          </Panel>
        }
        form={(v, set) => (
          <>
            <Field label="Titel *" style={{ flex: 2, minWidth: 200 }}>
              <input value={v.title} required maxLength={200}
                onChange={(e) => set("title", e.target.value)} />
            </Field>
            <Field label="Beschreibung" style={{ flex: 3, minWidth: 220 }}>
              <textarea rows={2} value={v.description}
                onChange={(e) => set("description", e.target.value)} />
            </Field>
            <Field label="Beginn *">
              <input type="datetime-local" required value={v.start_at}
                onChange={(e) => set("start_at", e.target.value)} />
            </Field>
            <Field label="Ende (optional)">
              <input type="datetime-local" value={v.end_at}
                onChange={(e) => set("end_at", e.target.value)} />
            </Field>
            <Field label="Ort">
              <input value={v.location} onChange={(e) => set("location", e.target.value)} />
            </Field>
            <Field label="Kategorie">
              <input value={v.category} onChange={(e) => set("category", e.target.value)} />
            </Field>
            <Field label="Website">
              <input value={v.website} placeholder="https://…"
                onChange={(e) => set("website", e.target.value)} />
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={v.featured}
                onChange={(e) => set("featured", e.target.checked)} />
              Highlight
            </label>
          </>
        )}
        fill={(v) => ({
          title: v.title, description: v.description,
          start_at: v.start_at, end_at: v.end_at || null,
          location: v.location, category: v.category.trim() || "Allgemein",
          website: v.website.trim(), featured: v.featured,
        })}
        reset={() => ({ title: "", description: "", start_at: "", end_at: "", location: "", category: "Allgemein", website: "", featured: false })}
        renderRow={(e) => (
          <>
            <td>{fmtDT(e.start_at)}{e.end_at ? <><br />bis {fmtDT(e.end_at)}</> : ""}</td>
            <td>{e.title}{e.featured ? <> <Badge kind="ok">Highlight</Badge></> : ""}
              <div className="muted">{e.description}</div></td>
            <td>{e.location}<div><Badge>{e.category}</Badge></div></td>
            <td></td>
          </>
        )}
      />
    </>
  );
}
