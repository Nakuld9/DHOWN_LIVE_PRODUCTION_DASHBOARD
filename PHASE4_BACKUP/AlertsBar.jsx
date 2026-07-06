import React from "react";

const AlertsBar = () => {
  const alerts = [
    "M-04 Yarn Breakage - 10:25 AM",
    "M-06 Maintenance Due - 10:20 AM",
    "M-10 Power Cut - 10:15 AM",
    "M-08 Material Change - 09:50 AM",
  ];

  return (
    <div
      style={{
        background: "#0d1b2f",
        border: "1px solid #1f3b66",
        borderRadius: "12px",
        padding: "12px 20px",
        color: "white",
        marginTop: "20px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "20px",
          overflowX: "auto",
        }}
      >
        <h3
          style={{
            color: "#ff4d4f",
            margin: 0,
            minWidth: "140px",
          }}
        >
          Latest Alerts
        </h3>

        {alerts.map((alert, index) => (
          <div
            key={index}
            style={{
              padding: "6px 12px",
              background: "#162846",
              borderRadius: "8px",
              whiteSpace: "nowrap",
            }}
          >
            🔴 {alert}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AlertsBar;