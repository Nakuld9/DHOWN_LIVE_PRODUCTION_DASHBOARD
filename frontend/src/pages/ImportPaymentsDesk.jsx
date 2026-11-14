// Import Payments Desk (spec §35) — a global view of every import payment (TT),
// each at its own rate, with allocation across imports (one advance can cover 2-3
// containers). Read a bank TT advice to draft a payment; then split it across
// imports. Nothing posts to Busy. Dates DD-MM-YYYY.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });
const INR = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB").replace(/\//g, "-") : "—");
const n2 = (v) => (v == null || v === "" || isNaN(Number(v)) ? 0 : Number(v));

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };
const inp = { background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 9px", fontSize: 13, boxSizing: "border-box" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" });
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "8px 10px", fontSize: 13, borderTop: "1px solid var(--border)", whiteSpace: "nowrap" };

export default function ImportPaymentsDesk() {
  const [rows, setRows] = useState([]);
  const [imports, setImports] = useState([]);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [editAlloc, setEditAlloc] = useState(null); // {payment, allocations}
  const [payables, setPayables] = useState({ rows: [], totals: {} });
  const [rate, setRate] = useState(() => { try { return Number(localStorage.getItem("dhown_inr_rate")) || 96; } catch { return 96; } });
  const [showPaid, setShowPaid] = useState(false);

  const load = useCallback(() => {
    fetch(`${API}/api/imports/payments/all`, { headers: auth() }).then(r => r.json()).then(d => setRows(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${API}/api/imports?limit=500`, { headers: auth() }).then(r => r.json()).then(d => setImports(d.rows || [])).catch(() => {});
    fetch(`${API}/api/imports/payments/payables`, { headers: auth() }).then(r => r.json()).then(d => setPayables(d && d.rows ? d : { rows: [], totals: {} })).catch(() => {});
  }, []);
  const setRateP = (v) => { setRate(v); try { localStorage.setItem("dhown_inr_rate", String(v)); } catch {} };
  useEffect(() => { load(); }, [load]);

  const del = async (pid) => {
    if (!window.confirm("Delete this payment and its allocations?")) return;
    const r = await fetch(`${API}/api/imports/payments/${pid}`, { method: "DELETE", headers: auth() });
    if (r.ok) load();
  };
  const openAlloc = async (pid) => {
    const r = await fetch(`${API}/api/imports/payments/${pid}`, { headers: auth() });
    if (r.ok) setEditAlloc(await r.json());
  };

  return (
    <div style={{ padding: 20, color: "var(--text)", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase" }}>💱 Import Payments Desk</h2>
        <button onClick={() => setAdding(true)} style={btn("var(--yellow)", "#000")}>+ Add payment</button>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 13, marginTop: -8 }}>Every TT at its own exchange rate. An advance covering several containers is split across imports here. Nothing posts to Busy.</div>
      {err && <div style={{ color: "var(--crit)", fontSize: 13 }}>{err}</div>}

      {/* ── Live payables dashboard — outstanding balance per import ── */}
      {(() => {
        const all = payables.rows || [];
        const due = all.filter(r => !r.fully_paid);
        const shown = showPaid ? all : due;
        const t = payables.totals || {};
        const outFc = Number(t.outstanding_fc) || 0;
        const paidFc = Number(t.paid_fc) || 0, invFc = Number(t.invoice_fc) || 0;
        return (
          <div style={{ ...card }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
              <div style={label}>📊 Import payables — outstanding balances</div>
              <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={showPaid} onChange={e => setShowPaid(e.target.checked)} /> show fully paid
                </label>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
                  INR @ ₹<input type="number" value={rate} onChange={e => setRateP(Number(e.target.value) || 0)} style={{ ...inp, width: 70, padding: "4px 7px" }} />/USD
                </label>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
              {[["Total invoiced", invFc], ["Advances paid", paidFc], ["Balance due", outFc]].map(([k, v], i) => (
                <div key={k} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                  <div style={{ ...label, fontSize: 10 }}>{k}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: i === 2 ? "var(--gold-2)" : "var(--text)" }}>USD {Math.round(v).toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{INR(v * rate)}</div>
                </div>
              ))}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                <thead><tr>{["Import", "Supplier", "Incoterm", "Invoice (USD)", "Paid (USD)", "Balance (USD)", "Balance (₹ @" + rate + ")", "Status"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {!shown.length && <tr><td colSpan={8} style={{ ...td, color: "var(--muted)" }}>{all.length ? "All imports fully paid 🎉" : "No open imports."}</td></tr>}
                  {shown.map(r => (
                    <tr key={r.import_id}>
                      <td style={{ ...td, fontWeight: 700 }}>{r.import_no}<div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 400 }}>{r.invoice_ref || "—"}</div></td>
                      <td style={td}>{r.supplier || "—"}</td>
                      <td style={td}>{r.incoterm}</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Math.round(r.invoice_fc).toLocaleString()}</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Math.round(r.paid_fc).toLocaleString()}</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.fully_paid ? "var(--green)" : "var(--gold-2)", fontWeight: 700 }}>{Math.round(r.outstanding_fc).toLocaleString()}</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{INR(r.outstanding_fc * rate)}</td>
                      <td style={td}>{r.fully_paid ? <span style={{ color: "var(--green)", fontSize: 12, fontWeight: 600 }}>PAID</span> : <span style={{ color: "var(--gold-2)", fontSize: 12, fontWeight: 600 }}>{String(r.status).replace(/_/g, " ")}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      <div style={{ ...card, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
          <thead><tr>{["Kind", "TT ref", "Date", "Currency", "Amount (FC)", "Rate", "Amount (INR)", "Allocated", "Unallocated", "Imports", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={11} style={{ ...td, color: "var(--muted)" }}>No payments yet.</td></tr>}
            {rows.map(p => {
              const unalloc = n2(p.unallocated_fc);
              return (
                <tr key={p.payment_id}>
                  <td style={td}>{p.kind}</td>
                  <td style={td}>{p.tt_reference || "—"}</td>
                  <td style={td}>{day(p.tt_date)}</td>
                  <td style={td}>{p.currency}</td>
                  <td style={td}>{Number(p.amount_fc).toLocaleString("en-IN")}</td>
                  <td style={td}>₹{p.exchange_rate}</td>
                  <td style={td}>{INR(p.amount_inr)}</td>
                  <td style={td}>{p.currency} {Number(p.allocated_fc_total).toLocaleString("en-IN")}</td>
                  <td style={{ ...td, color: unalloc > 0.01 ? "var(--gold-2)" : "var(--muted)" }}>{p.currency} {unalloc.toLocaleString("en-IN")}</td>
                  <td style={td}>{p.import_count}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button onClick={() => openAlloc(p.payment_id)} style={{ ...btn("var(--bg)", "var(--text)"), padding: "4px 10px", marginRight: 6 }}>Allocate</button>
                    <button onClick={() => del(p.payment_id)} style={{ ...btn("var(--bg)", "var(--crit)"), padding: "4px 10px" }}>Del</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {adding && <AddPayment imports={imports} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} setErr={setErr} />}
      {editAlloc && <AllocateModal data={editAlloc} imports={imports} onClose={() => setEditAlloc(null)} onSaved={() => { setEditAlloc(null); load(); }} />}
    </div>
  );
}

// ── Add a standalone payment (with TT-advice read) ────────────────────────────
function AddPayment({ imports, onClose, onSaved, setErr }) {
  const empty = { kind: "ADVANCE", amount_fc: "", currency: "USD", exchange_rate: "", amount_inr: "", swift_charges: "", advance_import_charges: "", fx_conversion_charges: "", bank_charges: "", tt_reference: "", tt_date: "", bank: "", invoice_ref: "" };
  const [form, setForm] = useState(empty);
  const [allocs, setAllocs] = useState([{ import_id: "", allocated_fc: "", allocated_inr: "" }]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const readTT = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); setNote("");
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
      const r = await fetch(`${API}/api/imports/payments/analyze-tt`, { method: "POST", headers: jsonH(), body: JSON.stringify({ file: { file_name: file.name, file_data: b64 } }) });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || "Could not read TT");
      const d = out.payment_draft || {}, tt = out.tt || {};
      setForm(f => ({ ...f, kind: d.kind || "ADVANCE", amount_fc: d.amount_fc ?? "", currency: d.currency || "USD", exchange_rate: d.exchange_rate ?? "", amount_inr: d.amount_inr ?? "", swift_charges: d.swift_charges ?? "", advance_import_charges: d.advance_import_charges ?? "", fx_conversion_charges: d.fx_conversion_charges ?? "", bank_charges: d.bank_charges ?? "", tt_reference: d.tt_reference || "", tt_date: d.tt_date || "", bank: d.bank || "", invoice_ref: tt.invoice_ref || "" }));
      setNote(`Read by ${out.read_by || "AI"}${tt.beneficiary_name ? ` · beneficiary: ${tt.beneficiary_name}` : ""}${tt.invoice_ref ? ` · invoice ${tt.invoice_ref}` : ""}`);
    } catch (e) { setNote("⚠ " + e.message); }
    setBusy(false);
  };

  const setAlloc = (i, k, v) => setAllocs(a => a.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const allocations = allocs.filter(a => a.import_id && (n2(a.allocated_fc) || n2(a.allocated_inr)))
        .map(a => ({ import_id: Number(a.import_id), allocated_fc: n2(a.allocated_fc), allocated_inr: n2(a.allocated_inr) }));
      const r = await fetch(`${API}/api/imports/payments`, { method: "POST", headers: jsonH(), body: JSON.stringify({ ...form, allocations }) });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || "Save failed");
      onSaved();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title="Add payment (TT)">
      <div style={{ marginBottom: 10 }}>
        <label style={{ ...btn("var(--bg)", "var(--text)"), display: "inline-block" }}>📄 Read a bank TT advice (PDF)
          <input type="file" accept="application/pdf" onChange={readTT} style={{ display: "none" }} /></label>
        {note && <div style={{ fontSize: 12, color: note.includes("⚠") ? "var(--gold-2)" : "var(--muted)", marginTop: 6 }}>{note}</div>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
        <select style={inp} value={form.kind} onChange={e => set("kind", e.target.value)}>{["ADVANCE", "BALANCE", "OTHER"].map(k => <option key={k}>{k}</option>)}</select>
        <input style={inp} placeholder="Amount (FC)" value={form.amount_fc} onChange={e => set("amount_fc", e.target.value)} />
        <input style={inp} placeholder="Currency" value={form.currency} onChange={e => set("currency", e.target.value)} />
        <input style={inp} placeholder="Exchange rate" value={form.exchange_rate} onChange={e => set("exchange_rate", e.target.value)} />
        <input style={inp} placeholder="Amount (INR)" value={form.amount_inr} onChange={e => set("amount_inr", e.target.value)} />
        <input style={inp} placeholder="SWIFT/remittance chg (INR)" title="Remittance / SWIFT charges" value={form.swift_charges} onChange={e => set("swift_charges", e.target.value)} />
        <input style={inp} placeholder="Fgn advance import chg (INR)" title="Foreign advance import charges" value={form.advance_import_charges} onChange={e => set("advance_import_charges", e.target.value)} />
        <input style={inp} placeholder="FX conversion chg (INR)" title="Foreign currency conversion charges" value={form.fx_conversion_charges} onChange={e => set("fx_conversion_charges", e.target.value)} />
        <input style={inp} placeholder="Other bank charges (INR)" value={form.bank_charges} onChange={e => set("bank_charges", e.target.value)} />
        <input style={inp} placeholder="TT reference" value={form.tt_reference} onChange={e => set("tt_reference", e.target.value)} />
        <input style={inp} type="date" value={form.tt_date} onChange={e => set("tt_date", e.target.value)} />
        <input style={inp} placeholder="Bank" value={form.bank} onChange={e => set("bank", e.target.value)} />
        <input style={inp} placeholder="Invoice ref" value={form.invoice_ref} onChange={e => set("invoice_ref", e.target.value)} />
      </div>
      <div style={{ ...label, fontSize: 10, margin: "14px 0 6px" }}>Allocate to imports (leave blank to allocate later)</div>
      {allocs.map((a, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, marginBottom: 6 }}>
          <select style={inp} value={a.import_id} onChange={e => setAlloc(i, "import_id", e.target.value)}>
            <option value="">— import —</option>
            {imports.map(im => <option key={im.import_id} value={im.import_id}>{im.import_no} · {im.supplier || ""} · {im.currency} {Number(im.invoice_value).toLocaleString("en-IN")}</option>)}
          </select>
          <input style={inp} placeholder="FC" value={a.allocated_fc} onChange={e => setAlloc(i, "allocated_fc", e.target.value)} />
          <input style={inp} placeholder="INR" value={a.allocated_inr} onChange={e => setAlloc(i, "allocated_inr", e.target.value)} />
          <button onClick={() => setAllocs(x => x.filter((_, j) => j !== i))} style={{ ...btn("var(--bg)", "var(--crit)"), padding: "4px 10px" }}>✕</button>
        </div>
      ))}
      <button onClick={() => setAllocs(a => [...a, { import_id: "", allocated_fc: "", allocated_inr: "" }])} style={{ ...btn("var(--bg)", "var(--text)"), padding: "4px 10px", fontSize: 12 }}>+ another import</button>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btn("var(--bg)", "var(--text)")}>Cancel</button>
        <button onClick={save} disabled={busy} style={{ ...btn("var(--yellow)", "#000"), opacity: busy ? 0.5 : 1 }}>{busy ? "Working…" : "Save payment"}</button>
      </div>
    </Modal>
  );
}

// ── Re-allocate an existing payment across imports ────────────────────────────
function AllocateModal({ data, imports, onClose, onSaved }) {
  const pay = data.payment;
  const [allocs, setAllocs] = useState(data.allocations.length ? data.allocations.map(a => ({ import_id: String(a.import_id), allocated_fc: a.allocated_fc, allocated_inr: a.allocated_inr })) : [{ import_id: "", allocated_fc: "", allocated_inr: "" }]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const setAlloc = (i, k, v) => setAllocs(a => a.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const sumFc = allocs.reduce((s, a) => s + n2(a.allocated_fc), 0);

  const save = async () => {
    setBusy(true); setErr("");
    try {
      const allocations = allocs.filter(a => a.import_id && (n2(a.allocated_fc) || n2(a.allocated_inr)))
        .map(a => ({ import_id: Number(a.import_id), allocated_fc: n2(a.allocated_fc), allocated_inr: n2(a.allocated_inr) }));
      const r = await fetch(`${API}/api/imports/payments/${pay.payment_id}/allocations`, { method: "PATCH", headers: jsonH(), body: JSON.stringify({ allocations }) });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || "Save failed");
      onSaved();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title={`Allocate ${pay.tt_reference || "payment"} · ${pay.currency} ${Number(pay.amount_fc).toLocaleString("en-IN")} @ ₹${pay.exchange_rate}`}>
      <div style={{ fontSize: 12, color: sumFc - Number(pay.amount_fc) > 0.01 ? "var(--crit)" : "var(--muted)", marginBottom: 10 }}>
        Allocated {pay.currency} {sumFc.toLocaleString("en-IN")} of {Number(pay.amount_fc).toLocaleString("en-IN")} · remaining {(Number(pay.amount_fc) - sumFc).toLocaleString("en-IN")}
      </div>
      {allocs.map((a, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, marginBottom: 6 }}>
          <select style={inp} value={a.import_id} onChange={e => setAlloc(i, "import_id", e.target.value)}>
            <option value="">— import —</option>
            {imports.map(im => <option key={im.import_id} value={im.import_id}>{im.import_no} · {im.supplier || ""}</option>)}
          </select>
          <input style={inp} placeholder="FC" value={a.allocated_fc} onChange={e => setAlloc(i, "allocated_fc", e.target.value)} />
          <input style={inp} placeholder="INR" value={a.allocated_inr} onChange={e => setAlloc(i, "allocated_inr", e.target.value)} />
          <button onClick={() => setAllocs(x => x.filter((_, j) => j !== i))} style={{ ...btn("var(--bg)", "var(--crit)"), padding: "4px 10px" }}>✕</button>
        </div>
      ))}
      <button onClick={() => setAllocs(a => [...a, { import_id: "", allocated_fc: "", allocated_inr: "" }])} style={{ ...btn("var(--bg)", "var(--text)"), padding: "4px 10px", fontSize: 12 }}>+ another import</button>
      {err && <div style={{ color: "var(--crit)", fontSize: 13, marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btn("var(--bg)", "var(--text)")}>Cancel</button>
        <button onClick={save} disabled={busy} style={{ ...btn("var(--yellow)", "#000"), opacity: busy ? 0.5 : 1 }}>{busy ? "Saving…" : "Save allocation"}</button>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }} onClick={onClose}>
      <div style={{ ...card, width: 680, maxWidth: "96vw", maxHeight: "92vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
