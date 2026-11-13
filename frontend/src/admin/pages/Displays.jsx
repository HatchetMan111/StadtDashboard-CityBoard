import React, { useCallback, useEffect, useState } from "react";
import { api, copyText, fmtDT } from "../../shared/api.js";
import { Badge, Btn, Dot, Empty, Field, Modal, Panel, useBusy, useConfirm, useToast } from "../../shared/ui.jsx";

export default function Displays() {
  const toast = useToast();
  const { busy, run } = useBusy();
  const { confirm, confirmDialog } = useConfirm();
  const [layouts, setLayouts] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [displays, setDisplays] = useState([]);
  const [edit, setEdit] = useState(null);   // Display im Modal
  const [editName, setEditName] = useState("");
  const [editLoc, setEditLoc] = useState("");
  const [editOrient, setEditOrient] = useState("landscape");

  const displayUrl = `${window.location.protocol}//${window.location.host}/display`;

  const reload = useCallback(async () => {
    const [l, s, d] = await Promise.all([
      api("/api/admin/layouts"), api("/api/admin/schedules"), api("/api/admin/displays"),
    ]);
    setLayouts(l); setSchedules(s); setDisplays(d);
  }, []);

  useEffect(() => { reload().catch((e) => toast(e.message, true)); }, [reload, toast]);

  const patch = async (id, body, msg = "Gespeichert") => {
    await run(async () => {
      await api(`/api/admin/displays/${id}`, { method: "PATCH", body });
      toast(msg);
      await reload();
    });
  };

  const action = async (d, act) => {
    if (act === "approve") {
      await run(async () => {
        await api(`/api/admin/displays/${d.id}/approve`, { method: "POST" });
        toast("Display gekoppelt");
        await reload();
      });
    } else if (act === "toggle") {
      const enabled = !d.enabled;
      await patch(d.id, { enabled }, enabled ? "Display entsperrt" : "Display gesperrt");
    } else if (act === "revoke") {
      if (!await confirm("Token zurücksetzen? Das Display muss neu gekoppelt werden.")) return;
      await run(async () => {
        await api(`/api/admin/displays/${d.id}/revoke`, { method: "POST" });
        toast("Token zurückgesetzt");
        await reload();
      });
    } else if (act === "delete") {
      if (!await confirm("Display wirklich löschen?")) return;
      await run(async () => {
        await api(`/api/admin/displays/${d.id}`, { method: "DELETE" });
        toast("Gelöscht");
        await reload();
      });
    } else if (act === "edit") {
      setEdit(d);
      setEditName(d.name || "");
      setEditLoc(d.location || "");
      setEditOrient(d.orientation || "landscape");
    }
  };

  return (
    <>
      <h1>Displays veröffentlichen</h1>
      <p className="subtitle">Geräte koppeln, Layout zuweisen – Inhalte aktualisieren sich live.</p>

      {confirmDialog}

      <Panel className="howto" title="In 3 Schritten auf den Bildschirm">
        <ol style={{ paddingLeft: 22, lineHeight: 1.9, fontSize: 14.5 }}>
          <li><strong>Anzeige-URL am TV/Player öffnen</strong> (Chrome/Firefox im Kiosk-Modus):<br />
            <code style={{ fontSize: 15 }}>{displayUrl}</code>{" "}
            <Btn variant="secondary" size="small" type="button" onClick={async () => {
              const ok = await copyText(displayUrl);
              if (ok) return toast("Anzeige-URL kopiert");
              window.prompt(
                "Automatisches Kopieren wird von diesem Browser blockiert.\n" +
                "Bitte URL markieren und Strg+C drücken:", displayUrl);
              toast("URL angezeigt – bitte manuell kopieren");
            }}>URL kopieren</Btn>
          </li>
          <li><strong>Hier koppeln:</strong> Das Gerät erscheint unten als
            „wartet auf Kopplung“ → Button <em>Koppeln</em> drücken.</li>
          <li><strong>Inhalt zuweisen:</strong> Spalte „Layout / Zeitplan“ im Gerät setzen.
            Fertig – jede Änderung erscheint sofort live (WebSocket), auch offline
            läuft das Display mit dem letzten Stand weiter.</li>
        </ol>
      </Panel>

      <Panel title={`Displays (${displays.length})`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Status</th><th>Display</th><th>Layout / Zeitplan</th><th>Jetzt aktiv</th><th>Aktionen</th></tr>
            </thead>
            <tbody>
              {displays.map((d) => (
                <tr key={d.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Dot kind={!d.approved ? "pending" : d.online ? "online" : "offline"} />
                    {!d.approved ? "wartet auf Kopplung" : d.enabled ? "aktiv" : "gesperrt"}
                    <div className="muted" style={{ fontSize: 12 }}>{d.last_seen ? fmtDT(d.last_seen) : "nie gesehen"}</div>
                  </td>
                  <td>
                    {d.name}<div className="muted">{d.location}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{d.resolution} · {d.orientation}</div>
                  </td>
                  <td>
                    <select value={d.layout_id ?? ""} onChange={(e) =>
                      patch(d.id, { layout_id: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">Standard (Zeitplan)</option>
                      {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                    <select value={d.schedule_id ?? ""} style={{ marginTop: 4 }} onChange={(e) =>
                      patch(d.id, { schedule_id: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">Global</option>
                      {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                  <td>{d.approved && d.effective_layout
                    ? <Badge kind="ok">{d.effective_layout.name}</Badge>
                    : <span className="muted">–</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {!d.approved && <Btn size="small" onClick={() => action(d, "approve")}>Koppeln</Btn>}{" "}
                    <Btn variant="secondary" size="small" onClick={() => action(d, "edit")}>Bearbeiten</Btn>{" "}
                    {d.approved && <Btn variant="secondary" size="small" onClick={() => action(d, "toggle")}>
                      {d.enabled ? "Sperren" : "Entsperren"}</Btn>}{" "}
                    <Btn variant="secondary" size="small" onClick={() => action(d, "revoke")}>Token neu</Btn>{" "}
                    <Btn variant="danger" size="small" onClick={() => action(d, "delete")}>Löschen</Btn>
                  </td>
                </tr>
              ))}
              {!displays.length && (
                <tr><td colSpan={5}>
                  <Empty>Noch keine Displays registriert. Öffne <code>{displayUrl}</code> am Gerät.</Empty>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Modal open={!!edit} onClose={() => setEdit(null)} title="Display bearbeiten"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setEdit(null)}>Abbrechen</Btn>
            <Btn busy={busy} onClick={() => run(async () => {
              await api(`/api/admin/displays/${edit.id}`, {
                method: "PATCH",
                body: { name: editName.trim(), location: editLoc.trim(), orientation: editOrient },
              });
              setEdit(null);
              toast("Gespeichert");
              await reload();
            })}>Speichern</Btn>
          </>
        }>
        {edit && (
          <>
            <Field label="Name">
              <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
            </Field>
            <Field label="Standort" className="mt">
              <input value={editLoc} onChange={(e) => setEditLoc(e.target.value)} />
            </Field>
            <Field label="Ausrichtung" className="mt">
              <select value={editOrient} onChange={(e) => setEditOrient(e.target.value)}>
                <option value="landscape">Querformat</option>
                <option value="portrait">Hochformat</option>
              </select>
            </Field>
          </>
        )}
      </Modal>
    </>
  );
}
