import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

/* ───────────────────────── colour tokens ───────────────────────── */
const C = {
  bg:        "var(--surface)",
  surface:   "var(--surface)",
  card:      "var(--surface)",
  cardHover: "var(--surface)",
  border:    "var(--surface)",
  borderL:   "var(--surface)",
  gold:      "var(--gold)",
  goldDim:   "var(--gold)",
  goldGlow:  "rgba(212,168,67,.18)",
  emerald:   "var(--green)",
  emeraldDim:"var(--green)",
  blue:      "var(--link)",
  blueDim:   "var(--link)",
  purple:    "var(--purple)",
  red:       "var(--crit)",
  redDim:    "var(--crit)",
  orange:    "var(--gold)",
  cyan:      "var(--link)",
  white:     "#f1f5f9",
  text:      "var(--text)",
  textDim:   "var(--muted)",
  textMuted: "var(--muted)",
  navy:      "var(--surface)",
  navyLight: "var(--surface)",
};

/* ───────────────────────── SVG icon primitives ────────────────── */
const Icon = ({ d, size = 20, color = C.gold, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d={d} />
  </svg>
);

const ICONS = {
  factory:     "M3 21V9l5 3V9l5 3V9l5 3v12H3z",
  production:  "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  truck:       "M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 18.5a2 2 0 100-4 2 2 0 000 4zM18.5 18.5a2 2 0 100-4 2 2 0 000 4z",
  cart:        "M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6",
  box:         "M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z",
  dollar:      "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  cpu:         "M4 4h16v16H4zM9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3",
  gauge:       "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2",
  chart:       "M18 20V10M12 20V4M6 20v-6",
  trending:    "M23 6l-9.5 9.5-5-5L1 18",
  users:       "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  settings:    "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
  bell:        "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0",
  search:      "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35",
  user:        "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
  check:       "M20 6L9 17l-5-5",
  alert:       "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01",
  clock:       "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2",
  zap:         "M13 2L3 14h9l-1 10 10-12h-9l1-10",
  file:        "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  shield:      "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  database:    "M12 2C6.48 2 2 4.02 2 6.5v11C2 19.98 6.48 22 12 22s10-2.02 10-4.5v-11C22 4.02 17.52 2 12 2zM2 6.5C2 8.98 6.48 11 12 11s10-2.02 10-4.5M2 12c0 2.48 4.48 4.5 10 4.5s10-2.02 10-4.5",
  layers:      "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  package:     "M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12",
  flask:       "M10 2v7.527a2 2 0 01-.586 1.414l-5.828 5.828A2 2 0 005 20h14a2 2 0 001.414-3.414l-5.828-5.828A2 2 0 0114 9.527V2",
  clipboard:   "M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2M9 2h6a1 1 0 011 1v1a1 1 0 01-1 1H9a1 1 0 01-1-1V3a1 1 0 011-1z",
  grid:        "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  link:        "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71",
  plus:        "M12 5v14M5 12h14",
  activity:    "M22 12h-4l-3 9L9 3l-3 9H2",
  server:      "M2 4h20v5H2zM2 15h20v5H2zM6 7h.01M6 18h.01",
  wifi:        "M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01",
  star:        "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  crosshair:   "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM22 12h-4M6 12H2M12 6V2M12 22v-4",
  award:       "M12 15a7 7 0 100-14 7 7 0 000 14zM8.21 13.89L7 23l5-3 5 3-1.21-9.12",
  eye:         "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z",
  tool:        "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z",
  home:        "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  arrowRight:  "M5 12h14M12 5l7 7-7 7",
  refresh:     "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15",
  barChart:    "M12 20V10M18 20V4M6 20v-4",
  pieChart:    "M21.21 15.89A10 10 0 118 2.83M22 12A10 10 0 0012 2v10z",
  target:      "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z",
  lock:        "M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2zM7 11V7a5 5 0 0110 0v4",
  globe:       "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z",
  receipt:     "M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2-3-2z",
};

/* ───────────────────────── helpers ─────────────────────────────── */
const fmt  = (n) => typeof n === "number" ? n.toLocaleString("en-IN") : n;
const fmtK = (n) => n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : n >= 1000 ? `₹${(n / 1000).toFixed(1)}K` : `₹${fmt(n)}`;

const getShift = () => {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return { name: "A (Morning)", color: C.emerald };
  if (h >= 14 && h < 22) return { name: "B (Afternoon)", color: C.blue };
  return { name: "C (Night)", color: C.purple };
};

const now = () => {
  const d = new Date();
  return {
    date: d.toLocaleDateString('en-GB').split('/').join('-'),
    time: d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }),
  };
};

/* ───────────────────────── style factories ─────────────────────── */
const glass = (extra = {}) => ({
  background: `linear-gradient(135deg, rgba(19,26,46,.85), rgba(15,22,41,.65))`,
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  ...extra,
});

const cardStyle = (extra = {}) => ({
  ...glass(),
  padding: "18px 20px",
  transition: "all .25s ease",
  cursor: "default",
  position: "relative",
  overflow: "hidden",
  ...extra,
});

