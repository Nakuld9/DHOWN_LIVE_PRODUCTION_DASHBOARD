// ITC-04 — job-work GST return (goods sent to / received back from job workers).
// Half-yearly for turnover > Rs 5 cr. Prepares Table 4 (sent) + Table 5A
// (received back) from the MES's dye-house challans; file on the GST portal.
import React, { useState, useCallback } from "react";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB").split("/").join("-") : "—");
const kg = (n) => (n == null ? "—" : `${Number(n).toLocaleString("en-IN")} kg`);
const inr = (n) => (n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 }));

export default function ITC04() {
  const [params, setParams] = useState({ from: "", to: "", hsn: "6006", goods_rate_per_kg: "" });
  const [data, setData] = useState(null);
  const [state, setState] = useState("idle");

  const run = useCallback(async () => {
    setState("loading");
    try {
      const q = new URLSearchParams();
      if (params.from) q.set("from", params.from);
      if (params.to) q.set("to", params.to);
      if (params.hsn) q.set("hsn", params.hsn);
      if (params.goods_rate_per_kg) q.set("goods_rate_per_kg", params.goods_rate_per_kg);
      const r = await fetch(`/api/itc04?${q}`, { headers: auth() });
      if (r.status === 403) { setState("forbidden"); return; }
      if (!r.ok) { setState("error"); return; }
      setData(await r.json()); setState("ok");
    } catch { setState("error"); }
  }, [params]);

  // auto-run once on mount
  React.useEffect(() => { run(); }, []);

  const exportCSV = (which) => {
    if (!data) return;
    let head, lines, name;
    if (which === "4") {
      head = ["JW GSTIN", "JW name", "Challan no", "Challan date", "Description", "HSN", "UQC", "Qty", "Type", "Taxable value"];
      lines = data.table4.map((r) => [r.jw_gstin, r.jw_name, r.challan_no, day(r.challan_date), r.description, r.hsn, r.uqc, r.quantity, r.goods_type, r.taxable_value]);
      name = "ITC04-Table4-sent";
    } else {
      head = ["JW GSTIN", "JW name", "Orig challan no", "Orig date", "Received date", "Description", "HSN", "UQC", "Qty received", "Rejected", "Loss/waste", "Nature"];
      lines = data.table5a.map((r) => [r.jw_gstin, r.jw_name, r.orig_challan_no, day(r.orig_challan_date), day(r.received_date), r.description, r.hsn, r.uqc, r.quantity_received, r.rejected, r.loss_waste, r.nature]);
      name = "ITC04-Table5A-received";
    }
    const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const csv = [head.map(esc).join(","), ...lines.map((l) => l.map(esc).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `${name}.csv`; a.click();
  };

  const page = { padding: "22px 26px", maxWidth: 1200, margin: "0 auto" };
  const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow)", padding: 18 };
  const inp = { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, color: "var(--text)" };
  const lbl = { fontSize: 11, color: "var(--muted)", marginBottom: 3, display: "block" };
  const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 10.5, fontWeight: 700, borderBottom: "2px solid var(--border)", whiteSpace: "nowrap", position: "sticky", top: 0, background: "var(--surface)" };
  const td = { padding: "7px 10px", fontSize: 12.5, borderTop: "1px solid var(--border-soft)", whiteSpace: "nowrap" };
  const btn = (bg, fg, bd) => ({ font: "inherit", fontSize: 12.5, fontWeight: 700, color: fg, background: bg, border: `1px solid ${bd}`, borderRadius: 7, padding: "8px 14px", cursor: "pointer" });

  const Section = ({ title, onCsv, cols, rows, render, empty }) => (
    <div style={{ ...card, padding: 0, marginBottom: 18, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border-soft)" }}>
        <b style={{ color: "var(--text)", fontSize: 14 }}>{title}</b>
        <span style={{ marginLeft: 8, color: "var(--faint)", fontSize: 12 }}>{rows.length} row{rows.length === 1 ? "" : "s"}</span>
        <div style={{ flex: 1 }} />
        {rows.length > 0 && <button style={btn("var(--green-dim)", "var(--green-deep)", "var(--green-edge)")} onClick={onCsv}>⬇ CSV</button>}
      </div>
      {rows.length === 0 ? <div style={{ padding: 18, color: "var(--muted)", fontSize: 13 }}>{empty}</div> : (
        <div style={{ overflowX: "auto", maxHeight: "50vh" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
            <thead><tr>{cols.map((c) => <th key={c} style={th}>{c}</th>)}</tr></thead>
            <tbody>{rows.map(render)}</tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div style={page}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: "0 0 4px" }}>🧾 ITC-04 — Job-work Return</h1>
      <div style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 18 }}>
        Goods sent to and received back from job workers (dye house / finishers). Half-yearly for turnover &gt; ₹5 cr.
        The MES prepares it; file on the GST portal.
      </div>

      <div style={{ ...card, marginBottom: 18, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><span style={lbl}>From</span><input type="date" style={inp} value={params.from} onChange={(e) => setParams({ ...params, from: e.target.value })} /></div>
        <div><span style={lbl}>To</span><input type="date" style={inp} value={params.to} onChange={(e) => setParams({ ...params, to: e.target.value })} /></div>
        <div><span style={lbl}>HSN</span><input style={{ ...inp, width: 90 }} value={params.hsn} onChange={(e) => setParams({ ...params, hsn: e.target.value })} /></div>
        <div><span style={lbl}>Goods value ₹/kg (optional)</span><input type="number" style={{ ...inp, width: 150 }} value={params.goods_rate_per_kg} onChange={(e) => setParams({ ...params, goods_rate_per_kg: e.target.value })} placeholder="e.g. 180" /></div>
        <button style={btn("var(--green)", "var(--on-green)", "var(--green)")} onClick={run}>Generate</button>
        {!params.from && <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Blank dates = current half-year</span>}
      </div>

      {state === "loading" && <div style={card}>Generating…</div>}
      {state === "forbidden" && <div style={card}>You don't have access to ITC-04.</div>}
      {state === "error" && <div style={{ ...card, color: "var(--crit)" }}>Couldn't generate the report.</div>}

      {state === "ok" && data && (
        <>
          <div style={{ ...card, marginBottom: 18, display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
            <div><div style={lbl}>Period</div><b style={{ color: "var(--text)" }}>{data.period.half} · {day(data.period.from)} → {day(data.period.to)}</b></div>
            {data.period.due && <div><div style={lbl}>Due</div><b style={{ color: "var(--gold-deep)" }}>{day(data.period.due)}</b></div>}
            <div><div style={lbl}>Sent</div><b>{data.totals.sent_challans} challans · {kg(data.totals.sent_qty)}</b></div>
            <div><div style={lbl}>Received back</div><b>{kg(data.totals.received_qty)}</b></div>
            <div><div style={lbl}>Loss/waste</div><b>{kg(data.totals.loss_qty)}</b></div>
            {data.totals.sent_value != null && <div><div style={lbl}>Sent value</div><b>{inr(data.totals.sent_value)}</b></div>}
          </div>

          {data.deemed_supply_risk.length > 0 && (
            <div style={{ ...card, marginBottom: 18, borderColor: "var(--crit-edge)", background: "var(--crit-dim)" }}>
              <b style={{ color: "var(--crit)" }}>⚠ Deemed-supply risk ({data.deemed_supply_risk.length})</b>
              <div style={{ fontSize: 12.5, color: "var(--text)", marginTop: 6 }}>Job-work sent over 1 year ago, not yet received back — tax may become payable:</div>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {data.deemed_supply_risk.slice(0, 8).map((x) => (
                  <div key={x.challan_no} style={{ fontSize: 12.5, color: "var(--text)" }}>
                    <b>{x.challan_no}</b> · {day(x.challan_date)} · {x.vendor || "—"} · pending <b>{kg(x.pending_kg)}</b> · {x.days_since}d
                  </div>
                ))}
              </div>
            </div>
          )}

          <Section title="Table 4 — Goods sent to job worker" onCsv={() => exportCSV("4")}
            cols={["JW GSTIN", "Challan", "Date", "Description", "HSN", "Qty", "Type", "Taxable value"]}
            rows={data.table4} empty="No job-work goods sent in this period."
            render={(r) => (
              <tr key={r.challan_no}>
                <td style={td}>{r.jw_gstin || <span style={{ color: "var(--crit)" }}>missing</span>}</td>
                <td style={{ ...td, fontFamily: "var(--mono)" }}>{r.challan_no}</td>
                <td style={td}>{day(r.challan_date)}</td>
                <td style={td}>{r.description}</td>
                <td style={td}>{r.hsn}</td>
                <td style={{ ...td, textAlign: "right" }}>{kg(r.quantity)}</td>
                <td style={td}>{r.goods_type}</td>
                <td style={{ ...td, textAlign: "right" }}>{r.taxable_value == null ? "—" : inr(r.taxable_value)}</td>
              </tr>
            )} />

          <Section title="Table 5A — Goods received back from job worker" onCsv={() => exportCSV("5a")}
            cols={["JW GSTIN", "Orig challan", "Received", "Description", "HSN", "Qty back", "Rejected", "Loss", "Nature"]}
            rows={data.table5a} empty="No job-work goods received back in this period."
            render={(r) => (
              <tr key={r.orig_challan_no + r.received_date}>
                <td style={td}>{r.jw_gstin || <span style={{ color: "var(--crit)" }}>missing</span>}</td>
                <td style={{ ...td, fontFamily: "var(--mono)" }}>{r.orig_challan_no}</td>
                <td style={td}>{day(r.received_date)}</td>
                <td style={td}>{r.description}</td>
                <td style={td}>{r.hsn}</td>
                <td style={{ ...td, textAlign: "right" }}>{kg(r.quantity_received)}</td>
                <td style={{ ...td, textAlign: "right" }}>{kg(r.rejected)}</td>
                <td style={{ ...td, textAlign: "right", color: r.loss_waste > 0 ? "var(--gold-deep)" : "var(--muted)" }}>{kg(r.loss_waste)}</td>
                <td style={td}>{r.nature}</td>
              </tr>
            )} />

          <div style={{ ...card, background: "var(--gold-dim)", borderColor: "var(--gold-edge)", fontSize: 12.5, color: "var(--text)" }}>
            <b>Notes:</b>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
              {data.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
