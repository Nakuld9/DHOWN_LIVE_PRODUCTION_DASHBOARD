import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import logo from "../assets/images/dhown-logo.png";
import { useTenant } from "../useTenant";

const NAV_GROUPS = [
  {
    label: "SHOP FLOOR",
    icon: "🏭",
    links: [
      { to: "/", label: "Dashboard", icon: "📊" },
      { to: "/operations", label: "Operations Dashboard", icon: "🏭" },
      { to: "/ask-ai", label: "Ask AI", icon: "🤖" },
      { to: "/ai-image", label: "AI Image", icon: "🖼️" },
      { to: "/ai-approvals", label: "AI Approvals", icon: "✅" },
      { to: "/machines", label: "Machines", icon: "⚙️" },
      { to: "/production", label: "Production", icon: "📈" },
      { to: "/shift-entry", label: "Shift Production Entry", icon: "✍️" },
      { to: "/production-planning", label: "Production Plan", icon: "🗓️" },
      { to: "/planning", label: "Yarn Requirement (MRP)", icon: "🧮" },
      { to: "/rolls", label: "Rolls", icon: "🧶" },
      { to: "/downtime", label: "Downtime", icon: "⏸️" },
      { to: "/operators", label: "Operators", icon: "👷" },
      { to: "/assignments", label: "Assignments", icon: "📋" },
      { to: "/rfid", label: "RFID Scan", icon: "🔖" },
      { to: "/rfid-events", label: "RFID Events", icon: "📡" },
    ],
  },
  {
    label: "INVENTORY & STORES",
    icon: "🏬",
    links: [
      { to: "/warehouse", label: "Live Inventory", icon: "📊" },
      { to: "/yarn-store", label: "Yarn Store", icon: "🧵" },
      { to: "/greige", label: "Greige & Lots", icon: "🧶" },
      { to: "/batching", label: "Batching", icon: "⚗️" },
      { to: "/finished-goods", label: "Finished Goods", icon: "✅" },
      { to: "/work-center-stock", label: "Work Center Stock", icon: "📦" },
      { to: "/allocation", label: "Lot Allocation", icon: "🎯" },
      { to: "/vendor-stock", label: "Vendor Stock", icon: "🚚" },
      { to: "/traceability", label: "Traceability", icon: "🔍" },
      { to: "/stock-statement", label: "Stock Statement", icon: "📋" },
      { to: "/stock-valuation", label: "Stock Valuation", icon: "🧮" },
      { to: "/opening-balances", label: "Opening Balances", icon: "📦" },
    ],
  },
  {
    label: "PROCUREMENT & PROCESSING",
    icon: "🧾",
    links: [
      { to: "/purchase-orders", label: "Purchase Orders", icon: "🧾" },
      { to: "/grn", label: "GRN", icon: "📥" },
      { to: "/invoice-ocr", label: "Invoice OCR", icon: "🧠" },
      { to: "/yarn-issue", label: "Yarn Issue", icon: "🚀" },
      { to: "/subcontracting", label: "Dye House", icon: "🎨" },
      { to: "/jobwork-reconciliation", label: "Job-work Reconciliation", icon: "⚖️" },
      { to: "/finishing", label: "Finishing & QA", icon: "✔️" },
      { to: "/quality-inspection", label: "Quality Inspection", icon: "🔍" },
      { to: "/fabric-inspection", label: "Fabric 4-Point QC", icon: "📐" },
      { to: "/fabric-quality", label: "Fabric Quality Dashboard", icon: "📊" },
      { to: "/defect-types", label: "Defect Types", icon: "🏷️" },
    ],
  },
  {
    label: "IMPORTS & LOGISTICS",
    icon: "🌐",
    links: [
      { to: "/import-intake", label: "AI Import Intake", icon: "🤖" },
      { to: "/import-control-tower", label: "Import Control Tower", icon: "🚢" },
      { to: "/import-vessels", label: "Vessels & Map", icon: "🗺️" },
      { to: "/import-payments", label: "Payments Desk", icon: "💱" },
      { to: "/import-reports", label: "Import Reports", icon: "📑" },
    ],
  },
  {
    label: "SALES & CRM",
    icon: "🤝",
    links: [
      { to: "/prospective-buyers", label: "Prospective Buyers", icon: "🎯" },
      { to: "/whatsapp-inbox", label: "WhatsApp CRM", icon: "💬" },
      { to: "/whatsapp-insights", label: "Sales Intelligence", icon: "📊" },
      { to: "/whatsapp-campaigns", label: "WhatsApp Campaigns", icon: "📣" },
      { to: "/optin-growth", label: "Opt-in Growth (QR)", icon: "📲" },
      { to: "/sales-orders", label: "Sales Orders", icon: "📝" },
      { to: "/shade-cards", label: "Shade Cards", icon: "🎨" },
      { to: "/shade-approvals", label: "Shade Approvals", icon: "✅" },
      { to: "/dispatch", label: "Dispatch", icon: "📤" },
      { to: "/pod", label: "Proof of Delivery", icon: "📦" },
      { to: "/returns", label: "Sales Returns", icon: "↩️" },
      { to: "/complaints", label: "Complaints", icon: "⚠️" },
    ],
  },
  {
    label: "FINANCE & ACCOUNTS",
    icon: "💰",
    links: [
      { to: "/accounting", label: "Accounting (Ledger)", icon: "📒" },
      { to: "/busy-reconcile", label: "Busy Reconciliation", icon: "🔗" },
      { to: "/cfo", label: "Executive CFO", icon: "📈" },
      { to: "/ai-accountant", label: "AI Accountant", icon: "🧮" },
      { to: "/tax-invoices", label: "Invoices (record)", icon: "🧾" },
      { to: "/receipts", label: "Receipts & Outstanding", icon: "💰" },
      { to: "/bank-reconciliation", label: "Bank Reconciliation", icon: "🏦" },
      { to: "/bank-payouts", label: "Supplier Payments", icon: "💸" },
      { to: "/debt-management", label: "Debt & Loans", icon: "🏛️" },
      { to: "/budgets", label: "Budgets & Scenarios", icon: "📊" },
      { to: "/cash-flow", label: "Cash-flow Forecast", icon: "💧" },
      { to: "/profitability", label: "Mfg Profitability", icon: "🏭" },
      { to: "/financial", label: "Financial", icon: "💰" },
      { to: "/credit-terms", label: "Credit Limits", icon: "💳" },
      { to: "/costing", label: "Costing", icon: "₹" },
      { to: "/gst-report", label: "GST Report", icon: "📊" },
      { to: "/gstr1", label: "GSTR-1 Summary", icon: "🧾" },
      { to: "/itc04", label: "ITC-04 (Job-work)", icon: "🧵" },
      { to: "/eway", label: "E-way Bills", icon: "🚚" },
      { to: "/compliance", label: "Compliance Board", icon: "📋" },
      { to: "/busy-production", label: "Production → Busy", icon: "🔗" },
    ],
  },
  {
    label: "MAINTENANCE",
    icon: "🔧",
    links: [
      { to: "/maintenance", label: "Maintenance", icon: "🔧" },
      { to: "/work-orders", label: "Work Orders", icon: "🛠" },
      { to: "/spare-parts", label: "Spare Parts", icon: "⚙️" },
      { to: "/maintenance-schedule", label: "PM Schedule", icon: "📅" },
    ],
  },
  {
    label: "REPORTS",
    icon: "📊",
    links: [
      { to: "/reports", label: "Reports", icon: "📄" },
      { to: "/partner-scorecard", label: "Partner Scorecard", icon: "📊" },
      { to: "/inventory-reports", label: "Inventory Reports", icon: "📈" },
      { to: "/ai-performance", label: "AI Performance", icon: "🤖" },
      { to: "/alerts", label: "Alerts", icon: "🔔" },
    ],
  },
  {
    label: "MASTER DATA",
    icon: "🗂️",
    links: [
      { to: "/items", label: "Item Master", icon: "📦" },
      { to: "/partners", label: "Partners", icon: "🤝" },
      { to: "/knitting-library", label: "Knitting Library", icon: "🧶" },
      { to: "/approval-matrix", label: "Approval Matrix", icon: "✅" },
    ],
  },
  {
    label: "ADMIN",
    icon: "⚙️",
    links: [
      { to: "/settings", label: "Settings", icon: "⚙️" },
      { to: "/users", label: "User Management", icon: "👤" },
      { to: "/admin/masters", label: "Masters Config", icon: "🗃️" },
      { to: "/shift-handover", label: "Shift Handover", icon: "📝" },
      { to: "/payroll", label: "Payroll", icon: "💰" },
      { to: "/system-monitor", label: "System Monitor", icon: "🩺" },
      { to: "/retention", label: "Data Retention", icon: "🧹" },
      { to: "/trash", label: "Trash", icon: "🗑️" },
    ],
  },
]

