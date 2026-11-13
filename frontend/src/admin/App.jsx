/* App-Shell: Sidebar-Navigation + Routen. Rollensteuerung über /api/admin/me. */
import React, { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "../shared/api.js";
import { Spinner } from "../shared/ui.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Displays from "./pages/Displays.jsx";
import Announcements from "./pages/Announcements.jsx";
import Events from "./pages/Events.jsx";
import Media from "./pages/Media.jsx";
import Gestalten from "./pages/Gestalten.jsx";
import Layouts from "./pages/Layouts.jsx";
import Schedules from "./pages/Schedules.jsx";
import Settings from "./pages/Settings.jsx";
import Konto from "./pages/Konto.jsx";
import Datenschutz from "./pages/Datenschutz.jsx";

const MeCtx = createContext({ username: null, role: null });
export const useMe = () => useContext(MeCtx);

const NAV = [
  { group: "Überblick" },
  { to: "/", ico: "📊", label: "Dashboard", end: true },
  { to: "/displays", ico: "📺", label: "Displays", admin: true },
  { group: "Inhalte" },
  { to: "/announcements", ico: "📢", label: "Bekanntmachungen" },
  { to: "/events", ico: "🎉", label: "Veranstaltungen" },
  { to: "/media", ico: "🖼", label: "Medien" },
  { group: "Aussehen" },
  { to: "/gestalten", ico: "✨", label: "Layout gestalten" },
  { to: "/layouts", ico: "🧩", label: "Layouts", admin: true },
  { to: "/schedules", ico: "⏰", label: "Zeitpläne", admin: true },
  { group: "System" },
  { to: "/settings", ico: "⚙️", label: "Einstellungen", admin: true },
  { to: "/datenschutz", ico: "🔒", label: "Datenschutz", admin: true },
  { to: "/konto", ico: "👤", label: "Konto" },
];

export default function App() {
  const [me, setMe] = useState(null);      // null = prüfe noch
  const [version, setVersion] = useState("");
  const location = useLocation();

  useEffect(() => {
    /* 401 ist hier ein normaler Zustand (Login-Seite) – kein Redirect. */
    api("/api/admin/me", { noRedirect: true })
      .then(setMe)
      .catch(() => setMe({ username: null, role: null }));
  }, []);

  useEffect(() => {
    if (location.pathname !== "/login") return;
    /* Login-Seite rendert ohne Shell – nichts zu tun. */
  }, [location]);

  if (!me) return <div className="spinner-wrap" style={{ padding: 40 }}><Spinner /></div>;

  if (location.pathname === "/login") {
    return me.username
      ? <Navigate to="/" replace />
      : <Login onLogin={async () => {
          try { setMe(await api("/api/admin/me")); }
          catch { window.location.href = "/"; }
        }} />;
  }

  if (!me.username) {
    /* 401-Redirects erledigt api(); ohne Session zur Login-Seite. */
    window.location.href = "/login";
    return null;
  }

  const isAdmin = me.role === "admin";

  return (
    <MeCtx.Provider value={me}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="logo">🏙</span>
            <div>
              <b>StadtDashboard</b>
              <span>{version ? `v${version} · ` : ""}Open Source</span>
            </div>
          </div>
          <nav>
            {NAV.map((item, i) =>
              item.group
                ? <div key={i} className="nav-group">{item.group}</div>
                : (item.admin && !isAdmin)
                  ? null
                  : <NavLink key={item.to} to={item.to} end={item.end}
                      className={({ isActive }) => (isActive ? "active" : "")}>
                      <span className="ico">{item.ico}</span>{item.label}
                    </NavLink>)}
          </nav>
          <div className="side-foot">
            <div className="user-chip">
              <span className="avatar">{(me.username || "?")[0]}</span>
              <div>
                <b>{me.username}</b>
                <span>{isAdmin ? "Administrator" : "Redakteur"}</span>
              </div>
            </div>
            <button className="btn secondary small" style={{ width: "100%" }}
              onClick={async () => {
                await api("/api/admin/logout", { method: "POST" });
                window.location.href = "/login";
              }}>
              Abmelden
            </button>
          </div>
        </aside>
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard onVersion={setVersion} />} />
            <Route path="/displays" element={<AdminRoute><Displays /></AdminRoute>} />
            <Route path="/announcements" element={<Announcements />} />
            <Route path="/events" element={<Events />} />
            <Route path="/media" element={<Media />} />
            <Route path="/gestalten" element={<Gestalten />} />
            <Route path="/layouts" element={<AdminRoute><Layouts /></AdminRoute>} />
            <Route path="/schedules" element={<AdminRoute><Schedules /></AdminRoute>} />
            <Route path="/settings" element={<AdminRoute><Settings /></AdminRoute>} />
            <Route path="/datenschutz" element={<AdminRoute><Datenschutz /></AdminRoute>} />
            <Route path="/konto" element={<Konto />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </MeCtx.Provider>
  );
}

function AdminRoute({ children }) {
  const me = useMe();
  if (me.role !== "admin") return <Navigate to="/" replace />;
  return children;
}
