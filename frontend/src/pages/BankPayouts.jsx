// Supplier Payments — Host-to-host (H2H) outbound, DRAFT-ONLY.
//
// The MES generates a bank-uploadable payment file (pain.001 or CSV). It NEVER
// sends money: you upload the file to your bank's H2H portal, where the bank's
// maker-checker approves the debit. A beneficiary must be APPROVED before it can be
// paid. This page manages beneficiaries and builds / downloads payment batches.
import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });
const INR = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" };
const inp = { background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 9px", fontSize: 13, boxSizing: "border-box" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 7, padding: "6px 12px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" });
const th = { padding: "7px 9px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "7px 9px", fontSize: 13, borderTop: "1px solid var(--border)" };
const STB = { DRAFT: "var(--muted)", GENERATED: "var(--gold)", RELEASED: "var(--green)", CANCELLED: "var(--muted)" };

export default function BankPayouts() {
  const [bens, setBens] = useState([]);
  const [accts, setAccts] = useState([]);
  const [batches, setBatches] = useState([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [nb, setNb] = useState({ beneficiary_name: "", account_no: "", ifsc: "", bank_name: "" });
  const [batch, setBatch] = useState({ from_account_id: "", payment_method: "NEFT", value_date: "", lines: [{ beneficiary_id: "", amount: "", purpose: "", invoice_ref: "" }] });

  const flash = (m) => { setMsg(m); setErr(""); setTimeout(() => setMsg(""), 6000); };
  const load = useCallback(async () => {
    try {
      const [b, a, bt] = await Promise.all([
        fetch(`${API}/api/bank/beneficiaries`, { headers: auth() }).then(r => r.json()),
        fetch(`${API}/api/bank/accounts`, { headers: auth() }).then(r => r.json()),
        fetch(`${API}/api/bank/payouts`, { headers: auth() }).then(r => r.json()),
      ]);
      setBens(Array.isArray(b) ? b : []); setAccts(Array.isArray(a) ? a : []); setBatches(Array.isArray(bt) ? bt : []);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const addBen = async () => {
    const r = await fetch(`${API}/api/bank/beneficiaries`, { method: "POST", headers: jsonH(), body: JSON.stringify(nb) });
    const j = await r.json();
    if (r.ok) { flash(`Beneficiary added — approve it before paying.`); setNb({ beneficiary_name: "", account_no: "", ifsc: "", bank_name: "" }); load(); }
    else setErr(j.error || "Failed");
  };
  const approveBen = async (id) => {
    if (!window.confirm("Approve this beneficiary's bank details? Once approved it can be paid.")) return;
    const r = await fetch(`${API}/api/bank/beneficiaries/${id}/approve`, { method: "POST", headers: jsonH() });
    if (r.ok) { flash("Beneficiary approved."); load(); } else setErr((await r.json()).error || "Failed");
  };

  const setLine = (i, k, v) => setBatch(b => ({ ...b, lines: b.lines.map((l, j) => j === i ? { ...l, [k]: v } : l) }));
  const addLine = () => setBatch(b => ({ ...b, lines: [...b.lines, { beneficiary_id: "", amount: "", purpose: "", invoice_ref: "" }] }));
  const delLine = (i) => setBatch(b => ({ ...b, lines: b.lines.filter((_, j) => j !== i) }));
  const batchTotal = batch.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  const createBatch = async () => {
    const lines = batch.lines.filter(l => l.beneficiary_id && Number(l.amount) > 0)
      .map(l => ({ beneficiary_id: Number(l.beneficiary_id), amount: Number(l.amount), purpose: l.purpose, invoice_ref: l.invoice_ref }));
    if (!lines.length) { setErr("Add at least one line with a beneficiary and amount."); return; }
    const r = await fetch(`${API}/api/bank/payouts`, { method: "POST", headers: jsonH(), body: JSON.stringify({ ...batch, from_account_id: batch.from_account_id || null, lines }) });
    const j = await r.json();
    if (r.ok) { flash(`Batch ${j.batch_no} created (draft) · ${INR(j.total)} · ${j.lines} payment(s).`); setBatch({ from_account_id: batch.from_account_id, payment_method: "NEFT", value_date: "", lines: [{ beneficiary_id: "", amount: "", purpose: "", invoice_ref: "" }] }); load(); }
    else setErr(j.error || "Failed");
  };

  const genFile = async (id, format) => {
    const r = await fetch(`${API}/api/bank/payouts/${id}/generate`, { method: "POST", headers: jsonH(), body: JSON.stringify({ format }) });
    const j = await r.json();
    if (!r.ok) { setErr(j.error || "Failed"); return; }
    const blob = new Blob([j.content], { type: format === "CSV" ? "text/csv" : "application/xml" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = j.file_name; a.click(); URL.revokeObjectURL(a.href);
    flash(`${j.file_name} generated & downloaded — upload it to your bank H2H portal.`); load();
  };
  const release = async (id) => {
    if (!window.confirm("Mark this batch released to the bank? (You still approve the debit in the bank's own portal — the MES never sends money.)")) return;
    const r = await fetch(`${API}/api/bank/payouts/${id}/release`, { method: "POST", headers: jsonH() });
    if (r.ok) { flash("Marked released."); load(); } else setErr((await r.json()).error || "Failed");
  };
  const cancel = async (id) => { if (!window.confirm("Cancel this batch?")) return; const r = await fetch(`${API}/api/bank/payouts/${id}/cancel`, { method: "POST", headers: jsonH() }); if (r.ok) { flash("Cancelled."); load(); } else setErr((await r.json()).error || "Failed"); };

  const approvedBens = bens.filter(b => b.approved);

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ margin: "0 0 4px", fontFamily: "var(--mono)", fontWeight: 800, textTransform: "uppercase" }}>💸 Supplier Payments (H2H)</h2>
      <div style={{ color: "var(--muted)", fontSize: 12.5, marginBottom: 14 }}>Draft-only: the MES builds a bank-uploadable payment file — it never sends money. You upload it to your bank; the bank's maker-checker approves the debit.</div>
      {msg && <div style={{ ...card, borderColor: "var(--green-dim)", color: "var(--green)", marginBottom: 12 }}>{msg}</div>}
      {err && <div style={{ ...card, borderColor: "var(--crit-dim)", color: "var(--crit)", marginBottom: 12 }}>{err}</div>}

      {/* Beneficiaries */}
      <div style={card}>
        <div style={{ ...label, marginBottom: 10 }}>Beneficiaries (approved bank details)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <input style={{ ...inp, minWidth: 180 }} placeholder="Beneficiary name" value={nb.beneficiary_name} onChange={e => setNb({ ...nb, beneficiary_name: e.target.value })} />
          <input style={inp} placeholder="Account no." value={nb.account_no} onChange={e => setNb({ ...nb, account_no: e.target.value })} />
          <input style={inp} placeholder="IFSC" value={nb.ifsc} onChange={e => setNb({ ...nb, ifsc: e.target.value.toUpperCase() })} />
          <input style={inp} placeholder="Bank (optional)" value={nb.bank_name} onChange={e => setNb({ ...nb, bank_name: e.target.value })} />
          <button style={btn("var(--surface)", "var(--text)")} onClick={addBen}>+ Add</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
            <thead><tr>{["Name", "Account", "IFSC", "Bank", "Status", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {!bens.length && <tr><td colSpan={6} style={{ ...td, color: "var(--muted)" }}>No beneficiaries yet.</td></tr>}
              {bens.map(b => (
                <tr key={b.beneficiary_id}>
                  <td style={td}>{b.beneficiary_name}{b.partner_name ? <div style={{ fontSize: 11, color: "var(--muted)" }}>{b.partner_name}</div> : null}</td>
                  <td style={td}>{b.account_no}</td><td style={td}>{b.ifsc}</td><td style={td}>{b.bank_name || "—"}</td>
                  <td style={td}>{b.approved ? <span style={{ color: "var(--green)", fontWeight: 600 }}>approved</span> : <span style={{ color: "var(--gold)", fontWeight: 600 }}>unapproved</span>}</td>
                  <td style={td}>{!b.approved && <button style={btn("var(--bg)", "var(--green)")} onClick={() => approveBen(b.beneficiary_id)}>Approve</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New batch */}
      <div style={card}>
        <div style={{ ...label, marginBottom: 10 }}>New payment batch (draft)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <select style={inp} value={batch.from_account_id} onChange={e => setBatch({ ...batch, from_account_id: e.target.value })}>
            <option value="">Debit account…</option>
            {accts.map(a => <option key={a.account_id} value={a.account_id}>{a.account_name}{a.bank_name ? ` — ${a.bank_name}` : ""}</option>)}
          </select>
          <select style={inp} value={batch.payment_method} onChange={e => setBatch({ ...batch, payment_method: e.target.value })}>
            {["NEFT", "RTGS", "IMPS"].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input type="date" style={inp} value={batch.value_date} onChange={e => setBatch({ ...batch, value_date: e.target.value })} />
        </div>
        {batch.lines.map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6, alignItems: "center" }}>
            <select style={{ ...inp, minWidth: 200 }} value={l.beneficiary_id} onChange={e => setLine(i, "beneficiary_id", e.target.value)}>
              <option value="">Beneficiary (approved)…</option>
              {approvedBens.map(b => <option key={b.beneficiary_id} value={b.beneficiary_id}>{b.beneficiary_name} · {b.account_no}</option>)}
            </select>
            <input style={{ ...inp, width: 120 }} type="number" placeholder="Amount ₹" value={l.amount} onChange={e => setLine(i, "amount", e.target.value)} />
            <input style={{ ...inp, minWidth: 140 }} placeholder="Purpose" value={l.purpose} onChange={e => setLine(i, "purpose", e.target.value)} />
            <input style={{ ...inp, width: 130 }} placeholder="Invoice ref" value={l.invoice_ref} onChange={e => setLine(i, "invoice_ref", e.target.value)} />
            {batch.lines.length > 1 && <button style={btn("var(--bg)", "var(--crit)")} onClick={() => delLine(i)}>✕</button>}
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, flexWrap: "wrap", gap: 8 }}>
          <button style={btn("var(--bg)", "var(--text)")} onClick={addLine}>+ Add line</button>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>Total {INR(batchTotal)}</span>
            <button style={btn("var(--yellow)", "#000")} onClick={createBatch} disabled={approvedBens.length === 0}>Create draft batch</button>
          </div>
        </div>
        {approvedBens.length === 0 && <div style={{ color: "var(--gold)", fontSize: 12, marginTop: 6 }}>Add + approve at least one beneficiary before creating a batch.</div>}
      </div>

      {/* Batches */}
      <div style={card}>
        <div style={{ ...label, marginBottom: 10 }}>Payment batches</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead><tr>{["Batch", "Date", "Method", "Total", "Status", "File", "Actions"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {!batches.length && <tr><td colSpan={7} style={{ ...td, color: "var(--muted)" }}>No batches yet.</td></tr>}
              {batches.map(b => (
                <tr key={b.batch_id}>
                  <td style={{ ...td, fontWeight: 700 }}>{b.batch_no}</td>
                  <td style={td}>{b.value_date ? new Date(b.value_date).toLocaleDateString("en-GB") : "—"}</td>
                  <td style={td}>{b.payment_method}</td>
                  <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{INR(b.total_amount)}</td>
                  <td style={td}><span style={{ color: STB[b.status] || "var(--text)", fontWeight: 600 }}>{b.status}</span></td>
                  <td style={td}>{b.file_name || "—"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {b.status !== "CANCELLED" && b.status !== "RELEASED" && <>
                        <button style={btn("var(--surface)", "var(--text)")} onClick={() => genFile(b.batch_id, "PAIN001")}>pain.001</button>
                        <button style={btn("var(--surface)", "var(--text)")} onClick={() => genFile(b.batch_id, "CSV")}>CSV</button>
                      </>}
                      {b.status === "GENERATED" && <button style={btn("var(--green-dim)", "var(--green)")} onClick={() => release(b.batch_id)}>Release</button>}
                      {(b.status === "DRAFT" || b.status === "GENERATED") && <button style={btn("var(--bg)", "var(--crit)")} onClick={() => cancel(b.batch_id)}>Cancel</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
