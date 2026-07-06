import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";

import MachineGridV2 from "../components/MachineGridV2";
import ProductionTrend from "../components/ProductionTrend";
import DoughnutChart from "../components/DoughnutChart";
import DowntimeSummary from "../components/DowntimeSummary";
import ProductionLeaderboard from "../components/ProductionLeaderboard";
import ShiftStatus from "../components/ShiftStatus";
import AlertsBar from "../components/AlertsBar";
import ActiveOperators from "../components/ActiveOperators";
import LiveTrendCharts from "../components/LiveTrendCharts";
import OEEGauge from "../components/OEEGauge";
import FactoryHealth from "../components/FactoryHealth";
import YarnConsumption from "../components/YarnConsumption";
import DataCollectorStatus from "../components/DataCollectorStatus";

import logo from "../assets/images/dhown-logo.png";

/* ── HEADER ─────────────────────────────────────────── */
const HeaderBar = memo(() => {
  const [shift, setShift] = useState(null);
  const [time, setTime] = useState(new Date());
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const fetchShift = async () => {
      try {
        const r = await fetch("http://localhost:4000/api/analytics/shifts");
        const d = await r.json();
        setShift(d.current_shift || null);
        setConnected(true);
      } catch { setConnected(false); }
    };
    fetchShift();
    const t = setInterval(fetchShift, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const user = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("dhown_current_user")); } catch { return null; }
  }, []);

  const displayShift = shift ?? (time.getHours() >= 8 && time.getHours() < 20 ? "DAY" : "NIGHT");
  const dateStr = time.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  return (
    <header style={{
      background: "#081426",
      borderRadius: "8px",
      padding: "0 16px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      height: "50px",
      border: "1px solid #30363d",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <img src={logo} alt="DHOWN" style={{ width: "30px", height: "30px", objectFit: "contain", filter: "drop-shadow(0 0 4px #f4ae1f)" }} />
        <div>
          <div style={{ fontSize: "13px", fontWeight: "800", color: "#f4ae1f", letterSpacing: "1.5px" }}>DHOWN HOSIERY MILLS</div>
          <div style={{ fontSize: "9px", color: "#8b949e", letterSpacing: "1px" }}>MANUFACTURING EXECUTION SYSTEM</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <HeaderChip label="SHIFT" value={displayShift} color={displayShift === "DAY" ? "#f4ae1f" : "#60a5fa"} />
        <HeaderChip label="DATE" value={dateStr} color="#8b949e" />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "9px", color: "#8b949e", letterSpacing: "1px" }}>TIME</div>
          <div style={{ fontSize: "14px", fontWeight: "700", color: "#e6edf3", fontVariantNumeric: "tabular-nums" }}>{timeStr}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <div style={{
            width: "7px", height: "7px", borderRadius: "50%",
            background: connected ? "#22c55e" : "#ef4444",
            boxShadow: connected ? "0 0 6px #22c55e" : "0 0 6px #ef4444",
          }} />
          <span style={{ fontSize: "10px", color: connected ? "#22c55e" : "#ef4444", fontWeight: "600" }}>
            {connected ? "LIVE" : "OFFLINE"}
          </span>
        </div>
        {user && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{
              width: "24px", height: "24px", borderRadius: "50%",
              background: "#f4ae1f", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "12px", fontWeight: "bold", color: "#0D1117",
            }}>
              {user.full_name?.charAt(0).toUpperCase() || "?"}
            </div>
            <div>
              <div style={{ fontSize: "11px", fontWeight: "600", color: "#e6edf3" }}>{user.full_name}</div>
              <div style={{ fontSize: "9px", color: "#8b949e" }}>{user.role}</div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
});
HeaderBar.displayName = "HeaderBar";

const HeaderChip = memo(({ label, value, color }) => (
  <div style={{ textAlign: "center" }}>
    <div style={{ fontSize: "9px", color: "#8b949e", letterSpacing: "1px" }}>{label}</div>
    <div style={{ fontSize: "13px", fontWeight: "700", color }}>{value}</div>
  </div>
));
HeaderChip.displayName = "HeaderChip";

