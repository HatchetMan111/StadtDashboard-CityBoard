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
      box.appendChild(t);
      setTimeout(() => t.remove(), 4200);
    },

    esc(s) {
      return String(s ?? "").replace(/[&<>"']/g,
        c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
        layouts: () => this.pageLayouts(),
        schedules: () => this.pageSchedules(),
        settings: () => this.pageSettings(),
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
        const [displays, anns, events] = await Promise.all([
          this.api("/api/admin/displays"),
          this.api("/api/admin/announcements"),
          this.api("/api/admin/events"),
        ]);
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
      let layouts = [], schedules = [];
      const reload = async () => {
        [layouts, schedules] = await Promise.all([
          this.api("/api/admin/layouts"), this.api("/api/admin/schedules")]);
        const rows = await this.api("/api/admin/displays");
        render(rows);
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
            <td style="white-space:nowrap">
              ${!d.approved ? `<button class="btn small" data-act="approve">Koppeln</button>` : ""}
              <button class="btn secondary small" data-act="edit">Bearbeiten</button>
              ${d.approved ? `<button class="btn secondary small" data-act="toggle">
                    ${d.enabled ? "Sperren" : "Entsperren"}</button>` : ""}
              <button class="btn secondary small" data-act="revoke">Token neu</button>
              <button class="btn danger small" data-act="delete">Löschen</button>
            </td>
          </tr>`).join("") ||
          `<tr><td colspan="4" class="muted">Noch keine Displays registriert.
             Öffne <code>http://SERVER:8080/display</code> am Gerät.</td></tr>`;
      };

      document.getElementById("display-rows").addEventListener("change", async e => {
        const tr = e.target.closest("tr[data-id]");
        if (!tr || e.target.tagName !== "SELECT") return;
        const field = e.target.dataset.act === "layout" ? "layout_id" : "schedule_id";
        const val = e.target.value ? Number(e.target.value) : null;
        try {
          await this.api(`/api/admin/displays/${tr.dataset.id}`,
            { method: "PATCH", body: { [field]: val } });
          this.toast("Gespeichert");
        } catch (err) { this.toast(err.message, true); }
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
            const enabled = btn.textContent.trim() === "Sperren";
            await this.api(`/api/admin/displays/${id}`, { method: "PATCH", body: { enabled } });
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
        const row = document.querySelector(`tr[data-id="${id}"]`);
        modal.dataset.id = id;
        modal.dname.value = row.children[1].childNodes[0].textContent.trim();
        modal.dloc.value = row.querySelector(".muted").textContent.trim();
        modal.dorient.value = row.children[1].textContent.includes("portrait")
          ? "portrait" : "landscape";
        modal.classList.add("open");
      };
      document.getElementById("display-modal-cancel")
        .addEventListener("click", () => modal.classList.remove("open"));
      document.getElementById("display-modal-save").addEventListener("click", async () => {
        try {
          await this.api(`/api/admin/displays/${modal.dataset.id}`, {
            method: "PATCH",
            body: { name: modal.dname.value.trim(), location: modal.dloc.value.trim(),
              orientation: modal.dorient.value },
          });
          modal.classList.remove("open");
          this.toast("Gespeichert");
          await reload();
        } catch (err) { this.toast(err.message, true); }
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
    pageEvents() { this._crudList({
      listId: "ev-rows", formId: "ev-form", endpoint: "/api/admin/events",
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
      const form = document.getElementById(cfg.formId);
      const head = document.getElementById(`${cfg.formId}-title`);

      const reload = async () => {
        const rows = await this.api(cfg.endpoint);
        document.getElementById(cfg.listId).innerHTML = rows.map(r => `
          <tr data-id="${r.id}">${cfg.rowHtml.call(this, r)}
            <td style="white-space:nowrap">
              <button class="btn secondary small" data-edit="${r.id}">Bearbeiten</button>
              <button class="btn danger small" data-del="${r.id}">Löschen</button>
            </td></tr>`).join("") ||
          `<tr><td colspan="5" class="muted">Noch keine Einträge.</td></tr>`;
      };

      form.addEventListener("submit", async e => {
        e.preventDefault();
        try {
          const body = cfg.fill(form);
          if (editId) {
            await this.api(`${cfg.endpoint}/${editId}`, { method: "PATCH", body });
          } else {
            await this.api(cfg.endpoint, { method: "POST", body });
          }
          cfg.resetForm(form);
          editId = null;
          head.textContent = "Neu anlegen";
          form.querySelector('button[type="submit"]').textContent = "Hinzufügen";
          this.toast("Gespeichert");
          await reload();
        } catch (err) { this.toast(err.message, true); }
      });

      document.getElementById(cfg.listId).addEventListener("click", async e => {
        const del = e.target.closest("[data-del]");
        const ed = e.target.closest("[data-edit]");
        try {
          if (del) {
            if (!confirm("Wirklich löschen?")) return;
            await this.api(`${cfg.endpoint}/${del.dataset.del}`, { method: "DELETE" });
            this.toast("Gelöscht");
            await reload();
          } else if (ed) {
            const rows = await this.api(cfg.endpoint);
            const item = rows.find(r => String(r.id) === ed.dataset.edit);
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
            form.querySelector('button[type="submit"]').textContent = "Änderungen speichern";
            form.scrollIntoView({ behavior: "smooth" });
          }
        } catch (err) { this.toast(err.message, true); }
      });

      await reload().catch(err => this.toast(err.message, true));
    },

    /* ── Medien ────────────────────────────────────────────────────────── */
    async pageMedia() {
      const grid = document.getElementById("media-grid");
      const input = document.getElementById("media-input");

      const reload = async () => {
        const items = await this.api("/api/admin/media");
        grid.innerHTML = items.map(m => `
          <div class="media-item" data-id="${m.id}">
            ${m.kind === "image"
              ? `<img src="${m.thumb_url || m.url}" alt="" loading="lazy">`
              : `<video src="${m.url}" preload="metadata"></video>`}
            <div class="meta"><strong>${this.esc(m.title)}</strong>
              <div class="muted">${this.fmtSize(m.size)} · ${this.esc(m.mime)}</div></div>
            <div class="actions">
              <button class="btn danger small" data-del="${m.id}">Löschen</button>
            </div>
          </div>`).join("") ||
          `<p class="muted">Noch keine Medien hochgeladen.</p>`;
      };

      document.getElementById("media-upload").addEventListener("submit", async e => {
        e.preventDefault();
        if (!input.files.length) return this.toast("Keine Datei gewählt", true);
        const fd = new FormData();
        fd.append("file", input.files[0]);
        try {
          await this.api("/api/admin/media", { method: "POST", body: fd });
          this.toast("Upload erfolgreich");
          input.value = "";
          await reload();
        } catch (err) { this.toast(err.message, true); }
      });

      grid.addEventListener("click", async e => {
        const del = e.target.closest("[data-del]");
        if (!del) return;
        if (!confirm("Medium wirklich löschen?")) return;
        try {
          await this.api(`/api/admin/media/${del.dataset.del}`, { method: "DELETE" });
          await reload();
        } catch (err) { this.toast(err.message, true); }
      });

      await reload().catch(err => this.toast(err.message, true));
    },

    /* ── Layouts ───────────────────────────────────────────────────────── */
    async pageLayouts() {
      let layouts = [], currentId = null;
      const nameIn = document.getElementById("layout-name");
      const orientSel = document.getElementById("layout-orientation");
      const jsonTa = document.getElementById("layout-json");
      const preview = document.getElementById("layout-preview");
      const list = document.getElementById("layout-list");

      const WIDGETS = {
        header: { x: 3, y: 3, w: 40, h: 11, config: {} },
        clock: { x: 68, y: 3, w: 15, h: 11, config: {} },
        date: { x: 55, y: 3, w: 12, h: 11, config: {} },
        weather: { x: 84, y: 3, w: 13, h: 11, config: {} },
        forecast: { x: 80, y: 15, w: 17, h: 20, config: {} },
        text: { x: 40, y: 40, w: 30, h: 15, config: { text: "Willkommen!" } },
        image: { x: 36, y: 17, w: 38, h: 50, config: { media_id: null } },
        gallery: { x: 36, y: 17, w: 38, h: 62, config: { media_ids: [], seconds: 8 } },
        events: { x: 77, y: 17, w: 20, h: 46, config: { count: 5 } },
        announcements: { x: 3, y: 17, w: 30, h: 62, config: { count: 4 } },
        qr: { x: 77, y: 65, w: 20, h: 19, config: { setting_key: "city_website",
          label: "Mehr erfahren" } },
        ticker: { x: 0, y: 91, w: 100, h: 9, config: {} },
      };

      const parseJson = () => {
        try {
          const val = JSON.parse(jsonTa.value);
          if (!Array.isArray(val)) throw new Error("Elemente müssen ein Array sein");
          return val;
        } catch (err) {
          this.toast("JSON-Fehler: " + err.message, true);
          return null;
        }
      };
      const drawPreview = () => {
        const els = parseJson() || [];
        preview.className = "preview-box" +
          (orientSel.value === "portrait" ? " portrait" : "");
        preview.innerHTML = els.map((el, i) => `
          <div class="preview-el" style="left:${el.x}%;top:${el.y}%;width:${el.w}%;height:${el.h}%"
               title="Element ${i + 1}">${this.esc(el.type)}</div>`).join("");
      };

      const renderList = () => {
        list.innerHTML = layouts.map(l => `
          <tr data-id="${l.id}" class="${l.id === currentId ? "current" : ""}">
            <td>${this.esc(l.name)} ${l.is_default ? '<span class="badge ok">Standard</span>' : ""}
                <div class="muted">${this.esc(l.orientation)} · ${(l.elements || []).length} Elemente</div></td>
            <td style="white-space:nowrap">
              <button class="btn secondary small" data-load="${l.id}">Laden</button>
              ${l.is_default ? "" :
                `<button class="btn secondary small" data-default="${l.id}">Standard</button>`}
              <button class="btn danger small" data-del="${l.id}">Löschen</button>
            </td></tr>`).join("");
      };

      const loadLayout = id => {
        currentId = id;
        const l = layouts.find(x => x.id === id);
        if (!l) return;
        nameIn.value = l.name;
        orientSel.value = l.orientation;
        jsonTa.value = JSON.stringify(l.elements, null, 2);
        renderList();
        drawPreview();
      };

      list.addEventListener("click", async e => {
        const load = e.target.closest("[data-load]");
        const def = e.target.closest("[data-default]");
        const del = e.target.closest("[data-del]");
        try {
          if (load) loadLayout(Number(load.dataset.load));
          else if (def) {
            const l = layouts.find(x => x.id === Number(def.dataset.default));
            await this.api(`/api/admin/layouts/${l.id}`, {
              method: "PATCH",
              body: { name: l.name, orientation: l.orientation, elements: l.elements,
                is_default: true },
            });
            await reloadAll();
            this.toast("Standardlayout gesetzt");
          } else if (del) {
            if (!confirm("Layout wirklich löschen?")) return;
            await this.api(`/api/admin/layouts/${del.dataset.del}`, { method: "DELETE" });
            if (currentId === Number(del.dataset.del)) currentId = null;
            await reloadAll();
          }
        } catch (err) { this.toast(err.message, true); }
      });

      const reloadAll = async () => {
        layouts = await this.api("/api/admin/layouts");
        renderList();
        if (currentId == null && layouts.length) loadLayout(layouts[0].id);
      };

      document.getElementById("layout-new").addEventListener("click", () => {
        currentId = null;
        nameIn.value = "Neues Layout";
        jsonTa.value = "[]";
        renderList();
        drawPreview();
      });

      document.getElementById("layout-save").addEventListener("click", async () => {
        const els = parseJson();
        if (els === null) return;
        const body = { name: nameIn.value.trim() || "Layout",
          orientation: orientSel.value, elements: els,
          is_default: layouts.find(l => l.id === currentId)?.is_default || false };
        try {
          if (currentId) {
            await this.api(`/api/admin/layouts/${currentId}`, { method: "PATCH", body });
          } else {
            const res = await this.api("/api/admin/layouts", { method: "POST", body });
            currentId = res.id;
          }
          this.toast("Layout gespeichert");
          await reloadAll();
        } catch (err) { this.toast(err.message, true); }
      });

      document.querySelectorAll("[data-widget]").forEach(btn => {
        btn.addEventListener("click", () => {
          const els = parseJson();
          if (els === null) return;
          els.push({ type: btn.dataset.widget, ...WIDGETS[btn.dataset.widget] });
          jsonTa.value = JSON.stringify(els, null, 2);
          drawPreview();
        });
      });

      jsonTa.addEventListener("input", drawPreview);
      orientSel.addEventListener("change", drawPreview);

      await reloadAll().catch(err => this.toast(err.message, true));
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
            <td>${this.esc(s.name)}<div class="muted">Priorität ${s.priority} ·
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

      document.getElementById("sched-save").addEventListener("click", async () => {
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

      document.getElementById("weather-refresh").addEventListener("click", async () => {
        const out = document.getElementById("weather-result");
        out.textContent = "Abruf läuft …";
        try {
          const w = await this.api("/api/admin/weather/refresh", { method: "POST" });
          out.textContent = `Quelle: ${w.source}${w.stale ? " (VERALTET)" : ""} · ` +
            `${w.temp_c} °C · ${w.condition}` +
            (w.forecast.length ? ` · Vorhersage: ${w.forecast.length} Tage` : "");
        } catch (err) { out.textContent = "Fehler: " + err.message; }
      });

      document.getElementById("pw-form").addEventListener("submit", async e => {
        e.preventDefault();
        const f = e.target;
        try {
          await this.api("/api/admin/password", {
            method: "PUT", body: { old: f.old.value, new: f.new.value } });
          f.reset();
          this.toast("Passwort geändert");
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
