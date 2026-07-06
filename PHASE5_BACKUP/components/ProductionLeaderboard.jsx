import React from "react";

export default function ProductionLeaderboard() {
  const machines = [
    { machine: "SJ01", kg: 32.5 },
    { machine: "TV11", kg: 28.2 },
    { machine: "IL09", kg: 24.8 },
    { machine: "SJ13", kg: 21.6 },
    { machine: "RB04", kg: 18.9 },
  ];

  return (
    <div
      style={{
        background: "#071120",
        border: "1px solid #16345d",
        borderRadius: "10px",
        padding: "15px",
        marginTop: "15px",
      }}
    >
      <h3
        style={{
          color: "#FFD700",
          marginBottom: "15px",
        }}
      >
        Top Machines Today
      </h3>

      {machines.map((m, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "8px 0",
          }}
        >
          <span>
            #{i + 1} {m.machine}
          </span>

          <span
            style={{
              color: "#00ff88",
              fontWeight: "bold",
            }}
          >
            {m.kg} KG
          </span>
        </div>
      ))}
    </div>
  );
}