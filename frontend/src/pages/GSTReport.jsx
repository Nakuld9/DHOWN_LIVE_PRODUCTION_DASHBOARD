import React, { useState } from "react";

const API = "http://localhost:4000";

export default function GSTReport() {
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("output");

  const load = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("dhown_token");
      const res = await fetch(`${API}/api/reports/gst-summary?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const fmt = (v) => v != null ? `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—";

  const printReport = () => {
    if (!data) return;
    const rows = (tab === "output" ? data.output_lines : data.input_lines) || [];
    const label = tab === "output" ? "Output GST (Sales)" : "Input GST (Purchases)";
    const html = `<html><head><title>GST Report</title><style>
      body{font-family:Arial;padding:30px}table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{border:1px solid #ccc;padding:8px 10px;text-align:right;font-size:13px}
      th{background:#f0f0f0;text-align:center}td:first-child,td:nth-child(2){text-align:left}
      h2{margin:0}h3{color:#555}.tot{font-weight:bold;background:#fafafa}
    </style></head><body>
    <h2>DHOWN TEXTILES — GST Report</h2>
    <h3>${label} | ${from} to ${to}</h3>
    <table><thead><tr>${tab === "output"
      ? "<th>Challan</th><th>Party</th><th>Date</th><th>Taxable</th><th>GST%</th><th>GST Amt</th><th>Total</th>"
      : "<th>GRN</th><th>Vendor</th><th>Date</th><th>Qty (kg)</th><th>Rate</th><th>GST%</th><th>Taxable</th><th>GST Amt</th>"
    }</tr></thead><tbody>${rows.map(r => tab === "output"
      ? `<tr><td>${r.challan_no||""}</td><td>${r.party_name||""}</td><td>${r.dispatch_date||""}</td><td>${fmt(r.taxable_value)}</td><td>${r.gst_rate||5}%</td><td>${fmt(r.gst_amount)}</td><td>${fmt(r.line_total)}</td></tr>`
      : `<tr><td>${r.grn_number||""}</td><td>${r.vendor_name||""}</td><td>${r.grn_date||""}</td><td>${r.net_weight_kg||""}</td><td>${fmt(r.rate_per_kg)}</td><td>${r.gst_rate||5}%</td><td>${fmt(r.taxable)}</td><td>${fmt(r.gst_amount)}</td></tr>`
    ).join("")}</tbody>
    <tfoot><tr class="tot"><td colspan="${tab==="output"?3:4}">TOTAL</td>${tab==="output"
      ? `<td>${fmt(data.output_total_taxable)}</td><td></td><td>${fmt(data.output_total_gst)}</td><td>${fmt((data.output_total_taxable||0)+(data.output_total_gst||0))}</td>`
      : `<td></td><td></td><td>${fmt(data.input_total_taxable)}</td><td>${fmt(data.input_total_gst)}</td>`
    }</tr></tfoot></table>
    <div style="margin-top:24px;padding:12px;background:#f5f5f5;border-radius:6px">
      <strong>Output GST:</strong> ${fmt(data.output_total_gst)} &nbsp;|&nbsp;
      <strong>Input GST:</strong> ${fmt(data.input_total_gst)} &nbsp;|&nbsp;
      <strong>Net Payable:</strong> ${fmt(data.net_gst_payable)}
    </div></body></html>`;
    const w = window.open(); w.document.write(html); w.document.close(); w.print();
  };

  const tabStyle = (t) => ({
    padding: "10px 24px", cursor: "pointer", fontWeight: "bold", fontSize: 14, border: "none",
    borderBottom: tab === t ? "3px solid #FFD700" : "3px solid transparent",
    background: "transparent", color: tab === t ? "#FFD700" : "#7da2d6",
  });

  return (
    <div style={{ padding: 24, color: "white", background: "#050d1a", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ color: "#FFD700", margin: 0, letterSpacing: 1 }}>GST REPORT</h2>
        {data && <button onClick={printReport} style={btnStyle}>🖨 Print</button>}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 24 }}>
        <label style={lbl}>From</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} />
        <label style={lbl}>To</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp} />
        <button onClick={load} disabled={loading} style={btnStyle}>{loading ? "Loading..." : "Generate"}</button>
      </div>

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 24 }}>
            <KPI title="OUTPUT GST" value={fmt(data.output_total_gst)} color="#ef4444" />
            <KPI title="INPUT GST (CREDIT)" value={fmt(data.input_total_gst)} color="#22c55e" />
            <KPI title="NET GST PAYABLE" value={fmt(data.net_gst_payable)} color={data.net_gst_payable >= 0 ? "#ef4444" : "#22c55e"} />
          </div>

          <div style={{ borderBottom: "1px solid #16345d", marginBottom: 16 }}>
            <button style={tabStyle("output")} onClick={() => setTab("output")}>Output GST (Sales)</button>
            <button style={tabStyle("input")} onClick={() => setTab("input")}>Input GST (Purchases)</button>
          </div>

          {tab === "output" && (
            <Table
              headers={["Challan", "Party", "Date", "Taxable", "GST%", "GST Amt", "Total"]}
              rows={(data.output_lines || []).map(r => [
                r.challan_no, r.party_name, r.dispatch_date?.slice(0,10),
                fmt(r.taxable_value), `${r.gst_rate||5}%`, fmt(r.gst_amount), fmt(r.line_total),
              ])}
              totals={["", "", "TOTAL", fmt(data.output_total_taxable), "", fmt(data.output_total_gst), fmt((data.output_total_taxable||0)+(data.output_total_gst||0))]}
            />
          )}

          {tab === "input" && (
            <Table
              headers={["GRN", "Vendor", "Date", "Qty (kg)", "Rate", "GST%", "Taxable", "GST Amt"]}
              rows={(data.input_lines || []).map(r => [
                r.grn_number, r.vendor_name, r.grn_date?.slice(0,10),
                r.net_weight_kg, fmt(r.rate_per_kg), `${r.gst_rate||5}%`, fmt(r.taxable), fmt(r.gst_amount),
              ])}
              totals={["", "", "", "", "", "TOTAL", fmt(data.input_total_taxable), fmt(data.input_total_gst)]}
            />
          )}
        </>
      )}

      {!data && !loading && (
        <div style={{ textAlign: "center", color: "#7da2d6", padding: "60px 0", fontSize: 16 }}>
          Select date range and click <strong style={{ color: "#FFD700" }}>Generate</strong> to view GST summary.
        </div>
      )}
    </div>
  );
}