// Routes where startsWith should NOT match parent paths
const EXACT_ONLY = ["/", "/rfid", "/maintenance", "/greige", "/production"];

export default function Sidebar() {
  const tenant    = useTenant();
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
        await fetch("/api/auth/logout", {
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
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1, overflowY: "auto", padding: "10px 10px 14px" }}>
      {NAV_GROUPS.map((group, gi) => {
        const groupActive = group.links.some(l => isActive(l.to, location.pathname));
        return (
          <div key={group.label}>
            {/* Group header */}
            <button
              onClick={() => toggle(gi)}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                background: groupActive ? "rgba(231,194,78,0.10)" : "transparent",
                border: "none", borderRadius: "6px",
                padding: "9px 10px", cursor: "pointer",
                textAlign: "left",
                color: "var(--shell-gold)",
                fontFamily: "var(--mono)",
                fontSize: "11px", fontWeight: "800", letterSpacing: "1.8px", textTransform: "uppercase",
                marginBottom: "2px",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "8px", textAlign: "left" }}>
                <span style={{ fontSize: "12px", opacity: 0.85 }}>{group.icon}</span>
                {group.label}
              </span>
              <span style={{ fontSize: "9px", opacity: 0.7 }}>{open[gi] ? "▾" : "▸"}</span>
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
                        color: active ? "#fff7df" : "#cdd9cd",
                        textDecoration: "none",
                        padding: "8px 11px",
                        borderRadius: "6px",
                        background: active ? "rgba(231,194,78,0.14)" : "transparent",
                        borderLeft: active ? "3px solid var(--shell-gold)" : "3px solid transparent",
                        fontWeight: active ? 700 : 600,
                        fontSize: "14.3px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#fff7df"; } }}
                      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#cdd9cd"; } }}
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
          color: "var(--shell-gold)", textDecoration: "none", padding: "8px 10px",
          borderRadius: "6px", background: "transparent",
          border: "1px solid #3a5a44",
          fontSize: "12px", textAlign: "center", marginTop: "10px",
          display: "block", opacity: 0.85,
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
          <img src={logo} alt={tenant.name} style={{ width: "36px", height: "36px", objectFit: "contain" }} />
          <span style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: "15px" }}>{tenant.name} MES</span>
        </div>
        <button
          onClick={() => setMobileOpen(o => !o)}
          style={{
            background: "transparent", border: "1px solid #f4ae1f",
            color: "var(--yellow)", padding: "6px 12px", borderRadius: "5px",
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
              background: "var(--shell)", width: "266px", height: "100%",
              padding: "12px", display: "flex", flexDirection: "column", gap: "6px", overflowY: "auto",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ textAlign: "center", marginBottom: "12px", borderBottom: "1px solid #f4ae1f", paddingBottom: "12px" }}>
              <img src={logo} alt={tenant.name} style={{ width: "60px", height: "60px", objectFit: "contain" }} />
              <div style={{ color: "var(--yellow)", fontWeight: "bold", marginTop: "6px", fontSize: "13px" }}>DHOWN HOSIERY MILLS</div>
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
      <div className="desktop-sidebar" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "11px", padding: "16px 16px", borderBottom: "1px solid var(--shell-border)", flexShrink: 0 }}>
          <img src={logo} alt="DHOWN" style={{ width: "34px", height: "34px", objectFit: "contain", flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--shell-text)", fontWeight: 800, fontSize: "14px", letterSpacing: ".02em", textTransform: "uppercase", lineHeight: 1.1 }}>{tenant.name || "DHOWN"} MES</div>
            <div style={{ color: "var(--shell-muted)", fontSize: "9px", letterSpacing: ".22em", textTransform: "uppercase", marginTop: "2px" }}>Command Center</div>
          </div>
        </div>

        {nav(false)}

        <button
          onClick={handleLogout}
          style={{
            margin: "0 12px 14px", padding: "10px", background: "transparent",
            border: "1px solid var(--shell-border)", borderRadius: "6px",
            color: "var(--shell-muted)", cursor: "pointer", fontSize: "12px", fontWeight: 600,
            flexShrink: 0, letterSpacing: ".04em", textTransform: "uppercase",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#ff6b6b"; e.currentTarget.style.color = "#ff6b6b"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--shell-border)"; e.currentTarget.style.color = "var(--shell-muted)"; }}
        >
          ⏻ Logout
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
