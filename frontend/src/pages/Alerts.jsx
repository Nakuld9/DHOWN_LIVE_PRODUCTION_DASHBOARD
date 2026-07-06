import { useEffect, useState } from "react";

export default function Alerts() {

  const [alerts, setAlerts] =
    useState(null);

  const loadAlerts = async () => {

    try {

      const res = await fetch(
        "http://localhost:4000/api/alerts"
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
    return <div style={{ color: '#FFD700', padding: '30px', fontSize: '18px', background: '#050d1a', minHeight: '100vh' }}>Loading Alerts...</div>;

  const stoppedCount =
    alerts.stoppedMachines.length;

  const downtimeCount =
    alerts.openDowntime.length;

  return (
    <div
      style={{
        padding: "30px",
        color: "#fff"
      }}
    >
      <h1
        style={{
          color: "#FFD700",
          fontSize: "58px"
        }}
      >
        ALERTS
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(2,1fr)",
          gap: "20px",
          marginBottom: "30px"
        }}
      >
        <div
          style={{
            background:"#4d0000",
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
            background:"#4d2d00",
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
      </div>

      <div
        style={{
          background:"#081830",
          border:"1px solid #23395d",
          borderRadius:"12px",
          padding:"20px"
        }}
      >
        <h2
          style={{
            color:"#FFD700"
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
              "1px solid #23395d"
            }}
          >
            🔴 {m.machine_id}
          </div>

        ))}
      </div>
    </div>
  );
}