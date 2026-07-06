import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";

const STATUS_COLORS = {
  RUNNING: "#22c55e", DOWNTIME: "#dc2626", STOPPED: "#ef4444",
  OFFLINE: "#f59e0b", NO_DATA: "#6b7280",
};

const cardStyle = {
  background: "#161B22", border: "1px solid #30363d",
  borderRadius: "10px", padding: "16px",
};

const btnBase = {
  border: "none", borderRadius: "6px", padding: "10px 20px",
  fontWeight: "700", fontSize: "13px", cursor: "pointer",
  letterSpacing: "0.5px",
};

export default function MachineDetails() {
  const { machineId } = useParams();
  const [machine, setMachine] = useState(null);
  const [error, setError] = useState(null);

  // Manual controls state
  const [openingRoll, setOpeningRoll] = useState(false);
  const [closingRoll, setClosingRoll] = useState(false);
  const [closeWeight, setCloseWeight] = useState("");
  const [actionMsg, setActionMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  const token = localStorage.getItem("dhown_token");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const loadMachine = useCallback(async () => {
    try {
      const res = await fetch(`http://localhost:4000/api/machines/${machineId}/details`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setMachine(await res.json());
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
  }, [machineId]);

  useEffect(() => {
    loadMachine();
    const interval = setInterval(loadMachine, 5000);
    return () => clearInterval(interval);
  }, [loadMachine]);

  const showMsg = (text, isError = false) => {
    setActionMsg({ text, isError });
    setTimeout(() => setActionMsg(null), 4000);
  };

  // ── OPEN ROLL ──
  const handleOpenRoll = async () => {
    setLoading(true);
    try {
      const shift = new Date().getHours() >= 8 && new Date().getHours() < 20 ? "D" : "N";
      const res = await fetch("http://localhost:4000/api/rolls", {
        method: "POST", headers,
        body: JSON.stringify({ machine_id: machineId, shift, start_counter: 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to open roll");
      showMsg(`Roll opened: ${data.roll_id}`);
      setOpeningRoll(false);
      loadMachine();
    } catch (err) {
      showMsg(err.message, true);
    } finally { setLoading(false); }
  };

  // ── CLOSE ROLL ──
  const handleCloseRoll = async () => {
    if (!machine.roll_id) return;
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:4000/api/rolls/${machine.roll_id}/close`, {
        method: "PUT", headers,
        body: JSON.stringify({ actual_weight_kg: closeWeight ? parseFloat(closeWeight) : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to close roll");
      showMsg(`Roll closed: ${machine.roll_id}`);
      setClosingRoll(false);
      setCloseWeight("");
      loadMachine();
    } catch (err) {
      showMsg(err.message, true);
    } finally { setLoading(false); }
  };

  // ── REPORT DOWNTIME ──
  const handleDowntime = async (reason) => {
    setLoading(true);
    try {
      const shift = new Date().getHours() >= 8 && new Date().getHours() < 20 ? "D" : "N";
      const res = await fetch("http://localhost:4000/api/downtime", {
        method: "POST", headers,
        body: JSON.stringify({ machine_id: machineId, reason, shift }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to report downtime");
      showMsg(`Downtime reported: ${reason}`);
      loadMachine();
    } catch (err) {
      showMsg(err.message, true);
    } finally { setLoading(false); }
  };

  // ── CLOSE DOWNTIME ──
  const handleCloseDowntime = async () => {
    setLoading(true);
    try {
      const dtRes = await fetch("http://localhost:4000/api/downtime/open");
      const dtData = await dtRes.json();
      const openDt = Array.isArray(dtData) ? dtData.find(d => d.machine_id === machineId) : null;
      if (!openDt) { showMsg("No open downtime found", true); setLoading(false); return; }

      const res = await fetch(`http://localhost:4000/api/downtime/${openDt.id}/close`, {
        method: "PUT", headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to close downtime");
      showMsg("Downtime resolved");
      loadMachine();
    } catch (err) {
      showMsg(err.message, true);
    } finally { setLoading(false); }
  };

  if (error) {
    return (
      <div style={{ color: "white", padding: "30px", textAlign: "center" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠</div>
        <div style={{ fontSize: "20px", color: "#ef4444", marginBottom: "8px" }}>Failed to load machine</div>
        <div style={{ fontSize: "14px", color: "#7da2d6", marginBottom: "20px" }}>{error}</div>
        <button onClick={loadMachine} style={{ ...btnBase, background: "#f4ae1f", color: "#0D1117" }}>Retry</button>
      </div>
    );
  }

  if (!machine) {
    return <div style={{ color: "white", padding: "30px", fontSize: "24px" }}>Loading Machine...</div>;
  }

  const noData = machine.live_status === "NO_DATA";
  const statusColor = STATUS_COLORS[machine.live_status] || "#6b7280";
  const efficiency = noData || !machine.rpm_target ? "--"
    : Math.round(((machine.rpm || 0) / machine.rpm_target) * 100) + "%";
  const hasOpenRoll = machine.roll_id && machine.roll_status === "OPEN";
  const isDowntime = machine.live_status === "DOWNTIME";

  return (
    <div style={{ padding: "20px", color: "white", maxWidth: "1400px", margin: "0 auto" }}>

      {/* Back + Title */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
        <Link to="/" style={{ color: "#8b949e", textDecoration: "none", fontSize: "14px" }}>← Dashboard</Link>
        <h1 style={{ color: "#f4ae1f", margin: 0, fontSize: "22px", letterSpacing: "1px" }}>
          {machine.machine_name || machine.machine_id}
        </h1>
        <div style={{
          background: `${statusColor}18`, color: statusColor,
          padding: "4px 12px", borderRadius: "6px",
          fontSize: "12px", fontWeight: "700", border: `1px solid ${statusColor}40`,
        }}>
          {machine.live_status || "UNKNOWN"}
        </div>
      </div>

      {/* Action message */}
      {actionMsg && (
        <div style={{
          background: actionMsg.isError ? "#7f1d1d" : "#14532d",
          color: actionMsg.isError ? "#fca5a5" : "#86efac",
          padding: "10px 16px", borderRadius: "8px", marginBottom: "12px",
          fontSize: "13px", fontWeight: "600",
        }}>
          {actionMsg.text}
        </div>
      )}

      {/* KPI Cards Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "10px", marginBottom: "16px" }}>
        <KPICard label="STATUS" value={machine.live_status === "NO_DATA" ? "NO DATA" : machine.live_status} color={statusColor} />
        <KPICard label="LIVE RPM" value={noData ? "--" : (machine.rpm || 0)} color="#00ff88" />
        <KPICard label="TARGET RPM" value={machine.rpm_target || "--"} color="#60a5fa" />
        <KPICard label="EFFICIENCY" value={efficiency} color="#f4ae1f" />
        <KPICard label="DC STATUS" value={noData ? "OFFLINE" : (machine.dc_status || "OFFLINE").toUpperCase()}
          color={(machine.dc_status || "").toUpperCase() === "ONLINE" ? "#22c55e" : "#ef4444"} />
      </div>

      {/* ══════════════════════════════════════════════════════
          MANUAL CONTROLS — the main addition
          ══════════════════════════════════════════════════════ */}
      <div style={{ ...cardStyle, marginBottom: "16px", borderLeft: "4px solid #f4ae1f" }}>
        <h2 style={{ color: "#f4ae1f", margin: "0 0 12px 0", fontSize: "15px", letterSpacing: "1px" }}>
          MANUAL CONTROLS
        </h2>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>

          {/* ── Roll Controls ── */}
          {!hasOpenRoll ? (
            openingRoll ? (
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span style={{ fontSize: "12px", color: "#8b949e" }}>
                  Open new roll on {machineId}? (Shift: {new Date().getHours() >= 8 && new Date().getHours() < 20 ? "DAY" : "NIGHT"})
                </span>
                <button onClick={handleOpenRoll} disabled={loading}
                  style={{ ...btnBase, background: "#22c55e", color: "#fff" }}>
                  {loading ? "Opening..." : "CONFIRM OPEN"}
                </button>
                <button onClick={() => setOpeningRoll(false)}
                  style={{ ...btnBase, background: "#30363d", color: "#8b949e" }}>
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setOpeningRoll(true)}
                style={{ ...btnBase, background: "#22c55e", color: "#fff" }}>
                ▶ OPEN ROLL
              </button>
            )
          ) : (
            closingRoll ? (
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span style={{ fontSize: "12px", color: "#8b949e" }}>Weight (kg):</span>
                <input
                  type="number" step="0.1" placeholder="e.g. 18.5"
                  value={closeWeight} onChange={e => setCloseWeight(e.target.value)}
                  style={{
                    background: "#0D1117", border: "1px solid #30363d", borderRadius: "6px",
                    color: "#e6edf3", padding: "8px 12px", width: "100px", fontSize: "13px",
                  }}
                />
                <button onClick={handleCloseRoll} disabled={loading}
                  style={{ ...btnBase, background: "#ef4444", color: "#fff" }}>
                  {loading ? "Closing..." : "CONFIRM CLOSE"}
                </button>
                <button onClick={() => { setClosingRoll(false); setCloseWeight(""); }}
                  style={{ ...btnBase, background: "#30363d", color: "#8b949e" }}>
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setClosingRoll(true)}
                style={{ ...btnBase, background: "#ef4444", color: "#fff" }}>
                ⏹ CLOSE ROLL
              </button>
            )
          )}

          {/* ── Downtime Controls ── */}
          {isDowntime ? (
            <button onClick={handleCloseDowntime} disabled={loading}
              style={{ ...btnBase, background: "#22c55e", color: "#fff" }}>
              ✓ RESOLVE DOWNTIME
            </button>
          ) : (
            <DowntimeDropdown onSelect={handleDowntime} loading={loading} />
          )}
        </div>

        {/* Current roll info */}
        {hasOpenRoll && (
          <div style={{
            marginTop: "12px", padding: "8px 12px",
            background: "#0D1117", borderRadius: "6px", border: "1px solid #22c55e30",
            fontSize: "12px", color: "#8b949e",
          }}>
            <span style={{ color: "#22c55e", fontWeight: "700" }}>ACTIVE ROLL: </span>
            <span style={{ color: "#e6edf3" }}>{machine.roll_id}</span>
            <span style={{ marginLeft: "16px" }}>Weight: {machine.roll_weight_kg || 0} kg</span>
            <span style={{ marginLeft: "16px" }}>Counter: {machine.production_counter || 0}</span>
          </div>
        )}
      </div>

      {/* Machine Info + Operator + Roll — 3 columns */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "16px" }}>

        {/* Machine Info */}
        <div style={cardStyle}>
          <h3 style={{ color: "#f4ae1f", margin: "0 0 10px 0", fontSize: "13px", letterSpacing: "1px" }}>MACHINE INFORMATION</h3>
          <InfoRow label="Machine ID" value={machine.machine_id} />
          <InfoRow label="Name" value={machine.machine_name} />
          <InfoRow label="Type" value={machine.machine_type} />
          <InfoRow label="Diameter" value={machine.diameter ? `${machine.diameter}"` : "--"} />
          <InfoRow label="Gauge" value={machine.gauge ? `${machine.gauge}G` : "--"} />
          <InfoRow label="Fabric" value={machine.fabric || "--"} />
          <InfoRow label="Fabric Code" value={machine.fabric_code || "--"} />
          <InfoRow label="KG/Counter" value={machine.kg_per_counter || "--"} />
        </div>

        {/* Operator Info */}
        <div style={cardStyle}>
          <h3 style={{ color: "#f4ae1f", margin: "0 0 10px 0", fontSize: "13px", letterSpacing: "1px" }}>OPERATOR INFORMATION</h3>
          <InfoRow label="Assigned Operator" value={machine.assigned_operator || "Not Assigned"} highlight={!!machine.assigned_operator} />
          <InfoRow label="Operator ID" value={machine.assigned_operator_id || "--"} />
          <InfoRow label="Assigned At" value={machine.assigned_at ? new Date(machine.assigned_at).toLocaleString("en-IN") : "--"} />
          <InfoRow label="Shift" value={machine.shift || "--"} />
          <InfoRow label="DC Status" value={(machine.dc_status || "OFFLINE").toUpperCase()}
            highlight={(machine.dc_status || "").toUpperCase() === "ONLINE"}
            color={(machine.dc_status || "").toUpperCase() === "ONLINE" ? "#22c55e" : "#ef4444"} />
        </div>

        {/* Roll Info */}
        <div style={cardStyle}>
          <h3 style={{ color: "#f4ae1f", margin: "0 0 10px 0", fontSize: "13px", letterSpacing: "1px" }}>CURRENT ROLL</h3>
          {hasOpenRoll ? (
            <>
              <InfoRow label="Roll ID" value={machine.roll_id} highlight color="#22c55e" />
              <InfoRow label="Status" value={machine.roll_status} color="#22c55e" />
              <InfoRow label="Roll Weight" value={`${machine.roll_weight_kg || 0} kg`} />
              <InfoRow label="Counter" value={machine.production_counter || 0} />
            </>
          ) : (
            <div style={{ color: "#8b949e", fontSize: "13px", padding: "20px 0", textAlign: "center" }}>
              No active roll — use OPEN ROLL above to start production
            </div>
          )}
        </div>
      </div>

      {/* Downtime info if active */}
      {isDowntime && (
        <div style={{ ...cardStyle, marginBottom: "16px", borderLeft: "4px solid #dc2626" }}>
          <h3 style={{ color: "#dc2626", margin: "0 0 8px 0", fontSize: "13px", letterSpacing: "1px" }}>ACTIVE DOWNTIME</h3>
          <InfoRow label="Reason" value={machine.downtime_reason || "Reason Pending"} color="#fca5a5" />
          <InfoRow label="Since" value={machine.downtime_start_time ? new Date(machine.downtime_start_time).toLocaleString("en-IN") : "--"} />
          <InfoRow label="Duration" value={machine.downtime_duration_minutes ? `${machine.downtime_duration_minutes} min` : "--"} color="#f87171" />
        </div>
      )}
    </div>
  );
}

/* ── Helper Components ── */

function KPICard({ label, value, color }) {
  return (
    <div style={{
      background: "#161B22", border: "1px solid #30363d", borderRadius: "8px",
      padding: "10px 14px", textAlign: "center",
    }}>
      <div style={{ fontSize: "9px", color: "#8b949e", letterSpacing: "0.5px", marginBottom: "4px", fontWeight: "600" }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: "800", color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function InfoRow({ label, value, highlight, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #21262d" }}>
      <span style={{ fontSize: "12px", color: "#8b949e" }}>{label}</span>
      <span style={{ fontSize: "12px", fontWeight: highlight ? "700" : "500", color: color || (highlight ? "#f4ae1f" : "#e6edf3") }}>{value}</span>
    </div>
  );
}

function DowntimeDropdown({ onSelect, loading }) {
  const [open, setOpen] = useState(false);
  const reasons = [
    "Yarn Break", "Needle Break", "Fabric Fault", "Power Cut",
    "Maintenance", "Operator Absent", "Yarn Change", "Quality Issue", "Other",
  ];

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} disabled={loading}
        style={{ ...btnBase, background: "#dc2626", color: "#fff" }}>
        ⚠ REPORT DOWNTIME
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, marginTop: "4px",
          background: "#161B22", border: "1px solid #30363d", borderRadius: "8px",
          padding: "4px", zIndex: 50, minWidth: "180px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}>
          {reasons.map(r => (
            <div key={r} onClick={() => { onSelect(r); setOpen(false); }}
              style={{
                padding: "8px 12px", fontSize: "12px", color: "#e6edf3",
                cursor: "pointer", borderRadius: "4px",
              }}
              onMouseEnter={e => e.target.style.background = "#30363d"}
              onMouseLeave={e => e.target.style.background = "transparent"}>
              {r}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
