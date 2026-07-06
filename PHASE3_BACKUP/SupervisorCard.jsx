import React from "react";

const SupervisorCard = () => {
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
      <h3>Supervisor</h3>

      <div
        style={{
          textAlign: "center",
          marginTop: "15px"
        }}
      >
        <div
          style={{
            width: "80px",
            height: "80px",
            borderRadius: "50%",
            background: "#16345d",
            margin: "auto"
          }}
        />

        <h4>Admin</h4>
        <p>Production Supervisor</p>
      </div>
    </div>
  );
};

export default SupervisorCard;