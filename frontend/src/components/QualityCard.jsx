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
      const r = await fetch("/api/oee");
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
  const color = q === null ? "var(--muted)" : q >= 95 ? "var(--green)" : q >= 85 ? "var(--yellow)" : "var(--crit)";

  return (
    <div style={{ background: "var(--surface)", borderRadius: "12px", padding: "20px", color: "white", border: "1px solid var(--border)" }}>
      <h3 style={{ margin: "0 0 8px" }}>Quality</h3>

      {q === null ? (
        <div style={{ color: "var(--muted)", fontSize: "16px", margin: "20px 0" }}>No data yet</div>
      ) : (
        <>
          <h1 style={{ color, fontSize: "50px", margin: "8px 0" }}>{q.toFixed(1)}%</h1>
          <p style={{ color: "var(--muted)", margin: "4px 0" }}>Quality Score {data.shift ? `(Shift ${data.shift})` : ""}</p>
          <p style={{ color: q >= 100 ? "var(--green)" : "var(--gold)", fontSize: "16px", margin: "6px 0" }}>
            {q >= 100 ? "Target Met" : `${(100 - q).toFixed(1)}% below target`}
          </p>
          <p style={{ color: "var(--muted)", fontSize: "14px", margin: 0 }}>{data.machines} machine{data.machines !== 1 ? "s" : ""} reporting</p>
        </>
      )}
    </div>
  );
};

export default QualityCard;
