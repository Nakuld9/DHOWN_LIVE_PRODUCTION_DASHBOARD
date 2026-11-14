import React from "react";
import { Link } from "react-router-dom";

const STATUS_MAP = {
  DOWNTIME: { color: "var(--crit)", label: "DOWNTIME" },
  RUNNING:  { color: "var(--green)", label: "Running" },
  STOPPED:  { color: "var(--crit)", label: "Stopped" },
  OFFLINE:  { color: "var(--gold)", label: "Collector Offline" },
  NO_DATA:  { color: "var(--muted)", label: "Collector Offline" },
};

const fmt = (val, decimals = 2) =>
  val == null ? "--" : Number(val).toFixed(decimals);

const alertSupervisor = async (e, machine, mobile) => {
  e.preventDefault();
  e.stopPropagation();
  const status = machine.live_status || "OFFLINE";
  try {
    const res = await fetch(`/api/alerts/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        machine_id: machine.machine_id,
        machine_name: machine.work_center || machine.machine_id,
        status,
        mobile: mobile || undefined,
      }),
    });
    const j = await res.json().catch(() => ({}));
    window.alert(
      res.ok && j.ok && j.sent > 0
        ? `WhatsApp alert sent to ${j.sent} recipient(s).`
        : `Alert not delivered: ${j.error || "recipient may not be a WhatsApp test number, or the app isn't published yet"}.`
    );
  } catch (err) {
    window.alert(`Failed to send alert: ${err.message}`);
  }
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
  const operatorDisplay   = machine.assigned_operator || machine.operator || "Not Assigned";
  const fabricDisplay     = machine.fabric || "--";

  const metric = (label, value, color) => (
    <div>
      <div style={{ color: "var(--muted)", fontSize: "11px", marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "18px", color: noData ? "var(--muted)" : color, fontWeight: "bold" }}>
        {value}
      </div>
    </div>
  );

  return (
    <Link to={`/machine/${machine.work_center}`} style={{ textDecoration: "none" }}>
      <div
        style={{
          background: "var(--surface)",
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
            <div style={{ fontSize: "24px", fontWeight: "bold", color: "var(--text)" }}>
              {machine.machineNo || machine.work_center}
            </div>
            <div style={{ fontSize: "13px", color: "var(--muted)" }}>{fabricDisplay}</div>
          </div>
          <div
            style={{
              background: statusColor,
              color: "var(--text)",
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
              background: "var(--crit-dim)",
              border: "1px solid var(--crit)",
              borderRadius: "8px",
              padding: "8px 10px",
              marginBottom: "10px",
            }}
          >
            <div style={{ color: "var(--crit)", fontSize: "10px", fontWeight: "bold", marginBottom: "2px" }}>
              DOWNTIME ACTIVE
            </div>
            <div style={{ color: "var(--crit-edge)", fontSize: "12px", fontWeight: "bold" }}>
              {machine.downtime_reason || "Reason Pending"}
            </div>
            <div style={{ color: "var(--muted)", fontSize: "10px", marginTop: "2px" }}>
              Since:{" "}
              {machine.downtime_start_time
                ? new Date(machine.downtime_start_time).toLocaleTimeString()
                : "--"}
              {machine.downtime_duration_minutes != null && (
                <span style={{ color: "var(--crit)", fontWeight: "bold", marginLeft: "8px" }}>
                  {machine.downtime_duration_minutes} min
                </span>
              )}
            </div>
          </div>
        )}

        {/* Operator */}
        <div style={{ marginBottom: "12px" }}>
          <div style={{ color: "var(--yellow)", fontSize: "11px" }}>OPERATOR</div>
          <div style={{ fontSize: "16px", fontWeight: "bold" }}>{operatorDisplay}</div>
        </div>

        {/* Metrics Row 1 — RPM + Counter */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "10px" }}>
          {metric("LIVE RPM",    rpmDisplay,       "var(--green)")}
          {metric("TARGET RPM",  targetRpmDisplay, "var(--yellow)")}
          {metric("LIVE COUNTER", counterDisplay,  "var(--link)")}
        </div>

        {/* Metrics Row 2 — Production */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "10px" }}>
          {metric("ROLL PROD",  rollProdDisplay,  "var(--green)")}
          {metric("TODAY PROD", todayProdDisplay, "var(--purple)")}
          {metric("SHIFT PROD", shiftProdDisplay, "var(--idle)")}
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: "10px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid var(--border)",
            paddingTop: "8px",
          }}
        >
          <div style={{ display: "flex", gap: "18px" }}>
            <div>
              <span style={{ color: "var(--muted)", fontSize: "11px" }}>SHIFT </span>
              <span style={{ color: "var(--link)", fontWeight: "bold", fontSize: "13px" }}>{shiftDisplay}</span>
            </div>
            <div>
              <span style={{ color: "var(--muted)", fontSize: "11px" }}>DC </span>
              <span
                style={{
                  color:
                    dcStatusDisplay === "ONLINE"
                      ? "var(--green)"
                      : dcStatusDisplay === "No Data"
                      ? "var(--muted)"
                      : "var(--crit)",
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
                  background: "var(--green)", color: "white", border: "none",
                  padding: "3px 8px", borderRadius: "4px", cursor: "pointer",
                  fontSize: "12px", fontWeight: "bold",
                }}
              >
                📲
              </button>
            )}
            <div style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: "14px" }}>View →</div>
          </div>
        </div>
      </div>
    </Link>
  );
};

export default MachineCard;
