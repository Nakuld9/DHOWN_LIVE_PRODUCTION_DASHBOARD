import { Link } from "react-router-dom";
import React, { useEffect, useState } from "react";

const Production = () => {

  const [machines, setMachines] = useState([]);
  const [rolls, setRolls] = useState([]);

  useEffect(() => {
    loadData();

    const interval = setInterval(() => {
      loadData();
    }, 5000);

    return () => clearInterval(interval);

  }, []);

  const loadData = async () => {

    try {

      const machineRes = await fetch(
        "http://localhost:4000/api/machines"
      );

      const machineData =
        await machineRes.json();

      setMachines(machineData);

      const rollRes = await fetch(
        "http://localhost:4000/api/rolls"
      );

      const rollData =
        await rollRes.json();

      setRolls(rollData);

    } catch (err) {

      console.error(err);

    }

  };

  const runningMachines =
    machines.filter(
      (m) =>
        m.machine_status === "RUNNING"
    ).length;

  const stoppedMachines =
    machines.length - runningMachines;

  const todayProduction =
    rolls.reduce(
      (sum, roll) =>
        sum +
        Number(
          roll.actual_weight_kg || 0
        ),
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(5,1fr)",
          gap: "20px",
          marginBottom: "30px"
        }}
      >

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

        <table
    style={{
      width: "100%",
      borderCollapse: "collapse"
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

        const liveRPM =
          machine.live_rpm || 0;

        const targetRPM =
          machine.rpm_target || 26;

        const efficiency =
          targetRPM > 0
            ? (
                (liveRPM /
                  targetRPM) *
                100
              ).toFixed(0)
            : 0;

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
              {machine.operator_name ||
                "Not Assigned"}
            </td>

            <td style={td}>
              {currentRoll
                ?.roll_id || "-"}
            </td>

            <td style={td}>
              {machine.fabric}
            </td>

            <td style={td}>
              {targetRPM}
            </td>

            <td style={td}>
              {liveRPM}
            </td>

            <td
              style={{
                ...td,
                color:
                  efficiency >= 90
                    ? "#22c55e"
                    : efficiency >= 75
                    ? "#f59e0b"
                    : "#ef4444",
                fontWeight: "bold"
              }}
            >
              {efficiency}%
            </td>

            <td style={td}>
              <span
                style={{
                  color:
                    machine.machine_status ===
                    "RUNNING"
                      ? "#22c55e"
                      : "#ef4444"
                }}
              >
                {
                  machine.machine_status
                }
              </span>
            </td>
          </tr>
        );

      })}
    </tbody>
  </table>
  

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

        <table
          style={{
            width: "100%",
            borderCollapse:
              "collapse"
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