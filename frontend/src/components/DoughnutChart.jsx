import React, { useEffect, useState } from "react";

const COLORS = ["#22c55e", "#ef4444", "#f59e0b", "#6366f1", "#7da2d6"];

const DoughnutChart = () => {
  const [kpis, setKpis] = useState(null);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    try {
      const r = await fetch("http://localhost:4000/api/dashboard/kpis");
      const d = await r.json();
      setKpis(d);
    } catch (err) {
      console.error("DoughnutChart:", err);
    }
  };

  const total = kpis ? (kpis.totalMachines || 0) : 0;
  const segments = kpis ? [
    { label: "Running",  value: kpis.running  || 0, color: "#22c55e" },
    { label: "Stopped",  value: kpis.stopped  || 0, color: "#ef4444" },
    { label: "Offline",  value: kpis.offline  || 0, color: "#f59e0b" },
    { label: "No Data",  value: kpis.noData   || 0, color: "#6366f1" },
  ] : [];

  return (
    <div style={{ background: "#0d1b2f", borderRadius: "12px", padding: "20px", color: "white", border: "1px solid #16345d" }}>
      <h3 style={{ margin: "0 0 14px" }}>Machine Status Breakdown</h3>

      {!kpis ? (
        <div style={{ color: "#7da2d6", fontSize: "16px" }}>Loading...</div>
      ) : (
        <>
          <div style={{ textAlign: "center", fontSize: "43px", fontWeight: "bold", color: "#f4ae1f", marginBottom: "14px" }}>
            {total} <span style={{ fontSize: "17px", color: "#7da2d6" }}>Machines</span>
          </div>
          {segments.map((s, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #16345d" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: s.color }} />
                <span style={{ fontSize: "16px" }}>{s.label}</span>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <span style={{ color: s.color, fontWeight: "bold" }}>{s.value}</span>
                <span style={{ color: "#7da2d6", fontSize: "14px" }}>
                  ({total > 0 ? Math.round(s.value / total * 100) : 0}%)
                </span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
};

export default DoughnutChart;
