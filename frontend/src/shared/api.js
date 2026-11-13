/* API-Wrapper: einheitliche Fehler, 401 → Login-Redirect, JSON-Encoding. */

export async function api(path, opts = {}) {
  const config = { headers: {}, ...opts };
  if (opts.body && !(opts.body instanceof FormData)) {
    config.headers["Content-Type"] = "application/json";
    config.body = JSON.stringify(opts.body);
  }
  const resp = await fetch(path, config);
  if (resp.status === 401 && !opts.noRedirect && !path.endsWith("/login")
      && !path.includes("/api/display/")) {
    window.location.href = "/login";
    throw new Error("Nicht angemeldet");
  }
  let data = null;
  try { data = await resp.json(); } catch { /* leerer Body */ }
  if (!resp.ok) {
    const detail = data && data.detail ? data.detail : `HTTP ${resp.status}`;
    if (Array.isArray(detail)) {
      throw new Error(detail.map((d) => d.msg || JSON.stringify(d)).join("; "));
    }
    throw new Error(String(detail));
  }
  return data;
}

export function fmtDT(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

export function fmtD(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", {
    weekday: "short", day: "2-digit", month: "2-digit", year: "numeric",
  });
}

export function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return Math.round(bytes / 1024) + " KB";
}

export function prioLabel(p) {
  return { 5: "Notfall", 4: "Wichtig", 3: "Veranstaltung", 2: "Kampagne", 1: "Info" }[p] || p;
}

/* Clipboard mit execCommand-Fallback (http-LAN ist kein Secure Context). */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fällt durch zum Fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
