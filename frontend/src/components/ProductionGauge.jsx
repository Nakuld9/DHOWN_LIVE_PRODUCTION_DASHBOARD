import React, { useEffect, useState } from "react";

const ProductionGauge = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    try {
      const r = await fetch("http://localhost:4000/api/production/current");
      const machines = await r.json();
      if (Array.isArray(machines)) {
        const totalKg = machines.reduce((s, m) => s + parseFloat(m.session_production_kg || 0), 0);
        const running = machines.filter(m => m.live_status === "RUNNING").length;
        const total   = machines.length;
        setData({ totalKg: Math.round(totalKg * 1000) / 1000, running, total });
      }
    } catch (err) {
      console.error("ProductionGauge:", err);
    }
  };

  const pct = data && data.total > 0 ? Math.round(data.running / data.total * 100) : null;
  const color = pct === null ? "#7da2d6" : pct >= 80 ? "#22c55e" : pct >= 50 ? "#f4ae1f" : "#ef4444";

  return (
    <div style={{ background: "#0d1b2f", borderRadius: "12px", padding: "20px", color: "white", border: "1px solid #16345d" }}>
      <h3 style={{ margin: "0 0 8px" }}>PRODUCTION vs TARGET</h3>

      {!data ? (
        <div style={{ color: "#7da2d6", fontSize: "16px", margin: "20px 0" }}>Loading...</div>
      ) : (
        <>
          <div style={{ textAlign: "center", fontSize: "43px", color, marginTop: "10px", fontWeight: "bold" }}>
            {pct}%
          </div>
          <p style={{ textAlign: "center", color: "#7da2d6", margin: "6px 0" }}>Machine Utilisation</p>
          <div style={{ height: "8px", background: "#16345d", borderRadius: "6px", overflow: "hidden", margin: "10px 0" }}>
            <div style={{ width: `${pct || 0}%`, height: "100%", background: color, borderRadius: "6px" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px", color: "#7da2d6" }}>
            <span>{data.running}/{data.total} running</span>
            <span style={{ color: "#f4ae1f", fontWeight: "bold" }}>{data.totalKg} kg this session</span>
          </div>
        </>
      )}
    </div>
  );
};

export default ProductionGauge;
