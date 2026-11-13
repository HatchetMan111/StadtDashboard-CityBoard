import React from "react";
import { api, fmtDT, prioLabel } from "../../shared/api.js";
import { Badge, Field } from "../../shared/ui.jsx";
import CrudList from "./CrudList.jsx";

export default function Announcements() {
  return (
    <>
      <h1>Bekanntmachungen</h1>
      <p className="subtitle">Mit Priorität und Gültigkeitszeitraum – abgelaufene Meldungen verschwinden automatisch.</p>
      <CrudList
        title="Neu anlegen"
        endpoint="/api/admin/announcements"
        form={(v, set) => (
          <>
            <Field label="Titel *" style={{ flex: 2, minWidth: 220 }}>
              <input value={v.title} required maxLength={200}
                onChange={(e) => set("title", e.target.value)} />
            </Field>
            <Field label="Text" style={{ flex: 3, minWidth: 260 }}>
              <textarea rows={2} value={v.body} onChange={(e) => set("body", e.target.value)} />
            </Field>
            <Field label="Priorität">
              <select value={v.priority} onChange={(e) => set("priority", Number(e.target.value))}>
                <option value={1}>Info</option><option value={2}>Kampagne</option>
                <option value={3}>Veranstaltung</option><option value={4}>Wichtig</option>
                <option value={5}>Notfall</option>
              </select>
            </Field>
            <Field label="Gültig ab (leer = sofort)">
              <input type="datetime-local" value={v.valid_from}
                onChange={(e) => set("valid_from", e.target.value)} />
            </Field>
            <Field label="Gültig bis (leer = unbegrenzt)">
              <input type="datetime-local" value={v.valid_until}
                onChange={(e) => set("valid_until", e.target.value)} />
            </Field>
            <Field label="QR-Ziel-URL (optional)">
              <input value={v.qr_url} placeholder="https://…"
                onChange={(e) => set("qr_url", e.target.value)} />
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={v.active} onChange={(e) => set("active", e.target.checked)} />
              Aktiv
            </label>
          </>
        )}
        fill={(v) => ({
          title: v.title, body: v.body, priority: Number(v.priority),
          valid_from: v.valid_from || null, valid_until: v.valid_until || null,
          qr_url: v.qr_url.trim(), active: v.active,
        })}
        reset={() => ({ title: "", body: "", priority: 1, valid_from: "", valid_until: "", qr_url: "", active: true })}
        renderRow={(a) => (
          <>
            <td><span className={`prio p${a.priority}`}>{prioLabel(a.priority)}</span></td>
            <td>{a.title}<div className="muted">{a.body}</div></td>
            <td className="muted">{a.valid_from ? fmtDT(a.valid_from) : "ab sofort"}<br />
              bis {a.valid_until ? fmtDT(a.valid_until) : "unbegrenzt"}</td>
            <td>{a.currently_valid
              ? <Badge kind="ok">aktiv</Badge>
              : <Badge kind={a.active ? "warn" : ""}>{a.active ? "außerhalb Zeitraum" : "inaktiv"}</Badge>}</td>
          </>
        )}
      />
    </>
  );
}
