import React, { useEffect, useState } from "react";

const AlertsBar = () => {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 15000);
    return () => clearInterval(interval);
  }, []);

  const loadAlerts = async () => {
    try {
      const res = await fetch("/api/alerts");
      const data = await res.json();

      const built = [];

      // Open downtimes → highest priority
      (data.openDowntime || []).forEach(d => {
        const mins = d.start_time
          ? Math.round((Date.now() - new Date(d.start_time)) / 60000)
          : "?";
        built.push({ text: `${d.machine_id} — ${d.reason} (${mins} min)`, type: "downtime" });
      });

      // Stopped machines (machine_status = STOPPED in DB)
      (data.stoppedMachines || []).forEach(m => {
        built.push({ text: `${m.machine_id} is STOPPED`, type: "stopped" });
      });

      setAlerts(built);
    } catch (err) {
      console.error("AlertsBar:", err);
    }
  };

  const typeColor = { downtime: "var(--crit)", stopped: "var(--gold)" };

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        padding: "12px 20px",
        color: "white",
        marginTop: "0",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "20px", overflowX: "auto" }}>
        <h3 style={{ color: "var(--crit)", margin: 0, minWidth: "140px" }}>Live Alerts</h3>

        {alerts.length === 0 ? (
          <div style={{ color: "var(--green)", padding: "6px 12px" }}>
            ✓ No active alerts
          </div>
        ) : (
          alerts.map((alert, i) => (
            <div
              key={i}
              style={{
                padding: "6px 12px",
                background: "var(--surface)",
                border: `1px solid ${typeColor[alert.type] || "#555"}`,
                borderRadius: "8px",
                whiteSpace: "nowrap",
                fontSize: "16px",
              }}
            >
              <span style={{ color: typeColor[alert.type] || "white" }}>●</span>{" "}
              {alert.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AlertsBar;
