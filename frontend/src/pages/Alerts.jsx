import { useEffect, useState } from "react";

export default function Alerts() {

  const [alerts, setAlerts] =
    useState(null);

  const loadAlerts = async () => {

    try {

      const res = await fetch(
        "/api/alerts"
      );

      const data =
        await res.json();

      setAlerts(data);

    } catch (err) {

      console.error(err);

    }

  };

  useEffect(() => {

    loadAlerts();

    const interval =
      setInterval(
        loadAlerts,
        10000
      );

    return () =>
      clearInterval(interval);

  }, []);

  if (!alerts)
    return <div style={{ color: 'var(--gold)', padding: '30px', fontSize: '18px', background: 'var(--bg)', minHeight: '100vh' }}>Loading Alerts...</div>;

  const stoppedCount =
    alerts.stoppedMachines.length;

  const downtimeCount =
    alerts.openDowntime.length;

  const lowStock = alerts.lowStockParts || [];

  return (
    <div
      style={{
        padding: "30px",
        color: "var(--text)"
      }}
    >
      <h1
        style={{
          color: "var(--yellow)",
          fontSize: "58px"
        }}
      >
        ALERTS
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(3,1fr)",
          gap: "20px",
          marginBottom: "30px"
        }}
      >
        <div
          style={{
            background:"var(--crit-dim)",
            border:"1px solid red",
            borderRadius:"12px",
            padding:"20px"
          }}
        >
          <h3>
            Stopped Machines
          </h3>

          <h1>
            {stoppedCount}
          </h1>
        </div>

        <div
          style={{
            background:"var(--crit-dim)",
            border:"1px solid orange",
            borderRadius:"12px",
            padding:"20px"
          }}
        >
          <h3>
            Open Downtime
          </h3>

          <h1>
            {downtimeCount}
          </h1>
        </div>

        <div
          style={{
            background: lowStock.length ? "var(--crit-dim)" : "var(--surface)",
            border: `1px solid ${lowStock.length ? "var(--gold)" : "var(--surface)"}`,
            borderRadius:"12px",
            padding:"20px"
          }}
        >
          <h3>
            ⚙️ Low Spare Parts
          </h3>

          <h1 style={{ color: lowStock.length ? "var(--gold)" : "var(--green)" }}>
            {lowStock.length}
          </h1>
        </div>
      </div>

      {lowStock.length > 0 && (
        <div
          style={{
            background:"var(--crit-dim)",
            border:"1px solid var(--gold)",
            borderRadius:"12px",
            padding:"20px",
            marginBottom:"20px"
          }}
        >
          <h2 style={{ color:"var(--gold)", marginTop: 0 }}>
            ⚙️ Spare Parts Below Minimum Stock
          </h2>
          {lowStock.map(p => (
            <div key={p.id} style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:8, padding:"9px 4px", borderBottom:"1px solid var(--crit-dim)", fontSize:14 }}>
              <span><b>{p.part_name}</b>{p.sku ? <span style={{ color:"var(--muted)" }}> · {p.sku}</span> : null}{p.location ? <span style={{ color:"var(--muted)" }}> · {p.location}</span> : null}</span>
              <span style={{ color:"var(--crit)", fontWeight:700 }}>
                {parseFloat(p.current_stock)} / min {parseFloat(p.min_stock)} {p.unit}
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          background:"var(--surface)",
          border:"1px solid var(--border)",
          borderRadius:"12px",
          padding:"20px"
        }}
      >
        <h2
          style={{
            color:"var(--yellow)"
          }}
        >
          Stopped Machines
        </h2>

        {alerts.stoppedMachines.map(
          (m) => (

          <div
            key={m.machine_id}
            style={{
              padding:"10px",
              borderBottom:
              "1px solid var(--border)"
            }}
          >
            🔴 {m.machine_id}
          </div>

        ))}
      </div>
    </div>
  );
}