/* ── KPI ROW ────────────────────────────────────────── */
const KPIRow = memo(({ machines }) => {
  const total = machines.length;
  const running = machines.filter(m => m.live_status === "RUNNING").length;
  const stopped = machines.filter(m => m.live_status === "STOPPED").length;
  const downtime = machines.filter(m => m.live_status === "DOWNTIME").length;
  const offline = machines.filter(m => m.live_status === "OFFLINE" || m.live_status === "NO_DATA").length;
  const allNoData = total > 0 && machines.every(m => m.live_status === "NO_DATA");

  const todayKg = machines.reduce((s, m) => s + Number(m.today_production_kg || 0), 0);
  const shiftKg = machines.reduce((s, m) => s + Number(m.shift_production_kg || 0), 0);
  const efficiency = total === 0 || allNoData ? "--" : Math.round((running / total) * 100) + "%";
  const utilization = total === 0 || allNoData ? "--" : Math.round(((total - offline) / total) * 100) + "%";

  const kpis = [
    { label: "TODAY'S PRODUCTION", value: allNoData ? "--" : todayKg.toFixed(1) + " KG", color: "#a78bfa", icon: "📦" },
    { label: "SHIFT PRODUCTION", value: allNoData ? "--" : shiftKg.toFixed(1) + " KG", color: "#fb923c", icon: "⚡" },
    { label: "FACTORY EFFICIENCY", value: efficiency, color: "#22c55e", icon: "📊" },
    { label: "OEE", value: allNoData ? "--" : efficiency, color: "#60a5fa", icon: "🎯" },
    { label: "RUNNING", value: running, color: "#22c55e", icon: "✅", highlight: true },
    { label: "STOPPED", value: stopped + downtime, color: stopped + downtime > 0 ? "#ef4444" : "#22c55e", icon: "⛔", highlight: stopped + downtime > 0 },
    { label: "DOWNTIME", value: downtime, color: downtime > 0 ? "#dc2626" : "#8b949e", icon: "⏸️", highlight: downtime > 0 },
    { label: "UTILIZATION", value: utilization, color: "#f4ae1f", icon: "🏭" },
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(8, 1fr)",
      gap: "6px",
    }}>
      {kpis.map(k => (
        <div key={k.label} style={{
          background: "#081426",
          border: k.highlight ? `1px solid ${k.color}30` : "1px solid #30363d",
          borderRadius: "6px",
          padding: "6px 8px",
          position: "relative",
          overflow: "hidden",
        }}>
          {k.highlight && (
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, height: "2px",
              background: k.color,
              boxShadow: `0 0 8px ${k.color}`,
            }} />
          )}
          <div style={{ fontSize: "8px", color: "#8b949e", letterSpacing: "0.5px", marginBottom: "2px", fontWeight: "600" }}>
            {k.icon} {k.label}
          </div>
          <div style={{ fontSize: "18px", fontWeight: "800", color: k.color, lineHeight: 1 }}>
            {k.value}
          </div>
        </div>
      ))}
    </div>
  );
});
KPIRow.displayName = "KPIRow";

/* ── SECTION WRAPPER ────────────────────────────────── */
const Section = memo(({ title, children, style = {} }) => (
  <div style={{
    background: "#081426",
    border: "1px solid #30363d",
    borderRadius: "8px",
    padding: "8px",
    ...style,
  }}>
    {title && (
      <div style={{
        fontSize: "10px",
        fontWeight: "700",
        color: "#f4ae1f",
        letterSpacing: "1.5px",
        marginBottom: "6px",
        textTransform: "uppercase",
      }}>
        {title}
      </div>
    )}
    {children}
  </div>
));
Section.displayName = "Section";

