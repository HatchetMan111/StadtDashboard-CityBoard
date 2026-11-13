import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../shared/api.js";
import { Badge, Btn, Empty, Field, Panel, useBusy, useToast } from "../../shared/ui.jsx";

const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export default function Schedules() {
  const toast = useToast();
  const { busy, run } = useBusy();
  const [schedules, setSchedules] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [editId, setEditId] = useState(null);
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(1);
  const [rules, setRules] = useState([]);

  const reload = useCallback(async () => {
    const [ss, ls] = await Promise.all([api("/api/admin/schedules"), api("/api/admin/layouts")]);
    setSchedules(ss);
    setLayouts(ls);
    return ss;
  }, []);

  useEffect(() => {
    reload()
      .then((ss) => { if (ss.length) startEdit(ss[0], false); })
      .catch((e) => toast(e.message, true));
    /* eslint-disable-next-line */
  }, []);

  const startEdit = (s, scroll = true) => {
    setEditId(s.id);
    setName(s.name);
    setPriority(s.priority);
    setRules((s.rules || []).map((r) => ({ ...r })));
    if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const newSchedule = () => {
    setEditId(null);
    setName("");
    setPriority(1);
    setRules([newRule()]);
  };

  const newRule = () => ({ start: "00:00", end: "23:59", weekdays: [0, 1, 2, 3, 4, 5, 6], layout_id: null });

  const save = () => run(async () => {
    if (!name.trim()) { toast("Name fehlt", true); return; }
    const body = {
      name: name.trim(), priority: Number(priority),
      rules: rules.filter((r) => r.layout_id).map((r) => ({ ...r, layout_id: Number(r.layout_id) })),
    };
    if (editId) {
      await api(`/api/admin/schedules/${editId}`, { method: "PATCH", body });
    } else {
      await api("/api/admin/schedules", { method: "POST", body });
    }
    setEditId(null);
    toast("Zeitplan gespeichert");
    const ss = await reload();
    const cur = ss.find((s) => s.name === body.name);
    if (cur) startEdit(cur, false);
  });

  const del = async (id) => {
    if (!window.confirm("Zeitplan löschen?")) return;
    try {
      await api(`/api/admin/schedules/${id}`, { method: "DELETE" });
      if (editId === id) newSchedule();
      await reload();
      toast("Gelöscht");
    } catch (err) { toast(err.message, true); }
  };

  const setRule = (i, patch) =>
    setRules((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <>
      <h1>Zeitpläne</h1>
      <p className="subtitle">Layouts je Wochentag/Zeitfenster zuweisen – höhere Priorität gewinnt.</p>

      <Panel title={editId ? `Bearbeiten: ${name || `#${editId}`}` : "Neu anlegen"}>
        <div className="inline">
          <Field label="Name" style={{ flex: 1 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Priorität (1–100)">
            <input type="number" min={1} max={100} value={priority}
              onChange={(e) => setPriority(e.target.value)} style={{ width: 110 }} />
          </Field>
          <Btn variant="secondary" onClick={newSchedule}>Neu</Btn>
        </div>

        <div className="mt" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rules.map((r, i) => (
            <div key={i} className="panel rule-row" style={{ margin: 0 }}>
              <div className="inline" style={{ alignItems: "center" }}>
                <Field label="Von">
                  <input type="time" value={r.start}
                    onChange={(e) => setRule(i, { start: e.target.value })} />
                </Field>
                <Field label="Bis">
                  <input type="time" value={r.end}
                    onChange={(e) => setRule(i, { end: e.target.value })} />
                </Field>
                <Field label="Wochentage">
                  <span className="wd-group">
                    {WD.map((n, d) => (
                      <label key={d} className="checkbox">
                        <input type="checkbox" checked={(r.weekdays || []).includes(d)}
                          onChange={(e) => setRule(i, {
                            weekdays: e.target.checked
                              ? [...(r.weekdays || []), d].sort()
                              : (r.weekdays || []).filter((x) => x !== d),
                          })} />{n}
                      </label>
                    ))}
                  </span>
                </Field>
                <Field label="Layout" style={{ flex: 1 }}>
                  <select value={r.layout_id ?? ""} onChange={(e) =>
                    setRule(i, { layout_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">– wählen –</option>
                    {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </Field>
                <Btn variant="danger" size="small"
                  onClick={() => setRules((cur) => cur.filter((_, j) => j !== i))}>✕</Btn>
              </div>
            </div>
          ))}
          <div>
            <Btn variant="secondary" size="small"
              onClick={() => setRules((cur) => [...cur, newRule()])}>＋ Regel hinzufügen</Btn>
          </div>
        </div>

        <div className="mt">
          <Btn busy={busy} onClick={save}>Speichern</Btn>
          {editId && <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
            Änderungen an Zeitplan #{editId}
          </span>}
        </div>
      </Panel>

      <Panel title={`Zeitpläne (${schedules.length})`}>
        <div className="table-wrap">
          <table>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className={editId === s.id ? "editing" : ""}>
                  <td>{s.name} {s.active_now ? <Badge kind="ok">jetzt aktiv</Badge> : ""}
                    <div className="muted">Priorität {s.priority} · {(s.rules || []).length} Regel(n)</div></td>
                  <td className="muted">{(s.rules || []).map((r, i) =>
                    <div key={i}>{r.start}–{r.end}</div>) || "–"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Btn variant="secondary" size="small" onClick={() => startEdit(s)}>Bearbeiten</Btn>{" "}
                    <Btn variant="danger" size="small" onClick={() => del(s.id)}>Löschen</Btn>
                  </td>
                </tr>
              ))}
              {!schedules.length && <tr><td colSpan={3}>
                <Empty>Keine Zeitpläne – Displays zeigen immer das Standardlayout.</Empty>
              </td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
