// Partner Scorecard — supplier & customer performance at a glance.
// Suppliers: spend, PO reliability (overdue POs), imports. Customers: billed,
// receivables/overdue, returns, credit. Built on the reusable DataTable
// (sticky header, click-sort, CSV export).
import React, { useState, useEffect, useCallback } from "react";
import DataTable from "../components/DataTable";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const inr = (n) => (n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 }));
const pct = (n) => (n == null ? "—" : `${n}%`);
const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB").split("/").join("-") : "—");

const SUP_COLS = [
  { key: "name", label: "Supplier", align: "left", bold: true },
  { key: "spend", label: "Spend", fmt: inr },
  { key: "po_count", label: "POs" },
  { key: "open_pos", label: "Open" },
  { key: "overdue_pos", label: "Overdue", tone: (v) => (v > 0 ? "var(--crit)" : "var(--muted)") },
  { key: "reliability_pct", label: "Reliability", fmt: pct, tone: (v) => (v == null ? "var(--muted)" : v >= 90 ? "var(--green)" : v >= 70 ? "var(--gold-deep)" : "var(--crit)") },
  { key: "import_count", label: "Imports" },
  { key: "rating", label: "Rating", fmt: (v) => v || "—" },
  { key: "last_order", label: "Last order", fmt: day },
];
const CUST_COLS = [
  { key: "name", label: "Customer", align: "left", bold: true,
    render: (v, r) => (<>{v}{r.over_limit ? <span style={{ marginLeft: 6, fontSize: 10, color: "var(--crit)", fontWeight: 700 }}>OVER LIMIT</span> : null}</>) },
  { key: "billed", label: "Billed", fmt: inr },
  { key: "outstanding", label: "Outstanding", fmt: inr },
  { key: "overdue", label: "Overdue", fmt: inr, tone: (v) => (v > 0 ? "var(--crit)" : "var(--muted)") },
  { key: "oldest_overdue_days", label: "Oldest (d)", tone: (v) => (v > 60 ? "var(--crit)" : v > 0 ? "var(--gold-deep)" : "var(--muted)") },
  { key: "return_count", label: "Returns" },
  { key: "return_rate_pct", label: "Return %", fmt: pct, tone: (v) => (v == null ? "var(--muted)" : v > 5 ? "var(--crit)" : "var(--muted)") },
  { key: "credit_limit", label: "Credit limit", fmt: inr },
  { key: "last_order", label: "Last order", fmt: day },
];

export default function PartnerScorecard() {
  const [tab, setTab] = useState("suppliers");
  const [data, setData] = useState({ suppliers: null, customers: null });
  const [state, setState] = useState("loading");

  const load = useCallback(async (which) => {
    setState("loading");
    try {
      const r = await fetch(`/api/scorecard/${which}`, { headers: auth() });
      if (r.status === 403) { setState("forbidden"); return; }
      if (!r.ok) { setState("error"); return; }
      const rows = await r.json();
      setData((d) => ({ ...d, [which]: rows })); setState("ok");
    } catch { setState("error"); }
  }, []);

  useEffect(() => { if (data[tab] == null) load(tab); else setState("ok"); }, [tab, data, load]);

  const cols = tab === "suppliers" ? SUP_COLS : CUST_COLS;
  const rows = data[tab] || [];
  const page = { padding: "22px 26px", maxWidth: 1200, margin: "0 auto" };
  const tabBtn = (active) => ({ font: "inherit", fontSize: 13, fontWeight: 700, padding: "8px 16px", borderRadius: 8, cursor: "pointer", border: `1px solid ${active ? "var(--green)" : "var(--border)"}`, background: active ? "var(--green)" : "var(--surface)", color: active ? "var(--on-green)" : "var(--muted)" });

  return (
    <div style={page}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: "0 0 4px" }}>📊 Partner Scorecard</h1>
      <div style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 18 }}>
        Supplier &amp; customer performance from the MES's own records. Supplier payables live in Busy;
        a true on-time % needs a PO↔GRN link (not stored), so reliability is from overdue POs.
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <button style={tabBtn(tab === "suppliers")} onClick={() => setTab("suppliers")}>Suppliers</button>
        <button style={tabBtn(tab === "customers")} onClick={() => setTab("customers")}>Customers</button>
      </div>

      {state === "loading" && <div style={{ padding: 24, color: "var(--muted)" }}>Loading…</div>}
      {state === "forbidden" && <div style={{ padding: 24, color: "var(--muted)" }}>You don't have access to the scorecard.</div>}
      {state === "error" && <div style={{ padding: 24, color: "var(--crit)" }}>Couldn't load the scorecard.</div>}
      {state === "ok" && (
        <DataTable
          columns={cols} rows={rows} rowKey="partner_id"
          csvName={`${tab}-scorecard`}
          initialSort={{ key: tab === "suppliers" ? "spend" : "billed", dir: -1 }}
          empty={`No ${tab} with activity yet.`}
        />
      )}
    </div>
  );
}