/* ── EVENT TIMELINE ─────────────────────────────────── */
const EventTimeline = memo(({ machines }) => {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("http://localhost:4000/api/alerts");
        const data = await r.json();
        const built = [];
        (data.openDowntime || []).forEach(d => {
          const mins = d.start_time ? Math.round((Date.now() - new Date(d.start_time)) / 60000) : "?";
          built.push({ text: `${d.machine_id} — ${d.reason} (${mins} min)`, type: "downtime", time: d.start_time });
        });
        (data.stoppedMachines || []).forEach(m => {
          built.push({ text: `${m.machine_id} is STOPPED`, type: "stopped", time: new Date().toISOString() });
        });
        machines.forEach(m => {
          if (m.live_status === "RUNNING" && m.session_production_kg > 0) {
            built.push({ text: `${m.machine_id} producing — ${Number(m.session_production_kg).toFixed(1)} kg this roll`, type: "running", time: new Date().toISOString() });
          }
        });
        setEvents(built.slice(0, 12));
      } catch {}
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [machines]);

  const typeColor = { downtime: "#dc2626", stopped: "#f59e0b", running: "#22c55e" };

  return (
    <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
      {events.length === 0 ? (
        <div style={{ color: "#22c55e", fontSize: "11px", padding: "4px" }}>✓ No active events</div>
      ) : events.map((ev, i) => (
        <div key={i} style={{
          flexShrink: 0,
          background: "#081426",
          border: `1px solid ${typeColor[ev.type] || "#30363d"}30`,
          borderLeft: `3px solid ${typeColor[ev.type] || "#30363d"}`,
          borderRadius: "6px",
          padding: "5px 8px",
          fontSize: "10px",
          minWidth: "160px",
          maxWidth: "240px",
        }}>
          <span style={{ color: typeColor[ev.type] || "#8b949e" }}>● </span>
          <span style={{ color: "#e6edf3" }}>{ev.text}</span>
        </div>
      ))}
    </div>
  );
});
EventTimeline.displayName = "EventTimeline";

/* ── DASHBOARD ──────────────────────────────────────── */
const QUICK_ACTIONS = [
  { label: "New GRN",          path: "/grn",            icon: "📦" },
  { label: "SC Challan",       path: "/subcontracting", icon: "📄" },
  { label: "Yarn Issue",       path: "/yarn-issue",     icon: "🧶" },
  { label: "Dispatch",         path: "/dispatch",       icon: "🚚" },
  { label: "New Batch",        path: "/batching",       icon: "🔄" },
  { label: "Item Master",      path: "/items",          icon: "📋" },
  { label: "Partners",         path: "/partners",       icon: "👥" },
  { label: "Admin Masters",    path: "/admin/masters",  icon: "⚙" },
  { label: "Finished Goods",   path: "/finished-goods", icon: "✅" },
  { label: "Command Center",   path: "/command-center", icon: "🏢" },
];

