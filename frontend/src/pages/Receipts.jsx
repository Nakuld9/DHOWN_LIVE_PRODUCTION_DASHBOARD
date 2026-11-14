// Receipts & Outstanding — the collections desk.
//
// Two things happen here: seeing who owes what and how late it is, and recording
// money when it arrives. They are one screen because they are one job — you open
// the ageing list, see a customer is 40 days over, ring them, and post the
// receipt without navigating anywhere.
//
// The allocation preview in the receipt form is a PREVIEW. It mirrors the server
// rule (oldest invoice first, clamped to each balance) so nobody posts blind, but
// the server re-picks under a lock and its answer is the real one.

import React, { useEffect, useState, useCallback } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });
const auth = () => ({ Authorization: `Bearer ${tok()}` });

const rupee = n => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rupeeShort = n => {
  const v = Number(n || 0);
  if (v >= 1e7) return "₹" + (v / 1e7).toFixed(2) + " Cr";
  if (v >= 1e5) return "₹" + (v / 1e5).toFixed(2) + " L";
  return rupee(v);
};
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—";

const inp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 11px", color: "var(--text)", fontSize: 14, boxSizing: "border-box" };
const lbl = { color: "var(--muted)", fontSize: 12, marginBottom: 4, display: "block" };
const th = { padding: "10px 8px", textAlign: "left", color: "var(--yellow)", fontSize: 13, borderBottom: "2px solid var(--surface)", whiteSpace: "nowrap" };
const td = { padding: "10px 8px", borderBottom: "1px solid rgba(22,52,93,0.4)", fontSize: 14 };
const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const thNum = { ...th, textAlign: "right" };
const btn = (bg, fg = "#000") => ({ background: bg, color: fg, border: "none", padding: "6px 12px", borderRadius: 6, fontWeight: "bold", cursor: "pointer", fontSize: 12 });
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 };

// How late money is, coloured so the worst reads first without being counted.
const ageColour = days => {
  if (!days) return "var(--green)";
  if (days <= 30) return "var(--gold)";
  if (days <= 60) return "var(--gold)";
  if (days <= 90) return "var(--idle)";
  return "var(--crit)";
};

const MODES = ["NEFT", "RTGS", "IMPS", "UPI", "CHEQUE", "CASH", "ADJUSTMENT"];

