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
        const [displays, anns, events, status] = await Promise.all([
          this.api("/api/admin/displays"),
          this.api("/api/admin/announcements"),
          this.api("/api/admin/events"),
          this.api("/api/admin/status"),
        ]);
        if (status.initial_password_active) {
          document.getElementById("pw-banner").classList.remove("hidden");
        }
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

    /* ── Layouts: Drag-&-Drop-Editor ───────────────────────────────────── */
    async pageLayouts() {
      const S = { layouts: [], id: null, els: [], sel: -1, media: [] };
      const $ = (id) => document.getElementById(id);
      const canvas = $("ed-canvas"), propsBox = $("ed-props");
      const ICONS = { header: "🏙", clock: "🕐", date: "📅", weather: "🌤",
        forecast: "🌦", text: "📝", image: "🖼", gallery: "🎞",
        events: "🎉", announcements: "📢", qr: "🔳", ticker: "📰" };
      const LABELS = { header: "Kopf", clock: "Uhr", date: "Datum",
        weather: "Wetter", forecast: "Vorhersage", text: "Text",
        image: "Bild", gallery: "Galerie", events: "Veranstaltungen",
        announcements: "Bekanntmachungen", qr: "QR-Code", ticker: "Ticker" };
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
          if (i === S.sel) {
            const h = document.createElement("span");
            h.className = "ed-handle";
            d.appendChild(h);
          }
          canvas.appendChild(d);
          positionEl(i);
        });
      }

      let drag = null;
      canvas.addEventListener("pointerdown", (e) => {
        const target = e.target.closest(".ed-el");
        if (!target) { select(-1); return; }
        const i = Number(target.dataset.i);
        select(i);
        drag = {
          i,
          mode: e.target.classList.contains("ed-handle") ? "resize" : "move",
          startX: e.clientX, startY: e.clientY,
          orig: { ...S.els[i] }, rect: canvas.getBoundingClientRect(),
          moved: false,
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
          el.x = clamp(Math.round(drag.orig.x + dx), 0, 100 - el.w);
          el.y = clamp(Math.round(drag.orig.y + dy), 0, 100 - el.h);
        } else {
          el.w = clamp(Math.round(drag.orig.w + dx), 3, 100 - el.x);
          el.h = clamp(Math.round(drag.orig.h + dy), 3, 100 - el.y);
        }
        positionEl(drag.i);
        syncPosInputs();
      });
      canvas.addEventListener("pointerup", () => { drag = null; });
      canvas.addEventListener("pointercancel", () => { drag = null; });

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
      function numInput(value, min, max, onInput) {
        const inp = document.createElement("input");
        inp.type = "number"; inp.value = value;
        inp.min = min; inp.max = max;
        inp.addEventListener("input", () => onInput(Number(inp.value)));
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
          });
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

        const actions = document.createElement("p");
        actions.style.cssText = "display:flex;gap:8px;margin-top:10px";
        const del = document.createElement("button");
        del.className = "btn danger small"; del.textContent = "Element löschen";
        del.addEventListener("click", () => {
          S.els.splice(S.sel, 1); select(-1); draw();
        });
        const dup = document.createElement("button");
        dup.className = "btn secondary small"; dup.textContent = "Duplizieren";
        dup.addEventListener("click", () => {
          const copy = JSON.parse(JSON.stringify(el));
          copy.x = clamp(copy.x + 2, 0, 100 - copy.w);
          copy.y = clamp(copy.y + 2, 0, 100 - copy.h);
          S.els.splice(S.sel + 1, 0, copy); select(S.sel + 1); draw();
        });
        actions.append(del, dup);
        propsBox.appendChild(actions);
      }

      /* ── Palette ── */
      $("palette").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-widget]");
        if (!btn) return;
        const type = btn.dataset.widget;
        S.els.push({ type, ...JSON.parse(JSON.stringify(DEFAULTS[type])) });
        select(S.els.length - 1);
        draw();
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
              ${l.is_default ? "" :
                `<button class="btn secondary small" data-default="${l.id}">Standard</button>`}
              <button class="btn danger small" data-del="${l.id}">Löschen</button>
            </td></tr>`).join("");
      }

      function loadLayout(id) {
        const l = S.layouts.find((x) => x.id === id);
        if (!l) return;
        S.id = id;
        S.els = JSON.parse(JSON.stringify(l.elements || []));
        S.sel = -1;
        $("layout-name").value = l.name;
        $("layout-orientation").value = l.orientation;
        renderList(); draw(); buildProps();
      }

      $("layout-list").addEventListener("click", async (e) => {
        const load = e.target.closest("[data-load]");
        const def = e.target.closest("[data-default]");
        const del = e.target.closest("[data-del]");
        try {
          if (load) loadLayout(Number(load.dataset.load));
          else if (def) {
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
        S.id = null; S.els = []; S.sel = -1;
        $("layout-name").value = "Neues Layout";
        renderList(); draw(); buildProps();
      });

      $("layout-save").addEventListener("click", async () => {
        const name = $("layout-name").value.trim() || "Layout";
        const current = S.layouts.find((l) => l.id === S.id);
        const body = { name, orientation: $("layout-orientation").value,
          elements: S.els, is_default: current?.is_default || false };
        try {
          if (S.id) {
            await SB.api(`/api/admin/layouts/${S.id}`, { method: "PATCH", body });
          } else {
            const res = await SB.api("/api/admin/layouts", { method: "POST", body });
            S.id = res.id;
          }
          SB.toast("Layout gespeichert");
          await reloadAll();
        } catch (err) { SB.toast(err.message, true); }
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
          S.els = parsed; S.sel = -1; draw(); buildProps();
          SB.toast("JSON übernommen");
        } catch (err) { SB.toast("JSON-Fehler: " + err.message, true); }
      });

      async function reloadAll() {
        [S.layouts, S.media] = await Promise.all([
          SB.api("/api/admin/layouts"),
          SB.api("/api/admin/media").catch(() => []),
        ]);
        renderList();
        if (S.id == null && S.layouts.length) loadLayout(S.layouts[0].id);
        else if (S.id != null) { const cur = S.layouts.find(l => l.id === S.id); if (cur) loadLayout(S.id); }
        buildProps();
      }

      await reloadAll().catch((err) => SB.toast(err.message, true));
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
