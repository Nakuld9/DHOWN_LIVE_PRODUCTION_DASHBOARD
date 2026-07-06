import React from "react";
import { Link } from "react-router-dom";
import logo from "../assets/images/dhown-logo.png";

const Sidebar = () => {
  return (
    <div
      style={{
        width: "200px",
        background: "#081426",
        minHeight: "100vh",
        padding: "20px",
        color: "white",
      }}
    >
      <div
  style={{
    textAlign: "center",
    marginBottom: "20px",
    borderBottom: "1px solid #f4ae1f",
    paddingBottom: "15px",
  }}
>
  <img
    src={logo}
    alt="DHOWN Logo"
    style={{
      width: "180px",
      height: "180px",
      objectFit: "contain",
      marginBottom: "20px",
      filter: "drop-shadow(0 0 8px #f4ae1f)",
    }}
  />

  <h2
    style={{
      color: "#f4ae1f",
      margin: 0,
    }}
  >
    DHOWN HOSIERY MILLS
  </h2>
</div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

        <Link to="/" style={linkStyle}>Dashboard</Link>

        <Link to="/machines" style={linkStyle}>Machines</Link>

        <Link to="/production" style={linkStyle}>Production</Link>

        <Link to="/operators" style={linkStyle}>Operators</Link>

        <Link to="/assignments" style={linkStyle}>Assignments</Link>

        <Link to="/rfid-events" style={linkStyle}>RFID Events</Link>
      
        <Link to="/downtime" style={linkStyle}>Downtime</Link>

        <Link to="/rolls" style={linkStyle}>Rolls</Link>

        <Link to="/reports" style={linkStyle}>Reports</Link>

        <Link to="/alerts" style={linkStyle}>Alerts</Link>

        <Link to="/maintainence" style={linkStyle}>Maintenance</Link>

        <Link to="/settings" style={linkStyle}>Settings</Link>

        
      </div>
    </div>
  );
};

const linkStyle = {
  color: "white",
  textDecoration: "none",
  padding: "8px",
  borderRadius: "5px",
  background: "#0d1b2a",
};

export default Sidebar;