/* KPI_DATA is now built dynamically from API data inside the component */

const MODULE_GROUPS = [
  { title: "Procurement", emoji: "📦", color: C.orange, modules: [
    { name: "Purchase Requisition", desc: "Create & track purchase requests",       icon: ICONS.clipboard, path: null },
    { name: "Purchase Order",       desc: "Manage vendor purchase orders",          icon: ICONS.file,      path: null },
    { name: "Goods Receipt Note",   desc: "Record incoming raw materials",          icon: ICONS.package,   path: "/grn" },
    { name: "Supplier Invoice",     desc: "Process vendor invoices",                icon: ICONS.receipt,   path: null },
    { name: "Supplier Ledger",      desc: "Track vendor account balances",          icon: ICONS.dollar,    path: "/partners" },
    { name: "Purchase Register",    desc: "Complete purchase history & analytics",   icon: ICONS.barChart,  path: null },
  ]},
  { title: "Store & Inventory", emoji: "🏭", color: C.emerald, modules: [
    { name: "Live Inventory",       desc: "Real-time stock across all warehouses", icon: ICONS.eye,       path: "/warehouse" },
    { name: "Raw Material Stock",   desc: "Yarn, chemicals, dyes & accessories",   icon: ICONS.box,       path: "/yarn-store" },
    { name: "Finished Goods",       desc: "Ready-to-ship fabric inventory",        icon: ICONS.package,   path: "/finished-goods" },
    { name: "Store Issue",          desc: "Issue materials to production",          icon: ICONS.arrowRight,path: "/yarn-issue" },
    { name: "Stock Statement",      desc: "Detailed stock position report",        icon: ICONS.file,      path: "/stock-statement" },
    { name: "Lot Tracking",         desc: "Track every yarn lot & its journey",    icon: ICONS.crosshair, path: "/traceability" },
  ]},
  { title: "Production", emoji: "🧶", color: C.blue, modules: [
    { name: "Production Planning",  desc: "Plan orders, batches & scheduling",     icon: ICONS.layers,    path: "/batching" },
    { name: "Machine Dashboard",    desc: "Live machine status & monitoring",       icon: ICONS.cpu,       path: "/" },
    { name: "Machine Monitoring",   desc: "Real-time RPM, speed & efficiency",     icon: ICONS.activity,  path: "/machines" },
    { name: "Work Centers",         desc: "Work center stock & WIP tracking",      icon: ICONS.grid,      path: "/work-center-stock" },
    { name: "Operators",            desc: "Operator assignments & performance",    icon: ICONS.users,     path: "/operators" },
    { name: "Downtime",             desc: "Track & analyze machine downtime",      icon: ICONS.alert,     path: "/downtime" },
    { name: "Production Reports",   desc: "Shift, daily & monthly analytics",      icon: ICONS.barChart,  path: "/reports" },
    { name: "Roll Tracking",        desc: "Individual roll-level traceability",    icon: ICONS.link,      path: "/rolls" },
  ]},
  { title: "Subcontracting", emoji: "📄", color: C.cyan, modules: [
    { name: "SC Challan",           desc: "Send batches for dyeing / finishing",   icon: ICONS.truck,     path: "/subcontracting" },
    { name: "Greige & Lots",        desc: "Grey fabric warehouse & batching",      icon: ICONS.package,   path: "/greige" },
    { name: "Finishing & QA",       desc: "Finishing process & quality checks",    icon: ICONS.flask,     path: "/finishing" },
    { name: "Yarn Issue",           desc: "Issue yarn to knitting machines",       icon: ICONS.arrowRight,path: "/yarn-issue" },
  ]},
  { title: "Sales & Dispatch", emoji: "🚚", color: C.gold, modules: [
    { name: "Dispatch Challan",     desc: "Create delivery challans & invoices",   icon: ICONS.truck,     path: "/dispatch" },
    { name: "Customer Ledger",      desc: "Track customer account balances",       icon: ICONS.dollar,    path: "/partners" },
    { name: "Sales Order",          desc: "Manage customer orders & fulfillment",  icon: ICONS.clipboard, path: null },
    { name: "Dispatch Tracking",    desc: "Track shipments & vehicle movements",   icon: ICONS.globe,     path: null },
  ]},
  { title: "Quality", emoji: "🧪", color: C.purple, modules: [
    { name: "Quality Inspection",   desc: "Inspect rolls for defects & grade",     icon: ICONS.eye,       path: null },
    { name: "Fabric Testing",       desc: "GSM, shrinkage & pilling tests",        icon: ICONS.flask,     path: null },
    { name: "Shade Approval",       desc: "Color matching & shade cards",          icon: ICONS.target,    path: null },
    { name: "Quality Analytics",    desc: "Defect trends, reject rates & charts",  icon: ICONS.pieChart,  path: null },
  ]},
  { title: "HR & Workforce", emoji: "👥", color: C.blue, modules: [
    { name: "Employees",            desc: "Employee master & profiles",            icon: ICONS.users,     path: null },
    { name: "Attendance",           desc: "Daily attendance & shift records",      icon: ICONS.check,     path: null },
    { name: "Operator Performance", desc: "Efficiency, speed & quality scores",    icon: ICONS.award,     path: "/operators" },
    { name: "Payroll",              desc: "Salary processing & slip generation",   icon: ICONS.dollar,    path: null },
  ]},
  { title: "Finance", emoji: "💰", color: C.gold, modules: [
    { name: "Costing",              desc: "FIFO yarn cost & fabric costing",       icon: ICONS.dollar,    path: "/costing" },
    { name: "GST Report",           desc: "GSTR-1, GSTR-3B & reconciliation",     icon: ICONS.file,      path: "/gst-report" },
    { name: "Receivables",          desc: "Outstanding customer invoices",         icon: ICONS.receipt,   path: null },
    { name: "Payables",             desc: "Outstanding supplier invoices",         icon: ICONS.file,      path: null },
    { name: "Profit & Loss",        desc: "Revenue, expenses & profitability",     icon: ICONS.trending,  path: null },
    { name: "Balance Sheet",        desc: "Assets, liabilities & equity",          icon: ICONS.barChart,  path: null },
  ]},
  { title: "Analytics", emoji: "📊", color: C.purple, modules: [
    { name: "Business Intelligence",desc: "Cross-department executive insights",   icon: ICONS.pieChart,  path: null },
    { name: "Inventory Analytics",  desc: "Stock movement, ageing & ABC analysis", icon: ICONS.barChart,  path: "/inventory-reports" },
    { name: "Production Analytics", desc: "OEE, efficiency & output trends",       icon: ICONS.chart,     path: "/reports" },
    { name: "Machine Analytics",    desc: "Utilization, downtime & maintenance",   icon: ICONS.cpu,       path: "/machines" },
    { name: "Power Consumption",    desc: "kWh tracking & energy cost analysis",   icon: ICONS.zap,       path: null },
    { name: "Executive Reports",    desc: "Board-ready summary dashboards",        icon: ICONS.star,      path: null },
  ]},
  { title: "Administration", emoji: "⚙", color: C.textDim, modules: [
    { name: "Master Data",          desc: "Items, partners, warehouses & config",  icon: ICONS.database,  path: "/admin/masters" },
    { name: "Item Master",          desc: "Yarn types, fabric types & materials",  icon: ICONS.grid,      path: "/items" },
    { name: "Users & Roles",        desc: "User accounts & access control",       icon: ICONS.lock,      path: "/users" },
    { name: "System Settings",      desc: "Factory config, shifts & preferences",  icon: ICONS.settings,  path: "/settings" },
    { name: "Opening Balances",     desc: "Set initial stock & financial balances", icon: ICONS.layers,   path: "/opening-balances" },
    { name: "RFID Management",      desc: "RFID readers, tags & event tracking",   icon: ICONS.wifi,      path: "/rfid" },
  ]},
];

