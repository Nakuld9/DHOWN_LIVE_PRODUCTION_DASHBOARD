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
      const res = await fetch("/api/active-operators");
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
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "15px",
      }}
    >
      <h3 style={{ color: "var(--yellow)", marginBottom: "12px" }}>Active Operators</h3>

      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: "16px" }}>Loading...</div>
      ) : assignments.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: "16px", fontStyle: "italic" }}>
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
              borderBottom: "1px solid var(--border)",
              fontSize: "17px",
            }}
          >
            <span>
              <span style={{ color: "var(--yellow)", marginRight: "8px" }}>👤</span>
              {a.operator_name || `Operator #${a.operator_id}`}
            </span>
            <span style={{ color: "var(--muted)" }}>{a.machine_id}</span>
          </div>
        ))
      )}
    </div>
  );
}
