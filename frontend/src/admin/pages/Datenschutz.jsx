import React, { useEffect, useState } from "react";
import { api, fmtDT } from "../../shared/api.js";
import { Panel, Badge } from "../../shared/ui.jsx";

export default function Datenschutz() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api("/api/admin/settings").then(setData).catch(() => {});
  }, []);

  const ext = data?.values?.allow_external === "true";
  const mode = data?.values?.weather_mode || "manual";
  const cache = data?.weather_cache || {};

  return (
    <>
      <h1>Datenschutz</h1>
      <p className="subtitle">Welche Verbindungen geht dieses System wirklich?</p>

      <Panel title="Status">
        <p style={{ fontSize: 16, margin: "6px 0 12px" }}>
          <Badge kind={ext ? "warn" : "ok"}>
            {ext
              ? `Externe Dienste AKTIVIERT (Wetter: ${mode})`
              : "Externe Dienste DEAKTIVIERT – Betrieb vollständig lokal"}
          </Badge>
        </p>
        <p className="muted" style={{ fontSize: 14 }}>
          {cache.cached
            ? `Letzter externer Wetterabruf: ${fmtDT(cache.fetched_at)} Uhr`
            : "Kein externer Wetterabruf vorhanden."}
        </p>
      </Panel>

      <Panel title="Grundsätze">
        <ul style={{ paddingLeft: 20, lineHeight: 1.9, fontSize: 14.5 }}>
          <li>Keine CDNs, keine externen Fonts, keine Karten-Tiles, kein Tracking.</li>
          <li>Open-Meteo-Wetterabruf nur nach expliziter Freigabe
            (Einstellungen → Datenschutz) und mit Cache.</li>
          <li>QR-Codes werden serverseitig generiert – keine Tracking-Dienste.</li>
          <li>Jedes Display hat ein eigenes Gerätetoken: koppelbar, sperrbar, zurücksetzbar.</li>
          <li>Alle Daten bleiben in der LXC-Instanz (<code>/opt/stadtdashboard/data/</code>).</li>
        </ul>
      </Panel>
    </>
  );
}
