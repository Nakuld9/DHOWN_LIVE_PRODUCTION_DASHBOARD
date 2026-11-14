import React, { useEffect, useState, useCallback } from "react";
import { io } from "socket.io-client";

const STATUS_COLOR = {
  DOWNTIME: "var(--crit)",
  RUNNING:  "var(--green)",
  STOPPED:  "var(--crit)",
  OFFLINE:  "var(--gold)",
  NO_DATA:  "var(--border)",
};

const STATUS_BG = {
  DOWNTIME: "rgba(220,38,38,0.18)",
  RUNNING:  "rgba(34,197,94,0.14)",
  STOPPED:  "rgba(239,68,68,0.14)",
  OFFLINE:  "rgba(245,158,11,0.14)",
  NO_DATA:  "rgba(71,85,105,0.12)",
};

const SHIFT_LABEL = { D: "Day", N: "Night", A: "Day", B: "Night" };

// The screen has nobody logged into it and no keyboard to log back in with, so
// it carries its own long-lived credential. An ADMIN mints one from Settings;
// it is pasted here once and stored. The token is scoped server-side to the live
// dashboard alone, so a screen in a corridor cannot be used to read invoices.
const DISPLAY_KEY = "dhown_display_token";

export default function TVDashboard() {
  const [live, setLive]             = useState(null);
  const [clock, setClock]           = useState(new Date());
  const [lastUpdated, setLastUpdated] = useState(null);
  const [needsToken, setNeedsToken]  = useState(false);
  const [pasted, setPasted]          = useState("");

  const load = useCallback(async () => {
    const token = localStorage.getItem(DISPLAY_KEY) || localStorage.getItem("dhown_token");
    if (!token) { setNeedsToken(true); return; }
    try {
      const r = await fetch(`/api/dashboard/live`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 401 || r.status === 403) {
        // Expired or wrongly scoped. Ask for a new one rather than showing a
        // frozen board that looks live from across the floor.
        localStorage.removeItem(DISPLAY_KEY);
        setNeedsToken(true);
        return;
      }
      const d = await r.json();
      setLive(d);
      setNeedsToken(false);
      setLastUpdated(new Date());
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const dataTimer  = setInterval(load, 10000);
    const clockTimer = setInterval(() => setClock(new Date()), 1000);
    const socket = io(window.location.origin, { transports: ["websocket"] });
    socket.on("machine_update", load);
    return () => { clearInterval(dataTimer); clearInterval(clockTimer); socket.disconnect(); };
  }, [load]);

  // One-time setup. Shown instead of a permanently blank board, which is what
  // this screen did before it had a credential of its own.
  if (needsToken) {
    return (
      <div style={{ width: "100vw", height: "100vh", background: "var(--surface)", display: "flex",
                    alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 620, color: "var(--text)", fontFamily: "system-ui" }}>
          <div style={{ color: "var(--yellow)", fontSize: 28, fontWeight: "bold", marginBottom: 10 }}>
            Display setup
          </div>
          <p style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1.6 }}>
            This screen needs its own display token. In the MES, go to
            <b style={{ color: "var(--text)" }}> Settings → Display token</b>, generate one,
            and paste it here. It is stored on this screen only and reads the live
            dashboard alone.
          </p>
          <textarea
            value={pasted} onChange={e => setPasted(e.target.value.trim())}
            placeholder="Paste the display token"
            style={{ width: "100%", height: 96, background: "var(--surface)", color: "var(--text)",
                     border: "1px solid var(--border)", borderRadius: 8, padding: 12,
                     fontFamily: "monospace", fontSize: 13, boxSizing: "border-box" }} />
          <button
            onClick={() => { if (pasted) { localStorage.setItem(DISPLAY_KEY, pasted); setNeedsToken(false); load(); } }}
            style={{ marginTop: 12, background: "var(--yellow)", color: "#000", border: "none",
                     padding: "10px 18px", borderRadius: 8, fontWeight: "bold", cursor: "pointer" }}>
            Save and start
          </button>
        </div>
      </div>
    );
  }

  if (!live) {
    return (
      <div style={{ width: "100vw", height: "100vh", background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--yellow)", fontSize: "clamp(22px, 2.4vw, 52px)", fontFamily: "monospace", letterSpacing: "4px" }}>
          LOADING...
        </div>
      </div>
    );
  }

  const { kpis, oee_summary, machines, current_shift } = live;
  const shiftLabel = SHIFT_LABEL[current_shift] || current_shift;

  const kpiItems = [
    { label: "TOTAL",      value: kpis.total_machines,                              color: "var(--muted)" },
    { label: "RUNNING",    value: kpis.running,                                     color: "var(--green)" },
    { label: "DOWNTIME",   value: kpis.in_downtime || 0,                            color: (kpis.in_downtime || 0) > 0 ? "var(--crit)" : "var(--border)" },
    { label: "STOPPED",    value: kpis.stopped,                                     color: kpis.stopped > 0 ? "var(--crit)" : "var(--border)" },
    { label: "OFFLINE",    value: kpis.offline,                                     color: kpis.offline > 0 ? "var(--gold)" : "var(--border)" },
    { label: "UTIL %",     value: kpis.utilization_pct + "%",                       color: "var(--green)" },
    { label: "OEE",        value: (oee_summary.avg_oee || 0) + "%",                color: "var(--green)" },
    { label: "SHIFT kg",   value: (kpis.shift_production_kg || 0).toFixed(2),       color: "var(--yellow)" },
    { label: "DAILY kg",   value: (kpis.daily_production_kg || 0).toFixed(2),       color: "var(--gold-2)" },
  ];

  const oeeItems = [
    { label: "AVAILABILITY", value: oee_summary.avg_availability },
    { label: "PERFORMANCE",  value: oee_summary.avg_performance },
    { label: "QUALITY",      value: oee_summary.avg_quality },
    { label: "OEE",          value: oee_summary.avg_oee },
  ];

  return (
    <div style={{
      width: "100vw",
      height: "100vh",
      background: "var(--surface)",
      color: "white",
      fontFamily: "'Courier New', Courier, monospace",
      display: "flex",
      flexDirection: "column",
      padding: "1.2vh 1vw",
      boxSizing: "border-box",
      overflow: "hidden",
      gap: "1vh",
    }}>

      {/* ── HEADER ───────────────────────────────────────────────── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        borderBottom: "2px solid var(--surface)", paddingBottom: "10px",
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: "clamp(18px, 2.1vw, 46px)", fontWeight: "bold", color: "var(--yellow)", letterSpacing: "4px" }}>
            DHOWN HOSIERY MILLS
          </div>
          <div style={{ fontSize: "clamp(10px, 0.95vw, 20px)", color: "var(--muted)", letterSpacing: "3px", marginTop: "3px" }}>
            LIVE PRODUCTION DASHBOARD &nbsp;—&nbsp; {shiftLabel.toUpperCase()} SHIFT &nbsp;—&nbsp; TV MODE
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "clamp(28px, 3.2vw, 68px)", fontWeight: "bold", color: "var(--yellow)", lineHeight: 1, letterSpacing: "2px" }}>
            {clock.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div style={{ fontSize: "clamp(11px, 0.8vw, 18px)", color: "var(--muted)", marginTop: "4px" }}>
            {clock.toLocaleDateString('en-GB').split('/').join('-')}
            &nbsp;|&nbsp; Updated {lastUpdated ? lastUpdated.toLocaleTimeString() : "—"}
          </div>
        </div>
      </div>

      {/* ── KPI STRIP ────────────────────────────────────────────── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 100px), 1fr))", gap: "8px",
        flexShrink: 0,
      }}>
        {kpiItems.map(k => (
          <div key={k.label} style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "10px 6px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "clamp(18px, 2.1vw, 46px)", fontWeight: "bold", color: k.color, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: "clamp(9px, 0.75vw, 16px)", color: "var(--muted)", marginTop: "5px", letterSpacing: "1px" }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* ── MACHINE GRID (responsive: auto-fit cols, rows scroll if needed) ── */}
      <div style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
        gridAutoRows: "minmax(120px, 1fr)",
        gap: "8px",
        minHeight: 0,
        overflowY: "auto",
      }}>
        {(machines || []).map(m => {
          const status   = m.live_status || "NO_DATA";
          const col      = STATUS_COLOR[status] || "var(--border)";
          const bg       = STATUS_BG[status]    || "rgba(71,85,105,0.12)";
          const rpm      = m.rpm || 0;
          const rpmPct   = m.rpm_target > 0 ? Math.min(100, Math.round(rpm / m.rpm_target * 100)) : 0;
          const sessionKg = parseFloat(m.session_production_kg || 0).toFixed(2);
          const todayKg   = parseFloat(m.today_production_kg   || 0).toFixed(2);
          const shiftKg   = parseFloat(m.shift_production_kg   || 0).toFixed(2);

          return (
            <div key={m.machine_id} style={{
              background: bg,
              border: `2px solid ${col}`,
              borderRadius: "10px",
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              overflow: "hidden",
              position: "relative",
            }}>
              {/* ID + Status */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: "clamp(16px, 1.6vw, 36px)", fontWeight: "bold", color: "var(--yellow)", lineHeight: 1, letterSpacing: "1px" }}>
                    {m.machine_id}
                  </div>
                  <div style={{ fontSize: "clamp(9px, 0.7vw, 16px)", color: "var(--muted)", marginTop: "2px", letterSpacing: "0.5px" }}>
                    {m.machine_type || "—"}{m.fabric_code ? ` · ${m.fabric_code}` : ""}
                  </div>
                </div>
                <span style={{
                  background: col, color: "#000",
                  fontSize: "clamp(8px, 0.6vw, 14px)", fontWeight: "bold",
                  padding: "3px 7px", borderRadius: "4px",
                  letterSpacing: "0.5px", whiteSpace: "nowrap",
                }}>{status}</span>
              </div>

              {/* RPM / Downtime reason */}
              <div style={{ textAlign: "center", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "4px 0" }}>
                {status === "DOWNTIME" ? (
                  <>
                    <div style={{ color: "var(--crit)", fontSize: "clamp(13px, 1.1vw, 24px)", fontWeight: "bold", letterSpacing: "1px" }}>IN DOWNTIME</div>
                    <div style={{ color: "var(--crit-edge)", fontSize: "clamp(10px, 0.85vw, 19px)", marginTop: "4px" }}>{m.downtime_reason || "Reason Pending"}</div>
                  </>
                ) : (
                  <>
                    <div style={{
                      fontSize: "clamp(26px, 3vw, 64px)", fontWeight: "bold", lineHeight: 1,
                      color: status === "RUNNING" ? "var(--green)" : "var(--border)",
                    }}>
                      {rpm}
                    </div>
                    <div style={{ fontSize: "clamp(9px, 0.7vw, 16px)", color: "var(--muted)", marginTop: "2px" }}>
                      RPM{m.rpm_target ? ` / ${m.rpm_target} target (${rpmPct}%)` : ""}
                    </div>
                  </>
                )}
              </div>

              {/* Production footer */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "5px" }}>
                {[
                  { v: sessionKg, label: "SESSION" },
                  { v: shiftKg,   label: "SHIFT" },
                  { v: todayKg,   label: "TODAY" },
                ].map(p => (
                  <div key={p.label} style={{
                    background: "rgba(0,0,0,0.25)",
                    borderRadius: "5px", padding: "5px 4px", textAlign: "center",
                  }}>
                    <div style={{ fontSize: "clamp(11px, 0.95vw, 22px)", fontWeight: "bold", color: "var(--yellow)", lineHeight: 1 }}>{p.v}</div>
                    <div style={{ fontSize: "clamp(8px, 0.55vw, 13px)", color: "var(--muted)", marginTop: "2px", letterSpacing: "0.5px" }}>{p.label} kg</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── OEE FOOTER ───────────────────────────────────────────── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))", gap: "8px",
        flexShrink: 0,
      }}>
        {oeeItems.map(o => {
          const v = parseFloat(o.value || 0);
          const c = v >= 85 ? "var(--green)" : v >= 65 ? "var(--yellow)" : "var(--crit)";
          return (
            <div key={o.label} style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: "8px", padding: "8px", textAlign: "center",
            }}>
              <div style={{ fontSize: "clamp(18px, 2.1vw, 46px)", fontWeight: "bold", color: c, lineHeight: 1 }}>{v.toFixed(1)}%</div>
              <div style={{ fontSize: "clamp(9px, 0.75vw, 16px)", color: "var(--muted)", marginTop: "4px", letterSpacing: "1px" }}>{o.label}</div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
