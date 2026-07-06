import React from "react";

const KPICard = ({ title, value, color, sub }) => (
  <div
    style={{
      background: "#0d1b2f",
      padding: "16px 20px",
      borderRadius: "12px",
      border: "1px solid #16345d",
      color: "white",
    }}
  >
    <p style={{ color: "#7da2d6", marginBottom: "8px", fontSize: "12px", fontWeight: "600" }}>
      {title}
    </p>
    <h2 style={{ color, margin: 0, fontSize: "22px" }}>{value}</h2>
    {sub && <p style={{ color: "#6b7280", fontSize: "11px", marginTop: "4px", marginBottom: 0 }}>{sub}</p>}
  </div>
);

const KPICards = ({ machines = [] }) => {
  const totalMachines = machines.length;

  const running    = machines.filter((m) => m.live_status === "RUNNING").length;
  const inDowntime = machines.filter((m) => m.live_status === "DOWNTIME").length;
  const offline    = machines.filter(
    (m) => m.live_status === "OFFLINE" || m.live_status === "STOPPED" || m.live_status === "NO_DATA"
  ).length;

  const allNoData =
    totalMachines > 0 && machines.every((m) => m.live_status === "NO_DATA");

  const efficiencyDisplay =
    totalMachines === 0 || allNoData
      ? "--"
      : Math.round((running / totalMachines) * 100) + "%";

  // Live counter sum (raw counter values from collectors)
  const totalLiveCounter = machines.reduce(
    (sum, m) => sum + Number(m.production_counter || 0), 0
  );

  // Today and shift production from production_records (via API join)
  const todayProductionKg = machines.reduce(
    (sum, m) => sum + Number(m.today_production_kg || 0), 0
  );
  const shiftProductionKg = machines.reduce(
    (sum, m) => sum + Number(m.shift_production_kg || 0), 0
  );

  const row1 = [
    { title: "TOTAL MACHINES",    value: totalMachines,                         color: "#7da2d6" },
    { title: "RUNNING MACHINES",  value: running,                               color: "#22c55e" },
    { title: "IN DOWNTIME",       value: inDowntime,                            color: inDowntime > 0 ? "#dc2626" : "#7da2d6" },
    { title: "OFFLINE / STOPPED", value: offline,                               color: offline > 0 ? "#f59e0b" : "#7da2d6" },
    { title: "EFFICIENCY",        value: efficiencyDisplay,                     color: "#7da2d6" },
  ];

  const row2 = [
    {
      title: "TOTAL LIVE COUNTER",
      value: allNoData ? "--" : totalLiveCounter.toLocaleString(),
      color: "#60a5fa",
      sub: "Sum of all machine counters",
    },
    {
      title: "SHIFT PRODUCTION",
      value: allNoData ? "-- KG" : shiftProductionKg.toFixed(2) + " KG",
      color: "#fb923c",
      sub: "Current shift total",
    },
    {
      title: "TODAY PRODUCTION",
      value: allNoData ? "-- KG" : todayProductionKg.toFixed(2) + " KG",
      color: "#a78bfa",
      sub: "All shifts today",
    },
  ];

  return (
    <div style={{ marginTop: "20px" }}>
      {/* Row 1 — machine status KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5,1fr)",
          gap: "12px",
          marginBottom: "12px",
        }}
      >
        {row1.map((card) => (
          <KPICard key={card.title} {...card} />
        ))}
      </div>

      {/* Row 2 — production KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: "12px",
        }}
      >
        {row2.map((card) => (
          <KPICard key={card.title} {...card} />
        ))}
      </div>
    </div>
  );
};

export default KPICards;
