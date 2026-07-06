import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export default function MachineDetails() {
  const { machineId } = useParams();

  const [machine, setMachine] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadMachine();

    const interval = setInterval(() => {
      loadMachine();
    }, 5000);

    return () => clearInterval(interval);
  }, [machineId]);

  const loadMachine = async () => {
    try {
      const res = await fetch(
        `http://localhost:4000/api/machines/${machineId}/details`
      );
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setMachine(data);
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
  };

  if (error) {
    return (
      <div style={{ color: "white", padding: "30px", textAlign: "center" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠</div>
        <div style={{ fontSize: "20px", color: "#ef4444", marginBottom: "8px" }}>Failed to load machine</div>
        <div style={{ fontSize: "14px", color: "#7da2d6", marginBottom: "20px" }}>{error}</div>
        <button onClick={loadMachine} style={{ background: "#FFD700", color: "#111", border: "none", padding: "10px 24px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}>
          Retry
        </button>
      </div>
    );
  }

  if (!machine) {
    return (
      <div style={{ color: "white", padding: "30px", fontSize: "24px" }}>
        Loading Machine...
      </div>
    );
  }

  const noData = machine.live_status === "NO_DATA";

  const efficiency =
    noData || !machine.rpm_target
      ? "--"
      : Math.round(((machine.rpm || 0) / machine.rpm_target) * 100) + "%";

  return (
    <div style={{ padding: "30px", color: "#FFD700" }}>

<h1>MACHINE DETAILS</h1>

<div
  style={{
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
    gap: "15px",
    marginBottom: "25px"
  }}
>

  <div
  style={{
    background: "#111827",
    border: "1px solid #374151",
    borderRadius: "10px",
    padding: "20px",
    textAlign: "center"
  }}
>
    <h3>Status</h3>
    <h2 style={{ color:
      machine.live_status === "DOWNTIME" ? "#dc2626" :
      machine.live_status === "RUNNING"  ? "#22c55e" :
      machine.live_status === "STOPPED"  ? "#ef4444" :
      machine.live_status === "OFFLINE"  ? "#f59e0b" : "#6b7280"
    }}>
      {machine.live_status === "NO_DATA"
        ? "Waiting for Data"
        : machine.live_status === "OFFLINE"
        ? "Collector Offline"
        : machine.live_status || "--"}
    </h2>
    {machine.live_status === "DOWNTIME" && (
      <div style={{ marginTop: "8px", fontSize: "13px" }}>
        <div style={{ color: "#fca5a5" }}>{machine.downtime_reason || "Reason Pending"}</div>
        {machine.downtime_start_time && (
          <div style={{ color: "#9ca3af" }}>
            Since {new Date(machine.downtime_start_time).toLocaleTimeString()} · {machine.downtime_duration_minutes} min
          </div>
        )}
      </div>
    )}
  </div>

  <div
  style={{
    background: "#111827",
    border: "1px solid #374151",
    borderRadius: "10px",
    padding: "20px",
    textAlign: "center"
  }}
>
    <h3>Live RPM</h3>
    <h2>{noData ? "--" : (machine.rpm || 0)}</h2>
  </div>

  <div
  style={{
    background: "#111827",
    border: "1px solid #374151",
    borderRadius: "10px",
    padding: "20px",
    textAlign: "center"
  }}
>
    <h3>Target RPM</h3>
    <h2>{machine.rpm_target || "--"}</h2>
  </div>

  <div
  style={{
    background: "#111827",
    border: "1px solid #374151",
    borderRadius: "10px",
    padding: "20px",
    textAlign: "center"
  }}
>
    <h3>Efficiency</h3>
    <h2>{efficiency}</h2>
  </div>

</div>

<div style={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: "10px", padding: "20px", marginBottom: "16px", color: "white" }}>

<h2 style={{ color: "#f4ae1f", marginTop: 0 }}>Machine Information</h2>

<p>Machine ID: {machine.machine_id}</p>
<p>Name: {machine.machine_name}</p>
<p>Type: {machine.machine_type}</p>
<p>Diameter: {machine.diameter}"</p>
<p>Gauge: {machine.gauge}G</p>
<p>Fabric: {machine.fabric}</p>
<p>DC Status: {noData ? "No Data" : (machine.dc_status || "OFFLINE").toUpperCase()}</p>

</div>

<div style={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: "10px", padding: "20px", marginBottom: "16px", color: "white" }}>

<h2 style={{ color: "#f4ae1f", marginTop: 0 }}>Operator Information</h2>

<p>Operator: {noData ? "Not Assigned" : (machine.operator_name || "Not Assigned")}</p>

<p>Shift: {machine.shift || "-"}</p>

</div>

<div style={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: "10px", padding: "20px", marginBottom: "16px", color: "white" }}>

<h2 style={{ color: "#f4ae1f", marginTop: 0 }}>Current Roll</h2>

<p>Roll ID: {machine.roll_id || "-"}</p>

<p>
Roll Weight:
{" "}
{machine.roll_weight_kg || 0}
Kg
</p>

<p>
Production Counter:
{" "}
{machine.production_counter || 0}
</p>

</div>

</div>
      
  );
}