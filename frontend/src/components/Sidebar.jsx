import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import logo from "../assets/images/dhown-logo.png";

const NAV_GROUPS = [
  {
    label: "SHOP FLOOR",
    icon: "🏭",
    links: [
      { to: "/",            label: "Dashboard",    icon: "📊" },
      { to: "/machines",         label: "Machines",        icon: "⚙️" },
      { to: "/work-center-stock", label: "Work Center Stock", icon: "📦" },
      { to: "/production",  label: "Production",   icon: "📈" },
      { to: "/operators",   label: "Operators",    icon: "👷" },
      { to: "/assignments", label: "Assignments",  icon: "📋" },
      { to: "/rfid-events", label: "RFID Events",  icon: "📡" },
      { to: "/rfid",        label: "RFID Scan",    icon: "🔖" },
      { to: "/downtime",    label: "Downtime",     icon: "⏸️" },
      { to: "/rolls",       label: "Rolls",        icon: "🧶" },
    ],
  },
  {
    label: "MANAGEMENT",
    icon: "📊",
    links: [
      { to: "/reports",              label: "Reports",        icon: "📄" },
      { to: "/inventory-reports",    label: "Inventory Reports", icon: "📈" },
      { to: "/stock-statement",     label: "Stock Statement",   icon: "📋" },
      { to: "/alerts",               label: "Alerts",         icon: "🔔" },
      { to: "/maintenance",          label: "Maintenance",    icon: "🔧" },
      { to: "/maintenance-schedule", label: "PM Schedule",    icon: "📅" },
      { to: "/shift-handover",       label: "Shift Handover", icon: "📝" },
    ],
  },
  {
    label: "TRANSACTIONS",
    icon: "🧾",
    links: [
      { to: "/grn",            label: "GRN",             icon: "📥" },
      { to: "/yarn-issue",     label: "Yarn Issue",      icon: "🚀" },
      { to: "/subcontracting", label: "Dye House",       icon: "🎨" },
      { to: "/finishing",      label: "Finishing & QA",  icon: "✔️" },
      { to: "/quality-inspection", label: "Quality Inspection", icon: "🔍" },
      { to: "/dispatch",       label: "Dispatch",        icon: "📤" },
    ],
  },
  {
    label: "INVENTORY",
    icon: "🏬",
    links: [
      { to: "/warehouse",        label: "Live Inventory",   icon: "📊" },
      { to: "/yarn-store",       label: "Yarn Store",       icon: "🧵" },
      { to: "/greige",           label: "Greige & Lots",    icon: "🧶" },
      { to: "/finished-goods",   label: "Finished Goods",   icon: "✅" },
      { to: "/vendor-stock",     label: "Vendor Stock",     icon: "🚚" },
      { to: "/traceability",     label: "Traceability",     icon: "🔍" },
      { to: "/costing",          label: "Costing",          icon: "₹" },
      { to: "/gst-report",       label: "GST Report",       icon: "📊" },
      { to: "/opening-balances", label: "Opening Balances", icon: "📦" },
    ],
  },
  {
    label: "MASTER DATA",
    icon: "🗂️",
    links: [
      { to: "/items",    label: "Item Master",    icon: "📦" },
      { to: "/partners", label: "Partners",       icon: "🤝" },
    ],
  },
  {
    label: "ADMIN",
    icon: "⚙️",
    links: [
      { to: "/settings",      label: "Settings",        icon: "⚙️" },
      { to: "/users",         label: "User Management", icon: "👤" },
      { to: "/admin/masters", label: "Masters Config",  icon: "🗃️" },
    ],
  },
];

// Routes where startsWith should NOT match parent paths
const EXACT_ONLY = ["/", "/rfid", "/maintenance", "/greige"];

