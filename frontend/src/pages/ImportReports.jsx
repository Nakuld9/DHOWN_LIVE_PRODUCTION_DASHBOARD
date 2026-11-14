// Import reports + management view (spec §48, §49). A report picker renders each
// report as a table; the management summary sits on top. All live from the API.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const INR = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
// Import invoice/CIF values are in USD (the trade currency); customs & landed cost are INR.
const USD = (n) => "USD " + Math.round(Number(n) || 0).toLocaleString("en-US");
const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB").replace(/\//g, "-") : "—");

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "8px 10px", fontSize: 13, borderTop: "1px solid var(--border)", whiteSpace: "nowrap" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "6px 14px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" });

// Report definitions: key → { label, endpoint, columns:[{h, k, fmt}] }
const money = (v) => INR(v);
// Never show a bare negative day count — a past ETA reads "overdue".
const daysLeft = (v) => (v == null ? "—" : Number(v) < 0 ? "overdue" : `${Number(v)}d`);
const REPORTS = {
  register: { label: "Import Register", ep: "register", cols: [["Import", "import_no"], ["PO", "po_number"], ["Supplier", "supplier"], ["Material", "material"], ["Qty", "quantity"], ["CIF Value", "invoice_value", money], ["Incoterm", "incoterm"], ["ETA", "current_eta", day], ["Status", "status"]] },
  shipments: { label: "Shipment Report", ep: "shipments", cols: [["Import", "import_no"], ["Booking", "booking_number"], ["BL", "bl_number"], ["Line", "shipping_line"], ["ETD", "etd", day], ["ETA", "eta", day], ["Arrived", "actual_arrival", day], ["Delay", "delay_days"], ["Ctrs", "containers"], ["Status", "status"]] },
  "pending-customs": { label: "Pending Customs", ep: "pending-customs", cols: [["Import", "import_no"], ["Supplier", "supplier"], ["BOE", "boe_number"], ["Status", "customs_status"], ["Duty", "customs_duty", money], ["Days pending", "days_pending"]] },
  "pending-documents": { label: "Pending Documents", ep: "pending-documents", cols: [["Import", "import_no"], ["Status", "status"], ["Missing", "missing", (v) => (v || []).join(", ")], ["#", "missing_count"], ["Age (d)", "age_days"]] },
  "expected-arrival": { label: "Expected Arrivals", ep: "expected-arrival", cols: [["Material", "material"], ["Import", "import_no"], ["Qty", "quantity"], ["ETA", "current_eta", day], ["Days left", "days_remaining", daysLeft]] },
  delayed: { label: "Delayed Imports", ep: "delayed", cols: [["Import", "import_no"], ["Material", "material"], ["Qty", "quantity"], ["Value", "invoice_value", money], ["Original ETA", "original_eta", day], ["Current ETA", "current_eta", day], ["Delay (d)", "delay_days"]] },
  "landed-cost": { label: "Landed Cost", ep: "landed-cost", cols: [["Import", "import_no"], ["Material", "material"], ["CIF/kg", "cif_per_kg", money], ["Duty/kg", "duty_per_kg", money], ["Landed/kg", "landed_cost_per_kg", money], ["Total landed", "total_landed_cost", money], ["Actual?", "is_actual", (v) => v ? "actual" : "estimate"]] },
  "cost-variance": { label: "Cost Variance", ep: "cost-variance", cols: [["Import", "import_no"], ["Material", "material"], ["Estimated", "estimated_landed_cost", money], ["Actual", "actual_landed_cost", money], ["Variance", "variance", money], ["%", "variance_pct"]] },
};