/* RECENT, PENDING, FACTORY are now built dynamically from API data */

const QUICK_ACTIONS = [
  { label: "New GRN",            path: "/grn",            icon: ICONS.package },
  { label: "SC Challan",         path: "/subcontracting", icon: ICONS.truck },
  { label: "Dispatch",           path: "/dispatch",       icon: ICONS.truck },
  { label: "Yarn Issue",         path: "/yarn-issue",     icon: ICONS.arrowRight },
  { label: "New Batch",          path: "/batching",       icon: ICONS.layers },
  { label: "New Partner",        path: "/partners",       icon: ICONS.users },
  { label: "Stock Adjust",       path: "/opening-balances",icon:ICONS.box },
  { label: "Item Master",        path: "/items",          icon: ICONS.grid },
  { label: "Maintenance",        path: "/maintenance",    icon: ICONS.tool },
];

/* SUMMARIES is now built dynamically from API data */

/* ───────────────────────── mini sparkline SVG ──────────────────── */
const Sparkline = ({ data, color, w = 80, h = 28 }) => {
  if (!data || !data.length) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`sp-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#sp-${color.replace("#","")})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
};

/* ───────────────────────── progress ring ───────────────────────── */
const ProgressRing = ({ pct, color, size = 52, stroke = 4 }) => {
  const r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
        strokeLinecap="round" style={{ transition: "stroke-dashoffset .8s ease" }} />
    </svg>
  );
};

/* ───────────────────────── donut chart ──────────────────────────── */
const DonutChart = ({ segments, size = 120, stroke = 16 }) => {
  const r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const total = segments.reduce((s, g) => s + g.value, 0);
  let offset = 0;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={stroke} />
      {segments.map((seg, i) => {
        const dash = (seg.value / total) * circ;
        const el = (
          <circle key={i} cx={size/2} cy={size/2} r={r} fill="none" stroke={seg.color}
            strokeWidth={stroke} strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={-offset} strokeLinecap="butt"
            style={{ transition: "all .6s ease" }} />
        );
        offset += dash;
        return el;
      })}
    </svg>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════ */
const API = window.location.origin;
const token = () => localStorage.getItem("dhown_token");
const authHdr = () => ({ Authorization: `Bearer ${token()}` });

const timeAgo = (ts) => {
  if (!ts) return "—";
  const diff = (Date.now() - new Date(ts).getTime()) / 60000;
  if (diff < 1) return "just now";
  if (diff < 60) return `${Math.round(diff)} min ago`;
  if (diff < 1440) return `${Math.round(diff / 60)} hr ago`;
  return `${Math.round(diff / 1440)} days ago`;
};

const fmtLakh = (n) => {
  const v = parseFloat(n || 0);
  if (v >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${Math.round(v)}`;
};