export default function Sidebar() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Determine which group is active based on current path
  const activeGroup = NAV_GROUPS.findIndex(g =>
    g.links.some(l => isActive(l.to, location.pathname))
  );

  // Open state: active group open by default, others closed
  const [open, setOpen] = useState(() =>
    NAV_GROUPS.reduce((acc, _, i) => ({ ...acc, [i]: i === activeGroup || activeGroup === -1 && i === 0 }), {})
  );

  const toggle = (i) => setOpen(o => {
    const wasOpen = o[i];
    const next = NAV_GROUPS.reduce((acc, _, j) => ({ ...acc, [j]: false }), {});
    if (!wasOpen) next[i] = true;
    return next;
  });

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

  const nav = (closeMobile = false) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1, overflowY: "auto" }}>
      {NAV_GROUPS.map((group, gi) => {
        const groupActive = group.links.some(l => isActive(l.to, location.pathname));
        return (
          <div key={group.label}>
            {/* Group header */}
            <button
              onClick={() => toggle(gi)}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                background: groupActive ? "rgba(244,174,31,0.08)" : "transparent",
                border: "none", borderRadius: "6px",
                padding: "7px 10px", cursor: "pointer",
                color: groupActive ? "#f4ae1f" : "#7da2d6",
                fontSize: "11px", fontWeight: "bold", letterSpacing: "1.5px",
                marginBottom: "2px",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                <span style={{ fontSize: "13px" }}>{group.icon}</span>
                {group.label}
              </span>
              <span style={{ fontSize: "10px", opacity: 0.7 }}>{open[gi] ? "▾" : "▸"}</span>
            </button>

            {/* Group links */}
            {open[gi] && (
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginBottom: "6px", paddingLeft: "6px" }}>
                {group.links.map(({ to, label, icon }) => {
                  const active = isActive(to, location.pathname);
                  return (
                    <Link
                      key={to}
                      to={to}
                      onClick={() => { if (closeMobile) setMobileOpen(false); }}
                      style={{
                        color: active ? "#fff" : "#9ca3af",
                        textDecoration: "none",
                        padding: "7px 10px",
                        borderRadius: "5px",
                        background: active ? "#1e3a5f" : "transparent",
                        borderLeft: active ? "3px solid #f4ae1f" : "3px solid transparent",
                        fontWeight: active ? 500 : 400,
                        fontSize: "13px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#0d1b2a"; }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{ fontSize: "14px" }}>{icon}</span>
                      {label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* TV Dashboard external link */}
      <a
        href="/tv-dashboard"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: "#f4ae1f", textDecoration: "none", padding: "7px 10px",
          borderRadius: "5px", background: "transparent",
          border: "1px solid #f4ae131",
          fontSize: "12px", textAlign: "center", marginTop: "8px",
          display: "block", opacity: 0.7,
        }}
      >
        📺 TV Dashboard ↗
      </a>
    </div>
  );

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
            background: "transparent", border: "1px solid #f4ae1f",
            color: "#f4ae1f", padding: "6px 12px", borderRadius: "5px",
            fontSize: "20px", cursor: "pointer", lineHeight: 1,
          }}
        >
          {mobileOpen ? "✕" : "☰"}
        </button>
      </div>

      {/* ── MOBILE DRAWER ──────────────────────────────── */}
      {mobileOpen && (
        <div className="mobile-drawer" onClick={() => setMobileOpen(false)}>
          <div
            style={{
              background: "#081426", width: "260px", height: "100%",
              padding: "16px", display: "flex", flexDirection: "column", gap: "6px", overflowY: "auto",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ textAlign: "center", marginBottom: "12px", borderBottom: "1px solid #f4ae1f", paddingBottom: "12px" }}>
              <img src={logo} alt="DHOWN" style={{ width: "60px", height: "60px", objectFit: "contain" }} />
              <div style={{ color: "#f4ae1f", fontWeight: "bold", marginTop: "6px", fontSize: "13px" }}>DHOWN HOSIERY MILLS</div>
            </div>
            {nav(true)}
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
      <div className="desktop-sidebar" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: "16px", borderBottom: "1px solid #f4ae1f", paddingBottom: "14px", flexShrink: 0 }}>
          <img
            src={logo} alt="DHOWN Logo"
            style={{ width: "90px", height: "90px", objectFit: "contain", marginBottom: "8px", filter: "drop-shadow(0 0 8px #f4ae1f)" }}
          />
          <h2 style={{ color: "#f4ae1f", margin: 0, fontSize: "12px", letterSpacing: 1 }}>DHOWN HOSIERY MILLS</h2>
        </div>

        {nav(false)}

        <button
          onClick={handleLogout}
          style={{
            marginTop: "12px", padding: "9px", background: "transparent",
            border: "1px solid #ef4444", borderRadius: "5px",
            color: "#ef4444", cursor: "pointer", fontSize: "13px", fontWeight: 500,
            flexShrink: 0,
          }}
        >
          Logout
        </button>
      </div>
    </>
  );
}

function isActive(to, pathname) {
  if (pathname === to) return true;
  if (EXACT_ONLY.includes(to)) return false;
  return pathname.startsWith(to);
}
