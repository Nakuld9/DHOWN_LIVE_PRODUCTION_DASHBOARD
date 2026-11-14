import React, { useState, useEffect, useCallback, memo } from "react";
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
import AIInsights from "../components/AIInsights";
import MorningBriefing from "../components/MorningBriefing";

/* ── PAGE HEADER ────────────────────────────────────── */
const HeaderBar = memo(() => {
  const [time, setTime] = useState(new Date());
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const ping = async () => {
      try { await fetch("/api/analytics/shifts"); setConnected(true); } catch { setConnected(false); }
    };
    ping();
    const t = setInterval(ping, 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const dateStr = time.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
      <div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--faint)", letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 7 }}>
          Unit 1 · {dateStr}
        </div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: ".01em", textTransform: "uppercase", color: "var(--text)", lineHeight: 1 }}>
          Command Center
        </h1>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--mono)", fontSize: 11, color: connected ? "var(--ok)" : "var(--crit)", textTransform: "uppercase", letterSpacing: ".08em" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? "var(--ok)" : "var(--crit)", boxShadow: `0 0 9px ${connected ? "var(--ok)" : "var(--crit)"}` }} />
        {connected ? "Live" : "Offline"}
      </div>
    </div>
  );
});
HeaderBar.displayName = "HeaderBar";

/* ── KPI ROW ────────────────────────────────────────── */
const KPIRow = memo(({ machines }) => {
  const total = machines.length;
  const running = machines.filter(m => m.live_status === "RUNNING").length;
  const stopped = machines.filter(m => m.live_status === "STOPPED").length;
  const downtime = machines.filter(m => m.live_status === "DOWNTIME").length;
  const noData = machines.filter(m => m.live_status === "NO_DATA").length;
  const offline = machines.filter(m => m.live_status === "OFFLINE" || m.live_status === "NO_DATA").length;
  const allNoData = total > 0 && machines.every(m => m.live_status === "NO_DATA");

  const todayKg = machines.reduce((s, m) => s + Number(m.today_production_kg || 0), 0);
  const shiftKg = machines.reduce((s, m) => s + Number(m.shift_production_kg || 0), 0);
  const efficiency = total === 0 || allNoData ? "--" : Math.round((running / total) * 100) + "%";
  // Utilization = running / machines that were actually AVAILABLE to run.
  // Downtime and no-data machines are excluded from the denominator (they were
  // not available to produce), matching the backend rule in dashboard.routes.js.
  const available = total - noData - downtime;
  const utilization = total === 0 || allNoData || available <= 0 ? "--" : Math.round((running / available) * 100) + "%";

  const kpis = [
    { label: "Today's Production", value: allNoData ? "--" : todayKg.toFixed(1), unit: "kg", rail: "var(--yellow)", lead: true },
    { label: "Shift Production", value: allNoData ? "--" : shiftKg.toFixed(1), unit: "kg", rail: "var(--mnt)" },
    { label: "Efficiency", value: efficiency, rail: "var(--ok)" },
    { label: "OEE", value: allNoData ? "--" : efficiency, rail: "var(--ok)" },
    { label: "Running", value: running, rail: "var(--ok)", tone: "var(--ok)" },
    { label: "Stopped", value: stopped + downtime, rail: stopped + downtime > 0 ? "var(--crit)" : "var(--ok)", tone: stopped + downtime > 0 ? "var(--crit)" : "var(--text)" },
    { label: "Downtime", value: downtime, rail: downtime > 0 ? "var(--idle)" : "var(--mnt)", tone: downtime > 0 ? "var(--idle)" : "var(--text)" },
    { label: "Utilization", value: utilization, rail: "var(--yellow)" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "8px" }}>
      {kpis.map(k => (
        <div key={k.label} style={{
          background: k.lead ? "linear-gradient(150deg,var(--surface),var(--surface) 62%)" : "var(--surface)",
          border: `1px solid ${k.lead ? "var(--gold-dim)" : "var(--border)"}`,
          borderRadius: "var(--r)", padding: "12px 13px", position: "relative", overflow: "hidden",
        }}>
          <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "3px", background: k.rail }} />
          <div style={{ fontFamily: "var(--mono)", fontSize: "9.5px", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)" }}>
            {k.label}
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: "20px", fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-.02em", marginTop: "9px", lineHeight: 1, color: k.lead ? "var(--yellow)" : (k.tone || "var(--text)") }}>
            {k.value}{k.unit && <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 500 }}> {k.unit}</span>}
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
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r)",
    padding: "12px",
    ...style,
  }}>
    {title && (
      <div style={{
        fontFamily: "var(--mono)",
        fontSize: "10px",
        fontWeight: "700",
        color: "var(--muted)",
        letterSpacing: ".14em",
        marginBottom: "10px",
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
        const r = await fetch("/api/alerts");
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

  const typeColor = { downtime: "var(--crit)", stopped: "var(--idle)", running: "var(--ok)" };

  return (
    <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
      {events.length === 0 ? (
        <div style={{ color: "var(--ok)", fontSize: "12px", padding: "4px", fontFamily: "var(--mono)" }}>✓ No active events</div>
      ) : events.map((ev, i) => (
        <div key={i} style={{
          flexShrink: 0,
          background: "var(--surface)",
          border: `1px solid var(--border)`,
          borderLeft: `3px solid ${typeColor[ev.type] || "var(--mnt)"}`,
          borderRadius: "var(--r-sm)",
          padding: "7px 10px",
          fontSize: "11px",
          minWidth: "170px",
          maxWidth: "260px",
        }}>
          <span style={{ color: typeColor[ev.type] || "var(--muted)" }}>● </span>
          <span style={{ color: "var(--text)" }}>{ev.text}</span>
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
      const res = await fetch("/api/machines");
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
    const socket = io(window.location.origin, { transports: ['websocket'] });
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
        <div style={{ background: "var(--crit-dim)", color: "var(--crit-edge)", padding: "8px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 500 }}>
          {error}
        </div>
      )}

      {/* ROW 1: KPI Cards — 8 across full width */}
      <KPIRow machines={machines} />

      {/* ROW 1b: AI Insights — proactive feed of what needs attention */}
      <MorningBriefing />
      <AIInsights />

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
            background: "rgba(18,18,22,.97)",
            backdropFilter: "blur(16px)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            padding: 10,
            marginBottom: 10,
            width: 210,
            boxShadow: "0 12px 40px rgba(0,0,0,.7)",
          }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--faint)", fontWeight: 700, padding: "4px 8px 8px", letterSpacing: ".14em", textTransform: "uppercase" }}>Quick Create</div>
            {QUICK_ACTIONS.map((qa, i) => (
              <div key={i}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer", transition: "background .15s" }}
                onClick={() => { setFabOpen(false); nav(qa.path); }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--surface)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ fontSize: 15 }}>{qa.icon}</span>
                <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>{qa.label}</span>
              </div>
            ))}
          </div>
        )}
        <div
          style={{
            width: 52, height: 52, borderRadius: 14,
            background: "var(--yellow)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 6px 24px rgba(201,162,39,.25)",
            transition: "all .25s",
            transform: fabOpen ? "rotate(45deg)" : "none",
            marginLeft: "auto",
          }}
          onClick={() => setFabOpen(f => !f)}
          onMouseEnter={e => e.currentTarget.style.boxShadow = "0 6px 30px rgba(201,162,39,.4)"}
          onMouseLeave={e => e.currentTarget.style.boxShadow = "0 6px 24px rgba(201,162,39,.25)"}
        >
          <span style={{ fontSize: 28, color: "var(--on-gold)", fontWeight: 300, lineHeight: 1 }}>+</span>
        </div>
      </div>
    </div>
  );
};