export default function MasterDashboard() {
  const nav = useNavigate();
  const [clock, setClock] = useState(now());
  const [fabOpen, setFabOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const shift = getShift();

  const fetchData = useCallback(() => {
    fetch(`${API}/api/command-center`, { headers: authHdr() })
      .then(r => r.json())
      .then(d => { if (!d.error) { setData(d); setLoading(false); } })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(() => setClock(now()), 1000);
    fetchData();
    const r = setInterval(fetchData, 30000);
    return () => { clearInterval(t); clearInterval(r); };
  }, [fetchData]);

  /* ── derive display data from API response ── */
  const d = data || {};
  const mach = d.machines || { total: 0, running: 0, stopped: 0, maintenance: 0, offline: 0 };
  const prod = d.production || { today_kg: 0, shift_kg: 0 };
  const oeeVal = d.oee || 0;
  const grn = d.grn || { today_count: 0, today_value: 0, recent: [] };
  const disp = d.dispatch || { today_count: 0, today_kg: 0, recent: [] };
  const sc = d.sc || { sent_today: 0, recv_today: 0, recent: [] };
  const yarnIss = d.yarn_issue || { today_count: 0, today_kg: 0, recent: [] };
  const inv = d.inventory || { value: 0, total_kg: 0 };
  const pend = d.pending || { sc_challans: 0, grn_draft: 0, dispatch_draft: 0 };

  const utilPct = mach.total > 0 ? Math.round((mach.running / mach.total) * 100) : 0;

  const KPI_DATA = [
    { label: "Today's Production",  value: `${fmt(Math.round(prod.today_kg))} kg`, delta: `${prod.today_kg > 0 ? "+" : ""}${fmt(Math.round(prod.today_kg))} kg`, icon: ICONS.factory, color: C.emerald },
    { label: "Shift Production",    value: `${fmt(Math.round(prod.shift_kg))} kg`, delta: d.current_shift || "—", icon: ICONS.production, color: C.blue },
    { label: "Today's Dispatch",    value: `${fmt(Math.round(disp.today_kg))} kg`, delta: `${disp.today_count} challans`, icon: ICONS.truck, color: C.cyan },
    { label: "Purchase Today",      value: fmtLakh(grn.today_value),               delta: `${grn.today_count} GRNs`, icon: ICONS.cart, color: C.orange },
    { label: "Inventory Value",     value: fmtLakh(inv.value),                      delta: `${fmt(Math.round(inv.total_kg))} kg`, icon: ICONS.box, color: C.purple },
    { label: "Running Machines",    value: `${mach.running} / ${mach.total}`,       delta: `${utilPct}%`, icon: ICONS.cpu, color: mach.running > 0 ? C.emerald : C.red },
    { label: "Factory OEE",         value: `${oeeVal}%`,                            delta: oeeVal > 0 ? "Live" : "No data", icon: ICONS.gauge, color: C.gold },
    { label: "SC Sent Today",       value: `${sc.sent_today}`,                      delta: "challans", icon: ICONS.truck, color: C.cyan },
    { label: "SC Received Today",   value: `${sc.recv_today}`,                      delta: "received", icon: ICONS.check, color: C.blue },
    { label: "Yarn Issued Today",   value: `${fmt(Math.round(yarnIss.today_kg))} kg`, delta: `${yarnIss.today_count} issues`, icon: ICONS.arrowRight, color: C.purple },
    { label: "Pending SC",          value: `${pend.sc_challans}`,                   delta: "awaiting receive", icon: ICONS.clock, color: C.orange },
    { label: "Pending GRN",         value: `${pend.grn_draft}`,                     delta: "drafts", icon: ICONS.package, color: C.red },
    { label: "Inventory (kg)",      value: `${fmt(Math.round(inv.total_kg))} kg`,   delta: "in stock", icon: ICONS.box, color: C.emerald },
    { label: "Machines Stopped",    value: `${mach.stopped}`,                       delta: mach.stopped > 0 ? "needs attention" : "all clear", icon: ICONS.alert, color: mach.stopped > 0 ? C.red : C.emerald },
    { label: "In Downtime",         value: `${mach.maintenance}`,                   delta: "machines", icon: ICONS.tool, color: C.orange },
    { label: "Pending Dispatch",    value: `${pend.dispatch_draft}`,                delta: "drafts", icon: ICONS.truck, color: C.gold },
  ];

  /* build recent activity from real data */
  const RECENT = [
    ...(grn.recent || []).map(g => ({ type: "GRN", id: g.grn_number, detail: `${g.supplier_name} — ${g.status}`, time: timeAgo(g.receipt_date), color: C.emerald })),
    ...(sc.recent || []).map(s => ({ type: "SC Challan", id: s.challan_number, detail: `${s.vendor_name} — ${s.status}`, time: timeAgo(s.sent_date), color: C.cyan })),
    ...(disp.recent || []).map(dp => ({ type: "Dispatch", id: dp.challan_number, detail: `${dp.customer_name} — ${dp.total_weight_kg} kg`, time: timeAgo(dp.created_at), color: C.gold })),
    ...(yarnIss.recent || []).map(yi => ({ type: "Yarn Issue", id: yi.issue_number, detail: `${yi.total_kg} kg issued to ${yi.machine_id}`, time: timeAgo(yi.issue_date), color: C.purple })),
    ...(d.recent_rolls || []).map(r => ({ type: "Production", id: `ROLL-${r.roll_id}`, detail: `${r.net_weight_kg || 0} kg on ${r.machine_id}`, time: timeAgo(r.completed_at), color: C.emerald })),
    ...(d.recent_downtime || []).map(dt => ({ type: "Downtime", id: dt.machine_id, detail: `${dt.reason || "Unknown"} (${dt.mins} min)`, time: timeAgo(dt.start_time), color: C.red })),
  ];

  const PENDING = [
    { type: "SC Challans (Sent)",  count: pend.sc_challans,    icon: ICONS.truck,     color: C.cyan },
    { type: "GRN (Draft)",         count: pend.grn_draft,      icon: ICONS.package,   color: C.emerald },
    { type: "Dispatch (Draft)",    count: pend.dispatch_draft,  icon: ICONS.truck,     color: C.gold },
  ];

  const FACTORY = {
    machines: [
      { label: "Running",     value: mach.running,     color: C.emerald },
      { label: "Stopped",     value: mach.stopped,     color: C.red },
      { label: "Downtime",    value: mach.maintenance, color: C.orange },
      { label: "Offline",     value: mach.offline,     color: C.textMuted },
    ],
    topOperators: (d.top_operators || []).map((op, i) => ({ name: op.operator_name, machines: op.machine_id, shifts: op.shifts })),
    topFabrics:   (d.top_fabrics || []).map(f => ({ name: f.fabric, kg: parseFloat(f.kg || 0) })),
    topYarn:      (d.top_yarn || []).map(y => ({ name: y.yarn, kg: parseFloat(y.kg || 0) })),
  };

  const SUMMARIES = [
    { title: "Purchase",   value: fmtLakh(grn.today_value), pct: grn.today_count > 0 ? 100 : 0, items: grn.today_count,  color: C.orange,  icon: ICONS.cart },
    { title: "Inventory",  value: fmtLakh(inv.value),       pct: inv.total_kg > 0 ? 85 : 0,     items: `${fmt(Math.round(inv.total_kg))} kg`, color: C.emerald, icon: ICONS.box },
    { title: "Production", value: `${fmt(Math.round(prod.today_kg))} kg`, pct: prod.today_kg > 0 ? Math.min(100, Math.round(prod.today_kg / 30)) : 0, items: "today", color: C.blue, icon: ICONS.factory },
    { title: "Dispatch",   value: `${fmt(Math.round(disp.today_kg))} kg`, pct: disp.today_count > 0 ? 100 : 0, items: disp.today_count, color: C.cyan, icon: ICONS.truck },
    { title: "SC Sent",    value: `${sc.sent_today}`,       pct: sc.sent_today > 0 ? 100 : 0,   items: "today",          color: C.purple,  icon: ICONS.truck },
    { title: "Machines",   value: `${utilPct}% UP`,         pct: utilPct,                        items: `${mach.total} total`, color: C.emerald, icon: ICONS.cpu },
  ];

  const go = useCallback((path) => { if (path) nav(path); }, [nav]);

  /* ── inline styles ── */
  const page = {
    minHeight: "100vh",
    background: C.bg,
    color: C.text,
    fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
    overflowX: "hidden",
    position: "relative",
  };

  const header = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "14px 32px",
    background: `linear-gradient(180deg, ${C.surface} 0%, ${C.bg} 100%)`,
    borderBottom: `1px solid ${C.border}`,
    position: "sticky", top: 0, zIndex: 100,
    backdropFilter: "blur(12px)",
  };

  const sectionTitle = (emoji, text, sub) => (
    <div style={{ margin: "36px 0 18px", display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 22 }}>{emoji}</span>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.white, letterSpacing: ".3px" }}>{text}</h2>
        {sub && <span style={{ fontSize: 12, color: C.textDim }}>{sub}</span>}
      </div>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${C.border}, transparent)`, marginLeft: 16 }} />
    </div>
  );

  return (
    <div style={page}>

      {/* ═══════════ HEADER ═══════════ */}
      <div style={header}>
        {/* left */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img src="/logo.png" alt="DHOWN" style={{
            width: 44, height: 44, borderRadius: 10, objectFit: "cover",
            boxShadow: `0 0 20px ${C.goldGlow}`,
          }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.gold, letterSpacing: 1 }}>DHOWN HOSIERY MILLS</div>
            <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 2, textTransform: "uppercase" }}>Master Command Center</div>
          </div>
        </div>

        {/* center */}
        <div style={{ display: "flex", alignItems: "center", gap: 28, textAlign: "center" }}>
          <div style={{
            padding: "6px 16px", borderRadius: 8,
            background: `${shift.color}18`, border: `1px solid ${shift.color}40`,
          }}>
            <div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: 1 }}>Current Shift</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: shift.color }}>{shift.name}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: 1 }}>Date</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.white }}>{clock.date}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: 1 }}>Time</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.gold, fontVariantNumeric: "tabular-nums" }}>{clock.time}</div>
          </div>
          <div style={{
            padding: "6px 16px", borderRadius: 8,
            background: `${C.emerald}18`, border: `1px solid ${C.emerald}40`,
          }}>
            <div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: 1 }}>Status</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.emerald }}>● OPERATIONAL</div>
          </div>
        </div>

        {/* right */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {[
            { icon: ICONS.bell, badge: 5 },
            { icon: ICONS.search },
            { icon: ICONS.user },
            { icon: ICONS.settings },
          ].map((btn, i) => (
            <div key={i} style={{
              width: 38, height: 38, borderRadius: 10,
              background: C.card, border: `1px solid ${C.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", position: "relative",
              transition: "all .2s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = C.cardHover; e.currentTarget.style.borderColor = C.gold; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.card; e.currentTarget.style.borderColor = C.border; }}
            >
              <Icon d={btn.icon} size={18} color={C.textDim} />
              {btn.badge && (
                <span style={{
                  position: "absolute", top: -4, right: -4,
                  width: 18, height: 18, borderRadius: 9,
                  background: C.red, color: "var(--text)", fontSize: 10, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>{btn.badge}</span>
              )}
            </div>
          ))}
          <div
            style={{ padding: "7px 16px", borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, cursor: "pointer", transition: "all .2s" }}
            onClick={() => go("/")}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.gold; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}
          >
            <span style={{ fontSize: 12, color: C.textDim }}>← Back to </span>
            <span style={{ fontSize: 12, color: C.gold, fontWeight: 600 }}>Dashboard</span>
          </div>
        </div>
      </div>

      {/* ═══════════ BODY ═══════════ */}
      <div style={{ padding: "0 32px 100px", maxWidth: 1600, margin: "0 auto" }}>

        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.textDim }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Loading Command Center...</div>
            <div style={{ fontSize: 12, color: C.textMuted }}>Fetching live data from all departments</div>
          </div>
        )}

        {/* ─── ROW 1: KPI CARDS ─── */}
        {sectionTitle("📈", "Executive KPIs", "Real-time business performance at a glance")}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 14,
        }}>
          {KPI_DATA.map((kpi, i) => (
            <div key={i} style={cardStyle()}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = kpi.color;
                e.currentTarget.style.boxShadow = `0 4px 24px ${kpi.color}22`;
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = C.border;
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${kpi.color}, transparent)`, borderRadius: "14px 14px 0 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 9,
                  background: `${kpi.color}15`, border: `1px solid ${kpi.color}30`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon d={kpi.icon} size={16} color={kpi.color} />
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 6,
                  background: kpi.delta.startsWith("+") ? `${C.emerald}18` : kpi.delta.startsWith("-") ? `${C.red}18` : `${C.blue}18`,
                  color: kpi.delta.startsWith("+") ? C.emerald : kpi.delta.startsWith("-") ? C.red : C.blue,
                }}>{kpi.delta}</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.white, marginBottom: 2, fontVariantNumeric: "tabular-nums" }}>{kpi.value}</div>
              <div style={{ fontSize: 11, color: C.textDim }}>{kpi.label}</div>
            </div>
          ))}
        </div>

        {/* ─── ROW 2: BUSINESS MODULES ─── */}
        {sectionTitle("🏢", "Business Modules", "Navigate to any department with one click")}
        {MODULE_GROUPS.map((group, gi) => (
          <div key={gi} style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 16 }}>{group.emoji}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: group.color, letterSpacing: ".5px" }}>{group.title}</span>
              <span style={{ fontSize: 11, color: C.textMuted }}>({group.modules.length} modules)</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {group.modules.map((mod, mi) => (
                <div key={mi}
                  style={{
                    ...cardStyle({ padding: "16px 18px", cursor: mod.path ? "pointer" : "default" }),
                    opacity: mod.path ? 1 : .55,
                  }}
                  onClick={() => go(mod.path)}
                  onMouseEnter={e => {
                    if (!mod.path) return;
                    e.currentTarget.style.borderColor = group.color;
                    e.currentTarget.style.boxShadow = `0 4px 28px ${group.color}20, inset 0 0 30px ${group.color}06`;
                    e.currentTarget.style.transform = "translateY(-3px) scale(1.01)";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = C.border;
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.transform = "none";
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 9,
                      background: `${group.color}12`, border: `1px solid ${group.color}25`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      <Icon d={mod.icon} size={17} color={group.color} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mod.name}</div>
                    </div>
                    {mod.path && <Icon d={ICONS.arrowRight} size={14} color={C.textMuted} />}
                  </div>
                  <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.4 }}>{mod.desc}</div>
                  {!mod.path && (
                    <div style={{ marginTop: 8, fontSize: 10, color: C.textMuted, background: `${C.textMuted}15`, padding: "2px 8px", borderRadius: 4, display: "inline-block" }}>Coming Soon</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* ─── ROW 3: LIVE SUMMARIES ─── */}
        {sectionTitle("📊", "Live Business Dashboards", "Real-time department performance")}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14 }}>
          {SUMMARIES.map((s, i) => (
            <div key={i} style={cardStyle({ textAlign: "center", padding: "22px 16px" })}
              onMouseEnter={e => { e.currentTarget.style.borderColor = s.color; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = "none"; }}
            >
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 12, position: "relative" }}>
                <ProgressRing pct={s.pct} color={s.color} size={64} stroke={5} />
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}>
                  <Icon d={s.icon} size={18} color={s.color} />
                </div>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: C.white }}>{s.value}</div>
              <div style={{ fontSize: 12, color: s.color, fontWeight: 600, marginBottom: 4 }}>{s.title}</div>
              <div style={{ fontSize: 11, color: C.textDim }}>{s.items} transactions today</div>
              <div style={{ marginTop: 10, height: 4, borderRadius: 2, background: C.border, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${s.pct}%`, background: s.color, borderRadius: 2, transition: "width 1s ease" }} />
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>{s.pct}% of daily target</div>
            </div>
          ))}
        </div>

        {/* ─── ROW 4: RECENT ACTIVITY ─── */}
        {sectionTitle("🕐", "Recent Activity", "Latest events across all departments")}
        <div style={{ ...glass(), padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.navyLight }}>
                {["Type", "Reference", "Details", "Time"].map(h => (
                  <th key={h} style={{ padding: "12px 18px", fontSize: 11, fontWeight: 600, color: C.textDim, textAlign: "left", textTransform: "uppercase", letterSpacing: 1, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RECENT.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}08`, transition: "background .15s" }}
                  onMouseEnter={e => e.currentTarget.style.background = C.navyLight}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "11px 18px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: r.color, padding: "3px 10px", borderRadius: 6, background: `${r.color}14`, border: `1px solid ${r.color}25` }}>{r.type}</span>
                  </td>
                  <td style={{ padding: "11px 18px", fontSize: 13, fontWeight: 600, color: C.white, fontFamily: "'JetBrains Mono', monospace" }}>{r.id}</td>
                  <td style={{ padding: "11px 18px", fontSize: 12, color: C.textDim }}>{r.detail}</td>
                  <td style={{ padding: "11px 18px", fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>{r.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ─── ROW 5: PENDING APPROVALS ─── */}
        {sectionTitle("⏳", "Pending Approvals", "Items requiring your attention")}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
          {PENDING.map((p, i) => (
            <div key={i} style={cardStyle({ padding: "16px", textAlign: "center", cursor: "pointer" })}
              onMouseEnter={e => { e.currentTarget.style.borderColor = p.color; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = "none"; }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 10, margin: "0 auto 10px",
                background: `${p.color}12`, border: `1px solid ${p.color}25`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon d={p.icon} size={18} color={p.color} />
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: C.white }}>{p.count}</div>
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>{p.type}</div>
            </div>
          ))}
        </div>

        {/* ─── ROW 6: FACTORY OVERVIEW ─── */}
        {sectionTitle("🏭", "Factory Overview", "Machines, operators & production insights")}
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr 1fr 1fr", gap: 16 }}>

          {/* Donut: machine status */}
          <div style={cardStyle({ padding: "20px", textAlign: "center" })}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 14 }}>Machine Status</div>
            <div style={{ display: "flex", justifyContent: "center", position: "relative", marginBottom: 14 }}>
              <DonutChart segments={FACTORY.machines} size={130} stroke={18} />
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: C.white }}>{mach.total}</div>
                <div style={{ fontSize: 10, color: C.textDim }}>Total</div>
              </div>
            </div>
            {FACTORY.machines.map((m, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 4, background: m.color }} />
                  <span style={{ fontSize: 12, color: C.textDim }}>{m.label}</span>
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: m.color }}>{m.value}</span>
              </div>
            ))}
          </div>

          {/* Top Operators */}
          <div style={cardStyle({ padding: "20px" })}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 14 }}>Active Operators</div>
            {FACTORY.topOperators.length === 0 && <div style={{ fontSize: 12, color: C.textMuted }}>No active operators</div>}
            {FACTORY.topOperators.map((op, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: i < FACTORY.topOperators.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: `${[C.gold, C.blue, C.emerald, C.purple][i % 4]}18`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 800, color: [C.gold, C.blue, C.emerald, C.purple][i % 4],
                }}>#{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.white }}>{op.name}</div>
                  <div style={{ fontSize: 10, color: C.textMuted }}>{op.machines}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.blue }}>{op.shifts} shifts</div>
                </div>
              </div>
            ))}
          </div>

          {/* Top Fabrics */}
          <div style={cardStyle({ padding: "20px" })}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 14 }}>Top Fabrics Produced</div>
            {FACTORY.topFabrics.length === 0 && <div style={{ fontSize: 12, color: C.textMuted }}>No production data yet</div>}
            {FACTORY.topFabrics.map((f, i) => {
              const pct = FACTORY.topFabrics[0].kg > 0 ? Math.round((f.kg / FACTORY.topFabrics[0].kg) * 100) : 0;
              return (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: C.textDim }}>{f.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.white }}>{f.kg} kg</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: C.border, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${C.blue}, ${C.cyan})`, borderRadius: 3, transition: "width .6s ease" }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Top Yarn Consumed */}
          <div style={cardStyle({ padding: "20px" })}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 14 }}>Most Consumed Yarn</div>
            {FACTORY.topYarn.length === 0 && <div style={{ fontSize: 12, color: C.textMuted }}>No yarn issue data yet</div>}
            {FACTORY.topYarn.map((y, i) => {
              const pct = FACTORY.topYarn[0].kg > 0 ? Math.round((y.kg / FACTORY.topYarn[0].kg) * 100) : 0;
              return (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: C.textDim }}>{y.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.white }}>{y.kg} kg</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: C.border, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${C.gold}, ${C.orange})`, borderRadius: 3, transition: "width .6s ease" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══════════ QUICK ACTION FAB ═══════════ */}
      <div style={{ position: "fixed", bottom: 28, right: 28, zIndex: 200 }}>
        {fabOpen && (
          <div style={{
            ...glass({ padding: "12px", marginBottom: 12 }),
            boxShadow: `0 8px 40px rgba(0,0,0,.5), 0 0 30px ${C.goldGlow}`,
            width: 220,
          }}>
            <div style={{ fontSize: 11, color: C.textDim, fontWeight: 600, padding: "4px 8px 8px", textTransform: "uppercase", letterSpacing: 1 }}>Quick Create</div>
            {QUICK_ACTIONS.map((qa, i) => (
              <div key={i}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 10px", borderRadius: 8, cursor: "pointer",
                  transition: "all .15s",
                }}
                onClick={() => { setFabOpen(false); go(qa.path); }}
                onMouseEnter={e => { e.currentTarget.style.background = C.cardHover; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                <Icon d={qa.icon} size={15} color={C.gold} />
                <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{qa.label}</span>
              </div>
            ))}
          </div>
        )}
        <div
          style={{
            width: 54, height: 54, borderRadius: 14,
            background: `linear-gradient(135deg, ${C.gold}, ${C.goldDim})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", boxShadow: `0 4px 24px ${C.goldGlow}, 0 0 40px ${C.goldGlow}`,
            transition: "all .25s", transform: fabOpen ? "rotate(45deg)" : "none",
            marginLeft: "auto",
          }}
          onClick={() => setFabOpen(f => !f)}
          onMouseEnter={e => e.currentTarget.style.boxShadow = `0 4px 32px ${C.gold}44, 0 0 50px ${C.goldGlow}`}
          onMouseLeave={e => e.currentTarget.style.boxShadow = `0 4px 24px ${C.goldGlow}, 0 0 40px ${C.goldGlow}`}
        >
          <Icon d={ICONS.plus} size={24} color={C.navy} />
        </div>
      </div>

      {/* ═══════════ FOOTER ═══════════ */}
      <div style={{
        padding: "14px 32px",
        background: C.surface,
        borderTop: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 12,
      }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {[
            { label: "Server",       status: "Online",    color: C.emerald },
            { label: "Database",     status: "Connected", color: C.emerald },
            { label: "Socket",       status: "Active",    color: C.emerald },
            { label: "API",          status: "200 OK",    color: C.emerald },
            { label: "RFID",         status: "2 Readers", color: C.blue },
            { label: "Data Collect", status: "3 Active",  color: C.blue },
            { label: "PLC",          status: "N/A",       color: C.textMuted },
          ].map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: 3, background: s.color }} />
              <span style={{ fontSize: 10, color: C.textMuted }}>{s.label}:</span>
              <span style={{ fontSize: 10, color: s.color, fontWeight: 600 }}>{s.status}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 10, color: C.textMuted }}>Last Sync: {clock.time}</span>
          <span style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>DHOWN MES v2.4.0</span>
          <span style={{ fontSize: 10, color: C.gold, fontWeight: 700 }}>© 2026 DHOWN HOSIERY MILLS</span>
        </div>
      </div>
    </div>
  );
}