const Dashboard = () => {
  const nav = useNavigate();
  const [machines, setMachines] = useState([]);
  const [error, setError] = useState(null);
  const [fabOpen, setFabOpen] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("http://localhost:4000/api/machines");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setMachines(
        data.map((m) => ({
          ...m,
          work_center: m.machine_id,
          operator: m.assigned_operator || m.operator_name || "Not Assigned",
          dc_status: m.live_status === "NO_DATA" ? "OFFLINE" : m.dc_status || "OFFLINE",
          shift: m.live_shift || "",
        }))
      );
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Unable to reach server. Check backend is running.");
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    const socket = io(`http://${window.location.hostname}:4000`, { transports: ['websocket'] });
    socket.on('machine_update', loadData);
    return () => { clearInterval(interval); socket.disconnect(); };
  }, [loadData]);

  return (
    <div style={{
      minHeight: "100vh",
      padding: "8px",
      color: "white",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      maxWidth: "1800px",
      margin: "0 auto",
      width: "calc(100% - 16px)",
      boxSizing: "border-box",
    }}>
      {/* ROW 0: Header */}
      <HeaderBar />

      {/* Error banner */}
      {error && (
        <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: "8px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 500 }}>
          {error}
        </div>
      )}

      {/* ROW 1: KPI Cards — 8 across full width */}
      <KPIRow machines={machines} />

      {/* ROW 2: MACHINE GRID — full width, the main focus */}
      <Section title="LIVE MACHINE GRID">
        <MachineGridV2 machines={machines} />
      </Section>

      {/* ROW 3: Widgets that were in the right sidebar — now 5 columns below grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "8px" }}>
        <ShiftStatus />
        <DoughnutChart />
        <DowntimeSummary />
        <ProductionLeaderboard />
        <OEEGauge />
      </div>

      {/* ROW 4: Full-width chart */}
      <LiveTrendCharts machines={machines} />

      {/* Overdue SC Challans Alert */}
      <OverdueSCAlert />

      {/* ROW 5: Three-column info row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
        <AlertsBar />
        <YarnConsumption />
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <ActiveOperators />
          <DataCollectorStatus />
        </div>
      </div>

      {/* ROW 6: Event Timeline */}
      <Section title="FACTORY EVENT TIMELINE">
        <EventTimeline machines={machines} />
      </Section>

      {/* ═══ QUICK ACTION FAB ═══ */}
      <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999 }}>
        {fabOpen && (
          <div style={{
            background: "rgba(13,20,37,.95)",
            backdropFilter: "blur(16px)",
            border: "1px solid #1e2a4a",
            borderRadius: 14,
            padding: 10,
            marginBottom: 10,
            width: 210,
            boxShadow: "0 8px 40px rgba(0,0,0,.6), 0 0 30px rgba(212,168,67,.15)",
          }}>
            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, padding: "4px 8px 8px", letterSpacing: 1, textTransform: "uppercase" }}>Quick Create</div>
            {QUICK_ACTIONS.map((qa, i) => (
              <div key={i}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer", transition: "background .15s" }}
                onClick={() => { setFabOpen(false); nav(qa.path); }}
                onMouseEnter={e => e.currentTarget.style.background = "#17203a"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ fontSize: 15 }}>{qa.icon}</span>
                <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 500 }}>{qa.label}</span>
              </div>
            ))}
          </div>
        )}
        <div
          style={{
            width: 52, height: 52, borderRadius: 14,
            background: "linear-gradient(135deg, #d4a843, #b8922f)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 4px 24px rgba(212,168,67,.3), 0 0 40px rgba(212,168,67,.15)",
            transition: "all .25s",
            transform: fabOpen ? "rotate(45deg)" : "none",
            marginLeft: "auto",
          }}
          onClick={() => setFabOpen(f => !f)}
          onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 32px rgba(212,168,67,.5), 0 0 50px rgba(212,168,67,.25)"}
          onMouseLeave={e => e.currentTarget.style.boxShadow = "0 4px 24px rgba(212,168,67,.3), 0 0 40px rgba(212,168,67,.15)"}
        >
          <span style={{ fontSize: 28, color: "#0a0e1a", fontWeight: 300, lineHeight: 1 }}>+</span>
        </div>
      </div>
    </div>
  );
};

const OverdueSCAlert = memo(() => {
  const [overdue, setOverdue] = useState([]);
  useEffect(() => {
    fetch("http://localhost:4000/api/subcontract/overdue-alerts")
      .then(r => r.json()).then(d => setOverdue(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  if (overdue.length === 0) return null;
  return (
    <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid #ef444444", borderRadius: 8, padding: "12px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: "#ef4444", fontWeight: 700, fontSize: 13 }}>⚠ {overdue.length} Overdue Subcontract Challan{overdue.length > 1 ? "s" : ""}</span>
        <a href="/subcontracting" style={{ color: "#60a5fa", fontSize: 12, textDecoration: "none" }}>View All →</a>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {overdue.slice(0, 5).map(c => (
          <div key={c.challan_id} style={{ background: "#0d1b2f", border: "1px solid #ef444444", borderRadius: 6, padding: "6px 12px", fontSize: 11 }}>
            <span style={{ color: "#FFD700", fontFamily: "monospace", fontWeight: 700 }}>{c.challan_number}</span>
            <span style={{ color: "#9ca3af", marginLeft: 6 }}>{c.vendor_name}</span>
            <span style={{ color: "#ef4444", marginLeft: 6, fontWeight: 700 }}>{c.days_overdue}d overdue</span>
            <span style={{ color: "#7da2d6", marginLeft: 6 }}>{parseFloat(c.sent_weight_kg).toFixed(1)}kg</span>
          </div>
        ))}
        {overdue.length > 5 && <span style={{ color: "#ef4444", fontSize: 11, alignSelf: "center" }}>+{overdue.length - 5} more</span>}
      </div>
    </div>
  );
});

export default Dashboard;
