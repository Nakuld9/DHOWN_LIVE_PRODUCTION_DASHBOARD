import React from "react";
import { Link } from "react-router-dom";

const STATUS_MAP = {
  DOWNTIME: { color: "#dc2626", label: "DOWNTIME" },
  RUNNING:  { color: "#22c55e", label: "Running" },
  STOPPED:  { color: "#ef4444", label: "Stopped" },
  OFFLINE:  { color: "#f59e0b", label: "Collector Offline" },
  NO_DATA:  { color: "#6b7280", label: "Waiting for Data" },
};

const fmt = (val, decimals = 2) =>
  val == null ? "--" : Number(val).toFixed(decimals);

const alertSupervisor = (e, machine, mobile) => {
  e.preventDefault();
  e.stopPropagation();
  const status = machine.live_status || "OFFLINE";
  const now = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  const text = `ALERT: Machine ${machine.work_center || machine.machine_id} is ${status} as of ${now}. Please check immediately.`;
  window.open(`whatsapp://send?phone=91${mobile}&text=${encodeURIComponent(text)}`);
};

const MachineCard = ({ machine, supervisorMobile = "8727048169" }) => {
  const machineStatus = machine.live_status || "NO_DATA";
  const { color: statusColor, label: statusLabel } =
    STATUS_MAP[machineStatus] || STATUS_MAP.NO_DATA;

  const noData = machineStatus === "NO_DATA";

  const rpmDisplay        = noData ? "--" : String(machine.rpm ?? 0);
  const targetRpmDisplay  = noData ? "--" : String(machine.rpm_target ?? 0);
  const shiftDisplay      = noData ? "--" : machine.shift || "--";
  const counterDisplay    = noData ? "--" : String(machine.production_counter ?? 0);
  const rollProdDisplay   = noData ? "--" : fmt(machine.session_production_kg) + " KG";
  const todayProdDisplay  = noData ? "--" : fmt(machine.today_production_kg) + " KG";
  const shiftProdDisplay  = noData ? "--" : fmt(machine.shift_production_kg) + " KG";
  const dcStatusDisplay   = noData ? "No Data" : (machine.dc_status || "OFFLINE").toUpperCase();
  const operatorDisplay   = machine.operator || "Not Assigned";
  const fabricDisplay     = machine.fabric || "--";

  const metric = (label, value, color) => (
    <div>
      <div style={{ color: "#9ca3af", fontSize: "11px", marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "18px", color: noData ? "#6b7280" : color, fontWeight: "bold" }}>
        {value}
      </div>
    </div>
  );

  return (
    <Link to={`/machine/${machine.work_center}`} style={{ textDecoration: "none" }}>
      <div
        style={{
          background: "#071120",
          border: `2px solid ${statusColor}`,
          borderRadius: "14px",
          padding: "12px",
          color: "white",
          minHeight: "310px",
          boxShadow: `0 0 12px ${statusColor}30`,
          transition: "0.2s",
          cursor: "pointer",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <div>
            <div style={{ fontSize: "24px", fontWeight: "bold", color: "#ffffff" }}>
              {machine.machineNo || machine.work_center}
            </div>
            <div style={{ fontSize: "13px", color: "#9ca3af" }}>{fabricDisplay}</div>
          </div>
          <div
            style={{
              background: statusColor,
              color: "#fff",
              padding: "4px 10px",
              borderRadius: "20px",
              fontSize: "11px",
              fontWeight: "bold",
            }}
          >
            {statusLabel}
          </div>
        </div>

        {/* Downtime Panel */}
        {machineStatus === "DOWNTIME" && (
          <div
            style={{
              background: "#1a0505",
              border: "1px solid #dc2626",
              borderRadius: "8px",
              padding: "8px 10px",
              marginBottom: "10px",
            }}
          >
            <div style={{ color: "#dc2626", fontSize: "10px", fontWeight: "bold", marginBottom: "2px" }}>
              DOWNTIME ACTIVE
            </div>
            <div style={{ color: "#fca5a5", fontSize: "12px", fontWeight: "bold" }}>
              {machine.downtime_reason || "Reason Pending"}
            </div>
            <div style={{ color: "#9ca3af", fontSize: "10px", marginTop: "2px" }}>
              Since:{" "}
              {machine.downtime_start_time
                ? new Date(machine.downtime_start_time).toLocaleTimeString()
                : "--"}
              {machine.downtime_duration_minutes != null && (
                <span style={{ color: "#f87171", fontWeight: "bold", marginLeft: "8px" }}>
                  {machine.downtime_duration_minutes} min
                </span>
              )}
            </div>
          </div>
        )}

        {/* Operator */}
        <div style={{ marginBottom: "12px" }}>
          <div style={{ color: "#FFD700", fontSize: "11px" }}>OPERATOR</div>
          <div style={{ fontSize: "16px", fontWeight: "bold" }}>{operatorDisplay}</div>
        </div>

        {/* Metrics Row 1 — RPM + Counter */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "10px" }}>
          {metric("LIVE RPM",    rpmDisplay,       "#00ff88")}
          {metric("TARGET RPM",  targetRpmDisplay, "#FFD700")}
          {metric("LIVE COUNTER", counterDisplay,  "#60a5fa")}
        </div>

        {/* Metrics Row 2 — Production */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "10px" }}>
          {metric("ROLL PROD",  rollProdDisplay,  "#4ade80")}
          {metric("TODAY PROD", todayProdDisplay, "#a78bfa")}
          {metric("SHIFT PROD", shiftProdDisplay, "#fb923c")}
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: "10px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid #16345d",
            paddingTop: "8px",
          }}
        >
          <div style={{ display: "flex", gap: "18px" }}>
            <div>
              <span style={{ color: "#9ca3af", fontSize: "11px" }}>SHIFT </span>
              <span style={{ color: "#60a5fa", fontWeight: "bold", fontSize: "13px" }}>{shiftDisplay}</span>
            </div>
            <div>
              <span style={{ color: "#9ca3af", fontSize: "11px" }}>DC </span>
              <span
                style={{
                  color:
                    dcStatusDisplay === "ONLINE"
                      ? "#22c55e"
                      : dcStatusDisplay === "No Data"
                      ? "#6b7280"
                      : "#ef4444",
                  fontWeight: "bold",
                  fontSize: "13px",
                }}
              >
                {dcStatusDisplay}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {["STOPPED", "OFFLINE", "DOWNTIME"].includes(machineStatus) && (
              <button
                onClick={(e) => alertSupervisor(e, machine, supervisorMobile)}
                title={`Alert supervisor via WhatsApp`}
                style={{
                  background: "#25D366", color: "white", border: "none",
                  padding: "3px 8px", borderRadius: "4px", cursor: "pointer",
                  fontSize: "12px", fontWeight: "bold",
                }}
              >
                📲
              </button>
            )}
            <div style={{ color: "#FFD700", fontWeight: "bold", fontSize: "14px" }}>View →</div>
          </div>
        </div>
      </div>
    </Link>
  );
};

export default MachineCard;
