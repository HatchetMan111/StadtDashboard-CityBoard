/* StadtDashboard Admin – Vanilla JS, keine externen Abhängigkeiten */
(function () {
  "use strict";

  const SB = {
    _inited: false,

    async api(path, opts = {}) {
      const config = {
        headers: {},
        ...opts,
      };
      if (opts.body && !(opts.body instanceof FormData)) {
        config.headers["Content-Type"] = "application/json";
        config.body = JSON.stringify(opts.body);
      }
      const resp = await fetch(path, config);
      if (resp.status === 401 && !path.endsWith("/login")) {
        location.href = "/login";
        throw new Error("Nicht angemeldet");
      }
      let data = null;
      try { data = await resp.json(); } catch { /* leer */ }
      if (!resp.ok) {
        const detail = data && data.detail ? data.detail : `HTTP ${resp.status}`;
        if (Array.isArray(detail)) {
          throw new Error(detail.map(d => d.msg || JSON.stringify(d)).join("; "));
        }
        throw new Error(String(detail));
      }
      return data;
    },

    toast(msg, error = false) {
      const box = document.getElementById("toast");
      const t = document.createElement("div");
      t.className = "toast" + (error ? " error" : "");
      t.textContent = msg;
      t.title = "Klicken zum Schließen";
      t.addEventListener("click", () => t.remove());
      box.appendChild(t);
      setTimeout(() => t.remove(), error ? 8000 : 4200);
    },

    /* Clipboard mit Fallback: navigator.clipboard gibt es nur in Secure
       Contexts (HTTPS/localhost) – im LAN per http also execCommand. */
    async copyText(text) {
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
    },

    esc(s) {
      return String(s ?? "").replace(/[&<>"']/g,
        c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    },

    /* Button während eines Requests sperren → schützt vor Doppelklicks
       (Doppel-Uploads, doppelt angelegte Objekte …). */
    async withBusy(btn, fn) {
      if (btn && btn.disabled) return;
      if (btn) btn.disabled = true;
      try { return await fn(); }
      catch (err) { this.toast(err.message, true); }
      finally { if (btn) btn.disabled = false; }
    },

    fmtDT(iso) {
      if (!iso) return "–";
      const d = new Date(iso);
      return d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
    },
    fmtD(iso) {
      if (!iso) return "–";
      const d = new Date(iso);
      return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit",
        month: "2-digit", year: "numeric" });
    },
    fmtTime(iso) {
      return new Date(iso).toLocaleTimeString("de-DE",
        { hour: "2-digit", minute: "2-digit" });
    },

    fmtSize(bytes) {
      if (!bytes) return "";
      if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
      return Math.round(bytes / 1024) + " KB";
    },

    prioLabel(p) {
      return { 5: "Notfall", 4: "Wichtig", 3: "Veranstaltung", 2: "Kampagne",
        1: "Info" }[p] || p;
    },

    async initPage() {
      if (this._inited) return;
      this._inited = true;
      const page = document.body.dataset.page;

      const logoutBtn = document.getElementById("logout-btn");
      if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
          await this.api("/api/admin/logout", { method: "POST" });
          location.href = "/login";
        });
      }
      document.querySelectorAll(".sidebar nav a").forEach(a => {
        if (a.dataset.nav === page) a.classList.add("active");
      });

      const handlers = {
        login: () => this.pageLogin(),
        dashboard: () => this.pageDashboard(),
        displays: () => this.pageDisplays(),
        announcements: () => this.pageAnnouncements(),
        events: () => this.pageEvents(),
        media: () => this.pageMedia(),
        gestalten: () => this.pageGestalten(),
        layouts: () => this.pageLayouts(),
        schedules: () => this.pageSchedules(),
        settings: () => this.pageSettings(),
        konto: () => this.pageKonto(),
        datenschutz: () => this.pageDatenschutz(),
      };
      if (handlers[page]) await handlers[page]();
    },

    /* ── Login ─────────────────────────────────────────────────────────── */
    pageLogin() {
      const form = document.getElementById("login-form");
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errEl = document.getElementById("login-error");
        errEl.classList.add("hidden");
        try {
          await this.api("/api/admin/login", {
            method: "POST",
            body: {
              username: form.username.value.trim(),
              password: form.password.value,
            },
          });
          location.href = "/";
        } catch (err) {
          errEl.textContent = err.message;
          errEl.classList.remove("hidden");
        }
      });
    },

    /* ── Dashboard ─────────────────────────────────────────────────────── */
    async pageDashboard() {
      try {
        // Einzelne Catches: wenn z. B. Medien 500 liefert, stirbt nicht die
        // ganze Seite, sondern nur der betreffende Kasten bleibt leer.
        const [displays, anns, events, status, media, layouts, schedules] =
          await Promise.all([
            this.api("/api/admin/displays").catch((e) => { this.toast(e.message, true); return []; }),
            this.api("/api/admin/announcements").catch((e) => { this.toast(e.message, true); return []; }),
            this.api("/api/admin/events").catch((e) => { this.toast(e.message, true); return []; }),
            this.api("/api/admin/status").catch(() => ({})),
            this.api("/api/admin/media").catch(() => []),
            this.api("/api/admin/layouts").catch(() => []),
            this.api("/api/admin/schedules").catch(() => []),
          ]);
        if (status.initial_password_active) {
          document.getElementById("pw-banner").classList.remove("hidden");
        }

        /* Einrichtungs-Checkliste */
        const mediaAssigned = layouts.some((l) => (l.elements || []).some((e) =>
          (e.type === "gallery" && (e.config?.media_ids || []).length) ||
          (e.type === "image" && e.config?.media_id)));
        const paired = displays.some((d) => d.approved);
        const steps = [
          { done: media.length > 0, label: "Medien hochladen",
            href: "/media", cta: "Medien" },
          { done: mediaAssigned, label: "Layout mit Medien füllen",
            href: "/layouts", cta: "Layout-Editor" },
          { done: paired, label: "Display koppeln & veröffentlichen",
            href: "/displays", cta: "Displays" },
          { done: schedules.length > 0,
            label: "Optional: Zeitplan für Tageszeiten",
            href: "/schedules", cta: "Zeitpläne" },
        ];
        document.getElementById("setup-list").innerHTML = steps.map((s) => `
          <li class="${s.done ? "done" : ""}">
            <span class="lbl">${this.esc(s.label)}</span>
            ${s.done ? "" :
              ` – <a href="${s.href}">jetzt in ${s.cta} →</a>`}
          </li>`).join("");
        const online = displays.filter(d => d.online && d.approved).length;
        const pending = displays.filter(d => !d.approved).length;
        const activeAnns = anns.filter(a => a.currently_valid);
        const upcoming = events.filter(e => new Date(e.start_at)
          > new Date(Date.now() - 3 * 3600 * 1000));

        document.getElementById("stat-displays").textContent =
          `${online}/${displays.length}`;
        document.getElementById("stat-pending").textContent = pending;
        document.getElementById("stat-anns").textContent = activeAnns.length;
        document.getElementById("stat-events").textContent = upcoming.length;

        const tbody = document.getElementById("dash-displays");
        tbody.innerHTML = displays.map(d => `
          <tr>
            <td><span class="dot ${!d.approved ? "pending" : d.online ? "online" : "offline"}"></span>
                ${!d.approved ? "wartet" : d.online ? "online" : "offline"}</td>
            <td>${this.esc(d.name)}<div class="muted">${this.esc(d.location)}</div></td>
            <td>${d.last_seen ? this.fmtDT(d.last_seen) : "nie"}</td>
          </tr>`).join("") ||
          `<tr><td colspan="3" class="muted">Noch keine Displays.
             Öffne <a href="/display" target="_blank">/display</a> auf einem Gerät.</td></tr>`;

        const annList = document.getElementById("dash-anns");
        annList.innerHTML = activeAnns.slice(0, 6).map(a => `
          <tr><td><span class="prio p${a.priority}">${this.prioLabel(a.priority)}</span></td>
              <td>${this.esc(a.title)}</td></tr>`).join("") ||
          `<tr><td class="muted">Keine aktiven Bekanntmachungen.</td></tr>`;

        const evList = document.getElementById("dash-events");
        evList.innerHTML = upcoming.slice(0, 6).map(e => `
          <tr><td>${this.fmtDT(e.start_at)}</td><td>${this.esc(e.title)}
              <div class="muted">${this.esc(e.location)}</div></td></tr>`).join("") ||
          `<tr><td class="muted">Keine kommenden Veranstaltungen.</td></tr>`;
      } catch (err) {
        this.toast(err.message, true);
      }
    },

    /* ── Displays ──────────────────────────────────────────────────────── */
    async pageDisplays() {
      const displayUrl = `${location.protocol}//${location.host}/display`;
      document.getElementById("display-url").textContent = displayUrl;
      document.getElementById("copy-display-url").addEventListener("click",
        async () => {
          const ok = await this.copyText(displayUrl);
          if (ok) {
            this.toast("Anzeige-URL kopiert");
            return;
          }
          // Letzter Fallback: manuelles Markieren im Dialog
          const typed = prompt(
            "Automatisches Kopieren wird von diesem Browser blockiert.\n" +
            "Bitte URL markieren und Strg+C drücken:", displayUrl);
          if (typed !== null) this.toast("URL angezeigt – bitte manuell kopieren");
        });

      let layouts = [], schedules = [], displays = [];
      const reload = async () => {
        [layouts, schedules] = await Promise.all([
          this.api("/api/admin/layouts"), this.api("/api/admin/schedules")]);
        displays = await this.api("/api/admin/displays");
        render(displays);
      };
      const layoutOpts = sel => ["<option value=''>Standard (Zeitplan)</option>"]
        .concat(layouts.map(l =>
          `<option value="${l.id}" ${sel === l.id ? "selected" : ""}>${this.esc(l.name)}</option>`))
        .join("");
      const scheduleOpts = sel => ["<option value=''>Global</option>"]
        .concat(schedules.map(s =>
          `<option value="${s.id}" ${sel === s.id ? "selected" : ""}>${this.esc(s.name)}</option>`))
        .join("");

      const render = rows => {
        const tbody = document.getElementById("display-rows");
        tbody.innerHTML = rows.map(d => `
          <tr data-id="${d.id}">
            <td><span class="dot ${!d.approved ? "pending" : d.online ? "online" : "offline"}"></span>
                ${!d.approved ? "wartet auf Kopplung" : d.enabled ? "aktiv" : "gesperrt"}
                <div class="muted">${d.last_seen ? this.fmtDT(d.last_seen) : "nie gesehen"}</div></td>
            <td>${this.esc(d.name)}<div class="muted">${this.esc(d.location)}</div>
                <div class="muted">${this.esc(d.resolution)} · ${this.esc(d.orientation)}</div></td>
            <td><select data-act="layout">${layoutOpts(d.layout_id)}</select>
                <select data-act="schedule" style="margin-top:4px">${scheduleOpts(d.schedule_id)}</select></td>
            <td>${d.approved && d.effective_layout
              ? `<span class="badge ok">${this.esc(d.effective_layout.name)}</span>`
              : '<span class="muted">–</span>'}</td>
            <td style="white-space:nowrap">
              ${!d.approved ? `<button class="btn small" data-act="approve">Koppeln</button>` : ""}
              <button class="btn secondary small" data-act="edit">Bearbeiten</button>
              ${d.approved ? `<button class="btn secondary small" data-act="toggle">
                    ${d.enabled ? "Sperren" : "Entsperren"}</button>` : ""}
              <button class="btn secondary small" data-act="revoke">Token neu</button>
              <button class="btn danger small" data-act="delete">Löschen</button>
            </td>
          </tr>`).join("") ||
          `<tr><td colspan="5" class="muted">Noch keine Displays registriert.
             Öffne <code>http://SERVER:8080/display</code> am Gerät.</td></tr>`;
      };

      document.getElementById("display-rows").addEventListener("change", async e => {
        const tr = e.target.closest("tr[data-id]");
        if (!tr || e.target.tagName !== "SELECT") return;
        const field = e.target.dataset.act === "layout" ? "layout_id" : "schedule_id";
        const val = e.target.value ? Number(e.target.value) : null;
        await this.withBusy(e.target, async () => {
          await this.api(`/api/admin/displays/${tr.dataset.id}`,
            { method: "PATCH", body: { [field]: val } });
          this.toast("Gespeichert");
          await reload();   // „Jetzt aktiv“-Spalte frisch halten
        });
      });

      document.getElementById("display-rows").addEventListener("click", async e => {
        const btn = e.target.closest("button[data-act]");
        if (!btn) return;
        const tr = btn.closest("tr[data-id]");
        const id = tr.dataset.id;
        const act = btn.dataset.act;
        try {
          if (act === "approve") {
            await this.api(`/api/admin/displays/${id}/approve`, { method: "POST" });
            this.toast("Display gekoppelt");
          } else if (act === "toggle") {
            const d = displays.find(x => String(x.id) === id);
            const enabled = !d?.enabled;   // aus Datenzustand, nicht Label
            await this.api(`/api/admin/displays/${id}`,
              { method: "PATCH", body: { enabled } });
            this.toast(enabled ? "Display entsperrt" : "Display gesperrt");
          } else if (act === "revoke") {
            if (!confirm("Token zurücksetzen? Das Display muss neu gekoppelt werden.")) return;
            await this.api(`/api/admin/displays/${id}/revoke`, { method: "POST" });
          } else if (act === "delete") {
            if (!confirm("Display wirklich löschen?")) return;
            await this.api(`/api/admin/displays/${id}`, { method: "DELETE" });
          } else if (act === "edit") {
            openEdit(id);
            return;
          }
          await reload();
        } catch (err) { this.toast(err.message, true); }
      });

      const modal = document.getElementById("display-modal");
      const openEdit = id => {
        const d = displays.find(x => String(x.id) === String(id));
        if (!d) return;
        modal.dataset.id = d.id;
        modal.dname.value = d.name || "";
        modal.dloc.value = d.location || "";
        modal.dorient.value = d.orientation || "landscape";
        modal.classList.add("open");
        modal.dname.focus();
      };
      const closeModal = () => modal.classList.remove("open");
      document.getElementById("display-modal-cancel")
        .addEventListener("click", closeModal);
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();   // Backdrop-Klick
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.classList.contains("open")) closeModal();
      });
      document.getElementById("display-modal-save").addEventListener("click", (e) => {
        this.withBusy(e.target, async () => {
          await this.api(`/api/admin/displays/${modal.dataset.id}`, {
            method: "PATCH",
            body: { name: modal.dname.value.trim(), location: modal.dloc.value.trim(),
              orientation: modal.dorient.value },
          });
          modal.classList.remove("open");
          this.toast("Gespeichert");
          await reload();
        });
      });

      await reload().catch(err => this.toast(err.message, true));
    },

    /* ── Bekanntmachungen ──────────────────────────────────────────────── */
    pageAnnouncements() { this._crudList({
      listId: "ann-rows", formId: "ann-form", endpoint: "/api/admin/announcements",
      rowHtml: a => `
        <td><span class="prio p${a.priority}">${this.prioLabel(a.priority)}</span></td>
        <td>${this.esc(a.title)}<div class="muted">${this.esc(a.body)}</div></td>
        <td class="muted">${a.valid_from ? this.fmtDT(a.valid_from) : "ab sofort"}<br>
            bis ${a.valid_until ? this.fmtDT(a.valid_until) : "unbegrenzt"}</td>
        <td>${a.currently_valid
          ? '<span class="badge ok">aktiv</span>'
          : `<span class="badge ${a.active ? "warn" : ""}">${a.active ? "außerhalb Zeitraum" : "inaktiv"}</span>`}</td>`,
      fill: f => ({
        title: f.title.value, body: f.body.value,
        priority: Number(f.priority.value),
        valid_from: f.valid_from.value || null,
        valid_until: f.valid_until.value || null,
        qr_url: f.qr_url.value.trim(), active: f.active.checked,
      }),
      resetForm: f => { f.reset(); f.priority.value = "1"; f.active.checked = true; },
    }); },

    /* ── Veranstaltungen ───────────────────────────────────────────────── */
    pageEvents() {
      const resultEl = document.getElementById("ics-result");
      document.getElementById("ics-import").addEventListener("click", (e) => {
        this.withBusy(e.target, async () => {
        const fileIn = document.getElementById("ics-file");
        const url = document.getElementById("ics-url").value.trim();
        if (!fileIn.files.length && !url) {
          return this.toast("Bitte ICS-Datei wählen oder URL eingeben", true);
        }
        resultEl.textContent = "Importiere …";
        try {
          let body;
          if (fileIn.files.length) {
            body = { ics_text: await fileIn.files[0].text() };
          } else {
            body = { url };
          }
          const res = await this.api("/api/admin/events/import",
            { method: "POST", body });
          resultEl.textContent =
            `${res.imported} importiert · ${res.duplicates} Duplikate übersprungen · ` +
            `${res.past} vergangene ignoriert` +
            (res.invalid ? ` · ${res.invalid} ungültig` : "");
          fileIn.value = "";
          document.getElementById("ics-url").value = "";
          window.dispatchEvent(new Event("sb-reload-ev-rows"));
        } catch (err) { resultEl.textContent = "Fehler: " + err.message; }
        });
      });

      const searchEl = document.getElementById("ev-search");
      const hidePastEl = document.getElementById("ev-hide-past");
      const applyEvFilter = (items) => {
        const q = (searchEl?.value || "").trim().toLowerCase();
        const hidePast = hidePastEl?.checked;
        return items.filter((e) => {
          if (hidePast && new Date(e.start_at) < new Date(Date.now() - 3 * 3600 * 1000)) {
            return false;
          }
          if (!q) return true;
          return [e.title, e.description, e.location, e.category]
            .some((v) => (v || "").toLowerCase().includes(q));
        });
      };
      searchEl?.addEventListener("input", () =>
        document.dispatchEvent(new CustomEvent("sb-filter-ev")));
      hidePastEl?.addEventListener("change", () =>
        document.dispatchEvent(new CustomEvent("sb-filter-ev")));

      this._crudList({
      listId: "ev-rows", formId: "ev-form", endpoint: "/api/admin/events",
      applyFilter: applyEvFilter, filterEvent: "sb-filter-ev",
      rowHtml: e => `
        <td>${this.fmtDT(e.start_at)}${e.end_at ? "<br>bis " + this.fmtDT(e.end_at) : ""}</td>
        <td>${this.esc(e.title)}${e.featured ? ' <span class="badge ok">Highlight</span>' : ""}
            <div class="muted">${this.esc(e.description)}</div></td>
        <td>${this.esc(e.location)}<div class="badge">${this.esc(e.category)}</div></td>
        <td></td>`,
      fill: f => ({
        title: f.title.value, description: f.description.value,
        start_at: f.start_at.value, end_at: f.end_at.value || null,
        location: f.location.value, category: f.category.value.trim() || "Allgemein",
        website: f.website.value.trim(), featured: f.featured.checked,
      }),
      resetForm: f => { f.reset(); f.category.value = "Allgemein"; },
    }); },

    async _crudList(cfg) {
      let editId = null;
      let items = [];
      const form = document.getElementById(cfg.formId);
      const head = document.getElementById(`${cfg.formId}-title`);
      const submitBtn = form.querySelector('button[type="submit"]');

      // Abbrechen-Button für den Bearbeiten-Modus
      let cancelBtn = form.querySelector("[data-cancel]");
      if (!cancelBtn) {
        cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "btn secondary hidden";
        cancelBtn.textContent = "Abbrechen";
        submitBtn.after(cancelBtn);
      }

      const clearEdit = () => {
        editId = null;
        head.textContent = "Neu anlegen";
        submitBtn.textContent = "Hinzufügen";
        cancelBtn.classList.add("hidden");
        document.querySelector(`#${cfg.listId} tr.editing`)?.classList
          .remove("editing");
      };

      const reload = async () => {
        items = await this.api(cfg.endpoint);
        renderRows();
      };

      const renderRows = () => {
        const visible = cfg.applyFilter ? cfg.applyFilter(items) : items;
        document.getElementById(cfg.listId).innerHTML = visible.map(r => `
          <tr data-id="${r.id}">${cfg.rowHtml.call(this, r)}
            <td style="white-space:nowrap">
              <button class="btn secondary small" data-edit="${r.id}">Bearbeiten</button>
              <button class="btn danger small" data-del="${r.id}">Löschen</button>
            </td></tr>`).join("") ||
          `<tr><td colspan="5" class="muted">${items.length
            ? "Keine Treffer für den Filter."
            : "Noch keine Einträge."}</td></tr>`;
      };

      const markEditing = (id) => {
        document.querySelector(`#${cfg.listId} tr.editing`)?.classList
          .remove("editing");
        document.querySelector(`#${cfg.listId} tr[data-id="${id}"]`)?.classList
          .add("editing");
      };

      form.addEventListener("submit", async e => {
        e.preventDefault();
        await this.withBusy(e.submitter || submitBtn, async () => {
          const body = cfg.fill(form);
          if (editId) {
            await this.api(`${cfg.endpoint}/${editId}`, { method: "PATCH", body });
          } else {
            await this.api(cfg.endpoint, { method: "POST", body });
          }
          cfg.resetForm(form);
          clearEdit();
          this.toast("Gespeichert");
          await reload();
        });
      });
      cancelBtn.addEventListener("click", () => { cfg.resetForm(form); clearEdit(); });

      document.getElementById(cfg.listId).addEventListener("click", async e => {
        const del = e.target.closest("[data-del]");
        const ed = e.target.closest("[data-edit]");
        try {
          if (del) {
            if (!confirm("Wirklich löschen?")) return;
            await this.api(`${cfg.endpoint}/${del.dataset.del}`, { method: "DELETE" });
            this.toast("Gelöscht");
            if (editId && String(editId) === del.dataset.del) { cfg.resetForm(form); clearEdit(); }
            await reload();
          } else if (ed) {
            const item = items.find(r => String(r.id) === ed.dataset.edit);
            if (!item) return;
            editId = item.id;
            form.title.value = item.title || "";
            form.body ? (form.body.value = item.body || "") : null;
            if (form.priority) form.priority.value = String(item.priority);
            if (form.active) form.active.checked = !!item.active;
            if (form.qr_url) form.qr_url.value = item.qr_url || "";
            if (form.description) form.description.value = item.description || "";
            if (form.start_at) form.start_at.value = (item.start_at || "").slice(0, 16);
            if (form.end_at) form.end_at.value = (item.end_at || "").slice(0, 16);
            if (form.location) form.location.value = item.location || "";
            if (form.category) form.category.value = item.category || "";
            if (form.website) form.website.value = item.website || "";
            if (form.featured) form.featured.checked = !!item.featured;
            head.textContent = "Bearbeiten";
            submitBtn.textContent = "Änderungen speichern";
            cancelBtn.classList.remove("hidden");
            markEditing(item.id);
            form.scrollIntoView({ behavior: "smooth" });
            form.title.focus();
          }
        } catch (err) { this.toast(err.message, true); }
      });

      // Externe Trigger (z. B. ICS-Import) können die Liste neu laden:
      window.addEventListener(`sb-reload-${cfg.listId}`, () => {
        reload().catch(() => {});
      });
      if (cfg.filterEvent) {
        document.addEventListener(cfg.filterEvent, renderRows);
      }

      await reload().catch(err => this.toast(err.message, true));
    },

    /* ── Medien ────────────────────────────────────────────────────────── */
    async pageMedia() {
      const grid = document.getElementById("media-grid");
      const input = document.getElementById("media-input");
      const layoutSel = document.getElementById("assign-layout");
      let layouts = [];
      const lastAssigned = {}; // mediaId -> layoutId (für Vorschau-Link)

      function renderLayoutOptions() {
        if (!layouts.length) {
          layoutSel.innerHTML = "<option value=''>– noch keine Layouts –</option>";
          return;
        }
        layoutSel.innerHTML = layouts.map((l) =>
          `<option value="${l.id}">${SB.esc(l.name)}${l.is_default ? " (Standard)" : ""}</option>`).join("");
      }

      /* Zuweisung läuft über POST /api/admin/media/{id}/assign
         (serverseitig, funktioniert auch für Redakteure). */

      let mediaItems = [];
      const filterEl = document.getElementById("media-search");
      const form = document.getElementById("media-upload");

      async function reload() {
        mediaItems = await SB.api("/api/admin/media");
        renderGrid();
      }

      function renderGrid() {
        const q = (filterEl?.value || "").trim().toLowerCase();
        const items = q
          ? mediaItems.filter((m) =>
              (m.title || "").toLowerCase().includes(q) ||
              (m.mime || "").toLowerCase().includes(q))
          : mediaItems;
        grid.innerHTML = items.map((m) => `
          <div class="media-item" data-id="${m.id}" data-title="${SB.esc(m.title)}">
            ${m.kind === "image"
              ? `<img src="${m.thumb_url || m.url}" alt="" loading="lazy">`
              : `<video src="${m.url}" preload="metadata"></video>`}
            <div class="meta"><strong>${SB.esc(m.title)}</strong>
              <div class="muted">${SB.fmtSize(m.size)} · ${SB.esc(m.mime)}</div></div>
            <div class="actions">
              <button class="btn secondary small" data-addgal="${m.id}">＋ Galerie</button>
              <button class="btn secondary small" data-addimg="${m.id}">Als Bild</button>
              ${lastAssigned[m.id]
                ? `<a class="btn small" target="_blank" rel="noopener"
                     href="/display?preview=${lastAssigned[m.id]}">▶ Vorschau</a>`
                : ""}
              <button class="btn danger small" data-del="${m.id}">Löschen</button>
            </div>
          </div>`).join("") ||
          (q ? `<p class="muted">Kein Medium passt zu „${SB.esc(q)}“.</p>`
             : `<p class="muted">Noch keine Medien hochgeladen.</p>`);
      }
      if (filterEl) filterEl.addEventListener("input", renderGrid);

      grid.addEventListener("click", async (e) => {
        const gal = e.target.closest("[data-addgal]");
        const img = e.target.closest("[data-addimg]");
        const del = e.target.closest("[data-del]");
        try {
          if (gal || img) {
            const item = (gal || img).closest(".media-item");
            const mediaId = Number(item.dataset.id);
            const layoutId = layoutSel.value;
            if (!layoutId) return SB.toast("Erst ein Layout oben wählen", true);
            const mode = gal ? "gallery" : "image";
            await SB.api(`/api/admin/media/${mediaId}/assign`, {
              method: "POST",
              body: { layout_id: Number(layoutId), mode },
            });
            lastAssigned[mediaId] = Number(layoutId);
            SB.toast(gal ? "Zur Galerie hinzugefügt – ▶ Vorschau unten"
                         : "Als Bild gesetzt – ▶ Vorschau unten");
            await reload();
          } else if (del) {
            const item = del.closest(".media-item");
            const title = item?.dataset.title || "Medium";
            if (!confirm(`„${title}" wirklich löschen?\n\n` +
              "Hinweis: Bilder/Galerien, die dieses Medium verwenden, " +
              "zeigen danach nichts mehr an.")) return;
            await SB.api(`/api/admin/media/${del.dataset.del}`, { method: "DELETE" });
            delete lastAssigned[del.dataset.del];
            await reload();
          }
        } catch (err) { SB.toast(err.message, true); }
      });

      document.getElementById("media-upload").addEventListener("submit", (e) => {
        e.preventDefault();
        this.withBusy(e.submitter || form, async () => {
          if (!input.files.length) return this.toast("Keine Datei gewählt", true);
          let ok = 0, failed = 0;
          for (const file of input.files) {
            const fd = new FormData();
            fd.append("file", file);
            try {
              await this.api("/api/admin/media", { method: "POST", body: fd });
              ok += 1;
            } catch (err) {
              failed += 1;
              this.toast(`${file.name}: ${err.message}`, true);
            }
          }
          if (ok) this.toast(`${ok} Datei(en) hochgeladen` +
            (failed ? ` – ${failed} fehlgeschlagen` : ""));
          input.value = "";
          await reload();
        });
      });

      layouts = await SB.api("/api/admin/layouts").catch(() => []);
      renderLayoutOptions();
      await reload().catch((err) => this.toast(err.message, true));
    },

    /* ── Layouts: Drag-&-Drop-Editor ───────────────────────────────────── */
    async pageLayouts() {
      const S = { layouts: [], id: null, els: [], sel: -1, media: [],
                  bg: { mode: "color", color: "#0b1220", dim: 0.35 } };
      const $ = (id) => document.getElementById(id);
      const canvas = $("ed-canvas"), propsBox = $("ed-props");
      const ICONS = { header: "🏙", clock: "🕐", date: "📅", weather: "🌤",
        forecast: "🌦", text: "📝", image: "🖼", gallery: "🎞",
        events: "🎉", announcements: "📢", qr: "🔳", ticker: "📰",
        webcam: "🎥", website: "🌐", rss: "📡" };
      const LABELS = { header: "Kopf", clock: "Uhr", date: "Datum",
        weather: "Wetter", forecast: "Vorhersage", text: "Text",
        image: "Bild", gallery: "Galerie", events: "Veranstaltungen",
        announcements: "Bekanntmachungen", qr: "QR-Code", ticker: "Ticker",
        webcam: "Kamera", website: "Webseite", rss: "RSS-Feed" };
      const DEFAULTS = {
        header: { x: 3, y: 3, w: 40, h: 11, config: {} },
        clock: { x: 68, y: 3, w: 15, h: 11, config: {} },
        date: { x: 55, y: 3, w: 12, h: 11, config: {} },
        weather: { x: 84, y: 3, w: 13, h: 11, config: {} },
        forecast: { x: 80, y: 15, w: 17, h: 20, config: {} },
        text: { x: 40, y: 40, w: 30, h: 15, config: { text: "Willkommen!" } },
        image: { x: 36, y: 17, w: 38, h: 50, config: { media_id: null } },
        gallery: { x: 36, y: 17, w: 38, h: 62,
                   config: { media_ids: [], seconds: 8 } },
        events: { x: 77, y: 17, w: 20, h: 46, config: { count: 5 } },
        announcements: { x: 3, y: 17, w: 30, h: 62, config: { count: 4 } },
        qr: { x: 77, y: 65, w: 20, h: 19,
              config: { setting_key: "city_website", url: "", label: "Mehr erfahren" } },
        ticker: { x: 0, y: 91, w: 100, h: 9, config: {} },
        webcam: { x: 60, y: 40, w: 36, h: 34,
                  config: { mode: "snapshot", url: "", refresh_seconds: 30,
                            caption: "Live-Blick" } },
        website: { x: 20, y: 20, w: 60, h: 55,
                   config: { url: "", consent_param: "" } },
        rss: { x: 3, y: 17, w: 30, h: 50,
               config: { url: "", count: 5, refresh_minutes: 15 } },
      };
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

      /* ── Canvas ── */
      function positionEl(i) {
        const el = S.els[i];
        const div = canvas.querySelector(`[data-i="${i}"]`);
        if (!div) return;
        div.style.left = el.x + "%";
        div.style.top = el.y + "%";
        div.style.width = el.w + "%";
        div.style.height = el.h + "%";
      }
      function draw() {
        canvas.className = "preview-box ed-canvas" +
          ($("layout-orientation").value === "portrait" ? " portrait" : "");
        canvas.innerHTML = "";
        S.els.forEach((el, i) => {
          const d = document.createElement("div");
          d.className = "ed-el" + (i === S.sel ? " sel" : "");
          d.dataset.i = i;
          const badge = document.createElement("span");
          badge.className = "ed-badge";
          badge.textContent = `${ICONS[el.type] || "▫"} ${LABELS[el.type] || el.type}`;
          d.appendChild(badge);
          // Griff + ✕ IMMER rendern; CSS zeigt sie nur bei .sel
          // (select() togglet nur Klassen und ruft kein draw() auf!)
          const h = document.createElement("span");
          h.className = "ed-handle";
          d.appendChild(h);
          const del = document.createElement("button");
          del.type = "button";
          del.className = "ed-del";
          del.title = "Widget löschen";
          del.textContent = "✕";
          d.appendChild(del);
          canvas.appendChild(d);
          positionEl(i);
        });
        ensureGuides();
        applyCanvasBg();
      }

      /* ── Historie (Undo) + Dirty-Marker ── */
      let dirty = false;
      const markDirty = () => {
        dirty = true;
        $("ed-dirty").classList.remove("hidden");
      };
      const clearDirty = () => {
        dirty = false;
        $("ed-dirty").classList.add("hidden");
      };
      window.addEventListener("beforeunload", (e) => {
        if (!dirty) return;
        e.preventDefault();
        e.returnValue = "";
      });

      const hist = [];
      const pushHistory = () => {
        hist.push(JSON.stringify(S.els));
        if (hist.length > 50) hist.shift();
        markDirty();
      };
      function deleteSelected() {
        if (S.sel < 0) return;
        pushHistory();
        S.els.splice(S.sel, 1);
        select(-1);
        draw();
      }
      const undo = () => {
        if (!hist.length) return SB.toast("Nichts zum Rückgängigmachen");
        S.els = JSON.parse(hist.pop());
        S.sel = -1;
        draw(); buildProps();
      };
      $("ed-undo").addEventListener("click", undo);

      /* Widget-Zwischenablage (lebt solange die Seite offen ist –
         funktioniert damit auch zwischen Layouts) */
      let clipEl = null;
      const copySelected = () => {
        if (S.sel < 0) return false;
        clipEl = JSON.parse(JSON.stringify(S.els[S.sel]));
        return true;
      };
      const pasteClip = () => {
        if (!clipEl) return;
        pushHistory();
        const copy = JSON.parse(JSON.stringify(clipEl));
        copy.x = clamp(copy.x + 2, 0, 100 - copy.w);
        copy.y = clamp(copy.y + 2, 0, 100 - copy.h);
        S.els.push(copy);
        select(S.els.length - 1);
        draw();
        markDirty();
      };

      document.addEventListener("keydown", (e) => {
        const t = e.target;
        if (t && /^(input|textarea|select)$/i.test(t.tagName)) return;
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && k === "z") {
          e.preventDefault(); undo();
        } else if ((e.ctrlKey || e.metaKey) && k === "c") {
          if (copySelected()) SB.toast("Widget kopiert");
        } else if ((e.ctrlKey || e.metaKey) && k === "v") {
          e.preventDefault(); pasteClip();
        } else if (e.key === "Delete" || e.key === "Backspace") {
          if (S.sel >= 0) { e.preventDefault(); deleteSelected(); }
        } else if (e.key.startsWith("Arrow") && S.sel >= 0) {
          // Pfeiltasten verschieben das gewählte Widget (mit Shift: 5 %)
          e.preventDefault();
          const step = e.shiftKey ? 5 : 1;
          const el = S.els[S.sel];
          if (e.key === "ArrowLeft") el.x = clamp(el.x - step, 0, 100 - el.w);
          else if (e.key === "ArrowRight") el.x = clamp(el.x + step, 0, 100 - el.w);
          else if (e.key === "ArrowUp") el.y = clamp(el.y - step, 0, 100 - el.h);
          else if (e.key === "ArrowDown") el.y = clamp(el.y + step, 0, 100 - el.h);
          positionEl(S.sel);
          buildProps();
          markDirty();
        }
      });

      const snapStep = () => Number($("ed-snap").value) || 0;
      const snapVal = (v) => {
        const s = snapStep();
        return s ? Math.round(v / s) * s : Math.round(v);
      };

      function ensureGuides() {
        if (!canvas.querySelector(".ed-guide.v")) {
          const v = document.createElement("div");
          v.className = "ed-guide v"; v.style.display = "none";
          const h = document.createElement("div");
          h.className = "ed-guide h"; h.style.display = "none";
          canvas.append(v, h);
        }
      }
      function showGuides(el, on) {
        ensureGuides();
        const v = canvas.querySelector(".ed-guide.v");
        const h = canvas.querySelector(".ed-guide.h");
        if (!v || !h) return;
        if (!el || !on) {          // auch bei null sauber verstecken (endDrag!)
          v.style.display = "none";
          h.style.display = "none";
          return;
        }
        const centerV = Math.abs((el.x + el.w / 2) - 50) < 1.2;
        const centerH = Math.abs((el.y + el.h / 2) - 50) < 1.2;
        v.style.display = centerV ? "" : "none";
        h.style.display = centerH ? "" : "none";
      }

      let drag = null;
      canvas.addEventListener("pointerdown", (e) => {
        // ✕ am gewählten Widget: direkt löschen, kein Drag starten
        const delBtn = e.target.closest(".ed-del");
        if (delBtn) {
          e.stopPropagation();
          e.preventDefault();
          deleteSelected();
          return;
        }
        const target = e.target.closest(".ed-el");
        if (!target) { select(-1); return; }
        const i = Number(target.dataset.i);
        const wasSelected = (S.sel === i);   // für Klick-auf-gewählt = fest setzen
        select(i);
        drag = {
          i,
          mode: e.target.classList.contains("ed-handle") ? "resize" : "move",
          startX: e.clientX, startY: e.clientY,
          orig: { ...S.els[i] }, rect: canvas.getBoundingClientRect(),
          moved: false,
          snapshot: JSON.stringify(S.els),
          wasSelected,
        };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const dx = ((e.clientX - drag.startX) / drag.rect.width) * 100;
        const dy = ((e.clientY - drag.startY) / drag.rect.height) * 100;
        if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) drag.moved = true;
        const el = S.els[drag.i];
        if (drag.mode === "move") {
          el.x = clamp(snapVal(drag.orig.x + dx), 0, 100 - el.w);
          el.y = clamp(snapVal(drag.orig.y + dy), 0, 100 - el.h);
        } else {
          el.w = clamp(snapVal(drag.orig.w + dx), 3, 100 - el.x);
          el.h = clamp(snapVal(drag.orig.h + dy), 3, 100 - el.y);
        }
        positionEl(drag.i);
        showGuides(el, drag.mode === "move");
        syncPosInputs();
      });
      const endDrag = () => {
        if (!drag) return;
        try {
          showGuides(null, false);
        } catch { /* Guides dürfen den Drag-Abschluss niemals blockieren */ }
        if (drag.moved) hist.push(drag.snapshot); // Undo-Punkt für diesen Zug
        else if (drag.wasSelected) {
          // Klick auf bereits gewähltes Widget ohne Bewegung → fest setzen
          select(-1);
        }
        drag = null;
      };
      canvas.addEventListener("pointerup", endDrag);
      canvas.addEventListener("pointercancel", endDrag);

      /* ── Auswahl & Eigenschaften ── */
      function select(i) {
        S.sel = i;
        canvas.querySelectorAll(".ed-el").forEach((d) =>
          d.classList.toggle("sel", Number(d.dataset.i) === i));
        buildProps();
      }

      function field(labelText, inputEl) {
        const wrap = document.createElement("span");
        wrap.className = "field";
        const lab = document.createElement("label");
        lab.textContent = labelText;
        wrap.append(lab, inputEl);
        return wrap;
      }
      function numInput(value, min, max, onInput, onCommit) {
        const inp = document.createElement("input");
        inp.type = "number"; inp.value = value;
        inp.min = min; inp.max = max;
        inp.addEventListener("input", () => onInput(Number(inp.value)));
        if (onCommit) inp.addEventListener("change", () => onCommit());
        return inp;
      }

      function syncPosInputs() {
        if (S.sel < 0) return;
        const el = S.els[S.sel];
        ["x", "y", "w", "h"].forEach((k) => {
          const inp = propsBox.querySelector(`[data-pos="${k}"]`);
          if (inp && document.activeElement !== inp) inp.value = el[k];
        });
      }

      function buildProps() {
        propsBox.innerHTML = "";
        if (S.sel < 0) {
          propsBox.innerHTML =
            '<p class="muted">Kein Element ausgewählt – auf ein Widget klicken.</p>';
          return;
        }
        const el = S.els[S.sel];
        const cfg = el.config;

        const head = document.createElement("p");
        head.innerHTML = `<strong>${ICONS[el.type] || ""} ${LABELS[el.type] || el.type}</strong>`;
        propsBox.appendChild(head);

        const grid = document.createElement("div");
        grid.className = "props-grid";
        [["x", "X %"], ["y", "Y %"], ["w", "Breite"], ["h", "Höhe"]].forEach(([k, lbl]) => {
          const inp = numInput(el[k], 0, 100, (v) => {
            if (k === "x") el.x = clamp(v, 0, 100 - el.w);
            else if (k === "y") el.y = clamp(v, 0, 100 - el.h);
            else if (k === "w") el.w = clamp(v, 3, 100 - el.x);
            else { el.h = clamp(v, 3, 100 - el.y); }
            positionEl(S.sel);
          }, pushHistory);
          inp.dataset.pos = k;
          grid.appendChild(field(lbl, inp));
        });
        propsBox.appendChild(grid);

        /* Typ-spezifische Konfiguration */
        if (el.type === "text") {
          const ta = document.createElement("textarea");
          ta.rows = 3; ta.style.width = "100%";
          ta.value = cfg.text || "";
          ta.addEventListener("input", () => { cfg.text = ta.value; });
          ta.addEventListener("change", pushHistory);
          propsBox.appendChild(field("Text", ta));
        }

        if (el.type === "image") {
          const sel = document.createElement("select");
          sel.style.width = "100%";
          sel.innerHTML = `<option value="">– Medium wählen –</option>` +
            S.media.map((m) => `<option value="${m.id}" ${String(cfg.media_id) === String(m.id) ? "selected" : ""}>${SB.esc(m.title)}</option>`).join("");
          sel.addEventListener("change", () => { cfg.media_id = sel.value ? Number(sel.value) : null; });
          propsBox.appendChild(field("Medium", sel));
        }

        if (el.type === "gallery") {
          const chosenWrap = document.createElement("div");
          chosenWrap.className = "chips";
          const availWrap = document.createElement("div");
          availWrap.className = "chips";

          function renderChips() {
            chosenWrap.innerHTML = "<strong style='font-size:12px'>In Galerie (Reihenfolge = Klick-Reihenfolge):</strong>";
            availWrap.innerHTML = "<strong style='font-size:12px'>Verfügbare Medien:</strong>";
            cfg.media_ids.forEach((mid, idx) => {
              const m = S.media.find((x) => x.id === mid);
              const chip = document.createElement("span");
              chip.className = "chip";
              chip.innerHTML = `${m ? `<img src="${m.thumb_url || m.url}">` : ""}${SB.esc(m ? m.title : "?" )} <span class="x">✕</span>`;
              chip.addEventListener("click", () => {
                pushHistory();
                cfg.media_ids.splice(idx, 1); renderChips();
              });
              chosenWrap.appendChild(chip);
            });
            if (!cfg.media_ids.length) {
              chosenWrap.insertAdjacentHTML("beforeend",
                '<span class="muted">noch leer</span>');
            }
            S.media.filter((m) => !cfg.media_ids.includes(m.id)).forEach((m) => {
              const chip = document.createElement("span");
              chip.className = "chip add";
              chip.innerHTML = `＋ <img src="${m.thumb_url || m.url}">${SB.esc(m.title)}`;
              chip.addEventListener("click", () => {
                pushHistory();
                cfg.media_ids.push(m.id); renderChips();
              });
              availWrap.appendChild(chip);
            });
            if (!S.media.length) {
              availWrap.insertAdjacentHTML("beforeend",
                '<span class="muted">Erst <a href="/media">Medien hochladen</a>.</span>');
            }
          }
          renderChips();
          propsBox.append(chosenWrap, availWrap);

          const secs = numInput(cfg.seconds ?? 8, 3, 120, (v) => { cfg.seconds = v; });
          propsBox.appendChild(field("Wechsel alle (Sek.)", secs));
        }

        if (el.type === "qr") {
          const srcSel = document.createElement("select");
          srcSel.innerHTML = `
            <option value="city_website" ${cfg.setting_key === "city_website" || !cfg.url ? "selected" : ""}>Stadt-Website (Einstellung)</option>
            <option value="custom" ${cfg.url ? "selected" : ""}>Eigene URL</option>`;
          const urlInp = document.createElement("input");
          urlInp.placeholder = "https://…";
          urlInp.value = cfg.url || "";
          urlInp.disabled = !(cfg.url);
          srcSel.addEventListener("change", () => {
            const custom = srcSel.value === "custom";
            urlInp.disabled = !custom;
            if (!custom) { cfg.setting_key = "city_website"; cfg.url = ""; urlInp.value = ""; }
            else { cfg.url = urlInp.value; }
          });
          urlInp.addEventListener("input", () => { cfg.url = urlInp.value.trim(); });
          const labelInp = document.createElement("input");
          labelInp.value = cfg.label || "";
          labelInp.addEventListener("input", () => { cfg.label = labelInp.value; });
          propsBox.append(field("Ziel", srcSel), field("URL (bei eigener)", urlInp),
            field("Beschriftung", labelInp));
        }

        if (el.type === "events" || el.type === "announcements") {
          const cnt = numInput(cfg.count ?? 5, 1, 12, (v) => { cfg.count = v; });
          propsBox.appendChild(field("Anzahl Einträge", cnt));
        }

        if (el.type === "webcam") {
          const modeSel = document.createElement("select");
          modeSel.innerHTML = `
            <option value="snapshot" ${cfg.mode === "snapshot" ? "selected" : ""}>Snapshot (Bild-URL, aktualisiert sich)</option>
            <option value="mjpeg" ${cfg.mode === "mjpeg" ? "selected" : ""}>MJPEG-Stream (URL)</option>
            <option value="hls" ${cfg.mode === "hls" ? "selected" : ""}>HLS-Stream (.m3u8)</option>
            <option value="rtsp" ${cfg.mode === "rtsp" ? "selected" : ""}>RTSP-Kamera (Server holt Einzelframes)</option>`;
          modeSel.addEventListener("change", () => { cfg.mode = modeSel.value; });
          propsBox.appendChild(field("Modus", modeSel));

          const urlInp = document.createElement("input");
          urlInp.placeholder = modeSel.value === "rtsp"
            ? "rtsp://user:pass@kamera.local/stream1"
            : "https://…";
          urlInp.value = cfg.url || "";
          urlInp.addEventListener("change", () => { cfg.url = urlInp.value.trim(); pushHistory(); });
          propsBox.appendChild(field("Quell-URL", urlInp));

          const refresh = numInput(cfg.refresh_seconds ?? 30, 5, 600,
            (v) => { cfg.refresh_seconds = v; }, pushHistory);
          propsBox.appendChild(field("Aktualisierung (Sek., snapshot/rtsp)", refresh));

          const cap = document.createElement("input");
          cap.value = cfg.caption || "";
          cap.addEventListener("change", () => { cfg.caption = cap.value; pushHistory(); });
          propsBox.appendChild(field("Beschriftung (z. B. „Live-Blick Marktplatz“)", cap));

          propsBox.insertAdjacentHTML("beforeend",
            `<p class="muted">RTSP: Der Server zieht alle 60 s ein Einzelbild per ffmpeg
              (datenschutzfreundlich, kein Dauersream). Erfordert ffmpeg im Container –
              im Installer enthalten.</p>`);
        }

        if (el.type === "website") {
          const urlInp = document.createElement("input");
          urlInp.placeholder = "https://www.beispiel.de";
          urlInp.value = cfg.url || "";
          urlInp.addEventListener("change", () => {
            cfg.url = urlInp.value.trim(); pushHistory();
          });
          propsBox.appendChild(field("Webseiten-URL", urlInp));

          const consent = document.createElement("input");
          consent.placeholder = 'z. B. "cookie-consent=1" (seitenspezifisch)';
          consent.value = cfg.consent_param || "";
          consent.addEventListener("change", () => {
            cfg.consent_param = consent.value.trim(); pushHistory();
          });
          propsBox.appendChild(field("Consent-/Cookie-Parameter (an URL angehängt)", consent));

          propsBox.insertAdjacentHTML("beforeend", `<p class="muted">
            Wichtig: Die Seite muss Einbetten erlauben (keine X-Frame-Options-Sperre).
            Cookie-Banner können viele Seiten über einen URL-Parameter akzeptieren –
            das ist seitenspezifisch und kann hier hinterlegt werden. Öffentliche
            (nicht-lokale) Seiten werden nur geladen, wenn „Externe Dienste erlauben“
            aktiviert ist.</p>`);
        }

        if (el.type === "rss") {
          const urlInp = document.createElement("input");
          urlInp.placeholder = "https://www.stadt.de/news/rss";
          urlInp.value = cfg.url || "";
          urlInp.addEventListener("change", () => { cfg.url = urlInp.value.trim(); pushHistory(); });
          propsBox.appendChild(field("Feed-URL (RSS/Atom)", urlInp));

          const cnt = numInput(cfg.count ?? 5, 1, 12, (v) => { cfg.count = v; }, pushHistory);
          propsBox.appendChild(field("Anzahl Schlagzeilen", cnt));

          const mins = numInput(cfg.refresh_minutes ?? 15, 5, 240,
            (v) => { cfg.refresh_minutes = v; }, pushHistory);
          propsBox.appendChild(field("Abrufintervall (Minuten)", mins));

          propsBox.insertAdjacentHTML("beforeend", `<p class="muted">
            Benötigt „Externe Dienste erlauben“ (Einstellungen → Datenschutz);
            ohne Freigabe bleibt das Widget leer. Cache reduziert Abrufe.</p>`);
        }

        const actions = document.createElement("p");
        actions.style.cssText = "display:flex;gap:8px;margin-top:10px;flex-wrap:wrap";

        const mkBtn = (label, cls, fn) => {
          const b = document.createElement("button");
          b.type = "button"; b.className = `btn ${cls} small`;
          b.textContent = label;
          b.addEventListener("click", fn);
          return b;
        };

        actions.append(
          mkBtn("Nach vorn ⬆", "secondary", () => {
            if (S.sel >= S.els.length - 1) return;
            pushHistory();
            [S.els[S.sel], S.els[S.sel + 1]] = [S.els[S.sel + 1], S.els[S.sel]];
            S.sel += 1; draw(); buildProps();
          }),
          mkBtn("Nach hinten ⬇", "secondary", () => {
            if (S.sel <= 0) return;
            pushHistory();
            [S.els[S.sel - 1], S.els[S.sel]] = [S.els[S.sel], S.els[S.sel - 1]];
            S.sel -= 1; draw(); buildProps();
          }),
          mkBtn("Duplizieren", "secondary", () => {
            pushHistory();
            const copy = JSON.parse(JSON.stringify(el));
            copy.x = clamp(copy.x + 2, 0, 100 - copy.w);
            copy.y = clamp(copy.y + 2, 0, 100 - copy.h);
            S.els.splice(S.sel + 1, 0, copy);
            select(S.sel + 1); draw();
          }),
          mkBtn("Löschen", "danger", () => deleteSelected()),
        );
        propsBox.appendChild(actions);
      }

      /* ── Palette ── */
      $("palette").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-widget]");
        if (!btn) return;
        const type = btn.dataset.widget;
        pushHistory();
        S.els.push({ type, ...JSON.parse(JSON.stringify(DEFAULTS[type])) });
        // Bewusst NICHT selektieren: neue Widgets stehen sofort „fest“
        // und werden bei Bedarf per Klick in den Bearbeitungsmodus genommen.
        draw();
        SB.toast(`${LABELS[type] || type} hinzugefügt – zum Bearbeiten klicken`);
      });

      /* ── Liste / Laden / Speichern ── */
      function renderList() {
        const list = $("layout-list");
        list.innerHTML = S.layouts.map((l) => `
          <tr data-id="${l.id}" class="${l.id === S.id ? "current" : ""}">
            <td>${SB.esc(l.name)} ${l.is_default ? '<span class="badge ok">Standard</span>' : ""}
                <div class="muted">${SB.esc(l.orientation)} · ${(l.elements || []).length} Elemente</div></td>
            <td style="white-space:nowrap">
              <button class="btn secondary small" data-load="${l.id}">Laden</button>
              <button class="btn secondary small" data-dup="${l.id}">Duplizieren</button>
              ${l.is_default ? "" :
                `<button class="btn secondary small" data-default="${l.id}">Standard</button>`}
              <button class="btn danger small" data-del="${l.id}">Löschen</button>
            </td></tr>`).join("") ||
          `<tr><td colspan="2" class="muted">Noch keine Layouts –
             lege oben eines an oder nutze auf „Layout gestalten“ eine Vorlage.</td></tr>`;
      }

      function confirmDiscard() {
        if (!dirty) return true;
        return confirm("Es gibt ungespeicherte Änderungen. Verwerfen?");
      }

      function loadLayout(id) {
        if (S.id !== id && !confirmDiscard()) return;
        const l = S.layouts.find((x) => x.id === id);
        if (!l) return;
        S.id = id;
        S.els = JSON.parse(JSON.stringify(l.elements || []));
        S.bg = { mode: "color", color: "#0b1220", dim: 0.35,
                 ...(l.background || {}) };
        S.sel = -1;
        clearDirty();
        $("layout-name").value = l.name;
        $("layout-orientation").value = l.orientation;
        syncBgControls();
        updatePreviewLinks();
        renderList(); draw(); buildProps();
      }

      /* ── Hintergrund-Steuerung ── */
      function syncBgControls() {
        $("bg-mode").value = S.bg.mode || "color";
        if (S.bg.color) $("bg-color").value = S.bg.color;
        $("bg-dim").value = Math.round((S.bg.dim ?? 0.35) * 100);
        $("bg-dim-val").textContent = Math.round((S.bg.dim ?? 0.35) * 100);
        const isImg = $("bg-mode").value === "image";
        $("bg-color").parentElement.classList.toggle("hidden", isImg);
        $("bg-media-wrap").classList.toggle("hidden", !isImg);
        $("bg-dim-wrap").classList.toggle("hidden", !isImg);
        if (isImg) {
          $("bg-media").innerHTML = `<option value="">– wählen –</option>` +
            S.media.map((m) =>
              `<option value="${m.id}" ${Number(S.bg.media_id) === m.id ? "selected" : ""}>${SB.esc(m.title)}</option>`).join("");
        }
        applyCanvasBg();
      }
      function applyCanvasBg() {
        if (S.bg.mode === "image" && S.bg.media_id) {
          const m = S.media.find((x) => x.id === Number(S.bg.media_id));
          canvas.style.backgroundImage = m
            ? `linear-gradient(rgba(0,0,0,${S.bg.dim ?? .35}),rgba(0,0,0,${S.bg.dim ?? .35})),url('${m.thumb_url || m.url}')`
            : "";
          canvas.style.backgroundColor = "#000";
        } else {
          canvas.style.backgroundImage = "";
          canvas.style.background =
            S.bg.mode === "color" && S.bg.color ? S.bg.color : "#0b1220";
        }
      }
      $("bg-form").addEventListener("input", () => {
        S.bg.mode = $("bg-mode").value;
        S.bg.color = $("bg-color").value;
        S.bg.dim = Number($("bg-dim").value) / 100;
        $("bg-dim-val").textContent = $("bg-dim").value;
        if ($("bg-media").value) S.bg.media_id = Number($("bg-media").value);
        markDirty();
        syncBgControls();
      });
      $("bg-media").addEventListener("change", () => {
        S.bg.media_id = Number($("bg-media").value) || undefined;
        markDirty(); applyCanvasBg();
      });

      function updatePreviewLinks() {
        const frame = $("ed-preview-frame");
        const full = $("ed-preview-full");
        const hint = frame.previousElementSibling;
        const portrait = $("layout-orientation").value === "portrait";
        frame.style.aspectRatio = portrait ? "9 / 16" : "16 / 9";
        if (portrait) {
          frame.style.height = "76vh";
          frame.style.width = "auto";
          frame.style.margin = "0 auto";
        } else {
          frame.style.height = "";
          frame.style.width = "100%";
          frame.style.margin = "";
        }
        if (!S.id) {
          frame.style.display = "none"; full.classList.add("hidden");
          if (hint) hint.style.display = "";
          return;
        }
        const url = `/display?preview=${S.id}`;
        frame.src = url;
        frame.style.display = "";
        if (hint) hint.style.display = "none";
        full.href = url;
        full.classList.remove("hidden");
      }

      $("layout-list").addEventListener("click", async (e) => {
        const load = e.target.closest("[data-load]");
        const dup = e.target.closest("[data-dup]");
        const def = e.target.closest("[data-default]");
        const del = e.target.closest("[data-del]");
        try {
          if (load) loadLayout(Number(load.dataset.load));
          else if (dup) {
            const res = await SB.api(`/api/admin/layouts/${dup.dataset.dup}/duplicate`,
              { method: "POST" });
            await reloadAll();
            if (res.id) loadLayout(res.id);
            SB.toast(`Kopie „${res.name}" erstellt`);
          } else if (def) {
            const l = S.layouts.find((x) => x.id === Number(def.dataset.default));
            await SB.api(`/api/admin/layouts/${l.id}`, {
              method: "PATCH",
              body: { name: l.name, orientation: l.orientation,
                elements: l.elements, is_default: true },
            });
            await reloadAll();
            SB.toast("Standardlayout gesetzt");
          } else if (del) {
            if (!confirm("Layout wirklich löschen?")) return;
            await SB.api(`/api/admin/layouts/${del.dataset.del}`, { method: "DELETE" });
            if (S.id === Number(del.dataset.del)) { S.id = null; S.els = []; draw(); }
            await reloadAll();
          }
        } catch (err) { SB.toast(err.message, true); }
      });

      $("layout-new").addEventListener("click", () => {
        if (!confirmDiscard()) return;
        S.id = null; S.els = []; S.sel = -1;
        S.bg = { mode: "color", color: "#0b1220", dim: 0.35 };
        $("layout-name").value = "Neues Layout";
        clearDirty();
        syncBgControls();
        updatePreviewLinks();
        renderList(); draw(); buildProps();
      });

      $("layout-save").addEventListener("click", (e) => {
        this.withBusy(e.target, async () => {
        const name = $("layout-name").value.trim() || "Layout";
        const current = S.layouts.find((l) => l.id === S.id);
        const body = { name, orientation: $("layout-orientation").value,
          elements: S.els, is_default: current?.is_default || false,
          background: { mode: S.bg.mode, color: S.bg.color,
            media_id: S.bg.media_id ?? null, dim: S.bg.dim ?? 0.35 } };
        try {
          if (S.id) {
            await SB.api(`/api/admin/layouts/${S.id}`, { method: "PATCH", body });
          } else {
            const res = await SB.api("/api/admin/layouts", { method: "POST", body });
            S.id = res.id;
          }
          SB.toast("Layout gespeichert");
          clearDirty();
          updatePreviewLinks();   // iframe auf gespeicherte Version reloaden
          const frame = $("ed-preview-frame");
          if (frame && S.id) { frame.src = `/display?preview=${S.id}`; }
          await reloadAll();
        } catch (err) { SB.toast(err.message, true); }
        });
      });

      $("layout-orientation").addEventListener("change", draw);

      /* ── JSON-Ansicht ── */
      $("ed-json-details").addEventListener("toggle", () => {
        if ($("ed-json-details").open) {
          $("layout-json").value = JSON.stringify(S.els, null, 2);
        }
      });
      $("ed-json-fill").addEventListener("click", () => {
        $("layout-json").value = JSON.stringify(S.els, null, 2);
      });
      $("ed-json-import").addEventListener("click", () => {
        try {
          const parsed = JSON.parse($("layout-json").value);
          if (!Array.isArray(parsed)) throw new Error("Array erwartet");
          for (const el of parsed) {
            if (!el.type || !DEFAULTS[el.type]) throw new Error(`Unbekannter Typ: ${el.type}`);
            ["x", "y", "w", "h"].forEach((k) => { el[k] = Number(el[k]) || 0; });
            el.config = el.config || {};
          }
          pushHistory();
          S.els = parsed; S.sel = -1; draw(); buildProps();
          SB.toast("JSON übernommen (Strg+Z macht es rückgängig)");
        } catch (err) { SB.toast("JSON-Fehler: " + err.message, true); }
      });

      async function reloadAll() {
        [S.layouts, S.media] = await Promise.all([
          SB.api("/api/admin/layouts"),
          SB.api("/api/admin/media").catch(() => []),
        ]);
        renderList();
        if (dirty) { buildProps(); return; }  // ungespeicherte Arbeit behalten
        if (S.id == null && S.layouts.length) loadLayout(S.layouts[0].id);
        else if (S.id != null) { const cur = S.layouts.find(l => l.id === S.id); if (cur) loadLayout(S.id); }
        buildProps();
      }

      await reloadAll().catch((err) => SB.toast(err.message, true));
    },
    /* ── Layout gestalten (geführt) ────────────────────────────────────── */
    async pageGestalten() {
      const $ = (id) => document.getElementById(id);
      let layouts = [], media = [], presets = [];
      let currentCat = null;

      const CATS = [
        { type: "image", icon: "🖼", label: "Bild",
          desc: "Ein einzelnes Foto/Grafik", slot: "links",
          fields: [{ key: "media_id", label: "Bild", kind: "media",
                     required: true }] },
        { type: "gallery", icon: "🎞", label: "Bilder-Serie",
          desc: "Mehrere Bilder als Wechsel", slot: "rechts",
          fields: [{ key: "media_ids", label: "Bilder (Klick-Reihenfolge)",
                     kind: "media_multi" },
                   { key: "seconds", label: "Wechsel alle (Sek.)",
                     kind: "number", min: 3, max: 120, def: 8 }] },
        { type: "webcam", icon: "🎥", label: "Kamera",
          desc: "RTSP-Stream oder Bild-URL", slot: "rechts",
          fields: [{ key: "mode", label: "Art", kind: "select", def: "rtsp",
                     options: [["rtsp", "RTSP-Stream (Server holt Frames)"],
                               ["snapshot", "Snapshot-Bild-URL"],
                               ["mjpeg", "MJPEG-Stream"],
                               ["hls", "HLS-Stream (.m3u8)"]] },
                   { key: "url", label: "URL (rtsp://… bzw. https://…)",
                     kind: "text",
                     placeholder: "rtsp://user:pass@kamera.local/stream1" },
                   { key: "refresh_seconds", label: "Aktualisierung (Sek.)",
                     kind: "number", min: 5, max: 600, def: 30 },
                   { key: "caption", label: "Beschriftung (optional)",
                     kind: "text", def: "Live-Blick" }] },
        { type: "website", icon: "🌐", label: "Webseite",
          desc: "Seite einbetten (Link genügt)", slot: "mitte-gross",
          fields: [{ key: "url", label: "Link zur Webseite", kind: "text",
                     placeholder: "https://www.beispiel.de" },
                   { key: "consent_param",
                     label: "Cookie-/Consent-Parameter (optional)",
                     kind: "text", placeholder: "cookie-consent=1" }] },
        { type: "rss", icon: "📡", label: "RSS-Feed",
          desc: "Schlagzeilen aus Feed", slot: "links",
          fields: [{ key: "url", label: "Feed-URL", kind: "text",
                     placeholder: "https://…/rss" },
                   { key: "count", label: "Anzahl Zeilen", kind: "number",
                     min: 1, max: 12, def: 5 }] },
        { type: "announcements", icon: "📢", label: "Bekanntmachungen",
          desc: "Zeigt Ihre gepflegten Meldungen", slot: "links",
          fields: [{ key: "count", label: "Anzahl", kind: "number",
                     min: 1, max: 12, def: 4 }] },
        { type: "events", icon: "🎉", label: "Veranstaltungen",
          desc: "Kommende Termine aus dem Kalender", slot: "rechts",
          fields: [{ key: "count", label: "Anzahl", kind: "number",
                     min: 1, max: 12, def: 5 }] },
        { type: "weather", icon: "🌤", label: "Wetter",
          desc: "Aktuelle Werte + Bedingung", slot: "oben-rechts", fields: [] },
        { type: "forecast", icon: "🌦", label: "Wetter-Vorhersage",
          desc: "3-Tage-Vorschau", slot: "oben-rechts", fields: [] },
        { type: "clock", icon: "🕐", label: "Uhr", desc: "Große Uhrzeit",
          slot: "oben-rechts", fields: [] },
        { type: "date", icon: "📅", label: "Datum", desc: "Langes Datum",
          slot: "oben-rechts", fields: [] },
        { type: "header", icon: "🏙", label: "Kopf (Stadt + Logo)",
          desc: "Logo und Stadtname", slot: "oben-links", fields: [] },
        { type: "text", icon: "📝", label: "Text",
          desc: "Freier Text/Hinweis", slot: "mitte-gross",
          fields: [{ key: "text", label: "Text", kind: "textarea",
                     def: "Willkommen!" }] },
        { type: "qr", icon: "🔳", label: "QR-Code",
          desc: "Stadt-Website oder eigener Link", slot: "rechts",
          fields: [{ key: "_src", label: "Ziel", kind: "select_qr" },
                   { key: "label", label: "Beschriftung", kind: "text",
                     def: "Mehr erfahren" }] },
        { type: "ticker", icon: "📰", label: "Ticker",
          desc: "Laufband mit Ticker-Text", slot: "unten-band", fields: [] },
      ];

      const SLOT_LABELS = { "oben-links": "Oben links",
        "oben-rechts": "Oben rechts", links: "Linke Hälfte",
        rechts: "Rechte Hälfte", "mitte-gross": "Mitte (groß)",
        "voll-bild": "Ganze Fläche", "unten-band": "Unterer Balken" };

      /* ── Schritt 1: Layout & Vorlagen ── */
      function renderLayoutOptions() {
        $("g-layout").innerHTML = layouts.map((l) =>
          `<option value="${l.id}">${SB.esc(l.name)}${l.is_default ? " (Standard)" : ""}</option>`).join("");
      }

      function renderPresets() {
        $("g-presets").innerHTML = presets.map((p) => `
          <button class="preset-card" data-preset="${p.id}"
                  style="text-align:left;cursor:pointer;background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px">
            <strong>${SB.esc(p.name)}</strong>
            <div class="muted">${p.orientation === "portrait" ? "📱 Hochformat" : "🖥 Querformat"} · ${p.widget_count} Widgets</div>
            <div class="muted mt">${SB.esc(p.description)}</div>
            <span class="btn small mt" style="pointer-events:none">Diese Vorlage nutzen</span>
          </button>`).join("");
      }

      $("g-toggle-presets").addEventListener("click", () => {
        $("g-presets").classList.toggle("hidden");
      });
      $("g-presets").addEventListener("click", async (e) => {
        const card = e.target.closest("[data-preset]");
        if (!card) return;
        await SB.withBusy(card, async () => {
        try {
          const res = await SB.api("/api/admin/layouts/from-preset", {
            method: "POST", body: { preset_id: card.dataset.preset } });
          SB.toast(`Layout „${res.name}" erstellt`);
          layouts = await SB.api("/api/admin/layouts");
          renderLayoutOptions();
          $("g-layout").value = String(res.id);
        } catch (err) { SB.toast(err.message, true); }
        });
      });

      /* ── Schritt 2: Kategorien ── */
      function renderCats() {
        $("g-cats").innerHTML = CATS.map((c) => `
          <button class="cat-tile" data-cat="${c.type}"
                  style="text-align:left;cursor:pointer;background:#fff;
                  border:2px solid ${currentCat?.type === c.type ? "var(--accent)" : "var(--border)"};
                  border-radius:10px;padding:12px">
            <div style="font-size:26px">${c.icon}</div>
            <strong>${c.label}</strong>
            <div class="muted" style="font-size:12px">${c.desc}</div>
          </button>`).join("");
      }
      renderCats();

      /* ── Schritt 3: Formular ── */
      function mediaSelect(multiple) {
        const wrap = document.createElement("div");
        wrap.dataset.kind = multiple ? "medias" : "media";
        if (!media.length) {
          wrap.innerHTML =
            '<span class="muted">Noch keine Medien – <a href="/media">erst hochladen</a>.</span>';
          return wrap;
        }
        if (!multiple) {
          const sel = document.createElement("select");
          sel.innerHTML = `<option value="">– wählen –</option>` +
            media.map((m) =>
              `<option value="${m.id}">${SB.esc(m.title)}</option>`).join("");
          wrap.appendChild(sel);
        } else {
          const ids = new Set();
          wrap.innerHTML = "<div class='chips'></div>";
          const chips = wrap.querySelector(".chips");
          const drawChips = () => {
            chips.innerHTML = "";
            media.forEach((m) => {
              const on = ids.has(m.id);
              const chip = document.createElement("span");
              chip.className = "chip " + (on ? "" : "add");
              chip.innerHTML =
                `${on ? "✓" : "＋"} <img src="${m.thumb_url || m.url}">${SB.esc(m.title)}`;
              chip.addEventListener("click", () => {
                on ? ids.delete(m.id) : ids.add(m.id);
                drawChips();
              });
              chips.appendChild(chip);
            });
          };
          drawChips();
          wrap.getValue = () => [...ids];
        }
        return wrap;
      }

      function buildForm(cat) {
        const form = $("g-form");
        // QR erzeugt einen Extra-URL-Block – deshalb immer neu starten
        form.innerHTML = "";
        for (const f of cat.fields) {
          if (f.kind === "select_qr") {
            const wrap = document.createElement("div");
            wrap.className = "field"; wrap.dataset.key = "_src";
            const lab = document.createElement("label");
            lab.textContent = f.label;
            const sel = document.createElement("select");
            sel.dataset.qrsrc = "1";
            sel.innerHTML = `
              <option value="city_website">Stadt-Website (Einstellung)</option>
              <option value="custom">Eigene URL</option>`;
            sel.addEventListener("change", () => toggleQrUrl(sel.value));
            wrap.append(lab, sel);
            const urlWrap = document.createElement("div");
            urlWrap.className = "field mt"; urlWrap.dataset.key = "url";
            urlWrap.style.display = "none";
            const ulab = document.createElement("label");
            ulab.textContent = "URL";
            const u = document.createElement("input");
            u.placeholder = "https://…";
            urlWrap.append(ulab, u);
            form.append(wrap, urlWrap);
            continue;
          }
          const wrap = document.createElement("div");
          wrap.className = "field mt"; wrap.dataset.key = f.key;
          const lab = document.createElement("label");
          lab.textContent = f.label;
          wrap.appendChild(lab);

          if (f.kind === "media") {
            wrap.appendChild(mediaSelect(false));
          } else if (f.kind === "media_multi") {
            const ms = mediaSelect(true);
            wrap.appendChild(ms);
          } else if (f.kind === "textarea") {
            const ta = document.createElement("textarea");
            ta.rows = 3; ta.value = f.def ?? "";
            wrap.appendChild(ta);
          } else if (f.kind === "select") {
            const sel = document.createElement("select");
            sel.innerHTML = f.options.map(([v, l]) =>
              `<option value="${v}" ${f.def === v ? "selected" : ""}>${SB.esc(l)}</option>`).join("");
            wrap.appendChild(sel);
          } else if (f.kind === "number") {
            const inp = document.createElement("input");
            inp.type = "number";
            inp.min = f.min ?? 0; inp.max = f.max ?? 9999;
            inp.value = f.def ?? "";
            wrap.appendChild(inp);
          } else {
            const inp = document.createElement("input");
            inp.placeholder = f.placeholder || "";
            inp.value = f.def ?? "";
            wrap.appendChild(inp);
          }
          form.appendChild(wrap);
        }
        function toggleQrUrl(mode) {
          const uw = form.querySelector('[data-key="url"]');
          if (uw) uw.style.display = mode === "custom" ? "" : "none";
        }
        // Slot-Auswahl je Format
        const selected = layouts.find((l) => String(l.id) === $("g-layout").value);
        const portrait = selected?.orientation === "portrait";
        const slots = portrait
          ? ["oben-links", "oben-rechts", "links", "rechts", "mitte-gross",
             "unten-band", "voll-bild"]
          : Object.keys(SLOT_LABELS);
        $("g-slot").innerHTML = slots.map((s) =>
          `<option value="${s}" ${s === cat.slot ? "selected" : ""}>${SLOT_LABELS[s]}</option>`).join("");
      }

      $("g-cats").addEventListener("click", (e) => {
        const tile = e.target.closest("[data-cat]");
        if (!tile) return;
        currentCat = CATS.find((c) => c.type === tile.dataset.cat);
        renderCats();
        $("g-form-title").textContent =
          `${currentCat.icon} ${currentCat.label} – Angaben`;
        $("g-form-panel").classList.remove("hidden");
        buildForm(currentCat);
        $("g-form-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
      });

      $("g-add").addEventListener("click", (e) => {
        if (!currentCat) return;
        SB.withBusy(e.target, async () => {
        const layoutId = $("g-layout").value;
        if (!layoutId) return SB.toast("Erst ein Layout in Schritt 1 wählen", true);
        const cfg = {};
        for (const wrap of $("g-form").querySelectorAll("[data-key]")) {
          const key = wrap.dataset.key;
          if (key === "url") continue;                 // nur bei QR relevant
          const multi = wrap.querySelector("[data-kind='medias']");
          if (multi && typeof multi.getValue === "function") {
            cfg[key] = multi.getValue();
            continue;
          }
          const inner = wrap.querySelector("input,select,textarea");
          if (!inner) continue;
          let val = inner.value;
          if (inner.type === "number") {
            val = val === "" ? undefined : Number(val);
          }
          if (val !== "" && val !== undefined) cfg[key] = val;
        }
        if (currentCat.type === "qr") {
          const srcSel = $("g-form").querySelector("select[data-qrsrc]");
          if (srcSel && srcSel.value === "custom") {
            const u = $('g-form').querySelector('[data-key="url"] input');
            if (u && u.value.trim()) {
              cfg.url = u.value.trim();
              delete cfg.setting_key;
            }
          } else {
            cfg.setting_key = "city_website";
          }
        }
        try {
          const res = await SB.api(`/api/admin/layouts/${layoutId}/add-widget`, {
            method: "POST",
            body: { type: currentCat.type, config: cfg,
                    slot: $("g-slot").value },
          });
          $("g-done-preview").href = res.preview_url;
          $("g-done").classList.remove("hidden");
          SB.toast(`${currentCat.label} hinzugefügt – ▶ Vorschau ansehen!`);
        } catch (err) { SB.toast(err.message, true); }
        });
      });

      $("g-done-more").addEventListener("click", () => {
        $("g-done").classList.add("hidden");
      });
      $("g-layout").addEventListener("change", () => {
        if (currentCat) buildForm(currentCat);  // Slot-Map ans Format anpassen
      });

      [layouts, media, presets] = await Promise.all([
        SB.api("/api/admin/layouts"),
        SB.api("/api/admin/media").catch(() => []),
        SB.api("/api/admin/layout-presets"),
      ]);
      renderLayoutOptions();
      renderPresets();
    },

    /* ── Zeitpläne ─────────────────────────────────────────────────────── */
    async pageSchedules() {
      let schedules = [], layouts = [];
      const listBody = document.getElementById("sched-rows");
      const nameIn = document.getElementById("sched-name");
      const prioIn = document.getElementById("sched-priority");
      const rulesBox = document.getElementById("sched-rules");
      const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

      const layoutOptions = sel =>
        layouts.map(l => `<option value="${l.id}" ${sel === l.id ? "selected" : ""}>
          ${this.esc(l.name)}</option>`).join("");

      const addRuleRow = rule => {
        const row = document.createElement("div");
        row.className = "panel rule-row";
        row.style.padding = "10px";
        const wd = rule.weekdays || [0, 1, 2, 3, 4, 5, 6];
        row.innerHTML = `
          <div class="inline" style="gap:14px;display:flex;flex-wrap:wrap;align-items:center">
            <span class="field"><label>Von</label>
              <input type="time" class="r-start" value="${rule.start || "00:00"}"></span>
            <span class="field"><label>Bis</label>
              <input type="time" class="r-end" value="${rule.end || "23:59"}"></span>
            <span class="field"><label>Wochentage</label><span class="wd-group">
              ${WD.map((n, i) => `<label class="checkbox" style="font-size:12px">
                <input type="checkbox" class="r-wd" value="${i}"
                  ${wd.includes(i) ? "checked" : ""}>${n}</label>`).join("")}
            </span></span>
            <span class="field"><label>Layout</label>
              <select class="r-layout">${layoutOptions(rule.layout_id)}</select></span>
            <button type="button" class="btn danger small r-remove">✕</button>
          </div>`;
        row.querySelector(".r-remove").addEventListener("click", () => row.remove());
        rulesBox.appendChild(row);
      };

      const collectRules = () =>
        [...rulesBox.querySelectorAll(".rule-row")].map(row => ({
          start: row.querySelector(".r-start").value || "00:00",
          end: row.querySelector(".r-end").value || "23:59",
          weekdays: [...row.querySelectorAll(".r-wd:checked")].map(c => Number(c.value)),
          layout_id: Number(row.querySelector(".r-layout").value),
        })).filter(r => r.layout_id);

      let editId = null;
      const reload = async () => {
        [schedules, layouts] = await Promise.all([
          this.api("/api/admin/schedules"), this.api("/api/admin/layouts")]);
        listBody.innerHTML = schedules.map(s => `
          <tr data-id="${s.id}">
            <td>${this.esc(s.name)}
                ${s.active_now ? '<span class="badge ok">jetzt aktiv</span>' : ""}
                <div class="muted">Priorität ${s.priority} ·
                ${(s.rules || []).length} Regel(n)</div></td>
            <td class="muted">${(s.rules || []).map(r =>
              `${r.start}–${r.end}`).join("<br>") || "–"}</td>
            <td style="white-space:nowrap">
              <button class="btn secondary small" data-edit="${s.id}">Bearbeiten</button>
              <button class="btn danger small" data-del="${s.id}">Löschen</button>
            </td></tr>`).join("") ||
          `<tr><td colspan="3" class="muted">Keine Zeitpläne – Displays zeigen immer das
             Standardlayout.</td></tr>`;
      };

      document.getElementById("sched-add-rule").addEventListener("click",
        () => addRuleRow({}));
      document.getElementById("sched-new").addEventListener("click", () => {
        editId = null; nameIn.value = ""; prioIn.value = "1";
        rulesBox.innerHTML = "";
      });

      document.getElementById("sched-save").addEventListener("click", (e) => {
        this.withBusy(e.target, async () => {
        const body = { name: nameIn.value.trim(), priority: Number(prioIn.value),
          rules: collectRules() };
        if (!body.name) return this.toast("Name fehlt", true);
        try {
          if (editId) {
            await this.api(`/api/admin/schedules/${editId}`, { method: "PATCH", body });
          } else {
            await this.api("/api/admin/schedules", { method: "POST", body });
          }
          editId = null;
          this.toast("Zeitplan gespeichert");
          await reload();
        } catch (err) { this.toast(err.message, true); }
        });
      });

      listBody.addEventListener("click", async e => {
        const del = e.target.closest("[data-del]");
        const ed = e.target.closest("[data-edit]");
        try {
          if (del) {
            if (!confirm("Zeitplan löschen?")) return;
            await this.api(`/api/admin/schedules/${del.dataset.del}`, { method: "DELETE" });
            await reload();
          } else if (ed) {
            const s = schedules.find(x => x.id === Number(ed.dataset.edit));
            editId = s.id;
            nameIn.value = s.name;
            prioIn.value = String(s.priority);
            rulesBox.innerHTML = "";
            (s.rules || []).forEach(addRuleRow);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        } catch (err) { this.toast(err.message, true); }
      });

      await reload().catch(err => this.toast(err.message, true));
      if (!rulesBox.children.length) addRuleRow({});
    },

    /* ── Einstellungen ─────────────────────────────────────────────────── */
    async pageSettings() {
      const form = document.getElementById("settings-form");
      let logoOptions = [];

      const [data, media] = await Promise.all([
        this.api("/api/admin/settings"),
        this.api("/api/admin/media").catch(() => []),
      ]);
      logoOptions = media.filter(m => m.kind === "image");
      const v = data.values;
      for (const key of Object.keys(v)) {
        const input = form.elements[key];
        if (input) input.type === "checkbox"
          ? (input.checked = v[key] === "true")
          : (input.value = v[key]);
      }
      const logoSel = document.getElementById("set-logo");
      logoSel.innerHTML = `<option value="">Kein Logo</option>` +
        logoOptions.map(m => `<option value="${m.id}"
          ${v.logo_media_id === String(m.id) ? "selected" : ""}>${this.esc(m.title)}</option>`).join("");
      logoSel.value = v.logo_media_id || "";

      form.addEventListener("submit", async e => {
        e.preventDefault();
        await this.withBusy(e.submitter, async () => {
        const values = {};
        for (const key of Object.keys(v)) {
          const input = form.elements[key];
          if (input) values[key] = input.type === "checkbox"
            ? (input.checked ? "true" : "false") : input.value;
        }
        values.logo_media_id = logoSel.value;
        try {
          await this.api("/api/admin/settings", { method: "PUT", body: { values } });
          this.toast("Einstellungen gespeichert");
        } catch (err) { this.toast(err.message, true); }
        });
      });

      document.getElementById("weather-refresh").addEventListener("click", (e) => {
        this.withBusy(e.target, async () => {
        const out = document.getElementById("weather-result");
        out.textContent = "Abruf läuft …";
        try {
          const w = await this.api("/api/admin/weather/refresh", { method: "POST" });
          out.textContent = `Quelle: ${w.source}${w.stale ? " (VERALTET)" : ""} · ` +
            `${w.temp_c} °C · ${w.condition}` +
            (w.forecast.length ? ` · Vorhersage: ${w.forecast.length} Tage` : "");
        } catch (err) { out.textContent = "Fehler: " + err.message; }
        });
      });

      /* Benutzerverwaltung (nur Admin) */
      const me = document.getElementById("me-user")?.textContent.trim();
      async function reloadUsers() {
        const users = await this.api("/api/admin/users");
        document.querySelector("#users-table tbody").innerHTML =
          users.map(u => `
            <tr><td>${this.esc(u.username)}
                <span class="badge">${u.role}</span></td>
                <td style="text-align:right">
                  ${u.username === me ? "" :
                    `<button class="btn danger small" data-deluser="${u.id}">Löschen</button>`}
                </td></tr>`).join("");
      }
      document.querySelector("#users-table").addEventListener("click", async (e) => {
        const del = e.target.closest("[data-deluser]");
        if (!del) return;
        if (!confirm("Benutzer wirklich löschen?")) return;
        try {
          await this.api(`/api/admin/users/${del.dataset.deluser}`, { method: "DELETE" });
          await reloadUsers.call(this);
        } catch (err) { this.toast(err.message, true); }
      });
      document.getElementById("user-create").addEventListener("click", (e) => {
        this.withBusy(e.target, async () => {
        const f = document.getElementById("user-form");
        try {
          await this.api("/api/admin/users", {
            method: "POST",
            body: { username: f.username.value.trim(),
              password: f.password.value, role: f.role.value },
          });
          f.reset();
          this.toast("Benutzer angelegt");
          await reloadUsers.call(this);
        } catch (err) { this.toast(err.message, true); }
        });
      });
      await reloadUsers.call(this).catch(err => this.toast(err.message, true));
    },

    /* ── Konto (Passwort ändern, alle Rollen) ──────────────────────────── */
    pageKonto() {
      document.getElementById("pw-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target;
        try {
          await this.api("/api/admin/password", {
            method: "PUT", body: { old: f.old.value, new: f.new.value } });
          f.reset();
          this.toast("Passwort geändert – Initial-Passwort wurde entfernt");
        } catch (err) { this.toast(err.message, true); }
      });
    },

    /* ── Datenschutz ───────────────────────────────────────────────────── */
    async pageDatenschutz() {
      try {
        const data = await this.api("/api/admin/settings");
        const ext = data.values.allow_external === "true";
        const mode = data.values.weather_mode;
        const badge = document.getElementById("privacy-badge");
        badge.textContent = ext
          ? `Externe Dienste AKTIVIERT (Wetter: ${mode})`
          : "Externe Dienste DEAKTIVIERT – Betrieb vollständig lokal";
        badge.className = "badge " + (ext ? "warn" : "ok");
        const cache = data.weather_cache || {};
        document.getElementById("privacy-cache").textContent = cache.cached
          ? `Letzter externer Wetterabruf: ${this.fmtDT(cache.fetched_at)} Uhr`
          : "Kein externer Wetterabruf vorhanden.";
      } catch (err) { /* Seite funktioniert auch ohne */ }
    },
  };

  window.SB = SB;
  document.addEventListener("DOMContentLoaded", () => SB.initPage());
})();
