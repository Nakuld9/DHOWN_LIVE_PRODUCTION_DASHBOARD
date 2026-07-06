import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import logo from "../assets/images/dhown-logo.png";

const NAV_LINKS = [
  { to: "/",             label: "Dashboard",      icon: "📊" },
  { to: "/machines",     label: "Machines",        icon: "⚙️" },
  { to: "/production",   label: "Production",      icon: "🏭" },
  { to: "/operators",    label: "Operators",       icon: "👷" },
  { to: "/assignments",  label: "Assignments",     icon: "📋" },
  { to: "/rfid-events",  label: "RFID Events",     icon: "📡" },
  { to: "/rfid",         label: "RFID Scan",       icon: "🔖" },
  { to: "/downtime",     label: "Downtime",        icon: "⏸️" },
  { to: "/rolls",        label: "Rolls",           icon: "🧶" },
  { to: "/reports",      label: "Reports",         icon: "📄" },
  { to: "/alerts",       label: "Alerts",          icon: "🔔" },
  { to: "/maintenance",           label: "Maintenance",    icon: "🔧" },
  { to: "/maintenance-schedule", label: "PM Schedule",    icon: "📅" },
  { to: "/shift-handover",       label: "Shift Handover", icon: "📝" },
  { to: "/settings",             label: "Settings",       icon: "⚙️" },
  { to: "/users",        label: "User Management", icon: "👤" },
];

const Sidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    try {
      const token = localStorage.getItem("dhown_token");
      if (token) {
        await fetch("http://localhost:4000/api/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch (_) {}
    localStorage.removeItem("dhown_token");
    localStorage.removeItem("dhown_user");
    navigate("/login");
  };

  const isActive = (to) =>
    location.pathname === to ||
    (to !== "/" && to !== "/rfid" && to !== "/maintenance" && location.pathname.startsWith(to));

  const linkStyle = (to, color) => ({
    color: color || "white",
    textDecoration: "none",
    padding: "8px 10px",
    borderRadius: "5px",
    background: isActive(to) ? "#1e3a5f" : "#0d1b2a",
    borderLeft: isActive(to) ? "3px solid #f4ae1f" : "3px solid transparent",
    fontWeight: isActive(to) ? 500 : 400,
    fontSize: "13px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  });

  return (
    <>
      {/* ── MOBILE TOP BAR ─────────────────────────────── */}
      <div className="mobile-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <img src={logo} alt="DHOWN" style={{ width: "36px", height: "36px", objectFit: "contain" }} />
          <span style={{ color: "#f4ae1f", fontWeight: "bold", fontSize: "15px" }}>DHOWN MES</span>
        </div>
        <button
          onClick={() => setMobileOpen(o => !o)}
          style={{
            background: "transparent",
            border: "1px solid #f4ae1f",
            color: "#f4ae1f",
            padding: "6px 12px",
            borderRadius: "5px",
            fontSize: "20px",
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          {mobileOpen ? "✕" : "☰"}
        </button>
      </div>

      {/* ── MOBILE DRAWER ──────────────────────────────── */}
      {mobileOpen && (
        <div
          className="mobile-drawer"
          onClick={() => setMobileOpen(false)}
        >
          <div
            style={{
              background: "#081426",
              width: "260px",
              height: "100%",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              overflowY: "auto",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ textAlign: "center", marginBottom: "12px", borderBottom: "1px solid #f4ae1f", paddingBottom: "12px" }}>
              <img src={logo} alt="DHOWN" style={{ width: "60px", height: "60px", objectFit: "contain" }} />
              <div style={{ color: "#f4ae1f", fontWeight: "bold", marginTop: "6px", fontSize: "13px" }}>DHOWN HOSIERY MILLS</div>
            </div>
            {NAV_LINKS.map(({ to, label, icon, color }) => (
              <Link
                key={to}
                to={to}
                style={linkStyle(to, color)}
                onClick={() => setMobileOpen(false)}
              >
                <span>{icon}</span> {label}
              </Link>
            ))}
            <a
              href="/tv-dashboard"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "#f4ae1f", textDecoration: "none", padding: "8px 10px",
                borderRadius: "5px", background: "#0d1b2a",
                border: "1px solid #f4ae1f", fontSize: "13px", textAlign: "center", marginTop: "4px",
              }}
            >
              TV Dashboard ↗
            </a>
            <button
              onClick={handleLogout}
              style={{
                marginTop: "8px", padding: "9px", background: "transparent",
                border: "1px solid #ef4444", borderRadius: "5px",
                color: "#ef4444", cursor: "pointer", fontSize: "13px", fontWeight: 500,
              }}
            >
              Logout
            </button>
          </div>
        </div>
      )}

      {/* ── DESKTOP SIDEBAR ────────────────────────────── */}
      <div className="desktop-sidebar">
        <div style={{ textAlign: "center", marginBottom: "20px", borderBottom: "1px solid #f4ae1f", paddingBottom: "15px" }}>
          <img
            src={logo}
            alt="DHOWN Logo"
            style={{ width: "120px", height: "120px", objectFit: "contain", marginBottom: "10px", filter: "drop-shadow(0 0 8px #f4ae1f)" }}
          />
          <h2 style={{ color: "#f4ae1f", margin: 0, fontSize: "13px" }}>DHOWN HOSIERY MILLS</h2>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
          {NAV_LINKS.map(({ to, label, icon, color }) => (
            <Link key={to} to={to} style={linkStyle(to, color)}>
              <span>{icon}</span> {label}
            </Link>
          ))}
          <a
            href="/tv-dashboard"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#f4ae1f", textDecoration: "none", padding: "8px 10px",
              borderRadius: "5px", background: "#0d1b2a",
              border: "1px solid #f4ae1f", fontSize: "13px", textAlign: "center",
            }}
          >
            TV Dashboard ↗
          </a>
        </div>

        <button
          onClick={handleLogout}
          style={{
            marginTop: "16px", padding: "9px", background: "transparent",
            border: "1px solid #ef4444", borderRadius: "5px",
            color: "#ef4444", cursor: "pointer", fontSize: "13px", fontWeight: 500,
          }}
        >
          Logout
        </button>
      </div>
    </>
  );
};

export default Sidebar;
