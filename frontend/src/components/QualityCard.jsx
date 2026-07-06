import React, { useEffect, useState } from "react";

const QualityCard = () => {
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
        const quality = d.records.length > 0
          ? Math.round(d.records.reduce((s, x) => s + parseFloat(x.quality || 0), 0) / d.records.length * 100) / 100
          : 100;
        setData({ quality, shift: d.shift, machines: d.records.length });
      }
    } catch (err) {
      console.error("QualityCard:", err);
    }
  };

  const q = data ? parseFloat(data.quality) : null;
  const color = q === null ? "#7da2d6" : q >= 95 ? "#00ff88" : q >= 85 ? "#f4ae1f" : "#ef4444";

  return (
    <div style={{ background: "#0d1b2f", borderRadius: "12px", padding: "20px", color: "white", border: "1px solid #16345d" }}>
      <h3 style={{ margin: "0 0 8px" }}>Quality</h3>

      {q === null ? (
        <div style={{ color: "#7da2d6", fontSize: "16px", margin: "20px 0" }}>No data yet</div>
      ) : (
        <>
          <h1 style={{ color, fontSize: "50px", margin: "8px 0" }}>{q.toFixed(1)}%</h1>
          <p style={{ color: "#7da2d6", margin: "4px 0" }}>Quality Score {data.shift ? `(Shift ${data.shift})` : ""}</p>
          <p style={{ color: q >= 100 ? "#22c55e" : "#f59e0b", fontSize: "16px", margin: "6px 0" }}>
            {q >= 100 ? "Target Met" : `${(100 - q).toFixed(1)}% below target`}
          </p>
          <p style={{ color: "#7da2d6", fontSize: "14px", margin: 0 }}>{data.machines} machine{data.machines !== 1 ? "s" : ""} reporting</p>
        </>
      )}
    </div>
  );
};

export default QualityCard;
