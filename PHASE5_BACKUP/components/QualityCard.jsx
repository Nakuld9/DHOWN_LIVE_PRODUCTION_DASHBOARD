import React from "react";

const QualityCard = () => {
  return (
    <div
      style={{
        background: "#0d1b2f",
        borderRadius: "12px",
        padding: "20px",
        color: "white",
        border: "1px solid #16345d"
      }}
    >
      <h3>Quality</h3>

      <h1 style={{ color: "#00ff88" }}>
        98.5%
      </h1>

      <p>Quality Score</p>

      <p>Defect Rate: 1.25%</p>
    </div>
  );
};

export default QualityCard;