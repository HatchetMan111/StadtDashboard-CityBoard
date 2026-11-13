import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDT, prioLabel } from "../../shared/api.js";
import { Dot, Empty, Panel, useToast } from "../../shared/ui.jsx";

export default function Dashboard({ onVersion }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [pwWarn, setPwWarn] = useState(false);

  useEffect(() => {
    /* Einzelne Catches: wenn z. B. Medien 500 liefert, stirbt nicht die
       ganze Seite, sondern nur der betreffende Kasten bleibt leer. */
    const grab = (path, fallback) =>
      api(path).catch((e) => { toast(e.message, true); return fallback; });

    Promise.all([
      grab("/api/admin/displays", []),
      grab("/api/admin/announcements", []),
      grab("/api/admin/events", []),
      api("/api/admin/status").catch(() => ({})),
      grab("/api/admin/media", []),
      grab("/api/admin/layouts", []),
      grab("/api/admin/schedules", []),
    ]).then(([displays, anns, events, status, media, layouts, schedules]) => {
      setPwWarn(!!status.initial_password_active);
      onVersion?.(status.version || "");
      setData({ displays, anns, events, media, layouts, schedules });
    });
  }, [toast, onVersion]);

  if (!data) return <SpinnerOrEmpty />;

  const { displays, anns, events, media, layouts, schedules } = data;

  /* Einrichtungs-Checkliste */
  const mediaAssigned = layouts.some((l) => (l.elements || []).some((e) =>
    (e.type === "gallery" && (e.config?.media_ids || []).length) ||
    (e.type === "image" && e.config?.media_id)));
  const paired = displays.some((d) => d.approved);
  const steps = [
    { done: media.length > 0, label: "Medien hochladen", href: "/media", cta: "Medien" },
    { done: mediaAssigned, label: "Layout mit Medien füllen", href: "/layouts", cta: "Layout-Editor" },
    { done: paired, label: "Display koppeln & veröffentlichen", href: "/displays", cta: "Displays" },
    { done: schedules.length > 0, label: "Optional: Zeitplan für Tageszeiten", href: "/schedules", cta: "Zeitpläne" },
  ];

  const online = displays.filter((d) => d.online && d.approved).length;
  const pending = displays.filter((d) => !d.approved).length;
  const activeAnns = anns.filter((a) => a.currently_valid);
  const upcoming = events.filter((e) => new Date(e.start_at) > new Date(Date.now() - 3 * 3600 * 1000));

  return (
    <>
      <h1>Dashboard</h1>
      <p className="subtitle">Übersicht über Displays und Inhalte</p>

      {pwWarn && (
        <div className="banner-warn">
          ⚠️ Sie verwenden noch das <strong>Initial-Passwort</strong>.
          Bitte jetzt unter <Link to="/settings">Einstellungen → Passwort ändern</Link> ändern.
        </div>
      )}

      <Panel title="Einrichtung – was fehlt noch?">
        <ul className="setup">
          {steps.map((s) => (
            <li key={s.label} className={s.done ? "done" : ""}>
              <span className="lbl">{s.label}</span>
              {!s.done && <> – <Link to={s.href}>jetzt in {s.cta} →</Link></>}
            </li>
          ))}
        </ul>
      </Panel>

      <div className="cards">
        <div className="card"><div className="num">{online}/{displays.length}</div>
          <div className="label">Displays online / gesamt</div></div>
        <div className="card"><div className="num">{pending}</div>
          <div className="label">Displays warten auf Kopplung</div></div>
        <div className="card"><div className="num">{activeAnns.length}</div>
          <div className="label">Aktive Bekanntmachungen</div></div>
        <div className="card"><div className="num">{upcoming.length}</div>
          <div className="label">Kommende Veranstaltungen</div></div>
      </div>

      <div className="grid-2">
        <Panel title="Displays">
          <table><tbody>
            {displays.map((d) => (
              <tr key={d.id}>
                <td><Dot kind={!d.approved ? "pending" : d.online ? "online" : "offline"} />
                  {!d.approved ? "wartet" : d.online ? "online" : "offline"}</td>
                <td>{d.name}<div className="muted">{d.location}</div></td>
                <td>{d.last_seen ? fmtDT(d.last_seen) : "nie"}</td>
              </tr>
            ))}
            {!displays.length && (
              <tr><td colSpan={3} className="muted">Noch keine Displays.
                Öffne <a href="/display" target="_blank" rel="noopener">/display</a> auf einem Gerät.</td></tr>
            )}
          </tbody></table>
        </Panel>
        <Panel title="Aktive Bekanntmachungen">
          <table><tbody>
            {activeAnns.slice(0, 6).map((a) => (
              <tr key={a.id}>
                <td><span className={`prio p${a.priority}`}>{prioLabel(a.priority)}</span></td>
                <td>{a.title}</td>
              </tr>
            ))}
            {!activeAnns.length && <tr><td className="muted">Keine aktiven Bekanntmachungen.</td></tr>}
          </tbody></table>
        </Panel>
      </div>
      <div className="mt" />
      <Panel title="Kommende Veranstaltungen">
        <table><tbody>
          {upcoming.slice(0, 6).map((e) => (
            <tr key={e.id}>
              <td>{fmtDT(e.start_at)}</td>
              <td>{e.title}<div className="muted">{e.location}</div></td>
            </tr>
          ))}
          {!upcoming.length && <tr><td className="muted">Keine kommenden Veranstaltungen.</td></tr>}
        </tbody></table>
      </Panel>
    </>
  );
}

function SpinnerOrEmpty() {
  return <div className="spinner-wrap" style={{ padding: 30 }}><span className="spinner" /> Lade Übersicht …</div>;
}
