import React, { useEffect, useState } from "react";

export default function ProductionLeaderboard() {
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    try {
      const r = await fetch("http://localhost:4000/api/production/daily");
      const d = await r.json();
      setMachines((d.records || []).slice(0, 5));
    } catch (err) {
      console.error("ProductionLeaderboard:", err);
    } finally {
      setLoading(false);
    }
  };

  const medalColor = ["#FFD700", "#C0C0C0", "#CD7F32", "#7da2d6", "#7da2d6"];

  return (
    <div style={{ background: "#071120", border: "1px solid #16345d", borderRadius: "10px", padding: "15px", marginTop: "15px" }}>
      <h3 style={{ color: "#FFD700", marginBottom: "15px", margin: "0 0 15px" }}>Top Machines Today</h3>

      {loading ? (
        <div style={{ color: "#7da2d6", fontSize: "16px" }}>Loading...</div>
      ) : machines.length === 0 ? (
        <div style={{ color: "#7da2d6", fontSize: "16px", fontStyle: "italic" }}>No production data today yet</div>
      ) : (
        machines.map((m, i) => (
          <div key={m.machine_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < machines.length - 1 ? "1px solid #16345d" : "none" }}>
            <span>
              <span style={{ color: medalColor[i], marginRight: "8px", fontWeight: "bold" }}>#{i + 1}</span>
              {m.machine_name || m.machine_id}
            </span>
            <span style={{ color: "#00ff88", fontWeight: "bold" }}>
              {parseFloat(m.production_kg || 0).toFixed(3)} kg
            </span>
          </div>
        ))
      )}
    </div>
  );
}
