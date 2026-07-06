import React, { useEffect, useState, useCallback } from "react";
import { io } from "socket.io-client";

const STATUS_COLOR = {
  DOWNTIME: "#dc2626",
  RUNNING:  "#22c55e",
  STOPPED:  "#ef4444",
  OFFLINE:  "#f59e0b",
  NO_DATA:  "#475569",
};

const STATUS_BG = {
  DOWNTIME: "rgba(220,38,38,0.18)",
  RUNNING:  "rgba(34,197,94,0.14)",
  STOPPED:  "rgba(239,68,68,0.14)",
  OFFLINE:  "rgba(245,158,11,0.14)",
  NO_DATA:  "rgba(71,85,105,0.12)",
};

const SHIFT_LABEL = { D: "Day", N: "Night", A: "Day", B: "Night" };

export default function TVDashboard() {
  const [live, setLive]             = useState(null);
  const [clock, setClock]           = useState(new Date());
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`http://${window.location.hostname}:4000/api/dashboard/live`);
      const d = await r.json();
      setLive(d);
      setLastUpdated(new Date());
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const dataTimer  = setInterval(load, 10000);
    const clockTimer = setInterval(() => setClock(new Date()), 1000);
    const socket = io(`http://${window.location.hostname}:4000`, { transports: ["websocket"] });
    socket.on("machine_update", load);
    return () => { clearInterval(dataTimer); clearInterval(clockTimer); socket.disconnect(); };
  }, [load]);

  if (!live) {
    return (
      <div style={{ width: "100vw", height: "100vh", background: "#020d1a", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#f4ae1f", fontSize: "32px", fontFamily: "monospace", letterSpacing: "4px" }}>
          DHOWN MES — LOADING...
        </div>
      </div>
    );
  }

  const { kpis, oee_summary, machines, current_shift } = live;
  const shiftLabel = SHIFT_LABEL[current_shift] || current_shift;

  const kpiItems = [
    { label: "TOTAL",      value: kpis.total_machines,                              color: "#7da2d6" },
    { label: "RUNNING",    value: kpis.running,                                     color: "#22c55e" },
    { label: "DOWNTIME",   value: kpis.in_downtime || 0,                            color: (kpis.in_downtime || 0) > 0 ? "#dc2626" : "#475569" },
    { label: "STOPPED",    value: kpis.stopped,                                     color: kpis.stopped > 0 ? "#ef4444" : "#475569" },
    { label: "OFFLINE",    value: kpis.offline,                                     color: kpis.offline > 0 ? "#f59e0b" : "#475569" },
    { label: "UTIL %",     value: kpis.utilization_pct + "%",                       color: "#22c55e" },
    { label: "OEE",        value: (oee_summary.avg_oee || 0) + "%",                color: "#00e676" },
    { label: "SHIFT kg",   value: (kpis.shift_production_kg || 0).toFixed(2),       color: "#f4ae1f" },
    { label: "DAILY kg",   value: (kpis.daily_production_kg || 0).toFixed(2),       color: "#fbbf24" },
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
      background: "#020d1a",
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
        borderBottom: "2px solid #16345d", paddingBottom: "10px",
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: "2vw", fontWeight: "bold", color: "#f4ae1f", letterSpacing: "4px" }}>
            DHOWN HOSIERY MILLS
          </div>
          <div style={{ fontSize: "0.9vw", color: "#7da2d6", letterSpacing: "3px", marginTop: "3px" }}>
            LIVE PRODUCTION DASHBOARD &nbsp;—&nbsp; {shiftLabel.toUpperCase()} SHIFT &nbsp;—&nbsp; TV MODE
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "3vw", fontWeight: "bold", color: "#f4ae1f", lineHeight: 1, letterSpacing: "2px" }}>
            {clock.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div style={{ fontSize: "13px", color: "#7da2d6", marginTop: "4px" }}>
            {clock.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short", year: "numeric" })}
            &nbsp;|&nbsp; Updated {lastUpdated ? lastUpdated.toLocaleTimeString() : "—"}
          </div>
        </div>
      </div>

      {/* ── KPI STRIP ────────────────────────────────────────────── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: "8px",
        flexShrink: 0,
      }}>
        {kpiItems.map(k => (
          <div key={k.label} style={{
            background: "#061730",
            border: "1px solid #16345d",
            borderRadius: "8px",
            padding: "10px 6px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "2vw", fontWeight: "bold", color: k.color, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: "0.7vw", color: "#7da2d6", marginTop: "5px", letterSpacing: "1px" }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* ── MACHINE GRID  6 × 3 = 18 ─────────────────────────────── */}
      <div style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr)",
        gridTemplateRows: "repeat(3, 1fr)",
        gap: "8px",
        minHeight: 0,
      }}>
        {(machines || []).map(m => {
          const status   = m.live_status || "NO_DATA";
          const col      = STATUS_COLOR[status] || "#475569";
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
                  <div style={{ fontSize: "1.5vw", fontWeight: "bold", color: "#f4ae1f", lineHeight: 1, letterSpacing: "1px" }}>
                    {m.machine_id}
                  </div>
                  <div style={{ fontSize: "11px", color: "#7da2d6", marginTop: "2px", letterSpacing: "0.5px" }}>
                    {m.machine_type || "—"}{m.fabric_code ? ` · ${m.fabric_code}` : ""}
                  </div>
                </div>
                <span style={{
                  background: col, color: "#000",
                  fontSize: "10px", fontWeight: "bold",
                  padding: "3px 7px", borderRadius: "4px",
                  letterSpacing: "0.5px", whiteSpace: "nowrap",
                }}>{status}</span>
              </div>

              {/* RPM / Downtime reason */}
              <div style={{ textAlign: "center", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "4px 0" }}>
                {status === "DOWNTIME" ? (
                  <>
                    <div style={{ color: "#dc2626", fontSize: "15px", fontWeight: "bold", letterSpacing: "1px" }}>IN DOWNTIME</div>
                    <div style={{ color: "#fca5a5", fontSize: "12px", marginTop: "4px" }}>{m.downtime_reason || "Reason Pending"}</div>
                  </>
                ) : (
                  <>
                    <div style={{
                      fontSize: "2.8vw", fontWeight: "bold", lineHeight: 1,
                      color: status === "RUNNING" ? "#22c55e" : "#475569",
                    }}>
                      {rpm}
                    </div>
                    <div style={{ fontSize: "11px", color: "#7da2d6", marginTop: "2px" }}>
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
                    <div style={{ fontSize: "14px", fontWeight: "bold", color: "#f4ae1f", lineHeight: 1 }}>{p.v}</div>
                    <div style={{ fontSize: "9px", color: "#7da2d6", marginTop: "2px", letterSpacing: "0.5px" }}>{p.label} kg</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── OEE FOOTER ───────────────────────────────────────────── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px",
        flexShrink: 0,
      }}>
        {oeeItems.map(o => {
          const v = parseFloat(o.value || 0);
          const c = v >= 85 ? "#00e676" : v >= 65 ? "#f4ae1f" : "#ef4444";
          return (
            <div key={o.label} style={{
              background: "#061730", border: "1px solid #16345d",
              borderRadius: "8px", padding: "8px", textAlign: "center",
            }}>
              <div style={{ fontSize: "2vw", fontWeight: "bold", color: c, lineHeight: 1 }}>{v.toFixed(1)}%</div>
              <div style={{ fontSize: "0.7vw", color: "#7da2d6", marginTop: "4px", letterSpacing: "1px" }}>{o.label}</div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
