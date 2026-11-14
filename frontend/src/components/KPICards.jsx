import React from "react";

const KPICard = ({ title, value, color, sub }) => (
  <div
    style={{
      background: "var(--surface)",
      padding: "10px 14px",
      borderRadius: "10px",
      border: "1px solid var(--border)",
      color: "white",
    }}
  >
    <p style={{ color: "var(--muted)", marginBottom: "4px", fontSize: "11px", fontWeight: "600", letterSpacing: 0.5 }}>
      {title}
    </p>
    <h2 style={{ color, margin: 0, fontSize: "20px" }}>{value}</h2>
    {sub && <p style={{ color: "var(--muted)", fontSize: "10px", marginTop: "3px", marginBottom: 0 }}>{sub}</p>}
  </div>
);

const KPICards = ({ machines = [] }) => {
  const totalMachines = machines.length;

  const running    = machines.filter((m) => m.live_status === "RUNNING").length;
  const inDowntime = machines.filter((m) => m.live_status === "DOWNTIME").length;
  const stopped    = machines.filter((m) => m.live_status === "STOPPED").length;
  const collectorOffline = machines.filter(
    (m) => m.live_status === "OFFLINE" || m.live_status === "NO_DATA"
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
    { title: "TOTAL MACHINES",      value: totalMachines,      color: "var(--muted)" },
    { title: "RUNNING",             value: running,            color: "var(--green)" },
    { title: "DOWNTIME",            value: inDowntime,         color: inDowntime > 0 ? "var(--crit)" : "var(--muted)" },
    { title: "STOPPED",             value: stopped,            color: stopped > 0 ? "var(--gold)" : "var(--muted)" },
    { title: "COLLECTOR OFFLINE",   value: collectorOffline,   color: collectorOffline > 0 ? "var(--muted)" : "var(--muted)" },
    { title: "EFFICIENCY",          value: efficiencyDisplay,  color: "var(--muted)" },
  ];

  const row2 = [
    {
      title: "TOTAL LIVE COUNTER",
      value: allNoData ? "--" : totalLiveCounter.toLocaleString(),
      color: "var(--link)",
      sub: "Sum of all machine counters",
    },
    {
      title: "SHIFT PRODUCTION",
      value: allNoData ? "-- KG" : shiftProductionKg.toFixed(2) + " KG",
      color: "var(--idle)",
      sub: "Current shift total",
    },
    {
      title: "TODAY PRODUCTION",
      value: allNoData ? "-- KG" : todayProductionKg.toFixed(2) + " KG",
      color: "var(--purple)",
      sub: "All shifts today",
    },
  ];

  return (
    <div style={{ marginTop: "20px" }}>
      {/* Row 1 — machine status KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6,1fr)",
          gap: "10px",
          marginBottom: "10px",
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
          gap: "10px",
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
