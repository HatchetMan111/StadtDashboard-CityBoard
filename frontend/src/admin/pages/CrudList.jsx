/* Geteilte CRUD-Liste für Bekanntmachungen und Veranstaltungen:
   Formular oben (Neu/Bearbeiten mit Abbrechen), Tabelle unten. */
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../shared/api.js";
import { Btn, Empty, Panel, useConfirm, useToast } from "../../shared/ui.jsx";

export default function CrudList({ title, endpoint, renderRow, form, fill, reset, filterFn, extraToolbar }) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [items, setItems] = useState([]);
  const [editId, setEditId] = useState(null);
  const [values, setValues] = useState(() => reset());
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const rows = await api(endpoint);
    setItems(rows);
    setLoaded(true);
    return rows;
  }, [endpoint]);

  useEffect(() => { reload().catch((e) => toast(e.message, true)); }, [reload, toast]);

  const setField = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const body = fill(values);
      if (editId) {
        await api(`${endpoint}/${editId}`, { method: "PATCH", body });
      } else {
        await api(endpoint, { method: "POST", body });
      }
      setValues(reset());
      setEditId(null);
      toast("Gespeichert");
      await reload();
    } catch (err) {
      toast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (item) => {
    setEditId(item.id);
    setValues(Object.fromEntries(Object.entries(form(item)).map(([k, v]) => [k, v])));
    document.getElementById("crud-form-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const del = async (id) => {
    if (!await confirm("Wirklich löschen?")) return;
    try {
      await api(`${endpoint}/${id}`, { method: "DELETE" });
      toast("Gelöscht");
      if (editId === id) { setEditId(null); setValues(reset()); }
      await reload();
    } catch (err) {
      toast(err.message, true);
    }
  };

  const visible = filterFn ? filterFn(items) : items;

  return (
    <>
      {confirmDialog}
      <Panel title={title}>
        <form id="crud-form-panel" onSubmit={submit} className="inline">
          {form(values, setField, editId)}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Btn type="submit" busy={busy}>{editId ? "Änderungen speichern" : "Hinzufügen"}</Btn>
            {editId && (
              <Btn type="button" variant="secondary"
                onClick={() => { setEditId(null); setValues(reset()); }}>
                Abbrechen
              </Btn>
            )}
          </div>
        </form>
        {editId && <p className="muted mt" style={{ fontSize: 13 }}>
          Bearbeitungsmodus – Änderungen betreffen den Eintrag #{editId}.
        </p>}
      </Panel>

      {extraToolbar}

      <Panel>
        <div className="table-wrap">
          <table>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className={editId === r.id ? "editing" : ""}>
                  {renderRow(r)}
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Btn variant="secondary" size="small" onClick={() => startEdit(r)}>Bearbeiten</Btn>{" "}
                    <Btn variant="danger" size="small" onClick={() => del(r.id)}>Löschen</Btn>
                  </td>
                </tr>
              ))}
              {loaded && !visible.length && (
                <tr><td colSpan={5}>
                  <Empty>{items.length ? "Keine Treffer für den Filter." : "Noch keine Einträge."}</Empty>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
