/* UI-Kit: Toasts, Panel, Modal, Buttons, Felder, Bestätigungsdialoge. */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/* ── Toasts ────────────────────────────────────────────────────────────── */
const ToastCtx = createContext(() => {});

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);

  const toast = useCallback((msg, error = false) => {
    const id = ++idRef.current;
    setItems((cur) => [...cur, { id, msg, error }]);
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)),
      error ? 8000 : 4200);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-box" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={"toast" + (t.error ? " error" : "")}
            title="Klicken zum Schließen" onClick={() =>
              setItems((cur) => cur.filter((x) => x.id !== t.id))}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/* Button während eines Requests sperren → Doppelklick-Schutz. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const run = useCallback(async (fn, { silent } = {}) => {
    if (busy) return;
    setBusy(true);
    try { return await fn(); }
    catch (err) { if (!silent) toast(err.message, true); return undefined; }
    finally { setBusy(false); }
  }, [busy, toast]);
  return { busy, run, toast };
}

/* ── Layout-Bausteine ──────────────────────────────────────────────────── */
export function Panel({ title, actions, children, className = "", ...rest }) {
  return (
    <section className={"panel " + className} {...rest}>
      {(title || actions) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Btn({ variant = "", size = "", busy, children, className = "", ...rest }) {
  return (
    <button
      className={`btn ${variant} ${size} ${className}`.trim()}
      disabled={busy || rest.disabled}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children, className = "" }) {
  return (
    <label className={"field " + className}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/* ── Modal (Backdrop-Klick + ESC) ──────────────────────────────────────── */
export function Modal({ open, onClose, title, children, footer, width = 480 }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-x" onClick={onClose} aria-label="Schließen">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* Bestätigungsdialog als Promise (ersetzt window.confirm). */
export function useConfirm() {
  const [state, setState] = useState(null); // {message, resolve}
  const confirm = useCallback((message) =>
    new Promise((resolve) => setState({ message, resolve })), []);
  const settle = (ok) => {
    state?.resolve(ok);
    setState(null);
  };
  const node = state ? (
    <Modal open onClose={() => settle(false)} title="Bitte bestätigen" width={420}>
      <p style={{ whiteSpace: "pre-wrap" }}>{state.message}</p>
      <div className="modal-actions">
        <Btn variant="secondary" onClick={() => settle(false)}>Abbrechen</Btn>
        <Btn variant="danger" onClick={() => settle(true)}>OK</Btn>
      </div>
    </Modal>
  ) : null;
  return { confirm, confirmDialog: node };
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Spinner({ label = "Lade …" }) {
  return <div className="spinner-wrap"><span className="spinner" /> {label}</div>;
}

/* Status-Dot für Displays. */
export function Dot({ kind }) {
  return <span className={"dot " + kind} />;
}

export function Badge({ kind = "", children }) {
  return <span className={"badge " + kind}>{children}</span>;
}
