import React from "react";

const DowntimeSummary = () => {
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
      <h3>Downtime Summary</h3>

      <p>Yarn Breakage - 35%</p>
      <p>Maintenance - 28%</p>
      <p>Material Change - 20%</p>
      <p>Power Cut - 12%</p>
      <p>Others - 5%</p>
    </div>
  );
};

export default DowntimeSummary;