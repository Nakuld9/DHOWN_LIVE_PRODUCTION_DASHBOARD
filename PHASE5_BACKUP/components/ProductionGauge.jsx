import React from "react";

const ProductionGauge = () => {
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
      <h3>PRODUCTION vs TARGET</h3>

      <div
        style={{
          textAlign: "center",
          fontSize: "36px",
          color: "#22c55e",
          marginTop: "20px"
        }}
      >
        69.6%
      </div>

      <p style={{ textAlign: "center" }}>
        Production Achievement
      </p>
    </div>
  );
};

export default ProductionGauge;