const OverdueSCAlert = memo(() => {
  const [overdue, setOverdue] = useState([]);
  useEffect(() => {
    fetch("/api/subcontract/overdue-alerts")
      .then(r => r.json()).then(d => setOverdue(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  if (overdue.length === 0) return null;
  return (
    <div style={{ background: "var(--crit-dim, var(--crit-dim))", border: "1px solid var(--crit-dim)", borderLeft: "3px solid var(--crit)", borderRadius: "var(--r)", padding: "12px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: "var(--crit)", fontWeight: 700, fontSize: 13 }}>⚠ {overdue.length} Overdue Subcontract Challan{overdue.length > 1 ? "s" : ""}</span>
        <a href="/subcontracting" style={{ color: "var(--yellow)", fontSize: 12, textDecoration: "none", fontFamily: "var(--mono)" }}>View all →</a>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {overdue.slice(0, 5).map(c => (
          <div key={c.challan_id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", padding: "6px 12px", fontSize: 11 }}>
            <span style={{ color: "var(--yellow)", fontFamily: "var(--mono)", fontWeight: 700 }}>{c.challan_number}</span>
            <span style={{ color: "var(--muted)", marginLeft: 6 }}>{c.vendor_name}</span>
            <span style={{ color: "var(--crit)", marginLeft: 6, fontWeight: 700 }}>{c.days_overdue}d overdue</span>
            <span style={{ color: "var(--muted)", marginLeft: 6 }}>{parseFloat(c.sent_weight_kg).toFixed(1)}kg</span>
          </div>
        ))}
        {overdue.length > 5 && <span style={{ color: "var(--crit)", fontSize: 11, alignSelf: "center" }}>+{overdue.length - 5} more</span>}
      </div>
    </div>
  );
});

export default Dashboard;
