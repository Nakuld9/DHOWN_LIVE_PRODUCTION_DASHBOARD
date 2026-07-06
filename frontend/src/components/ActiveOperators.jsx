import React, { useEffect, useState } from "react";

export default function ActiveOperators() {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAssignments();
    const interval = setInterval(loadAssignments, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadAssignments = async () => {
    try {
      const res = await fetch("http://localhost:4000/api/active-operators");
      const data = await res.json();
      setAssignments(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("ActiveOperators:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        background: "#071120",
        border: "1px solid #16345d",
        borderRadius: "10px",
        padding: "15px",
      }}
    >
      <h3 style={{ color: "#FFD700", marginBottom: "12px" }}>Active Operators</h3>

      {loading ? (
        <div style={{ color: "#7da2d6", fontSize: "16px" }}>Loading...</div>
      ) : assignments.length === 0 ? (
        <div style={{ color: "#7da2d6", fontSize: "16px", fontStyle: "italic" }}>
          No operators currently assigned
        </div>
      ) : (
        assignments.map(a => (
          <div
            key={a.assignment_id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "6px 0",
              borderBottom: "1px solid #16345d",
              fontSize: "17px",
            }}
          >
            <span>
              <span style={{ color: "#FFD700", marginRight: "8px" }}>👤</span>
              {a.operator_name || `Operator #${a.operator_id}`}
            </span>
            <span style={{ color: "#7da2d6" }}>{a.machine_id}</span>
          </div>
        ))
      )}
    </div>
  );
}
