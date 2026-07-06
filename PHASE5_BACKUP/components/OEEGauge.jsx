import React from "react";

const OEEGauge = () => {
  return (
    <div
      style={{
        background: "#0d1b2f",
        border: "1px solid #16345d",
        borderRadius: "12px",
        padding: "20px",
        color: "white",
        textAlign: "center",
      }}
    >
      <h3>OEE</h3>

      <h1
        style={{
          color: "#00ff88",
        }}
      >
        78.6%
      </h1>

      <p>Good</p>
    </div>
  );
};

export default OEEGauge;