export default function Receipts() {
  const [tab, setTab] = useState("collections");
  const [ageing, setAgeing] = useState([]);
  const [payments, setPayments] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [partners, setPartners] = useState([]);
  const [sel, setSel] = useState(null);          // selected customer row
  const [detail, setDetail] = useState(null);    // { outstanding, open_invoices_detail }
  const [ledger, setLedger] = useState([]);
  const [credit, setCredit] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ amount: "", mode: "NEFT", reference: "", bank: "", notes: "", payment_date: new Date().toISOString().slice(0, 10) });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const flash = (m, ok = true) => { setMsg((ok ? "✓ " : "✗ ") + m); setTimeout(() => setMsg(""), 4000); };

  const loadAgeing = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/wa/ageing`, { headers: auth() });
      setAgeing(r.ok ? await r.json() : []);
    } catch { setAgeing([]); }
    setLoading(false);
  }, []);

  const loadPayments = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/wa/payments`, { headers: auth() });
      setPayments(r.ok ? await r.json() : []);
    } catch { setPayments([]); }
  }, []);

  // Customers holding unapplied advances. They are deliberately NOT in the
  // ageing list — they owe nothing — so without this their credit would sit
  // unnoticed until they asked about it.
  const loadAdvances = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/wa/credit-on-account`, { headers: auth() });
      setAdvances(r.ok ? await r.json() : []);
    } catch { setAdvances([]); }
  }, []);

  useEffect(() => { loadAgeing(); loadPayments(); loadAdvances(); }, [loadAgeing, loadPayments, loadAdvances]);

  // Every customer, not just those who owe — the point of the header button.
  useEffect(() => {
    fetch(`${API}/api/erp/partners`, { headers: auth() })
      .then(r => r.json())
      .then(d => setPartners(d.data || d.partners || (Array.isArray(d) ? d : [])))
      .catch(() => {});
  }, []);

  // Start a receipt with no customer chosen yet.
  const startBlankReceipt = () => {
    setSel(null); setDetail(null); setCredit(null); setLedger([]);
    setForm({ amount: "", mode: "NEFT", reference: "", bank: "", notes: "",
              payment_date: new Date().toISOString().slice(0, 10), partner_id: "" });
    setShowForm(true);
  };

  // Picking the customer inside the form loads their open invoices so the
  // allocation preview works the same as it does from the ageing list.
  const chooseCustomer = async (partnerId) => {
    setForm(f => ({ ...f, partner_id: partnerId }));
    if (!partnerId) { setSel(null); setDetail(null); return; }
    const p = partners.find(x => String(x.partner_id) === String(partnerId));
    setSel({ partner_id: partnerId, company_name: p?.company_name || "Customer" });
    try {
      const d = await fetch(`${API}/api/wa/customers/${partnerId}/outstanding`, { headers: auth() }).then(r => r.json());
      setDetail(d);
    } catch { setDetail(null); }
  };

  // Everything about one customer, loaded together so the panel never renders
  // half-populated.
  const openCustomer = async (row) => {
    setSel(row); setDetail(null); setLedger([]); setCredit(null);
    try {
      const [d, l, c] = await Promise.all([
        fetch(`${API}/api/wa/customers/${row.partner_id}/outstanding`, { headers: auth() }).then(r => r.json()),
        fetch(`${API}/api/wa/customers/${row.partner_id}/ledger`, { headers: auth() }).then(r => r.json()),
        fetch(`${API}/api/wa/customers/${row.partner_id}/credit-on-account`, { headers: auth() }).then(r => r.json()),
      ]);
      setDetail(d); setLedger(Array.isArray(l) ? l : []); setCredit(c);
    } catch { flash("Could not load customer", false); }
  };

  const refreshAll = async () => {
    await Promise.all([loadAgeing(), loadPayments(), loadAdvances()]);
    if (sel) await openCustomer(sel);
  };

  const postReceipt = async () => {
    const amt = Number(form.amount);
    if (!(sel?.partner_id || form.partner_id)) return flash("Choose a customer", false);
    if (!(amt > 0)) return flash("Enter an amount greater than zero", false);
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/wa/payments`, {
        method: "POST", headers: h(),
        body: JSON.stringify({ ...form, partner_id: sel?.partner_id || form.partner_id, amount: amt }),
      });
      const d = await r.json();
      if (!r.ok) { flash(d.error || "Could not record the receipt", false); }
      else {
        // "Settled" and "touched" are different numbers, and on a money screen
        // saying two invoices were settled when one was only part-paid is the
        // kind of wrong that gets believed.
        const applied = d.allocated || [];
        const open = new Map((detail?.open_invoices_detail || []).map(i => [i.invoice_id, Number(i.balance)]));
        const settled = applied.filter(a => a.amount >= (open.get(a.invoice_id) ?? Infinity) - 0.009).length;
        const part = applied.length - settled;
        const bits = [];
        if (settled) bits.push(`${settled} invoice${settled === 1 ? "" : "s"} settled`);
        if (part) bits.push(`${part} part-paid`);
        if (d.unallocated > 0) bits.push(`${rupee(d.unallocated)} left on account`);
        flash(`${d.payment.receipt_no} recorded. ` + (bits.join(", ") || "nothing was open to apply it to"));
        setShowForm(false);
        setForm({ amount: "", mode: "NEFT", reference: "", bank: "", notes: "", payment_date: new Date().toISOString().slice(0, 10) });
        await refreshAll();
      }
    } catch (e) { flash(e.message, false); }
    setSaving(false);
  };

  const applyCredit = async () => {
    try {
      const r = await fetch(`${API}/api/wa/customers/${sel.partner_id}/apply-credit`, { method: "POST", headers: h() });
      const d = await r.json();
      if (!r.ok) return flash(d.error || "Could not apply credit", false);
      flash(d.applied.length ? `Applied to ${d.applied.length} invoice(s)` : "Nothing open to apply it to");
      await refreshAll();
    } catch (e) { flash(e.message, false); }
  };

  const cancelPayment = async (p) => {
    const reason = window.prompt(`Cancel receipt ${p.receipt_no} for ${rupee(p.amount)}?\n\nThe receipt is kept for audit but its allocations are removed, so the customer will owe this again.\n\nReason:`);
    if (reason === null) return;
    try {
      const r = await fetch(`${API}/api/wa/payments/${p.payment_id}/cancel`, {
        method: "POST", headers: h(), body: JSON.stringify({ reason }),
      });
      const d = await r.json();
      if (!r.ok) return flash(d.error || "Could not cancel", false);
      flash(`${p.receipt_no} cancelled`);
      await refreshAll();
    } catch (e) { flash(e.message, false); }
  };

  // Mirrors the server's oldest-first allocation so the form can show where the
  // money will land before it is posted.
  const previewAllocation = () => {
    const amt = Number(form.amount) || 0;
    const invoices = detail?.open_invoices_detail || [];
    let left = amt;
    const rows = [];
    for (const inv of invoices) {
      if (left <= 0.009) break;
      const use = Math.min(left, Number(inv.balance));
      if (use <= 0.009) continue;
      rows.push({ ...inv, apply: use, settles: use >= Number(inv.balance) - 0.009 });
      left = Math.round((left - use) * 100) / 100;
    }
    return { rows, onAccount: Math.round(left * 100) / 100 };
  };

  const totals = ageing.reduce((a, r) => ({
    outstanding: a.outstanding + Number(r.outstanding || 0),
    overdue: a.overdue + Number(r.overdue || 0),
    overdueCount: a.overdueCount + (Number(r.overdue) > 0 ? 1 : 0),
    oldest: Math.max(a.oldest, Number(r.oldest_overdue_days || 0)),
  }), { outstanding: 0, overdue: 0, overdueCount: 0, oldest: 0 });

  const filtered = ageing.filter(r =>
    !q || String(r.company_name || "").toLowerCase().includes(q.toLowerCase()));

  const preview = showForm ? previewAllocation() : null;

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: 0 }}>💰 Receipts &amp; Outstanding</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btn(tab === "collections" ? "var(--yellow)" : "var(--surface)", tab === "collections" ? "#000" : "var(--text)")}
                  onClick={() => setTab("collections")}>Collections</button>
          <button style={btn(tab === "receipts" ? "var(--yellow)" : "var(--surface)", tab === "receipts" ? "#000" : "var(--text)")}
                  onClick={() => setTab("receipts")}>Receipts</button>
          {/* The only way in used to be through a customer's row in the ageing
              list, which meant money from a customer who owed nothing — an
              advance, or a first order paid up front — could not be recorded at
              all, because they never appear in that list. */}
          <button style={btn("var(--green)", "#000")} onClick={startBlankReceipt}>+ Record receipt</button>
          {/* The screen is for working the list; the export is for the meeting
              where someone wants to sort it their own way. Fetched as a blob
              because the endpoint needs the bearer token. */}
          <button style={btn("var(--surface)", "var(--text)")}
                  onClick={() => downloadFile("/api/wa/ageing.xlsx").catch(e => flash(e.message, false))}>
            ⭳ Ageing (Excel)
          </button>
          <button style={btn("var(--surface)", "var(--text)")} onClick={refreshAll}>↻ Refresh</button>
        </div>
      </div>

      {msg && <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 6, background: msg.startsWith("✓") ? "var(--green-dim)" : "var(--crit-dim)", border: `1px solid ${msg.startsWith("✓") ? "var(--green-deep)" : "var(--crit-dim)"}` }}>{msg}</div>}

      {/* Summary. Overdue is separated from outstanding because they prompt
          different action: outstanding is normal trading, overdue is a phone call. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, margin: "16px 0" }}>
        <Kpi label="Total outstanding" value={rupeeShort(totals.outstanding)} colour="var(--muted)" />
        <Kpi label="Overdue" value={rupeeShort(totals.overdue)} colour={totals.overdue > 0 ? "var(--crit)" : "var(--green)"} />
        <Kpi label="Customers overdue" value={totals.overdueCount} colour={totals.overdueCount ? "var(--gold)" : "var(--green)"} />
        <Kpi label="Oldest overdue" value={totals.oldest ? `${totals.oldest} days` : "—"} colour={ageColour(totals.oldest)} />
      </div>

      {tab === "collections" && (
        <div style={{ display: "grid", gridTemplateColumns: sel ? "1fr 420px" : "1fr", gap: 16, alignItems: "start" }}>
          <div style={card}>
            <input style={{ ...inp, marginBottom: 12 }} placeholder="Search customer…"
                   value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Customer</th>
                    <th style={thNum}>Outstanding</th>
                    <th style={thNum}>Overdue</th>
                    <th style={thNum}>Current</th>
                    <th style={thNum}>1–30</th>
                    <th style={thNum}>31–60</th>
                    <th style={thNum}>61–90</th>
                    <th style={thNum}>90+</th>
                    <th style={thNum}>Oldest</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td style={td} colSpan={9}>Loading…</td></tr>}
                  {!loading && !filtered.length && (
                    <tr><td style={{ ...td, color: "var(--muted)" }} colSpan={9}>
                      {ageing.length ? "No customer matches that search." : "Nothing outstanding — every invoice is settled."}
                    </td></tr>
                  )}
                  {filtered.map(r => (
                    <tr key={r.partner_id}
                        onClick={() => openCustomer(r)}
                        style={{ cursor: "pointer", background: sel?.partner_id === r.partner_id ? "rgba(244,174,31,0.10)" : "transparent" }}>
                      <td style={td}>
                        {r.company_name}
                        {Number(r.credit_limit) > 0 && Number(r.outstanding) > Number(r.credit_limit) && (
                          <span style={{ marginLeft: 8, fontSize: 11, color: "var(--crit)", border: "1px solid var(--crit-dim)", borderRadius: 4, padding: "1px 5px" }}>
                            over limit
                          </span>
                        )}
                      </td>
                      <td style={tdNum}>{rupee(r.outstanding)}</td>
                      <td style={{ ...tdNum, color: Number(r.overdue) > 0 ? "var(--crit)" : "var(--muted)" }}>
                        {Number(r.overdue) > 0 ? rupee(r.overdue) : "—"}
                      </td>
                      <td style={tdNum}>{Number(r.current) ? rupee(r.current) : "—"}</td>
                      <td style={tdNum}>{Number(r.d1_30) ? rupee(r.d1_30) : "—"}</td>
                      <td style={tdNum}>{Number(r.d31_60) ? rupee(r.d31_60) : "—"}</td>
                      <td style={tdNum}>{Number(r.d61_90) ? rupee(r.d61_90) : "—"}</td>
                      <td style={{ ...tdNum, color: Number(r.d90_plus) ? "var(--crit)" : undefined }}>
                        {Number(r.d90_plus) ? rupee(r.d90_plus) : "—"}
                      </td>
                      <td style={{ ...tdNum, color: ageColour(Number(r.oldest_overdue_days)), fontWeight: "bold" }}>
                        {Number(r.oldest_overdue_days) ? `${r.oldest_overdue_days}d` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {!!advances.length && !sel && (
            <div style={{ ...card, gridColumn: "1 / -1" }}>
              <div style={{ color: "var(--gold)", fontWeight: "bold", marginBottom: 4 }}>
                Advances not yet applied
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>
                Money received against no invoice. These customers owe nothing, so they do not
                appear above — apply the credit when their next invoice is raised.
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Customer</th><th style={thNum}>On account</th>
                  <th style={thNum}>Receipts</th><th style={th}>Latest</th><th style={th}></th>
                </tr></thead>
                <tbody>
                  {advances.map(a => (
                    <tr key={a.partner_id}>
                      <td style={td}>{a.company_name}</td>
                      <td style={{ ...tdNum, color: "var(--gold)", fontWeight: "bold" }}>{rupee(a.unapplied)}</td>
                      <td style={tdNum}>{a.receipts}</td>
                      <td style={td}>{fmtDate(a.latest)}</td>
                      <td style={td}>
                        <button style={btn("var(--surface)", "var(--text)")}
                                onClick={() => openCustomer({ partner_id: a.partner_id, company_name: a.company_name, outstanding: 0, overdue: 0, open_invoices: 0 })}>
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sel && (
            <CustomerPanel
              sel={sel} detail={detail} ledger={ledger} credit={credit}
              onClose={() => setSel(null)}
              onRecord={() => setShowForm(true)}
              onApplyCredit={applyCredit}
            />
          )}
        </div>
      )}

      {tab === "receipts" && (
        <div style={card}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Receipt</th>
                  <th style={th}>Date</th>
                  <th style={th}>Customer</th>
                  <th style={th}>Mode</th>
                  <th style={th}>Reference</th>
                  <th style={thNum}>Amount</th>
                  <th style={thNum}>Allocated</th>
                  <th style={thNum}>On account</th>
                  <th style={th}>Status</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {!payments.length && <tr><td style={{ ...td, color: "var(--muted)" }} colSpan={10}>No receipts recorded yet.</td></tr>}
                {payments.map(p => (
                  <tr key={p.payment_id} style={{ opacity: p.status === "CANCELLED" ? 0.5 : 1 }}>
                    <td style={td}>{p.receipt_no}</td>
                    <td style={td}>{fmtDate(p.payment_date)}</td>
                    <td style={td}>{p.company_name || "—"}</td>
                    <td style={td}>{p.mode || "—"}</td>
                    <td style={td}>{p.reference || "—"}</td>
                    <td style={tdNum}>{rupee(p.amount)}</td>
                    <td style={tdNum}>{p.status === "CANCELLED" ? "—" : rupee(p.allocated)}</td>
                    {/* Cancelling deletes the allocations, so amount-minus-allocated
                        equals the whole receipt. That is void money, not credit the
                        customer can spend — showing it as "on account" would overstate
                        what they have with us. */}
                    <td style={{ ...tdNum, color: p.status === "ACTIVE" && Number(p.unallocated) > 0 ? "var(--gold)" : undefined }}>
                      {p.status === "ACTIVE" && Number(p.unallocated) > 0 ? rupee(p.unallocated) : "—"}
                    </td>
                    <td style={{ ...td, color: p.status === "CANCELLED" ? "var(--crit)" : "var(--green)" }}>{p.status}</td>
                    <td style={td}>
                      {p.status === "ACTIVE" && (
                        <button style={btn("var(--crit-dim)", "#fff")} onClick={() => cancelPayment(p)}>Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <Modal onClose={() => setShowForm(false)}
               title={sel ? `Record receipt — ${sel.company_name}` : "Record receipt"}>
          {/* Shown only when the form was opened from the header, where no
              customer has been chosen yet. */}
          {!sel && (
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Customer *</label>
              <select style={inp} autoFocus value={form.partner_id || ""}
                      onChange={e => chooseCustomer(e.target.value)}>
                <option value="">— select a customer —</option>
                {partners.map(p => (
                  <option key={p.partner_id} value={p.partner_id}>{p.company_name}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={lbl}>Amount received *</label>
              <input style={inp} type="number" autoFocus value={form.amount}
                     onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Date</label>
              <input style={inp} type="date" value={form.payment_date}
                     onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Mode</label>
              <select style={inp} value={form.mode} onChange={e => setForm(f => ({ ...f, mode: e.target.value }))}>
                {MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Reference / UTR / cheque no.</label>
              <input style={inp} value={form.reference}
                     onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Bank</label>
              <input style={inp} value={form.bank}
                     onChange={e => setForm(f => ({ ...f, bank: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Notes</label>
              <input style={inp} value={form.notes}
                     onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ color: "var(--yellow)", fontSize: 13, marginBottom: 6 }}>
              Where this will go — oldest invoice first
            </div>
            {!Number(form.amount) && (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>Enter an amount to see the allocation.</div>
            )}
            {Number(form.amount) > 0 && !preview.rows.length && (
              <div style={{ color: "var(--gold)", fontSize: 13 }}>
                Nothing is open for this customer — the whole amount will be held on account as credit.
              </div>
            )}
            {!!preview?.rows.length && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Invoice</th><th style={th}>Date</th>
                  <th style={thNum}>Balance</th><th style={thNum}>Applied</th><th style={th}>Result</th>
                </tr></thead>
                <tbody>
                  {preview.rows.map(r => (
                    <tr key={r.invoice_id}>
                      <td style={td}>{r.invoice_number}</td>
                      <td style={td}>{fmtDate(r.invoice_date)}</td>
                      <td style={tdNum}>{rupee(r.balance)}</td>
                      <td style={tdNum}>{rupee(r.apply)}</td>
                      <td style={{ ...td, color: r.settles ? "var(--green)" : "var(--gold)" }}>
                        {r.settles ? "settled" : `part-paid, ${rupee(r.balance - r.apply)} left`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {preview?.onAccount > 0 && !!preview.rows.length && (
              <div style={{ marginTop: 8, color: "var(--gold)", fontSize: 13 }}>
                {rupee(preview.onAccount)} more than is owed — held on account for a future invoice.
              </div>
            )}
            <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 12 }}>
              A preview. The server re-checks balances when posting, so the final split may differ if
              something changed in the meantime.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
            <button style={btn("var(--surface)", "var(--text)")} onClick={() => setShowForm(false)}>Cancel</button>
            <button style={btn("var(--green)", "#000")} disabled={saving || !(sel?.partner_id || form.partner_id)} onClick={postReceipt}>
              {saving ? "Recording…" : "Record receipt"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Kpi({ label, value, colour }) {
  return (
    <div style={card}>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>{label}</div>
      <div style={{ color: colour, fontSize: 24, fontWeight: "bold", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function CustomerPanel({ sel, detail, ledger, credit, onClose, onRecord, onApplyCredit }) {
  const [view, setView] = useState("invoices");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState("");

  // The PDF route needs the bearer token, so it cannot be a plain link — fetch
  // it and hand the browser a blob. Opened in a new tab rather than downloaded
  // so the operator can read it before deciding to send it to the customer.
  const openStatement = async () => {
    setPdfBusy(true); setPdfErr("");
    try {
      const r = await fetch(`${API}/api/wa/customers/${sel.partner_id}/statement.pdf`, { headers: auth() });
      if (!r.ok) {
        // The route answers JSON on failure; show why rather than a blank tab.
        let msg = `Could not generate the statement (${r.status})`;
        try { const j = await r.json(); if (j.error) msg = j.error; } catch { /* not JSON */ }
        throw new Error(msg);
      }
      const url = URL.createObjectURL(await r.blob());
      const w = window.open(url, "_blank");
      if (!w) setPdfErr("Allow pop-ups to view the statement.");
      // Give the new tab time to load before revoking, or it opens blank.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setPdfErr(e.message);
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div style={{ ...card, position: "sticky", top: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: 16 }}>{sel.company_name}</div>
          {/* detail is the freshly-fetched figure; sel comes from the ageing row
              and goes stale the moment a receipt is posted. */}
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
            {(() => {
              const n = Number(detail?.open_invoices ?? sel.open_invoices ?? 0);
              return `${n} open invoice${n === 1 ? "" : "s"}`;
            })()}
            {Number(sel.credit_limit) > 0 && ` · limit ${rupeeShort(sel.credit_limit)}`}
          </div>
        </div>
        <button style={btn("var(--surface)", "var(--text)")} onClick={onClose}>✕</button>
      </div>

      <div style={{ display: "flex", gap: 16, margin: "14px 0" }}>
        <div>
          <div style={{ color: "var(--muted)", fontSize: 11 }}>Outstanding</div>
          <div style={{ fontSize: 20, fontWeight: "bold", fontVariantNumeric: "tabular-nums" }}>{rupee(detail?.outstanding ?? sel.outstanding)}</div>
        </div>
        <div>
          <div style={{ color: "var(--muted)", fontSize: 11 }}>Overdue</div>
          <div style={{ fontSize: 20, fontWeight: "bold", color: Number(detail?.overdue ?? sel.overdue) > 0 ? "var(--crit)" : "var(--green)", fontVariantNumeric: "tabular-nums" }}>
            {rupee(detail?.overdue ?? sel.overdue)}
          </div>
        </div>
      </div>

      <button style={{ ...btn("var(--green)", "#000"), width: "100%", padding: "9px 12px", fontSize: 14 }} onClick={onRecord}>
        + Record receipt
      </button>

      <button
        style={{ ...btn("var(--surface)", "var(--text)"), width: "100%", padding: "8px 12px", fontSize: 13, marginTop: 8 }}
        onClick={openStatement}
        disabled={pdfBusy}
      >
        {pdfBusy ? "Preparing…" : "Statement of account (PDF)"}
      </button>
      {pdfErr && <div style={{ color: "var(--crit)", fontSize: 12, marginTop: 6 }}>{pdfErr}</div>}

      {credit && Number(credit.total) > 0 && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "rgba(234,179,8,0.10)", border: "1px solid var(--gold-deep)" }}>
          <div style={{ fontSize: 13 }}>
            <b style={{ color: "var(--gold)" }}>{rupee(credit.total)}</b> paid in advance, not yet applied to an invoice.
          </div>
          <button style={{ ...btn("var(--gold)", "#000"), marginTop: 8 }} onClick={onApplyCredit}>
            Apply to open invoices
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, margin: "14px 0 10px" }}>
        {["invoices", "ledger"].map(v => (
          <button key={v} style={btn(view === v ? "var(--yellow)" : "var(--surface)", view === v ? "#000" : "var(--text)")}
                  onClick={() => setView(v)}>
            {v === "invoices" ? "Open invoices" : "Ledger"}
          </button>
        ))}
      </div>

      {view === "invoices" && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Invoice</th><th style={thNum}>Balance</th><th style={thNum}>Late</th>
          </tr></thead>
          <tbody>
            {!detail && <tr><td style={td} colSpan={3}>Loading…</td></tr>}
            {detail && !detail.open_invoices_detail?.length && (
              <tr><td style={{ ...td, color: "var(--muted)" }} colSpan={3}>Nothing open.</td></tr>
            )}
            {(detail?.open_invoices_detail || []).map(i => (
              <tr key={i.invoice_id}>
                <td style={td}>
                  {i.invoice_number}
                  <div style={{ color: "var(--muted)", fontSize: 11 }}>due {fmtDate(i.due_date)}</div>
                </td>
                <td style={tdNum}>
                  {rupee(i.balance)}
                  {Number(i.allocated) > 0 && (
                    <div style={{ color: "var(--muted)", fontSize: 11 }}>of {rupee(i.grand_total)}</div>
                  )}
                </td>
                <td style={{ ...tdNum, color: ageColour(Number(i.days_overdue)), fontWeight: "bold" }}>
                  {Number(i.days_overdue) ? `${i.days_overdue}d` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {view === "ledger" && (
        <div style={{ maxHeight: 380, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Date</th><th style={th}>Ref</th>
              <th style={thNum}>Debit</th><th style={thNum}>Credit</th><th style={thNum}>Balance</th>
            </tr></thead>
            <tbody>
              {!ledger.length && <tr><td style={{ ...td, color: "var(--muted)" }} colSpan={5}>No entries.</td></tr>}
              {ledger.map((l, i) => (
                <tr key={i}>
                  <td style={td}>{fmtDate(l.date)}</td>
                  <td style={td}>{l.ref}</td>
                  <td style={tdNum}>{l.debit ? rupee(l.debit) : "—"}</td>
                  <td style={{ ...tdNum, color: l.credit ? "var(--green)" : undefined }}>{l.credit ? rupee(l.credit) : "—"}</td>
                  <td style={{ ...tdNum, fontWeight: "bold" }}>{rupee(l.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div onClick={onClose}
         style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex",
                  alignItems: "flex-start", justifyContent: "center", padding: 24, zIndex: 1000, overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()}
           style={{ ...card, width: "min(760px,100%)", marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ color: "var(--yellow)", margin: 0 }}>{title}</h3>
          <button style={btn("var(--surface)", "var(--text)")} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