export default function ImportReports() {
  const [ms, setMs] = useState(null);
  const [pick, setPick] = useState("register");
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(null);
  const [preview, setPreview] = useState(null); // {import_id,...} voucher preview

  useEffect(() => { fetch(`${API}/api/imports/management-summary`, { headers: auth() }).then(r => r.ok ? r.json() : null).then(setMs).catch(() => { }); }, []);

  const loadBusy = useCallback(() => { fetch(`${API}/api/imports/busy/readiness`, { headers: auth() }).then(r => r.ok ? r.json() : null).then(setBusy).catch(() => { }); }, []);
  useEffect(() => { loadBusy(); }, [loadBusy]);

  const openPreview = async (importId) => {
    const r = await fetch(`${API}/api/imports/${importId}/busy/preview`, { headers: auth() });
    const out = await r.json(); if (r.ok) setPreview({ ...out, import_id: importId });
  };
  const recordRef = async (importId, current) => {
    const ref = window.prompt("Busy voucher reference (blank to clear):", current || "");
    if (ref === null) return;
    const r = await fetch(`${API}/api/imports/${importId}/busy/posted`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ busy_posted_ref: ref }) });
    if (r.ok) { setPreview(null); loadBusy(); }
  };

  const loadReport = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch(`${API}/api/imports/reports/${REPORTS[pick].ep}`, { headers: auth() });
      if (!r.ok) throw new Error((await r.json()).error || `Failed (${r.status})`);
      setRows(await r.json());
    } catch (e) { setErr(e.message); setRows([]); }
  }, [pick]);
  useEffect(() => { loadReport(); }, [loadReport]);

  const cols = REPORTS[pick].cols;
  return (
    <div style={{ padding: 20, color: "var(--text)", display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ margin: 0, fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase" }}>📑 Import Reports & Management</h2>

      {/* Management summary */}
      {ms && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            {[["CIF value in transit", USD(ms.cif_value_in_transit)], ["Customs value", INR(ms.customs_value)], ["Value due this week", USD(ms.value_expected_this_week)], ["Value due this month", USD(ms.value_expected_this_month)], ["Qty in transit", ms.qty_in_transit], ["Qty at port", ms.qty_at_port], ["Qty in customs", ms.qty_in_customs], ["Qty delivered", ms.qty_delivered], ["Shortage risks", ms.material_shortage_risks]].map(([t, v]) => (
              <div key={t} style={{ ...card, padding: 12 }}><div style={label}>{t}</div><div style={{ fontSize: 18, fontWeight: 800, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{v}</div></div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={card}>
              <div style={{ ...label, marginBottom: 8 }}>Top materials in transit</div>
              {!ms.top_materials_in_transit?.length ? <div style={{ color: "var(--muted)", fontSize: 13 }}>None.</div> :
                ms.top_materials_in_transit.map((m, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}><span>{m.material || "—"}</span><span>{m.qty} · {USD(m.value)}</span></div>)}
            </div>
            <div style={card}>
              <div style={{ ...label, marginBottom: 8 }}>Suppliers with active shipments</div>
              {!ms.suppliers_active?.length ? <div style={{ color: "var(--muted)", fontSize: 13 }}>None.</div> :
                ms.suppliers_active.map((s, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}><span>{s.supplier}</span><span>{s.shipments} · {USD(s.value)}</span></div>)}
            </div>
          </div>
        </>
      )}

      {/* Busy posting readiness — MES never writes to Busy */}
      {busy && (
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <div style={label}>Busy posting readiness</div>
            <div style={{ fontSize: 11, color: "var(--gold-2)", maxWidth: 620, textAlign: "right" }}>{busy.reason}</div>
          </div>
          <div style={{ display: "flex", gap: 20, margin: "10px 0 12px" }}>
            {[["Ready to post", busy.counts.ready_to_post], ["Awaiting actual cost", busy.counts.awaiting_actual], ["Posted in Busy", busy.counts.posted]].map(([t, v]) => (
              <div key={t}><div style={{ ...label, fontSize: 10 }}>{t}</div><div style={{ fontSize: 20, fontWeight: 800 }}>{v}</div></div>
            ))}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
              <thead><tr>{["Import", "Supplier", "Material", "Landed cost", "State", "Busy ref", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {[...busy.ready_to_post, ...busy.awaiting_actual, ...busy.posted].map(r => (
                  <tr key={r.import_id}>
                    <td style={{ ...td, color: "var(--yellow)" }}>{r.import_no}</td>
                    <td style={td}>{r.supplier || "—"}</td><td style={td}>{r.material || "—"}</td>
                    <td style={td}>{INR(r.landed_cost)}</td>
                    <td style={td}>{r.busy_posted_ref ? "posted" : r.is_actual ? "ready" : "estimate"}</td>
                    <td style={td}>{r.busy_posted_ref || "—"}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <button onClick={() => openPreview(r.import_id)} style={{ ...btn("var(--bg)", "var(--text)"), padding: "4px 10px", marginRight: 6 }}>Preview</button>
                      <button onClick={() => recordRef(r.import_id, r.busy_posted_ref)} style={{ ...btn("var(--bg)", "var(--muted)"), padding: "4px 10px" }}>{r.busy_posted_ref ? "Edit ref" : "Mark posted"}</button>
                    </td>
                  </tr>
                ))}
                {![...busy.ready_to_post, ...busy.awaiting_actual, ...busy.posted].length && <tr><td colSpan={7} style={{ ...td, color: "var(--muted)" }}>No costed imports yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Report picker */}
      <div style={{ ...card, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {Object.entries(REPORTS).map(([k, r]) => (
          <button key={k} onClick={() => setPick(k)} style={btn(pick === k ? "var(--yellow)" : "var(--bg)", pick === k ? "#000" : "var(--muted)")}>{r.label}</button>
        ))}
      </div>

      <div style={{ ...card, overflowX: "auto" }}>
        <div style={{ ...label, marginBottom: 10 }}>{REPORTS[pick].label} · {rows.length} row(s)</div>
        {err && <div style={{ color: "var(--crit)", fontSize: 13 }}>{err}</div>}
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
          <thead><tr>{cols.map(c => <th key={c[1]} style={th}>{c[0]}</th>)}</tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={cols.length} style={{ ...td, color: "var(--muted)" }}>No data.</td></tr>}
            {rows.map((row, i) => (
              <tr key={i}>{cols.map(c => <td key={c[1]} style={td}>{c[2] ? c[2](row[c[1]]) : (row[c[1]] ?? "—")}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>

      {preview && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setPreview(null)}>
          <div style={{ ...card, width: 620, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h3 style={{ margin: 0 }}>Busy voucher preview · {preview.import?.import_no}</h3>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: preview.ready ? "var(--green-dim)" : "var(--crit-dim)", color: preview.ready ? "var(--green)" : "var(--gold-2)" }}>{preview.ready ? "ready (actual)" : "estimate — finalise first"}</span>
            </div>
            <div style={{ ...label, fontSize: 10, margin: "8px 0" }}>{preview.import?.supplier} · {preview.import?.material} · {preview.import?.incoterm}</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Ledger", "Dr", "Cr"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {(preview.lines || []).map((l, i) => (
                  <tr key={i}>
                    <td style={td}><div>{l.ledger}</div><div style={{ fontSize: 10, color: "var(--muted)" }}>{l.basis}</div></td>
                    <td style={{ ...td, textAlign: "right" }}>{l.type === "DR" ? INR(l.amount) : ""}</td>
                    <td style={{ ...td, textAlign: "right" }}>{l.type === "CR" ? INR(l.amount) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ fontWeight: 800 }}>
                <td style={{ ...td, borderTop: "2px solid var(--border)" }}>Total {preview.totals?.balanced ? "(balanced)" : ""}</td>
                <td style={{ ...td, borderTop: "2px solid var(--border)", textAlign: "right" }}>{INR(preview.totals?.debit)}</td>
                <td style={{ ...td, borderTop: "2px solid var(--border)", textAlign: "right" }}>{INR(preview.totals?.credit)}</td>
              </tr></tfoot>
            </table>
            {(preview.notes || []).map((n, i) => <div key={i} style={{ fontSize: 11, color: i === 0 ? "var(--gold-2)" : "var(--muted)", marginTop: 6 }}>• {n}</div>)}

            {/* Advance payment vouchers (posted at booking, separate from the purchase voucher) */}
            {(preview.advance_vouchers || []).length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <div style={{ ...label, marginBottom: 8 }}>Advance payment voucher(s) · total {INR(preview.advance_total_inr)}</div>
                {preview.advance_vouchers.map((v, vi) => (
                  <div key={vi} style={{ ...card, padding: 10, marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{v.tt_reference || "TT"} · {day(v.tt_date)} · {v.bank || ""}{v.busy_ref ? ` · Busy ${v.busy_ref}` : ""}</div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <tbody>
                        {v.lines.map((l, li) => (
                          <tr key={li}>
                            <td style={{ ...td, borderTop: li ? "1px solid var(--border)" : "none" }}><div>{l.ledger}</div><div style={{ fontSize: 10, color: "var(--muted)" }}>{l.basis}</div></td>
                            <td style={{ ...td, borderTop: li ? "1px solid var(--border)" : "none", textAlign: "right" }}>{l.type === "DR" ? INR(l.amount) : ""}</td>
                            <td style={{ ...td, borderTop: li ? "1px solid var(--border)" : "none", textAlign: "right" }}>{l.type === "CR" ? INR(l.amount) : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setPreview(null)} style={btn("var(--bg)", "var(--text)")}>Close</button>
              <button onClick={() => recordRef(preview.import_id, preview.busy_posted_ref)} style={btn("var(--yellow)", "#000")}>{preview.busy_posted_ref ? "Edit Busy ref" : "Mark posted in Busy"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
