import { useEffect, useState } from "react";

export default function Assignments() {
  const [assignments, setAssignments] = useState([]);
  const [operators, setOperators] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState("");

  const [showModal, setShowModal] = useState(false);

  const [operatorId, setOperatorId] = useState("");
  const [machineId, setMachineId] = useState("");

  const releaseAssignment = async (id) => {
    if (!window.confirm("Release this operator from machine?")) return;
    try {
      await fetch(`http://localhost:4000/api/assignments/${id}/release`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${localStorage.getItem("dhown_token") || ""}` },
      });
      loadAssignments();
    } catch (err) { console.error(err); }
  };

  const loadAssignments = async () => {
    try {
      const res = await fetch("http://localhost:4000/api/assignments");
      if (!res.ok) throw new Error("Server error " + res.status);
      const data = await res.json();
      setAssignments(data);
      setError(null);
    } catch (err) {
      setError("Unable to load assignments. Check backend is running.");
    } finally {
      setLoading(false);
    }
  };

  const loadMasterData = async () => {
    try {
      const opRes = await fetch(
        "http://localhost:4000/api/operators"
      );

      const machineRes = await fetch(
        "http://localhost:4000/api/machines"
      );

      const opData = await opRes.json();
      const machineData = await machineRes.json();

      setOperators(opData);
      setMachines(machineData);
    } catch (err) {
      console.error(err);
    }
  };

  const assignOperator = async () => {
    if (!operatorId || !machineId) {
      setFormError("Select both Operator and Machine");
      return;
    }
    setFormError("");

    try {
      await fetch(
        "http://localhost:4000/api/assignments",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization: `Bearer ${localStorage.getItem("dhown_token") || ""}`,
          },
          body: JSON.stringify({
            operator_id: operatorId,
            machine_id: machineId,
          }),
        }
      );

      setShowModal(false);

      setOperatorId("");
      setMachineId("");

      loadAssignments();
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadAssignments();
    loadMasterData();
  }, []);

  const activeCount = assignments.filter(
    (a) => a.status === "ACTIVE"
  ).length;

  const releasedCount = assignments.filter(
    (a) => a.status === "RELEASED"
  ).length;

  const cardStyle = {
    background: "#081830",
    border: "1px solid #23395d",
    borderRadius: "12px",
    padding: "25px",
    minHeight: "140px",
    color: "#ffffff",
  };

  return (
    <div
      style={{
        padding: "30px",
        color: "#ffffff",
      }}
    >
      <h1
        style={{
          color: "#FFD700",
          fontSize: "58px",
          marginBottom: "20px",
        }}
      >
        ASSIGNMENTS
      </h1>

      {error && (
        <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid #ef4444", padding: "10px 16px", borderRadius: "8px", marginBottom: "16px", color: "#ef4444" }}>
          {error}
        </div>
      )}

      <button
        onClick={() =>
          setShowModal(true)
        }
        style={{
          background: "#00aa44",
          color: "#ffffff",
          border: "none",
          padding: "12px 20px",
          borderRadius: "8px",
          fontWeight: "bold",
          cursor: "pointer",
          marginBottom: "25px",
        }}
      >
        + ASSIGN OPERATOR
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(3,1fr)",
          gap: "20px",
          marginBottom: "30px",
        }}
      >
        <div style={cardStyle}>
          <h3
            style={{
              color: "#FFD700",
            }}
          >
            Active Assignments
          </h3>

          <h1
            style={{
              color: "#00ff66",
              fontSize: "50px",
            }}
          >
            {activeCount}
          </h1>
        </div>

        <div style={cardStyle}>
          <h3
            style={{
              color: "#FFD700",
            }}
          >
            Released
          </h3>

          <h1
            style={{
              color: "#FFA500",
              fontSize: "50px",
            }}
          >
            {releasedCount}
          </h1>
        </div>

        <div style={cardStyle}>
          <h3
            style={{
              color: "#FFD700",
            }}
          >
            Total
          </h3>

          <h1
            style={{
              color: "#ffffff",
              fontSize: "50px",
            }}
          >
            {assignments.length}
          </h1>
        </div>
      </div>

      <div
        style={{
          background: "#081830",
          border:
            "1px solid #23395d",
          borderRadius: "12px",
          padding: "20px",
        }}
      >
        <table
          width="100%"
          cellPadding="12"
          style={{
            borderCollapse:
              "collapse",
          }}
        >
          <thead>
            <tr
              style={{
                color: "#FFD700",
                fontSize: "22px",
                borderBottom:
                  "2px solid #23395d",
              }}
            >
              <th align="left">
                Operator
              </th>

              <th align="left">
                Machine
              </th>

              <th align="left">
                Assigned At
              </th>

              <th align="left">
                Released At
              </th>

              <th align="left">
                Status
              </th>
              <th align="left">
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr><td colSpan="6" style={{ padding: "24px", color: "#7da2d6", textAlign: "center" }}>Loading assignments...</td></tr>
            )}
            {!loading && !error && assignments.length === 0 && (
              <tr><td colSpan="6" style={{ padding: "24px", color: "#7da2d6", fontStyle: "italic", textAlign: "center" }}>No assignments found. Assign an operator to get started.</td></tr>
            )}
            {assignments.map(
              (row) => (
                <tr
                  key={
                    row.assignment_id
                  }
                  style={{
                    borderBottom:
                      "1px solid #23395d",
                    height: "55px",
                    color:
                      "#ffffff",
                  }}
                >
                  <td>
                    {
                      row.operator_name
                    }
                  </td>

                  <td>
                    {row.machine_id}
                  </td>

                  <td>
                    {row.assigned_at
                      ? new Date(
                          row.assigned_at
                        ).toLocaleString()
                      : "-"}
                  </td>

                  <td>
                    {row.released_at
                      ? new Date(
                          row.released_at
                        ).toLocaleString()
                      : "-"}
                  </td>

                  <td>
                    <span
                      style={{
                        background:
                          row.status ===
                          "ACTIVE"
                            ? "#006400"
                            : "#8B4513",

                        padding:
                          "6px 14px",

                        borderRadius:
                          "8px",

                        fontWeight:
                          "bold",

                        color:
                          "#ffffff",
                      }}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td>
                    {row.status === "ACTIVE" && (
                      <button onClick={() => releaseAssignment(row.assignment_id)}
                        style={{ background: "#dc2626", color: "#fff", border: "none", padding: "6px 14px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer", fontSize: "13px" }}>
                        Release
                      </button>
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background:
              "rgba(0,0,0,0.75)",
            display: "flex",
            justifyContent:
              "center",
            alignItems:
              "center",
          }}
        >
          <div
            style={{
              background:
                "#081830",
              padding: "30px",
              borderRadius:
                "12px",
              width: "400px",
              border:
                "1px solid #23395d",
            }}
          >
            <h2
              style={{
                color:
                  "#FFD700",
              }}
            >
              Assign Operator
            </h2>

            {formError && (
              <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid #ef4444", padding: "8px 12px", borderRadius: "6px", marginBottom: "12px", color: "#ef4444", fontSize: "14px" }}>
                {formError}
              </div>
            )}

            <select
              value={operatorId}
              onChange={(e) =>
                setOperatorId(
                  e.target.value
                )
              }
              style={{
                width: "100%",
                padding:
                  "12px",
                marginTop:
                  "15px",
                marginBottom:
                  "15px",
              }}
            >
              <option value="">
                Select Operator
              </option>

              {operators.map(
                (op) => (
                  <option
                    key={
                      op.operator_id
                    }
                    value={
                      op.operator_id
                    }
                  >
                    {
                      op.operator_name
                    }
                  </option>
                )
              )}
            </select>

            <select
              value={machineId}
              onChange={(e) =>
                setMachineId(
                  e.target.value
                )
              }
              style={{
                width: "100%",
                padding:
                  "12px",
                marginBottom:
                  "20px",
              }}
            >
              <option value="">
                Select Machine
              </option>

              {machines.map(
                (machine) => (
                  <option
                    key={
                      machine.machine_id
                    }
                    value={
                      machine.machine_id
                    }
                  >
                    {
                      machine.machine_id
                    }
                  </option>
                )
              )}
            </select>

            <button
              onClick={
                assignOperator
              }
              style={{
                background:
                  "#00aa44",
                color:
                  "#ffffff",
                border:
                  "none",
                padding:
                  "10px 20px",
                borderRadius:
                  "8px",
                cursor:
                  "pointer",
                marginRight:
                  "10px",
              }}
            >
              Assign
            </button>

            <button
              onClick={() =>
                setShowModal(
                  false
                )
              }
              style={{
                padding:
                  "10px 20px",
                borderRadius:
                  "8px",
                cursor:
                  "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