function Table({ headers, rows, totals }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", background: "#081426" }}>
        <thead><tr>{headers.map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={headers.length} style={{ ...td, textAlign: "center", color: "#7da2d6" }}>No data</td></tr>}
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ ...td, textAlign: j >= 3 ? "right" : "left" }}>{c}</td>)}</tr>)}
          {totals && <tr style={{ background: "#0d1b2f" }}>{totals.map((c, j) => <td key={j} style={{ ...td, fontWeight: "bold", color: "#FFD700", textAlign: j >= 3 ? "right" : "left" }}>{c}</td>)}</tr>}
        </tbody>
      </table>
    </div>
  );
}

function KPI({ title, value, color }) {
  return (
    <div style={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: 10, padding: "18px 20px" }}>
      <div style={{ fontSize: 12, color: "#7da2d6", letterSpacing: 1, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: "bold", color }}>{value}</div>
    </div>
  );
}

const btnStyle = { background: "#FFD700", color: "#111", border: "none", padding: "10px 20px", borderRadius: 6, fontWeight: "bold", cursor: "pointer", fontSize: 14 };
const lbl = { color: "#7da2d6", fontSize: 13, fontWeight: "bold" };
const inp = { background: "#0d1b2f", border: "1px solid #16345d", color: "#fff", padding: "9px 12px", borderRadius: 6, fontSize: 14 };
const th = { padding: "12px 14px", borderBottom: "1px solid #16345d", textAlign: "left", color: "#7da2d6", fontSize: 12, letterSpacing: 1 };
const td = { padding: "10px 14px", borderBottom: "1px solid #0d1b2f", fontSize: 13 };
