import { Link } from "react-router-dom";
import React, { useEffect, useState } from "react";
import AskAIButton from "../components/AskAIButton";

const MSTATUS = { RUNNING: "var(--green)", DOWNTIME: "var(--crit)", STOPPED: "var(--crit)", OFFLINE: "var(--gold)", NO_DATA: "var(--faint)" };
const RSTATUS = { OPEN: "var(--gold)", CLOSED: "var(--green)", APPROVED: "var(--green)", CANCELLED: "var(--crit)" };

const th = { fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)", textAlign: "left", padding: "11px 13px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const td = { padding: "11px 13px", borderBottom: "1px solid var(--border-soft)", fontSize: 13, whiteSpace: "nowrap" };
const pill = (c) => ({ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", padding: "3px 9px", borderRadius: 99, background: `${c}1f`, color: c, border: `1px solid ${c}33`, display: "inline-flex", alignItems: "center", gap: 5 });

const StatTile = ({ label, value, unit, rail, tone, lead }) => (
  <div style={{ background: lead ? "linear-gradient(150deg,var(--surface),var(--surface) 62%)" : "var(--surface)", border: `1px solid ${lead ? "var(--gold-dim)" : "var(--border)"}`, borderRadius: 9, padding: "13px 14px", position: "relative", overflow: "hidden", flex: 1, minWidth: 130 }}>
    <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: rail }} />
    <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".13em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
    <div style={{ fontFamily: "var(--mono)", fontSize: 24, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-.02em", marginTop: 8, lineHeight: 1, color: lead ? "var(--yellow)" : (tone || "var(--text)") }}>
      {value}{unit && <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}> {unit}</span>}
    </div>
  </div>
);

const Panel = ({ title, right, children }) => (
  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
    <div style={{ display: "flex", alignItems: "center", padding: "12px 15px", borderBottom: "1px solid var(--border)" }}>
      <h3 style={{ margin: 0, fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>{title}</h3>
      {right && <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)" }}>{right}</span>}
    </div>
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>{children}</div>
  </div>
);

const Production = () => {
  const [machines, setMachines] = useState([]);
  const [rolls, setRolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [machineRes, rollsRes] = await Promise.all([fetch("/api/machines"), fetch("/api/rolls")]);
      if (!machineRes.ok) throw new Error("Failed to load machine data");
      if (!rollsRes.ok) throw new Error("Failed to load rolls data");
      const [machineData, rollsData] = await Promise.all([machineRes.json(), rollsRes.json()]);
      setMachines(Array.isArray(machineData) ? machineData : []);
      setRolls(Array.isArray(rollsData) ? rollsData : []);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Failed to load production data. Retrying…");
    } finally { setLoading(false); }
  };

  const running = machines.filter((m) => m.live_status === "RUNNING").length;
  const stopped = machines.length - running;
  const openRolls = rolls.filter((r) => r.status === "OPEN").length;
  const todayKg = machines.reduce((s, m) => s + Number(m.today_production_kg || 0), 0);
  const shiftKg = machines.reduce((s, m) => s + Number(m.shift_production_kg || 0), 0);
  const util = machines.length > 0 ? Math.round((running / machines.length) * 100) : 0;

  return (
    <div style={{ padding: 20, color: "var(--text)", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 18 }}>
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--faint)", letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 7 }}>Operate · Live</div>
          <h1 style={{ margin: 0, fontFamily: "var(--mono)", fontWeight: 800, fontSize: 24, letterSpacing: ".02em", textTransform: "uppercase" }}>Production</h1>
        </div>
        <div style={{ marginLeft: "auto" }}><AskAIButton question="Why is production below target today, and which machines are holding it back?" /></div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--mono)", fontSize: 11, color: error ? "var(--crit, var(--crit))" : "var(--green)", textTransform: "uppercase", letterSpacing: ".08em" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: error ? "var(--crit)" : "var(--green)", boxShadow: `0 0 9px ${error ? "var(--crit)" : "var(--green)"}` }} />
          {error ? "Reconnecting" : "Live"}
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <StatTile label="Today's Production" value={todayKg.toFixed(1)} unit="kg" rail="var(--yellow)" lead />
        <StatTile label="This Shift" value={shiftKg.toFixed(1)} unit="kg" rail="var(--mnt)" />
        <StatTile label="Running" value={running} rail="var(--green)" tone="var(--green)" />
        <StatTile label="Stopped" value={stopped} rail={stopped > 0 ? "var(--crit)" : "var(--green)"} tone={stopped > 0 ? "var(--crit)" : "var(--text)"} />
        <StatTile label="Open Rolls" value={openRolls} rail="var(--gold)" />
        <StatTile label="Utilization" value={util} unit="%" rail="var(--yellow)" />
      </div>

      {error && <div style={{ background: "var(--crit-dim)", border: "1px solid var(--crit-dim)", borderRadius: 8, color: "var(--crit-edge)", padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>{error}</div>}

      {/* Machine production */}
      <div style={{ marginBottom: 16 }}>
        <Panel title="Machine Production" right={`${machines.length} machines · updates 5s`}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead><tr>
              <th style={th}>Machine</th><th style={th}>Operator</th><th style={th}>Current Roll</th><th style={th}>Fabric</th>
              <th style={{ ...th, textAlign: "right" }}>Target</th><th style={{ ...th, textAlign: "right" }}>Live RPM</th>
              <th style={{ ...th, textAlign: "right" }}>Efficiency</th><th style={th}>Status</th>
            </tr></thead>
            <tbody>
              {machines.length === 0 && <tr><td style={{ ...td, textAlign: "center", color: "var(--muted)", padding: 40 }} colSpan={8}>{loading ? "Loading…" : "No machines."}</td></tr>}
              {machines.map((machine) => {
                const noData = machine.live_status === "NO_DATA";
                const liveRPM = noData ? null : (machine.rpm || 0);
                const targetRPM = machine.rpm_target || 0;
                const effNum = noData || targetRPM === 0 ? null : Math.round((liveRPM / targetRPM) * 100);
                const effColor = effNum == null ? "var(--muted)" : effNum >= 90 ? "var(--green)" : effNum >= 75 ? "var(--gold)" : "var(--crit)";
                const currentRoll = rolls.find((r) => r.machine_id === machine.machine_id && r.status === "OPEN");
                const sc = MSTATUS[machine.live_status] || "var(--faint)";
                const sLabel = (machine.live_status === "NO_DATA" || machine.live_status === "OFFLINE") ? "Collector Off" : (machine.live_status || "--");
                return (
                  <tr key={machine.machine_id}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={td}><Link to={`/machine/${machine.machine_id}`} style={{ fontFamily: "var(--mono)", color: "var(--yellow)", textDecoration: "none", fontWeight: 700 }}>{machine.machine_id}</Link></td>
                    <td style={{ ...td, color: (noData || !machine.operator_name) ? "var(--faint)" : "var(--text)" }}>{noData ? "—" : (machine.operator_name || "—")}</td>
                    <td style={{ ...td, fontFamily: "var(--mono)", color: currentRoll ? "var(--text)" : "var(--faint)" }}>{currentRoll?.roll_id || "—"}</td>
                    <td style={{ ...td, color: "var(--muted)" }}>{machine.fabric || "—"}</td>
                    <td style={{ ...td, fontFamily: "var(--mono)", textAlign: "right", color: "var(--muted)" }}>{targetRPM || "--"}</td>
                    <td style={{ ...td, fontFamily: "var(--mono)", textAlign: "right" }}>{noData ? "--" : liveRPM}</td>
                    <td style={{ ...td, fontFamily: "var(--mono)", textAlign: "right", color: effColor, fontWeight: 700 }}>{effNum == null ? "--" : effNum + "%"}</td>
                    <td style={td}><span style={pill(sc)}><span style={{ width: 6, height: 6, borderRadius: "50%", background: sc }} />{sLabel}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* Roll production */}
      <Panel title="Roll Production" right={`${rolls.length} rolls`}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
          <thead><tr>
            <th style={th}>Roll ID</th><th style={th}>Machine</th><th style={th}>Fabric</th>
            <th style={th}>Shift</th><th style={{ ...th, textAlign: "right" }}>Weight</th><th style={th}>Status</th>
          </tr></thead>
          <tbody>
            {rolls.length === 0 && <tr><td style={{ ...td, textAlign: "center", color: "var(--muted)", padding: 40 }} colSpan={6}>{loading ? "Loading…" : "No rolls."}</td></tr>}
            {rolls.map((roll) => {
              const rc = RSTATUS[roll.status] || "var(--muted)";
              return (
                <tr key={roll.roll_id}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--surface)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ ...td, fontFamily: "var(--mono)", color: "var(--text)" }}>{roll.roll_id}</td>
                  <td style={{ ...td, fontFamily: "var(--mono)" }}>{roll.machine_id}</td>
                  <td style={{ ...td, color: "var(--muted)" }}>{roll.fabric_type || "—"}</td>
                  <td style={{ ...td, fontFamily: "var(--mono)", color: "var(--muted)" }}>{roll.shift || "—"}</td>
                  <td style={{ ...td, fontFamily: "var(--mono)", textAlign: "right" }}>{roll.actual_weight_kg || roll.roll_weight_kg || 0}<span style={{ color: "var(--muted)" }}> kg</span></td>
                  <td style={td}><span style={pill(rc)}><span style={{ width: 6, height: 6, borderRadius: "50%", background: rc }} />{roll.status}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
};

export default Production;
