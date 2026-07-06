import React, { useEffect, useState } from "react";

const OEEGauge = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    try {
      const r = await fetch("http://localhost:4000/api/oee");
      const d = await r.json();
      if (d.records) {
        const avg = d.avg_oee || 0;
        const avail = d.records.length > 0
          ? Math.round(d.records.reduce((s, x) => s + parseFloat(x.availability || 0), 0) / d.records.length * 100) / 100
          : 0;
        const perf = d.records.length > 0
          ? Math.round(d.records.reduce((s, x) => s + parseFloat(x.performance || 0), 0) / d.records.length * 100) / 100
          : 0;
        const qual = d.records.length > 0
          ? Math.round(d.records.reduce((s, x) => s + parseFloat(x.quality || 0), 0) / d.records.length * 100) / 100
          : 100;
        setData({ oee: avg, availability: avail, performance: perf, quality: qual, shift: d.shift });
      }
    } catch (err) {
      console.error("OEEGauge:", err);
    }
  };

  const color = (v) => v >= 85 ? "#00ff88" : v >= 65 ? "#f4ae1f" : "#ef4444";
  const label = (v) => v >= 85 ? "Excellent" : v >= 65 ? "Good" : "Needs Attention";

  const oee = data ? parseFloat(data.oee) : null;

  return (
    <div style={{ background: "#161B22", border: "1px solid #30363d", borderRadius: "12px", padding: "20px", color: "white", textAlign: "center" }}>
      <h3 style={{ margin: "0 0 8px" }}>OEE {data?.shift ? `(Shift ${data.shift})` : ""}</h3>

      {oee === null ? (
        <div style={{ color: "#7da2d6", fontSize: "16px", margin: "24px 0" }}>No data yet</div>
      ) : (
        <>
          <h1 style={{ color: color(oee), fontSize: "50px", margin: "8px 0" }}>{oee.toFixed(1)}%</h1>
          <p style={{ color: color(oee), margin: "0 0 14px" }}>{label(oee)}</p>
          <div style={{ display: "flex", justifyContent: "space-around", fontSize: "14px", color: "#7da2d6" }}>
            <div><div style={{ color: color(data.availability), fontWeight: "bold" }}>{parseFloat(data.availability).toFixed(1)}%</div>Availability</div>
            <div><div style={{ color: color(data.performance), fontWeight: "bold" }}>{parseFloat(data.performance).toFixed(1)}%</div>Performance</div>
            <div><div style={{ color: color(data.quality), fontWeight: "bold" }}>{parseFloat(data.quality).toFixed(1)}%</div>Quality</div>
          </div>
        </>
      )}
    </div>
  );
};

export default OEEGauge;
