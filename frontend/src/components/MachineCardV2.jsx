import React, { memo } from "react";
import { Link } from "react-router-dom";

// Status colours are hex (not CSS vars) so alpha compositing (`${sc}1f`) works.
// They mirror the design tokens: ok / crit / idle / offline.
const STATUS_MAP = {
  RUNNING:  { color: "var(--green)", label: "RUNNING" },
  DOWNTIME: { color: "var(--crit)", label: "DOWNTIME" },
  STOPPED:  { color: "var(--crit)", label: "STOPPED" },
  OFFLINE:  { color: "var(--gold)", label: "OFFLINE" },
  NO_DATA:  { color: "var(--faint)", label: "NO DATA" },
};

const fmt = (v, d = 1) => (v == null ? "--" : Number(v).toFixed(d));

const MachineCardV2 = memo(({ machine, supervisorMobile = "8727048169" }) => {
  const status = machine.live_status || "NO_DATA";
  const { color: sc, label: sl } = STATUS_MAP[status] || STATUS_MAP.NO_DATA;
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
  const progColor = progressPct >= 80 ? "var(--green)" : progressPct >= 50 ? "var(--gold)" : "var(--crit)";

  const alertSupervisor = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch(`/api/alerts/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machine_id: machine.machine_id,
          machine_name: machine.work_center || machine.machine_id,
          status,
          mobile: supervisorMobile || undefined,
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

  return (
    <Link to={`/machine/${machine.work_center}`} style={{ textDecoration: "none" }}>
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${sc}`,
        borderRadius: "9px",
        padding: "11px 12px",
        color: "var(--text)",
        minHeight: "180px",
        transition: "border-color 0.2s ease, background 0.2s ease",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
      }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.borderColor = "var(--surface-2)"; e.currentTarget.style.borderLeftColor = sc; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.borderLeftColor = sc; }}
      >
        {/* Top row: Machine id + Status */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
          <div>
            <div style={{ fontFamily: "var(--mono)", fontSize: "15px", fontWeight: "700", color: "var(--text)", letterSpacing: "0.02em" }}>
              {machine.machineNo || machine.work_center}
            </div>
            <div style={{ fontSize: "10px", color: "var(--faint)", marginTop: "2px" }}>{fabric}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            {status === "DOWNTIME" && (
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: sc, animation: "pulse 1.5s ease-in-out infinite", boxShadow: `0 0 6px ${sc}` }} />
            )}
            <div style={{
              background: `${sc}1f`, color: sc, padding: "3px 8px", borderRadius: "99px",
              fontFamily: "var(--mono)", fontSize: "9px", fontWeight: "700", letterSpacing: "0.06em",
              border: `1px solid ${sc}33`, textTransform: "uppercase",
              display: "inline-flex", alignItems: "center", gap: "5px",
            }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: sc }} />{sl}
            </div>
          </div>
        </div>

        {/* Downtime reason */}
        {status === "DOWNTIME" && machine.downtime_reason && (
          <div style={{ background: "var(--crit-dim)", border: "1px solid var(--crit-dim)", borderRadius: "6px", padding: "4px 7px", marginBottom: "6px", fontSize: "9.5px", color: "var(--crit-edge)" }}>
            {machine.downtime_reason}
            {machine.downtime_duration_minutes != null && (
              <span style={{ color: "var(--crit)", fontWeight: "bold", marginLeft: "6px" }}>{machine.downtime_duration_minutes}m</span>
            )}
          </div>
        )}

        {/* Operator */}
        <div style={{ fontSize: "10.5px", marginBottom: "8px" }}>
          <span style={{ fontFamily: "var(--mono)", color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase", fontSize: "9px" }}>Operator </span>
          <span style={{ color: "var(--text)", fontWeight: "600" }}>{operator}</span>
        </div>

        {/* Metrics grid - 2 rows x 3 cols */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px 10px", marginBottom: "8px" }}>
          <MetricCell label="RPM" value={rpm} accent />
          <MetricCell label="Eff" value={efficiency} yellow />
          <MetricCell label="Counter" value={counter} />
          <MetricCell label="Roll" value={rollKg} />
          <MetricCell label="Today" value={todayKg} />
          <MetricCell label="Shift" value={noData ? "--" : fmt(machine.shift_production_kg) + " kg"} />
        </div>

        {/* Efficiency progress bar */}
        <div style={{ height: "3px", background: "var(--surface)", borderRadius: "2px", overflow: "hidden", marginBottom: "7px" }}>
          <div style={{ width: `${progressPct}%`, height: "100%", background: progColor, borderRadius: "2px", transition: "width 0.5s ease" }} />
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "var(--mono)", fontSize: "9px" }}>
          <div style={{ display: "flex", gap: "10px" }}>
            <span style={{ color: "var(--faint)" }}>SHIFT <span style={{ color: "var(--muted)", fontWeight: "600" }}>{noData ? "--" : machine.shift || "--"}</span></span>
            <span style={{ color: "var(--faint)" }}>DC <span style={{ color: (machine.dc_status || "").toUpperCase() === "ONLINE" ? "var(--green)" : "var(--crit)", fontWeight: "600" }}>{noData ? "--" : (machine.dc_status || "OFF").toUpperCase()}</span></span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {["STOPPED", "OFFLINE", "DOWNTIME"].includes(status) && (
              <button onClick={alertSupervisor} title="Alert supervisor on WhatsApp" style={{
                background: "var(--green)", color: "var(--text)", border: "none",
                padding: "2px 7px", borderRadius: "5px", cursor: "pointer",
                fontSize: "10px", fontWeight: "bold", lineHeight: 1,
              }}>📲</button>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
});

const MetricCell = memo(({ label, value, accent, yellow }) => (
  <div>
    <div style={{ fontFamily: "var(--mono)", fontSize: "8.5px", color: "var(--faint)", letterSpacing: ".08em", textTransform: "uppercase", lineHeight: 1 }}>{label}</div>
    <div style={{ fontFamily: "var(--mono)", fontSize: "13px", fontWeight: "700", lineHeight: "1.35", fontVariantNumeric: "tabular-nums", color: yellow ? "var(--gold)" : accent ? "var(--text)" : "var(--muted)" }}>{value}</div>
  </div>
));

MachineCardV2.displayName = "MachineCardV2";
MetricCell.displayName = "MetricCell";

export default MachineCardV2;
