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
      const res = await fetch("http://localhost:4000/api/alerts");
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

  const typeColor = { downtime: "#ef4444", stopped: "#f59e0b" };

  return (
    <div
      style={{
        background: "#0d1b2f",
        border: "1px solid #1f3b66",
        borderRadius: "12px",
        padding: "12px 20px",
        color: "white",
        marginTop: "20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "20px", overflowX: "auto" }}>
        <h3 style={{ color: "#ff4d4f", margin: 0, minWidth: "140px" }}>Live Alerts</h3>

        {alerts.length === 0 ? (
          <div style={{ color: "#22c55e", padding: "6px 12px" }}>
            ✓ No active alerts
          </div>
        ) : (
          alerts.map((alert, i) => (
            <div
              key={i}
              style={{
                padding: "6px 12px",
                background: "#162846",
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
