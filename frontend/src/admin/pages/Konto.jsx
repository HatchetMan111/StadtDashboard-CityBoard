import React, { useState } from "react";
import { api } from "../../shared/api.js";
import { Field, Panel, Btn, useToast, useBusy } from "../../shared/ui.jsx";

export default function Konto() {
  const toast = useToast();
  const { busy, run } = useBusy();
  const [old, setOld] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (pw1 !== pw2) { toast("Neue Passwörter stimmen nicht überein", true); return; }
    run(async () => {
      await api("/api/admin/password", { method: "PUT", body: { old, new: pw1 } });
      setOld(""); setPw1(""); setPw2("");
      toast("Passwort geändert – Initial-Passwort wurde entfernt");
    });
  };

  return (
    <>
      <h1>Konto</h1>
      <p className="subtitle">Passwort ändern – gilt für alle Geräte mit diesem Zugang.</p>
      <Panel title="Passwort ändern" style={{ maxWidth: 480 }}>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Altes Passwort">
            <input type="password" required value={old} autoComplete="current-password"
              onChange={(e) => setOld(e.target.value)} />
          </Field>
          <Field label="Neues Passwort (min. 8 Zeichen)">
            <input type="password" required minLength={8} value={pw1} autoComplete="new-password"
              onChange={(e) => setPw1(e.target.value)} />
          </Field>
          <Field label="Neues Passwort (Wiederholung)">
            <input type="password" required minLength={8} value={pw2} autoComplete="new-password"
              onChange={(e) => setPw2(e.target.value)} />
          </Field>
          <Btn type="submit" busy={busy}>Passwort ändern</Btn>
        </form>
      </Panel>
    </>
  );
}
