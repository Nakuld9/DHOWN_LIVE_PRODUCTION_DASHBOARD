import React, { memo } from "react";
import { Link } from "react-router-dom";

const STATUS_MAP = {
  RUNNING:  { color: "#22c55e", label: "RUNNING",  bg: "rgba(34,197,94,0.08)" },
  DOWNTIME: { color: "#dc2626", label: "DOWNTIME", bg: "rgba(220,38,38,0.08)" },
  STOPPED:  { color: "#ef4444", label: "STOPPED",  bg: "rgba(239,68,68,0.08)" },
  OFFLINE:  { color: "#f59e0b", label: "OFFLINE",  bg: "rgba(245,158,11,0.08)" },
  NO_DATA:  { color: "#6b7280", label: "NO DATA",  bg: "rgba(107,114,128,0.08)" },
};

const fmt = (v, d = 1) => (v == null ? "--" : Number(v).toFixed(d));

const MachineCardV2 = memo(({ machine, supervisorMobile = "8727048169" }) => {
  const status = machine.live_status || "NO_DATA";
  const { color: sc, label: sl, bg } = STATUS_MAP[status] || STATUS_MAP.NO_DATA;
  const noData = status === "NO_DATA";

  const rpm = noData ? "--" : String(machine.rpm ?? 0);
  const counter = noData ? "--" : String(machine.production_counter ?? 0);
  const rollKg = noData ? "--" : fmt(machine.session_production_kg) + " kg";
  const todayKg = noData ? "--" : fmt(machine.today_production_kg) + " kg";
  const operator = machine.assigned_operator || machine.operator || "—";
  const fabric = machine.fabric || "—";
  const efficiency = noData ? "--" : (machine.rpm && machine.rpm_target && machine.rpm_target > 0
    ? Math.round((machine.rpm / machine.rpm_target) * 100) + "%"
    : "--");

  const progressPct = !noData && machine.rpm && machine.rpm_target && machine.rpm_target > 0
    ? Math.min(100, Math.round((machine.rpm / machine.rpm_target) * 100))
    : 0;

  const alertSupervisor = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const now = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    const text = `ALERT: Machine ${machine.work_center || machine.machine_id} is ${status} as of ${now}. Please check immediately.`;
    window.open(`whatsapp://send?phone=91${supervisorMobile}&text=${encodeURIComponent(text)}`);
  };

  return (
    <Link to={`/machine/${machine.work_center}`} style={{ textDecoration: "none" }}>
      <div style={{
        background: "#081426",
        border: `1px solid ${sc}40`,
        borderLeft: `4px solid ${sc}`,
        borderRadius: "8px",
        padding: "8px 10px",
        color: "white",
        minHeight: "180px",
        transition: "all 0.2s ease",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Top row: Machine name + Status */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
          <div>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "#fff", letterSpacing: "0.3px" }}>
              {machine.machineNo || machine.work_center}
            </div>
            <div style={{ fontSize: "9px", color: "#8b949e", marginTop: "1px" }}>{fabric}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            {status === "DOWNTIME" && (
              <div style={{
                width: "6px", height: "6px", borderRadius: "50%",
                background: "#dc2626",
                animation: "pulse 1.5s ease-in-out infinite",
                boxShadow: "0 0 6px #dc2626",
              }} />
            )}
            <div style={{
              background: `${sc}18`,
              color: sc,
              padding: "2px 6px",
              borderRadius: "4px",
              fontSize: "9px",
              fontWeight: "700",
              letterSpacing: "0.5px",
              border: `1px solid ${sc}30`,
            }}>
              {sl}
            </div>
          </div>
        </div>

        {/* Downtime reason */}
        {status === "DOWNTIME" && machine.downtime_reason && (
          <div style={{
            background: "rgba(220,38,38,0.1)",
            border: "1px solid rgba(220,38,38,0.2)",
            borderRadius: "6px",
            padding: "3px 6px",
            marginBottom: "5px",
            fontSize: "9px",
            color: "#fca5a5",
          }}>
            {machine.downtime_reason}
            {machine.downtime_duration_minutes != null && (
              <span style={{ color: "#f87171", fontWeight: "bold", marginLeft: "6px" }}>
                {machine.downtime_duration_minutes}m
              </span>
            )}
          </div>
        )}

        {/* Operator */}
        <div style={{ fontSize: "10px", color: "#f4ae1f", marginBottom: "5px", fontWeight: "600" }}>
          <span style={{ color: "#8b949e", fontWeight: "400" }}>OP: </span>{operator}
        </div>

        {/* Metrics grid - 2 rows x 3 cols */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "3px 8px", marginBottom: "5px" }}>
          <MetricCell label="RPM" value={rpm} color="#00ff88" />
          <MetricCell label="EFF" value={efficiency} color="#f4ae1f" />
          <MetricCell label="COUNTER" value={counter} color="#60a5fa" />
          <MetricCell label="ROLL" value={rollKg} color="#4ade80" />
          <MetricCell label="TODAY" value={todayKg} color="#a78bfa" />
          <MetricCell label="SHIFT" value={noData ? "--" : fmt(machine.shift_production_kg) + " kg"} color="#fb923c" />
        </div>

        {/* Efficiency progress bar */}
        <div style={{ height: "2px", background: "#21262d", borderRadius: "2px", overflow: "hidden", marginBottom: "4px" }}>
          <div style={{
            width: `${progressPct}%`,
            height: "100%",
            background: progressPct >= 80 ? "#22c55e" : progressPct >= 50 ? "#f4ae1f" : "#ef4444",
            borderRadius: "2px",
            transition: "width 0.5s ease",
          }} />
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "9px" }}>
          <div style={{ display: "flex", gap: "8px" }}>
            <span style={{ color: "#8b949e" }}>SHIFT <span style={{ color: "#60a5fa", fontWeight: "600" }}>{noData ? "--" : machine.shift || "--"}</span></span>
            <span style={{ color: "#8b949e" }}>DC <span style={{
              color: (machine.dc_status || "").toUpperCase() === "ONLINE" ? "#22c55e" : "#ef4444",
              fontWeight: "600"
            }}>{noData ? "--" : (machine.dc_status || "OFF").toUpperCase()}</span></span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {["STOPPED", "OFFLINE", "DOWNTIME"].includes(status) && (
              <button onClick={alertSupervisor} style={{
                background: "#25D366", color: "#fff", border: "none",
                padding: "2px 6px", borderRadius: "4px", cursor: "pointer",
                fontSize: "10px", fontWeight: "bold", lineHeight: 1,
              }}>📲</button>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
});

const MetricCell = memo(({ label, value, color }) => (
  <div>
    <div style={{ fontSize: "8px", color: "#8b949e", letterSpacing: "0.4px", lineHeight: 1 }}>{label}</div>
    <div style={{ fontSize: "12px", color, fontWeight: "700", lineHeight: "1.3" }}>{value}</div>
  </div>
));

MachineCardV2.displayName = "MachineCardV2";
MetricCell.displayName = "MetricCell";

export default MachineCardV2;
