import React from "react";

const DoughnutChart = () => {
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
      <h3>Top Fabrics (Today)</h3>

      <div
        style={{
          fontSize: "60px",
          textAlign: "center",
          marginTop: "20px"
        }}
      >
        🍩
      </div>

      <p>Single Jersey - 42%</p>
      <p>Rib - 26%</p>
      <p>Interlock - 22%</p>
      <p>Others - 10%</p>
    </div>
  );
};

export default DoughnutChart;