import React, { useState } from "react";
import { api } from "../../shared/api.js";
import { Btn, Field } from "../../shared/ui.jsx";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/admin/login", { method: "POST", body: { username, password } });
      await onLogin?.();
      window.location.href = "/";
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-box">
        <div className="brandline">
          <span className="logo">🏙</span>
          <div>
            <h1>StadtDashboard</h1>
            <p className="subtitle" style={{ margin: 0 }}>Admin-Zugang</p>
          </div>
        </div>
        <form id="login-form" onSubmit={submit}>
          <Field label="Benutzername">
            <input id="username" autoComplete="username" required autoFocus
              value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Passwort">
            <input id="password" type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Btn type="submit" busy={busy} style={{ width: "100%" }}>Anmelden</Btn>
          {error && <p className="login-error" role="alert">{error}</p>}
        </form>
      </div>
    </div>
  );
}
