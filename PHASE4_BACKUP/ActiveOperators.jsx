import React from "react";

export default function ActiveOperators() {
  return (
    <div
      style={{
        background: "#071120",
        border: "1px solid #16345d",
        borderRadius: "10px",
        padding: "15px",
      }}
    >
      <h3 style={{ color: "#FFD700" }}>
        Active Operators
      </h3>

      <div style={{ marginTop: "10px" }}>
        👤 Birjan Yadav → IL09
      </div>

      <div>
        👤 Pappu Yadav → TV11
      </div>

      <div>
        👤 Roshan Gupta → SJ13
      </div>
    </div>
  );
}