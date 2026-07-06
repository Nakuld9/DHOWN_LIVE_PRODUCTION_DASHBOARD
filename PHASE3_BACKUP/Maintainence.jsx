import React from "react";

const Maintenance = () => {
  return (
    <div
      style={{
        padding: "20px",
        background: "#050d1a",
        minHeight: "100vh",
        color: "white",
      }}
    >
      <h1 style={{ color: "#f4ae1f" }}>
        MAINTENANCE
      </h1>

      <table
        style={{
          width: "100%",
          marginTop: "20px",
        }}
      >
        <thead>
          <tr>
            <th>Machine</th>
            <th>Last Service</th>
            <th>Next Service</th>
          </tr>
        </thead>

        <tbody>
          <tr>
            <td>WC-KNIT-01</td>
            <td>01-05-2026</td>
            <td>01-08-2026</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default Maintenance;