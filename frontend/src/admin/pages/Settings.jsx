import React, { useCallback, useEffect, useState } from "react";
import { useMe } from "../App.jsx";
import { api } from "../../shared/api.js";
import { Badge, Btn, Field, Panel, useBusy, useConfirm, useToast } from "../../shared/ui.jsx";

const TEXT_KEYS = [
  "city_name", "city_website", "ticker_text", "ticker_speed_seconds", "scene_seconds",
  "weather_mode", "weather_manual_temp", "weather_manual_condition",
  "weather_lat", "weather_lon", "weather_interval_minutes",
  "notify_enabled", "offline_threshold_minutes", "notify_webhook_url",
  "smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from", "notify_email_to",
];

export default function Settings() {
  const me = useMe();
  const toast = useToast();
  const { busy, run } = useBusy();
  const { confirm, confirmDialog } = useConfirm();
  const [values, setValues] = useState({});
  const [media, setMedia] = useState([]);
  const [logoId, setLogoId] = useState("");
  const [users, setUsers] = useState([]);
  const [weatherResult, setWeatherResult] = useState("");
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "editor" });

  const set = (k, v) => setValues((c) => ({ ...c, [k]: v }));

  const reloadUsers = useCallback(async () => {
    const list = await api("/api/admin/users");
    setUsers(list);
  }, []);

  useEffect(() => {
    Promise.all([
      api("/api/admin/settings"),
      api("/api/admin/media").catch(() => []),
    ]).then(([data, ms]) => {
      setValues({ ...Object.fromEntries(TEXT_KEYS.map((k) => [k, ""])), ...data.values });
      setMedia(ms.filter((m) => m.kind === "image"));
      setLogoId(data.values.logo_media_id || "");
    }).catch((e) => toast(e.message, true));
    reloadUsers().catch(() => {});
  }, [toast, reloadUsers]);

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      await api("/api/admin/settings", { method: "PUT", body: { values: { ...values, logo_media_id: logoId } } });
      toast("Einstellungen gespeichert");
    });
  };

  const refreshWeather = () => run(async () => {
    setWeatherResult("Abruf läuft …");
    try {
      const w = await api("/api/admin/weather/refresh", { method: "POST" });
      setWeatherResult(`Quelle: ${w.source}${w.stale ? " (VERALTET)" : ""} · ` +
        `${w.temp_c} °C · ${w.condition}` +
        (w.forecast?.length ? ` · Vorhersage: ${w.forecast.length} Tage` : ""));
    } catch (err) { setWeatherResult("Fehler: " + err.message); }
  }, { silent: true });

  const createUser = () => run(async () => {
    await api("/api/admin/users", {
      method: "POST",
      body: { username: newUser.username.trim(), password: newUser.password, role: newUser.role },
    });
    setNewUser({ username: "", password: "", role: "editor" });
    toast("Benutzer angelegt");
    await reloadUsers();
  });

  const deleteUser = async (u) => {
    if (!await confirm(`Benutzer „${u.username}" wirklich löschen?`)) return;
    try {
      await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
      await reloadUsers();
      toast("Gelöscht");
    } catch (err) { toast(err.message, true); }
  };

  const v = values;
  const logoOptions = media;

  return (
    <>
      {confirmDialog}
      <h1>Einstellungen</h1>
      <p className="subtitle">Stadt, Wetter, Datenschutz und Zugang.</p>

      <form onSubmit={save}>
        <div className="grid-2">
          <Panel title="Allgemein">
            <div className="inline" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <Field label="Stadtname">
                <input value={v.city_name || ""} onChange={(e) => set("city_name", e.target.value)} />
              </Field>
              <Field label="Stadt-Website (QR-Standardziel)">
                <input value={v.city_website || ""} onChange={(e) => set("city_website", e.target.value)} />
              </Field>
              <Field label="Ticker-Text (leer = aus)">
                <input value={v.ticker_text || ""} onChange={(e) => set("ticker_text", e.target.value)} />
              </Field>
              <div className="inline">
                <Field label="Ticker-Geschwindigkeit (Sekunden pro Durchlauf)">
                  <input type="number" min={10} max={300} value={v.ticker_speed_seconds || ""}
                    onChange={(e) => set("ticker_speed_seconds", e.target.value)} />
                </Field>
                <Field label="Wechseldauer Szenen/Bilder (Sekunden, min. 3)">
                  <input type="number" min={3} max={120} value={v.scene_seconds || ""}
                    onChange={(e) => set("scene_seconds", e.target.value)} />
                </Field>
              </div>
              <Field label="Stadtlogo">
                <select value={logoId} onChange={(e) => setLogoId(e.target.value)}>
                  <option value="">Kein Logo</option>
                  {logoOptions.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select>
              </Field>
            </div>
          </Panel>

          <Panel title="Wetter">
            <div className="inline" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <Field label="Modus">
                <select value={v.weather_mode || "manual"} onChange={(e) => set("weather_mode", e.target.value)}>
                  <option value="manual">Manuell (keine externe Verbindung)</option>
                  <option value="open_meteo">Open-Meteo (externer Dienst – benötigt Internet)</option>
                </select>
              </Field>
              <div className="inline">
                <Field label="Temperatur (°C)">
                  <input value={v.weather_manual_temp || ""}
                    onChange={(e) => set("weather_manual_temp", e.target.value)} />
                </Field>
                <Field label="Bedingung" style={{ flex: 1 }}>
                  <input value={v.weather_manual_condition || ""}
                    onChange={(e) => set("weather_manual_condition", e.target.value)} />
                </Field>
              </div>
              <div className="inline">
                <Field label="Breite (Lat)">
                  <input value={v.weather_lat || ""} onChange={(e) => set("weather_lat", e.target.value)} />
                </Field>
                <Field label="Länge (Lon)">
                  <input value={v.weather_lon || ""} onChange={(e) => set("weather_lon", e.target.value)} />
                </Field>
                <Field label="Abrufintervall (Min.)">
                  <input type="number" min={5} value={v.weather_interval_minutes || ""}
                    onChange={(e) => set("weather_interval_minutes", e.target.value)} />
                </Field>
              </div>
              <div>
                <Btn type="button" variant="secondary" busy={busy} onClick={refreshWeather}>
                  Wetter jetzt abrufen (Test)
                </Btn>
              </div>
              {weatherResult && <p className="muted">{weatherResult}</p>}
            </div>
          </Panel>
        </div>

        <Panel title="Datenschutz / Externe Verbindungen">
          <label className="checkbox">
            <input type="checkbox" checked={(v.allow_external || "") === "true"}
              onChange={(e) => set("allow_external", e.target.checked ? "true" : "false")} />
            Externe Dienste erlauben (Wetterabruf via Open-Meteo, RSS-Feeds, öffentliche Webseiten).
            <strong>Nicht aktiviert = vollständig air-gap-fähig.</strong>
          </label>
          <p className="muted mt" style={{ fontSize: 13 }}>
            Ohne diese Option verlässt kein Datenpaket das System: keine externen Fonts,
            keine externen Karten-Tiles, keine CDN-Abfragen.
          </p>
        </Panel>

        <button className="btn" type="submit" disabled={busy}>Einstellungen speichern</button>
      </form>

      <div className="grid-2 mt">
        <Panel title="Benachrichtigungen (Offline-Wächter)">
          <label className="checkbox">
            <input type="checkbox" checked={(v.notify_enabled || "") === "true"}
              onChange={(e) => set("notify_enabled", e.target.checked ? "true" : "false")} />
            Warnen, wenn ein Display länger offline ist
          </label>
          <div className="inline mt">
            <Field label="Schwelle in Minuten">
              <input type="number" min={2} max={1440} value={v.offline_threshold_minutes || ""}
                onChange={(e) => set("offline_threshold_minutes", e.target.value)} />
            </Field>
            <Field label={'Webhook-URL (JSON {"text": …} – z. B. ntfy/Slack/Discord)'} style={{ flex: 1 }}>
              <input value={v.notify_webhook_url || ""} placeholder="https://ntfy.local/themenstadt"
                onChange={(e) => set("notify_webhook_url", e.target.value)} />
            </Field>
          </div>
          <h3 style={{ marginTop: 14, fontSize: 13, color: "var(--muted)" }}>E-Mail (SMTP)</h3>
          <div className="inline">
            <Field label="SMTP-Host" style={{ flex: 1 }}>
              <input value={v.smtp_host || ""} onChange={(e) => set("smtp_host", e.target.value)} />
            </Field>
            <Field label="Port">
              <input type="number" min={1} value={v.smtp_port || ""}
                onChange={(e) => set("smtp_port", e.target.value)} />
            </Field>
          </div>
          <div className="inline mt">
            <Field label="Benutzer" style={{ flex: 1 }}>
              <input value={v.smtp_user || ""} autoComplete="off"
                onChange={(e) => set("smtp_user", e.target.value)} />
            </Field>
            <Field label="Passwort" style={{ flex: 1 }}>
              <input type="password" value={v.smtp_pass || ""} autoComplete="new-password"
                onChange={(e) => set("smtp_pass", e.target.value)} />
            </Field>
          </div>
          <div className="inline mt">
            <Field label="Absender (From)" style={{ flex: 1 }}>
              <input value={v.smtp_from || ""} onChange={(e) => set("smtp_from", e.target.value)} />
            </Field>
            <Field label="Empfänger (To)" style={{ flex: 1 }}>
              <input value={v.notify_email_to || ""} onChange={(e) => set("notify_email_to", e.target.value)} />
            </Field>
          </div>
          <p className="muted mt" style={{ fontSize: 13 }}>
            Wird pro Offline-Episode maximal einmal benachrichtigt; wieder online gemeldete
            Displays werden neu „scharf gestellt“.
          </p>
        </Panel>

        <Panel title="Benutzer & Rollen">
          <p className="muted" style={{ fontSize: 13 }}>
            Administratoren dürfen alles; Redakteure nur Inhalte
            (Bekanntmachungen, Veranstaltungen, Medien inkl. Zuweisung).
          </p>
          <table style={{ marginTop: 8 }}><tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username} <Badge kind={u.role === "admin" ? "info" : ""}>{u.role}</Badge></td>
                <td style={{ textAlign: "right" }}>
                  {u.username !== me.username &&
                    <Btn variant="danger" size="small" onClick={() => deleteUser(u)}>Löschen</Btn>}
                </td>
              </tr>
            ))}
            {!users.length && <tr><td className="muted">Lade …</td></tr>}
          </tbody></table>
          <div className="inline mt">
            <Field label="Benutzername">
              <input value={newUser.username} minLength={3} required
                onChange={(e) => setNewUser((u) => ({ ...u, username: e.target.value }))} />
            </Field>
            <Field label="Passwort (min. 8)">
              <input type="password" value={newUser.password} minLength={8} required
                autoComplete="new-password"
                onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))} />
            </Field>
            <Field label="Rolle">
              <select value={newUser.role}
                onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value }))}>
                <option value="editor">Redakteur</option>
                <option value="admin">Administrator</option>
              </select>
            </Field>
            <Btn busy={busy} onClick={createUser}>Anlegen</Btn>
          </div>
        </Panel>
      </div>

      <Panel title="Backup" className="mt">
        <p className="muted" style={{ fontSize: 13 }}>
          Enthält Datenbank, Einstellungen und alle Medien.
        </p>
        <a className="btn mt" href="/api/admin/backup" download>Backup herunterladen</a>
        <p className="muted mt" style={{ fontSize: 13 }}>
          Restore: Service stoppen → Backup entpacken und <code>stadtdashboard.db</code>,
          <code>settings.json</code> sowie <code>uploads/</code> nach
          <code>/opt/stadtdashboard/data/</code> kopieren → Service starten.
        </p>
      </Panel>
    </>
  );
}
