import { Link } from "react-router-dom";
import React, { useEffect, useState } from "react";

const Production = () => {

  const [machines, setMachines] = useState([]);
  const [rolls, setRolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [machineRes, rollsRes] = await Promise.all([
        fetch("http://localhost:4000/api/machines"),
        fetch("http://localhost:4000/api/rolls"),
      ]);
      if (!machineRes.ok) throw new Error("Failed to load machine data");
      if (!rollsRes.ok) throw new Error("Failed to load rolls data");
      const [machineData, rollsData] = await Promise.all([
        machineRes.json(),
        rollsRes.json(),
      ]);
      setMachines(machineData);
      setRolls(rollsData);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Failed to load production data. Retrying...");
    } finally {
      setLoading(false);
    }
  };

  const runningMachines = machines.filter((m) => m.live_status === "RUNNING").length;
  const stoppedMachines = machines.length - runningMachines;

  const todayProduction = machines.reduce(
    (sum, m) => sum + Number(m.today_production_kg || 0),
    0
  );

  return (
    <div
      style={{
        padding: "20px",
        minHeight: "100vh",
        background: "#050d1a",
        color: "white"
      }}
    >

      <h1
        style={{
          color: "#f4ae1f",
          marginBottom: "25px"
        }}
      >
        PRODUCTION
      </h1>

      <div className="kpi-grid" style={{ marginBottom: "30px" }}>

        <Card
          title="Running Machines"
          value={runningMachines}
        />

        <Card
          title="Stopped Machines"
          value={stoppedMachines}
        />

        <Card
          title="Open Rolls"
          value={
            rolls.filter(
              (r) =>
                r.status === "OPEN"
            ).length
          }
        />

        <Card
          title="Today's Production"
          value={
            todayProduction.toFixed(2) +
            " Kg"
          }
        />
        <Card
  title="Utilization"
  value={
    machines.length > 0
      ? (
          (runningMachines /
            machines.length) *
          100
        ).toFixed(0) + "%"
      : "0%"
  }
/>

      </div>

      <div
        style={{
          background: "#081426",
          borderRadius: "10px",
          padding: "15px"
        }}
      >

        <h3
          style={{
            color: "#f4ae1f"
          }}
        >
          Machine Production
        </h3>

        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table
    style={{
      width: "100%",
      borderCollapse: "collapse",
      minWidth: "600px"
    }}
  >
    <thead>
      <tr>
        <th style={th}>Machine</th>
        <th style={th}>Operator</th>
        <th style={th}>Current Roll</th>
        <th style={th}>Fabric</th>
        <th style={th}>Target RPM</th>
        <th style={th}>Live RPM</th>
        <th style={th}>Efficiency</th>
        <th style={th}>Status</th>
      </tr>
    </thead>

    <tbody>
      {machines.map((machine) => {

        const noData = machine.live_status === "NO_DATA";

        const liveRPM =
          noData ? null : (machine.rpm || 0);

        const targetRPM =
          machine.rpm_target || 0;

        const efficiency =
          noData || targetRPM === 0
            ? "--"
            : (
                (liveRPM /
                  targetRPM) *
                100
              ).toFixed(0) + "%";

        const currentRoll =
          rolls.find(
            (r) =>
              r.machine_id ===
                machine.machine_id &&
              r.status === "OPEN"
          );

        return (
          <tr
            key={
              machine.machine_id
            }
          >
            <td style={td}>
  <Link
    to={`/machine/${machine.machine_id}`}
    style={{
      color: "#f4ae1f",
      textDecoration: "none",
      fontWeight: "bold"
    }}
  >
    {machine.machine_id}
  </Link>
</td>

            <td style={td}>
              {noData
                ? "Not Assigned"
                : machine.operator_name || "Not Assigned"}
            </td>

            <td style={td}>
              {currentRoll
                ?.roll_id || "-"}
            </td>

            <td style={td}>
              {machine.fabric}
            </td>

            <td style={td}>
              {targetRPM || "--"}
            </td>

            <td style={td}>
              {noData ? "--" : liveRPM}
            </td>

            <td
              style={{
                ...td,
                color:
                  efficiency === "--"
                    ? "#7da2d6"
                    : parseInt(efficiency) >= 90
                    ? "#22c55e"
                    : parseInt(efficiency) >= 75
                    ? "#f59e0b"
                    : "#ef4444",
                fontWeight: "bold"
              }}
            >
              {efficiency}
            </td>

            <td style={td}>
              <span
                style={{
                  color:
                    machine.live_status === "RUNNING"
                      ? "#22c55e"
                      : machine.live_status === "NO_DATA"
                      ? "#6b7280"
                      : machine.live_status === "OFFLINE"
                      ? "#f59e0b"
                      : "#ef4444"
                }}
              >
                {machine.live_status === "NO_DATA"
                  ? "Collector Offline"
                  : machine.live_status === "OFFLINE"
                  ? "Collector Offline"
                  : machine.live_status || "--"}
              </span>
            </td>
          </tr>
        );

      })}
    </tbody>
  </table>
  </div>

      </div>

      <br />

      <div
        style={{
          background: "#081426",
          borderRadius: "10px",
          padding: "15px"
        }}
      >

        <h3
          style={{
            color: "#f4ae1f"
          }}
        >
          Roll Production
        </h3>

        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            minWidth: "500px"
          }}
        >

          <thead>

            <tr>

              <th style={th}>
                Roll ID
              </th>

              <th style={th}>
                Machine
              </th>

              <th style={th}>
                Fabric
              </th>

              <th style={th}>
                Shift
              </th>

              <th style={th}>
                Weight
              </th>

              <th style={th}>
                Status
              </th>

            </tr>

          </thead>

          <tbody>

            {rolls.map(
              (roll) => (

                <tr
                  key={
                    roll.roll_id
                  }
                >

                  <td style={td}>
                    {
                      roll.roll_id
                    }
                  </td>

                  <td style={td}>
                    {
                      roll.machine_id
                    }
                  </td>

                  <td style={td}>
                    {
                      roll.fabric_type
                    }
                  </td>

                  <td style={td}>
                    {
                      roll.shift
                    }
                  </td>

                  <td style={td}>
                    {
                      roll.actual_weight_kg ||
                      roll.roll_weight_kg ||
                      0
                    }
                  </td>

                  <td style={td}>
                    {
                      roll.status
                    }
                  </td>

                </tr>

              )
            )}

          </tbody>

        </table>
        </div>

      </div>

    </div>
  );
};

const Card = ({
  title,
  value
}) => (
  <div
    style={{
      background: "#081426",
      padding: "20px",
      borderRadius: "10px",
      border:
        "1px solid #16345d"
    }}
  >
    <h3
      style={{
        color: "#f4ae1f"
      }}
    >
      {title}
    </h3>

    <h2>{value}</h2>

  </div>
);

const th = {
  padding: "12px",
  textAlign: "left",
  borderBottom:
    "1px solid #16345d"
};

const td = {
  padding: "12px",
  borderBottom:
    "1px solid #16345d"
};

export default Production;