// AI Accountant dashboard (spec §3, §4, §19, §29).
//
// One screen the finance team / management opens to see: today's money position,
// receivables, payables, sales/purchase, GST, anomalies to review, pending
// approvals, the daily report, and a natural-language finance assistant.
//
// Every figure is shown with the honesty tag the backend returns — anything that
// lives only in Busy (bank/cash balance, ITC) is shown as an "In Busy" chip, not
// a number. The AI never posts here; it reports and prepares for approval.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });

const INR = (n) => { const v = Math.round(Number(n) || 0); return (v < 0 ? "-₹" : "₹") + Math.abs(v).toLocaleString("en-IN"); };
const isUnavailable = (v) => v && typeof v === "object" && v.available === false;
// Show a real value from the Busy mirror when present, else the "In Busy" chip.
const busyVal = (field) => (field && field.available && field.value != null) ? INR(field.value) : busyChip;

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };
const big = { fontSize: 22, fontWeight: 800, marginTop: 6, fontVariantNumeric: "tabular-nums" };
const sub = { color: "var(--muted)", fontSize: 12, marginTop: 4 };
const chip = (bg, fg) => ({ display: "inline-block", background: bg, color: fg, borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 700 });

const SEV = {
  CRITICAL: { bg: "var(--crit-dim)", fg: "var(--crit)", bar: "var(--crit)" },
  HIGH: { bg: "var(--crit-dim)", fg: "var(--gold-2)", bar: "var(--idle)" },
  MEDIUM: { bg: "var(--gold-dim)", fg: "var(--gold)", bar: "var(--gold)" },
  LOW: { bg: "var(--surface)", fg: "var(--muted)", bar: "var(--link)" },
  INFO: { bg: "var(--surface)", fg: "var(--green)", bar: "var(--green)" },
};

const busyChip = <span style={chip("var(--surface)", "var(--purple)")}>In Busy</span>;

const CHECK_COLOR = { ok: "var(--green)", info: "var(--muted)", warn: "var(--gold)", fail: "var(--crit)" };
const VERDICT_COLOR = { LOOKS_CLEAN: "var(--green)", REVIEW_SUGGESTED: "var(--gold)", REVIEW_REQUIRED: "var(--crit)" };

// Upload a supplier invoice (PDF or photo) -> OCR -> AI validates (duplicate, GST
// math, GSTIN, HSN, supplier/PO) + price-checks each line vs purchase history.
// Prepares a draft; never posts.
function PurchaseInvoiceReview() {
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fileName, setFileName] = useState("");

  const onFile = async (file) => {
    if (!file) return;
    setBusy(true); setErr(""); setOut(null); setFileName(file.name);
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1]);
        r.onerror = rej; r.readAsDataURL(file);
      });
      const body = file.type === "application/pdf"
        ? { pdf_base64: b64 }
        : { image_base64: b64, mime: file.type };
      const r = await fetch(`${API}/api/ai/purchase-invoice/review`, { method: "POST", headers: jsonH(), body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || (j.scanned ? "Scanned PDF with no text layer — upload a digital PDF or a photo." : `Failed (${r.status})`));
      setOut(j);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={card}>
      <div style={{ ...label, fontSize: 13, marginBottom: 6 }}>📄 Purchase invoice AI</div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>
        Upload a supplier invoice (PDF or photo). The AI reads it, checks for duplicates, GST arithmetic, GSTIN, HSN and supplier/PO, and compares each rate against your purchase history. It prepares a draft — nothing is posted.
      </div>
      <label style={{ display: "inline-block", background: "var(--yellow)", color: "#000", borderRadius: 8, padding: "8px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
        {busy ? "Reading…" : "Upload invoice"}
        <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display: "none" }} disabled={busy}
          onChange={e => onFile(e.target.files?.[0])} />
      </label>
      {fileName && <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 10 }}>{fileName}</span>}
      {err && <div style={{ color: "var(--crit)", fontSize: 13, marginTop: 8 }}>{err}</div>}
      {out && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <span style={chip("var(--bg)", VERDICT_COLOR[out.summary.verdict])}>{out.summary.verdict.replace(/_/g, " ")}</span>
            <b style={{ fontSize: 13 }}>{out.summary.supplier || "Unknown supplier"} · {out.summary.invoice_no || "no inv#"} · {INR(out.summary.total)}</b>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {out.checks.map((c, i) => (
              <div key={i} style={{ fontSize: 13, display: "flex", gap: 8 }}>
                <span style={{ color: CHECK_COLOR[c.status], fontWeight: 700, minWidth: 44 }}>{c.status.toUpperCase()}</span>
                <span>{c.message}</span>
              </div>
            ))}
          </div>
          {out.price_intelligence?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ ...label, fontSize: 11, marginBottom: 4 }}>Price check</div>
              {out.price_intelligence.map((p, i) => (
                <div key={i} style={{ fontSize: 12.5, display: "flex", gap: 8 }}>
                  <span style={{ color: p.flag === "INCREASE" ? "var(--gold-2)" : p.flag === "DECREASE" ? "var(--green)" : "var(--muted)", fontWeight: 700, minWidth: 66 }}>{p.flag || "-"}</span>
                  <span>{p.item} — {p.note}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ ...sub, marginTop: 8 }}>{out.proposed_entry?.note}</div>
        </div>
      )}
    </div>
  );
}

const SALES_VERDICT_COLOR = { OK_TO_RAISE: "var(--green)", REVIEW_BEFORE_RAISING: "var(--gold)", DO_NOT_RAISE: "var(--crit)" };

// Pre-check a sales invoice BEFORE raising it: customer/GSTIN, credit, SO
// over-billing, authorised rate, dispatch, GST. Flags only — never creates it.
function SalesInvoiceCheck() {
  const [partners, setPartners] = useState([]);
  const [partnerId, setPartnerId] = useState("");
  const [soNumber, setSoNumber] = useState("");
  const [lines, setLines] = useState([{ description: "", quantity: "", rate: "" }]);
  const [tax, setTax] = useState("");
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`${API}/api/erp/partners`, { headers: auth() })
      .then(r => r.json()).then(d => setPartners(d.data || d.partners || (Array.isArray(d) ? d : []))).catch(() => {});
  }, []);

  const setLine = (i, k, v) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const taxable = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);
  const total = taxable + (Number(tax) || 0);

  const run = async () => {
    if (!partnerId) { setErr("Pick a customer."); return; }
    setBusy(true); setErr(""); setOut(null);
    try {
      const body = {
        partner_id: Number(partnerId), so_number: soNumber || undefined,
        items: lines.filter(l => l.description).map(l => ({ description: l.description, quantity: Number(l.quantity) || 0, rate: Number(l.rate) || 0 })),
        taxable: taxable || undefined, tax: Number(tax) || undefined, total: total || undefined,
      };
      const r = await fetch(`${API}/api/ai/sales-invoice/check`, { method: "POST", headers: jsonH(), body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setOut(j);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const inp = { background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 9px", fontSize: 13 };

  return (
    <div style={card}>
      <div style={{ ...label, fontSize: 13, marginBottom: 6 }}>🧾 Sales invoice pre-check</div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>
        Check a sales invoice before you raise it — customer, GSTIN, credit limit, over-billing vs the SO, authorised rate, dispatch and GST. Flags only; nothing is created.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <select value={partnerId} onChange={e => setPartnerId(e.target.value)} style={{ ...inp, minWidth: 220 }}>
          <option value="">Select customer…</option>
          {partners.map(p => <option key={p.partner_id} value={p.partner_id}>{p.company_name}</option>)}
        </select>
        <input placeholder="SO number (optional)" value={soNumber} onChange={e => setSoNumber(e.target.value)} style={{ ...inp, width: 170 }} />
      </div>
      {lines.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
          <input placeholder="Fabric / description" value={l.description} onChange={e => setLine(i, "description", e.target.value)} style={{ ...inp, flex: 1, minWidth: 200 }} />
          <input placeholder="Qty (kg)" value={l.quantity} onChange={e => setLine(i, "quantity", e.target.value)} style={{ ...inp, width: 90 }} />
          <input placeholder="Rate/kg" value={l.rate} onChange={e => setLine(i, "rate", e.target.value)} style={{ ...inp, width: 90 }} />
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
        <button onClick={() => setLines(ls => [...ls, { description: "", quantity: "", rate: "" }])} style={{ background: "var(--bg)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>+ line</button>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>Taxable {INR(taxable)}</span>
        <input placeholder="GST amount" value={tax} onChange={e => setTax(e.target.value)} style={{ ...inp, width: 110 }} />
        <span style={{ color: "var(--muted)", fontSize: 13 }}>Total {INR(total)}</span>
        <button onClick={run} disabled={busy} style={{ background: "var(--yellow)", color: "#000", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer", marginLeft: "auto" }}>
          {busy ? "Checking…" : "Check invoice"}
        </button>
      </div>
      {err && <div style={{ color: "var(--crit)", fontSize: 13, marginTop: 8 }}>{err}</div>}
      {out && (
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 8 }}>
            <span style={chip("var(--bg)", SALES_VERDICT_COLOR[out.summary.verdict])}>{out.summary.verdict.replace(/_/g, " ")}</span>
            <b style={{ fontSize: 13, marginLeft: 10 }}>{out.summary.customer} · {INR(out.summary.invoice_value)}</b>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {out.checks.map((c, i) => (
              <div key={i} style={{ fontSize: 13, display: "flex", gap: 8 }}>
                <span style={{ color: CHECK_COLOR[c.status], fontWeight: 700, minWidth: 44 }}>{c.status.toUpperCase()}</span>
                <span>{c.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const RECON_COLOR = { matched: "var(--green)", partial: "var(--gold)", unmatched: "var(--muted)", suspicious: "var(--crit)", duplicate: "var(--idle)" };

// Paste a bank statement (CSV) → AI suggests customer + invoice matches. Suggestions
// only: nothing is allocated or posted. A human confirms in Receipts.
function BankReconcile() {
  const [csv, setCsv] = useState("");
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const post = async (body) => {
    setBusy(true); setErr(""); setOut(null);
    try {
      const r = await fetch(`${API}/api/ai/bank/reconcile`, { method: "POST", headers: jsonH(), body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || (j.scanned ? "Scanned PDF — upload a photo of the statement instead." : `Failed (${r.status})`));
      setOut(j);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const run = () => { if (csv.trim()) post({ csv }); };

  const onFile = async (file) => {
    if (!file) return;
    setBusy(true); setErr(""); setOut(null);
    try {
      const b64 = await new Promise((res, rej) => {
        const rd = new FileReader();
        rd.onload = () => res(String(rd.result).split(",")[1]); rd.onerror = rej; rd.readAsDataURL(file);
      });
      await post(file.type === "application/pdf" ? { pdf_base64: b64 } : { image_base64: b64, mime: file.type });
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div style={card}>
      <div style={{ ...label, fontSize: 13, marginBottom: 6 }}>🏦 Bank reconciliation (AI)</div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>
        Paste a bank statement as CSV (with a header row: Date, Description, Credit, Debit — or Date, Narration, Amount). The AI suggests which customer and invoices each credit settles. Suggestions only — confirm in Receipts before allocating.
      </div>
      <textarea value={csv} onChange={e => setCsv(e.target.value)} rows={4}
        placeholder={"Date,Description,Credit,Debit\n2026-09-15,NEFT FROM ABC TEXTILES,482500,"}
        style={{ width: "100%", boxSizing: "border-box", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, fontFamily: "var(--mono)", fontSize: 12 }} />
      <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={run} disabled={busy || !csv.trim()} style={{ background: "var(--yellow)", color: "#000", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
          {busy ? "Matching…" : "Reconcile pasted CSV"}
        </button>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>or</span>
        <label style={{ display: "inline-block", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
          Upload statement (PDF / photo)
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display: "none" }} disabled={busy} onChange={e => onFile(e.target.files?.[0])} />
        </label>
      </div>
      {err && <div style={{ color: "var(--crit)", fontSize: 13, marginTop: 8 }}>{err}</div>}
      {out && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>
            {out.summary.credits} credit(s), {out.summary.debits} debit(s) · {Object.entries(out.summary.by_status || {}).map(([k, v]) => `${v} ${k}`).join(" · ") || "—"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {out.results.map((r, i) => (
              <div key={i} style={{ borderLeft: `3px solid ${RECON_COLOR[r.status] || "#555"}`, background: "var(--bg)", borderRadius: 6, padding: "8px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <b style={{ fontSize: 13 }}>{INR(r.amount)} — {r.description}</b>
                  <span style={chip("var(--surface)", RECON_COLOR[r.status])}>{r.status}{r.needs_confirmation ? " · confirm" : ""}</span>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 3 }}>
                  {r.party ? `→ ${r.party.company_name}` : "→ no customer identified"}
                  {r.suggested_invoices?.length ? ` · settles ${r.suggested_invoices.map(x => x.invoice_number).join(", ")}` : ""}
                  {` · ${r.note}`}
                </div>
              </div>
            ))}
          </div>
          <div style={{ ...sub, marginTop: 8 }}>{out.summary.note}</div>
        </div>
      )}
    </div>
  );
}

function Stat({ title, value, hint, tag }) {
  return (
    <div style={card}>
      <div style={label}>{title}</div>
      <div style={big}>{value}</div>
      {hint && <div style={sub}>{hint}</div>}
      {tag && <div style={{ marginTop: 8 }}>{tag}</div>}
    </div>
  );
}

export default function AIAccountant() {
  const [report, setReport] = useState(null);
  const [pending, setPending] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const [cfo, setCfo] = useState(null);
  const [supplier, setSupplier] = useState(null);
  const [auditRows, setAuditRows] = useState(null);
  const [mgmtAlerts, setMgmtAlerts] = useState(null);
  const [busyStatus, setBusyStatus] = useState(null);
  const [busyRecon, setBusyRecon] = useState(null);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    try {
      const [r, a, cf, wc, pf, si, au, ma, bs, br] = await Promise.all([
        fetch(`${API}/api/ai/finance/report`, { headers: auth() }),
        fetch(`${API}/api/ai/approvals?status=PENDING`, { headers: auth() }).catch(() => null),
        fetch(`${API}/api/ai/finance/cashflow?days=30`, { headers: auth() }).catch(() => null),
        fetch(`${API}/api/ai/finance/working-capital`, { headers: auth() }).catch(() => null),
        fetch(`${API}/api/ai/finance/profitability?limit=8`, { headers: auth() }).catch(() => null),
        fetch(`${API}/api/ai/supplier-intel`, { headers: auth() }).catch(() => null),
        fetch(`${API}/api/ai/audit?limit=15`, { headers: auth() }).catch(() => null),
        fetch(`${API}/api/ai/management-alerts`, { headers: auth() }).catch(() => null),
        fetch(`${API}/api/ai/busy/status`, { headers: auth() }).catch(() => null),
        fetch(`${API}/api/ai/busy/reconcile/receivables`, { headers: auth() }).catch(() => null),
      ]);
      if (!r.ok) throw new Error((await r.json()).error || `Failed (${r.status})`);
      setReport(await r.json());
      if (a && a.ok) { const j = await a.json(); setPending(Array.isArray(j) ? j.length : (j.count ?? null)); }
      const cfoData = {};
      if (cf && cf.ok) cfoData.cashflow = await cf.json();
      if (wc && wc.ok) cfoData.workingCapital = await wc.json();
      if (pf && pf.ok) cfoData.profitability = await pf.json();
      setCfo(cfoData);
      if (si && si.ok) setSupplier(await si.json());
      if (au && au.ok) setAuditRows(await au.json());
      if (ma && ma.ok) setMgmtAlerts(await ma.json());
      if (bs && bs.ok) setBusyStatus(await bs.json());
      if (br && br.ok) setBusyRecon(await br.json());
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const ask = async () => {
    if (!q.trim()) return;
    setAsking(true); setAnswer(null);
    try {
      const r = await fetch(`${API}/api/ai/ask`, {
        method: "POST", headers: jsonH(),
        body: JSON.stringify({ question: q.trim(), agent: "accountant" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setAnswer(j);
    } catch (e) { setAnswer({ answer: `⚠ ${e.message}` }); }
    finally { setAsking(false); }
  };

  if (loading) return <div style={{ padding: 20, color: "var(--muted)" }}>Loading AI Accountant…</div>;

  const s = report?.snapshot || {};
  const cash = s.cash || {}, recv = s.receivables || {}, pay = s.payables || {}, sales = s.sales || {}, purch = s.purchases || {}, gst = s.gst || {};
  const anomalies = report?.anomalies || { total: 0, by_severity: {}, items: [] };
  const recs = report?.recommendations || [];

  return (
    <div style={{ padding: 20, color: "var(--text)", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ margin: "0 0 4px", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase" }}>
          🧮 AI Accountant
        </h2>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          Finance intelligence from MES data. Busy remains the book of accounts — figures held only in Busy are marked <b>In Busy</b>, never invented. The AI reports and prepares entries; nothing is posted without approval.
        </div>
      </div>

      {err && <div style={{ ...card, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}

      {/* MANAGEMENT ALERTS BANNER */}
      {mgmtAlerts && mgmtAlerts.total > 0 && (
        <div style={{ ...card, borderColor: mgmtAlerts.by_severity?.CRITICAL ? "var(--crit-dim)" : "var(--crit-dim)", background: mgmtAlerts.by_severity?.CRITICAL ? "var(--crit-dim)" : "var(--gold-dim)" }}>
          <div style={{ ...label, fontSize: 13, marginBottom: 8, color: "var(--text)" }}>⚠ Needs management attention</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {mgmtAlerts.alerts.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 10 }}>
                <span style={chip(SEV[a.severity]?.bg || "#333", SEV[a.severity]?.fg || "#fff")}>{a.severity}</span>
                <div>
                  <b style={{ fontSize: 13 }}>{a.title}</b>
                  <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>{a.category} · {a.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TODAY / KPI ROW */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12 }}>
        <Stat title="Collections today" value={INR(cash.collections_today?.value)} hint={`${cash.collections_today?.count || 0} receipt(s) · MES`} />
        <Stat title="Bank balance" value={busyVal(cash.bank_balance)}
              hint={cash.bank_balance?.available
                ? (cash.bank_balance.source === "BANK"
                    ? `Bank feed · ${Array.isArray(cash.bank_balance.accounts) ? cash.bank_balance.accounts.length : cash.bank_balance.accounts} a/c${cash.bank_balance.as_of ? " · as of " + new Date(cash.bank_balance.as_of).toLocaleDateString("en-GB") : ""}`
                    : `Busy · ${cash.bank_balance.accounts} a/c`)
                : "Source: Busy"} />
        {cash.bank_movements_7d?.available && (
          <Stat title="Bank flow (7d)" value={INR(cash.bank_movements_7d.money_in - cash.bank_movements_7d.money_out)}
                hint={`In ${INR(cash.bank_movements_7d.money_in)} · Out ${INR(cash.bank_movements_7d.money_out)}`} />
        )}
        <Stat title="Receivables outstanding" value={INR(recv.total_outstanding)} hint={`Overdue ${INR(recv.total_overdue)}`} />
        <Stat title="Payables (open commitments)" value={INR(pay.total_open)} hint={`Overdue ${INR(pay.overdue_amount)} · Due wk ${INR(pay.due_this_week)}`} />
        <Stat title="Sales MTD" value={INR(sales.month_to_date?.value)} hint={`${sales.month_to_date?.invoices || 0} invoices`} />
        <Stat title="Purchases ordered MTD" value={INR(purch.month_to_date?.value)} hint="Order value · booked in Busy" />
        <Stat title="GST output (sales)" value={isUnavailable(gst.output_tax) ? busyChip : INR(gst.output_tax?.total)} hint="ITC in Busy" />
        <Stat title="Pending approvals" value={pending != null ? pending : "—"} hint="Awaiting human sign-off" tag={pending ? <span style={chip("var(--crit-dim)", "var(--gold-2)")}>action needed</span> : null} />
      </div>

      {/* ALERTS + RECOMMENDATIONS */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ ...label, fontSize: 13 }}>⚠ Items to review ({anomalies.total})</div>
            <div style={{ display: "flex", gap: 6 }}>
              {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map(k => (anomalies.by_severity?.[k] > 0)
                ? <span key={k} style={chip(SEV[k].bg, SEV[k].fg)}>{anomalies.by_severity[k]} {k[0]}</span> : null)}
            </div>
          </div>
          {!anomalies.items.length ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>No anomalies on MES data. Books look clean.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {anomalies.items.slice(0, 12).map((a) => (
                <div key={a.id} style={{ borderLeft: `3px solid ${SEV[a.severity]?.bar || "#555"}`, background: "var(--bg)", borderRadius: 6, padding: "8px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <b style={{ fontSize: 13 }}>{a.title}</b>
                    <span style={chip(SEV[a.severity]?.bg, SEV[a.severity]?.fg)}>{a.severity}</span>
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 3 }}>{a.evidence}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={card}>
          <div style={{ ...label, fontSize: 13, marginBottom: 10 }}>✅ Top actions today</div>
          {!recs.length ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>Nothing pressing.</div>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
              {recs.map((r, i) => <li key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>{r}</li>)}
            </ol>
          )}
        </div>
      </div>

      {/* NL ASSISTANT */}
      <div style={card}>
        <div style={{ ...label, fontSize: 13, marginBottom: 10 }}>💬 Ask the AI Accountant</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            style={{ flex: 1, minWidth: 260, padding: "10px 12px", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 }}
            placeholder='e.g. "How much do customers owe us?"  ·  "Find duplicate invoices"  ·  "What is our GST position?"'
            value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && ask()} />
          <button onClick={ask} disabled={asking || !q.trim()}
            style={{ background: "var(--yellow)", color: "#000", border: "none", borderRadius: 8, padding: "10px 20px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
            {asking ? "Thinking…" : "Ask"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {["How much do customers owe us?", "Which customers are overdue?", "Find duplicate invoices", "What is our GST position?", "What needs attention today?"].map(ex => (
            <button key={ex} onClick={() => setQ(ex)} style={{ background: "var(--bg)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>{ex}</button>
          ))}
        </div>
        {answer && (
          <div style={{ marginTop: 12, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6 }}>
            {answer.answer}
            {answer.confidence != null && (
              <div style={{ ...sub, marginTop: 8 }}>Confidence {Math.round(answer.confidence * 100)}% · {(answer.tools_used || []).join(", ") || "no tools"}{answer.agent ? ` · ${answer.agent}` : ""}</div>
            )}
          </div>
        )}
      </div>

      {/* CFO ANALYTICS */}
      {cfo && (cfo.cashflow || cfo.workingCapital || cfo.profitability) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: 16 }}>
          {cfo.cashflow && (
            <div style={card}>
              <div style={{ ...label, fontSize: 13, marginBottom: 8 }}>💵 30-day cash flow (net movement)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Best</span><b>{INR(cfo.cashflow.net_movement?.best)}</b></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Expected</span><b>{INR(cfo.cashflow.net_movement?.expected)}</b></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Worst</span><b>{INR(cfo.cashflow.net_movement?.worst)}</b></div>
              </div>
              <div style={{ ...sub, marginTop: 8 }}>Collections due {INR(cfo.cashflow.expected_collections?.on_time_due)} · commitments {INR(cfo.cashflow.expected_payments?.purchase_commitments_due)}. Opening cash {busyChip}. Net movement, not a closing balance.</div>
            </div>
          )}
          {cfo.workingCapital && (
            <div style={card}>
              <div style={{ ...label, fontSize: 13, marginBottom: 8 }}>🔄 Working capital</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>DSO (days)</span><b>{cfo.workingCapital.dso_days ?? "—"}</b></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>DPO (days)</span><b>{cfo.workingCapital.dpo_days ?? "—"}</b></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Inventory days</span>{busyChip}</div>
              </div>
              <div style={{ ...sub, marginTop: 8 }}>Estimates from a 12-month run-rate. Full CCC needs inventory valuation from Busy.</div>
            </div>
          )}
          {cfo.profitability && (
            <div style={card}>
              <div style={{ ...label, fontSize: 13, marginBottom: 8 }}>🏆 Top customers (net revenue, 12m)</div>
              {!cfo.profitability.customers?.length ? (
                <div style={{ color: "var(--muted)", fontSize: 13 }}>No invoiced sales yet.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead><tr>
                      <th style={{ textAlign: "left", color: "var(--muted)", fontWeight: 600, padding: "4px 6px" }}>Customer</th>
                      <th style={{ textAlign: "right", color: "var(--muted)", fontWeight: 600, padding: "4px 6px" }}>Net rev</th>
                      <th style={{ textAlign: "right", color: "var(--muted)", fontWeight: 600, padding: "4px 6px" }}>Overdue</th>
                    </tr></thead>
                    <tbody>
                      {cfo.profitability.customers.slice(0, 6).map(c => (
                        <tr key={c.partner_id}>
                          <td style={{ padding: "4px 6px" }}>{c.company_name}</td>
                          <td style={{ padding: "4px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{INR(c.net_revenue_12m)}</td>
                          <td style={{ padding: "4px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: c.overdue > 0 ? "var(--gold-2)" : "var(--muted)" }}>{INR(c.overdue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ ...sub, marginTop: 8 }}>Ranked by net revenue. True per-customer margin needs the costing link.</div>
            </div>
          )}
        </div>
      )}

      {/* DOCUMENT AI: PURCHASE / SALES / BANK */}
      <PurchaseInvoiceReview />
      <SalesInvoiceCheck />
      <BankReconcile />

      {/* SUPPLIER INTELLIGENCE + AUDIT TRAIL */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {supplier && (
          <div style={card}>
            <div style={{ ...label, fontSize: 13, marginBottom: 8 }}>🚚 Supplier intelligence</div>
            {supplier.price_alerts?.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                {supplier.price_alerts.slice(0, 5).map((a, i) => (
                  <div key={i} style={{ fontSize: 13, display: "flex", gap: 8 }}>
                    <span style={{ color: a.direction === "INCREASE" ? "var(--gold-2)" : "var(--green)", fontWeight: 700, minWidth: 70 }}>{a.direction === "INCREASE" ? "▲" : "▼"} {Math.abs(a.change_pct)}%</span>
                    <span>{a.message}</span>
                  </div>
                ))}
              </div>
            ) : <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 10 }}>{supplier.note || "No significant price moves."}</div>}
            {supplier.top_suppliers?.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <div style={{ ...label, fontSize: 11, marginBottom: 4 }}>Top suppliers (12m)</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <tbody>
                    {supplier.top_suppliers.slice(0, 5).map((s, i) => (
                      <tr key={i}>
                        <td style={{ padding: "3px 6px" }}>{s.supplier}</td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{INR(s.value_12m)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {auditRows && (
          <div style={card}>
            <div style={{ ...label, fontSize: 13, marginBottom: 8 }}>🧾 AI audit trail</div>
            {!auditRows.length ? (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>No AI-prepared actions recorded yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 260, overflowY: "auto" }}>
                {auditRows.map(a => (
                  <div key={a.audit_id} style={{ fontSize: 12.5, borderBottom: "1px solid var(--border)", paddingBottom: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <b>{a.action.replace(/_/g, " ")}</b>
                      <span style={{ color: "var(--muted)" }}>{new Date(a.ts).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div style={{ color: "var(--muted)" }}>{a.reason}{a.status ? ` · ${a.status}` : ""}{a.actor ? ` · ${a.actor}` : ""}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ ...sub, marginTop: 8 }}>Append-only record of every AI-prepared action (spec §21).</div>
          </div>
        )}
      </div>

      {/* MONTH-END CLOSE — readiness checklist */}
      <MonthEndClose />

      {/* COLLECTIONS — AR chase worklist */}
      <Collections />

      {/* GST RETURNS — GSTR-3B + GSTR-2B */}
      <GstReturns />

      {/* TDS CENTRE — editable section master + deduction calculator */}
      <TdsCenter />

      {/* BUSY SYNC + RECONCILIATION */}
      {busyStatus && (
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ ...label, fontSize: 13 }}>🔗 Busy sync {busyStatus.connected ? <span style={chip("var(--bg)", "var(--green)")}>connected</span> : <span style={chip("var(--surface)", "var(--purple)")}>not imported</span>}</div>
          </div>
          {!busyStatus.connected ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{busyStatus.note} Import Busy Outstanding / Bank / Trial Balance via <code>POST /api/ai/busy/import</code> (or the coming upload) to light up the "In Busy" fields and reconciliation.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {busyStatus.kinds.map(k => (
                  <span key={k.kind} style={chip("var(--bg)", "var(--muted)")}>{k.kind.replace(/_/g, " ")}: {k.rows} · {k.as_of ? new Date(k.as_of).toLocaleDateString("en-GB") : "—"}</span>
                ))}
              </div>
              {busyRecon?.available && (
                <div>
                  <div style={{ ...label, fontSize: 11, marginBottom: 4 }}>Receivables — MES vs Busy</div>
                  <div style={{ fontSize: 13, marginBottom: 6 }}>
                    MES {INR(busyRecon.totals.mes)} · Busy {INR(busyRecon.totals.busy)} · <b style={{ color: Math.abs(busyRecon.totals.difference) > 1 ? "var(--gold-2)" : "var(--green)" }}>diff {INR(busyRecon.totals.difference)}</b>
                    <span style={{ color: "var(--muted)" }}> · {busyRecon.counts.matched} matched, {busyRecon.counts.mismatch} mismatch, {busyRecon.counts.mes_only} MES-only, {busyRecon.counts.busy_only} Busy-only</span>
                  </div>
                  {busyRecon.mismatch?.slice(0, 5).map((m, i) => (
                    <div key={i} style={{ fontSize: 12.5, color: "var(--muted)" }}>• {m.party}: MES {INR(m.mes)} vs Busy {INR(m.busy)} (Δ {INR(m.delta)})</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* DAILY REPORT */}
      {report?.text && (
        <div style={card}>
          <div style={{ ...label, fontSize: 13, marginBottom: 10 }}>📊 Daily finance report</div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "var(--mono)", fontSize: 13, lineHeight: 1.6, color: "var(--text)" }}>{report.text}</pre>
        </div>
      )}

      <div style={{ color: "var(--muted)", fontSize: 11 }}>
        Snapshot as of {report?.snapshot?.as_of ? new Date(report.snapshot.as_of).toLocaleString("en-GB") : "—"}. Phase 0 — computed from MES data. Bank balance now from the live statement feed; supplier ledger arrives with the Busy read bridge; ITC from an uploaded GSTR-2B.
      </div>
    </div>
  );
}

// Month-end close — pre-close readiness checklist. Self-contained (own period + fetch).
function MonthEndClose() {
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [data, setData] = useState(null);

  useEffect(() => {
    let on = true;
    fetch(`${API}/api/ai/finance/month-end-close?period=${period}`, { headers: auth() })
      .then(r => r.json()).then(j => { if (on && !j.error) setData(j); }).catch(() => {});
    return () => { on = false; };
  }, [period]);

  const SB = { OK: { bg: "var(--bg)", fg: "var(--green)", t: "OK" }, REVIEW: { bg: "var(--gold-dim)", fg: "var(--gold)", t: "REVIEW" }, ACTION: { bg: "var(--crit-dim)", fg: "var(--crit)", t: "ACTION" } };

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div style={{ ...label, fontSize: 13 }}>📅 Month-end close</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {data && (data.ready_to_close
            ? <span style={chip("var(--bg)", "var(--green)")}>✓ Ready to close</span>
            : <span style={chip("var(--crit-dim)", "var(--crit)")}>{data.summary.action} to clear</span>)}
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
                 style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 13 }} />
        </div>
      </div>
      {!data ? <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading checklist…</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.items.map(it => {
            const s = SB[it.status] || SB.REVIEW;
            return (
              <div key={it.key} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px", background: "var(--bg)", borderRadius: 8, borderLeft: `3px solid ${s.fg}` }}>
                <span style={{ ...chip(s.bg, s.fg), minWidth: 56, textAlign: "center" }}>{s.t}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 600 }}>{it.label}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{it.detail}{it.hint ? <span style={{ color: s.fg }}> · {it.hint}</span> : null}</div>
                </div>
              </div>
            );
          })}
          <div style={{ ...sub, marginTop: 4 }}>Pre-close checklist from MES data — Busy stays the book of accounts; nothing is posted or closed here.</div>
        </div>
      )}
    </div>
  );
}

// Collections — AR chase worklist: who to chase (worst first), last reminder,
// promise-to-pay, with one-click WhatsApp reminder + an activity note. Self-contained.
function Collections() {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/ai/collections?limit=100`, { headers: auth() });
      const j = await r.json();
      if (r.ok) setData(j);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const remind = async (row) => {
    if (!window.confirm(`Send a WhatsApp payment reminder to ${row.company_name} for ${INR(row.overdue)} overdue?`)) return;
    setBusyId(row.partner_id); setMsg("");
    try {
      const r = await fetch(`${API}/api/ai/collections/${row.partner_id}/remind`, { method: "POST", headers: jsonH() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setMsg(`Reminder sent to ${row.company_name} (₹${j.amount}).`);
      load();
    } catch (e) { setMsg(e.message); }
    finally { setBusyId(null); }
  };
  const logNote = async (row) => {
    const note = window.prompt(`Collection note for ${row.company_name} (e.g. "promised payment by Fri"):`, "");
    if (note === null) return;
    const promise = window.prompt("Promise-to-pay date (YYYY-MM-DD), or leave blank:", "");
    const type = promise ? "PROMISE" : "NOTE";
    try {
      const r = await fetch(`${API}/api/ai/collections/${row.partner_id}/activity`, { method: "POST", headers: jsonH(), body: JSON.stringify({ type, note, promise_date: promise || null }) });
      if (r.ok) { setMsg(`Logged for ${row.company_name}.`); load(); } else setMsg((await r.json()).error || "Failed");
    } catch (e) { setMsg(e.message); }
  };

  const s = data?.summary, w = data?.worklist || [];
  const day = (d) => d ? new Date(d).toLocaleDateString("en-GB") : "—";
  const bk = (v, c) => <span style={{ fontVariantNumeric: "tabular-nums", color: c }}>{INR(v)}</span>;

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div style={{ ...label, fontSize: 13 }}>📞 Collections — chase worklist</div>
        {s && <div style={{ fontSize: 12, color: "var(--muted)" }}>DSO ~{s.dso_days != null ? Math.round(s.dso_days) + "d" : "—"} · DPO ~{s.dpo_days != null ? Math.round(s.dpo_days) + "d" : "—"}</div>}
      </div>
      {msg && <div style={{ fontSize: 12.5, color: msg.includes("sent") || msg.includes("Logged") ? "var(--green)" : "var(--crit)", marginBottom: 8 }}>{msg}</div>}

      {s && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <span style={chip("var(--bg)", "var(--green)")}>Current {INR(s.buckets.current)}</span>
          <span style={chip("var(--bg)", "var(--gold)")}>1–30 {INR(s.buckets.d1_30)}</span>
          <span style={chip("var(--bg)", "var(--idle)")}>31–60 {INR(s.buckets.d31_60)}</span>
          <span style={chip("var(--bg)", "var(--idle)")}>61–90 {INR(s.buckets.d61_90)}</span>
          <span style={chip("var(--crit-dim)", "var(--crit)")}>90+ {INR(s.buckets.d90_plus)}</span>
          <span style={chip("var(--bg)", "var(--text)")}>Overdue {INR(s.total_overdue)} · {s.overdue_customers} cust</span>
        </div>
      )}

      {!w.length ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Nothing outstanding to chase — receivables are clean (or none recorded yet).</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760, fontSize: 13 }}>
            <thead><tr>{["Customer", "Outstanding", "Overdue", "Oldest", "Last reminder", "Promise", "Actions"].map(h => <th key={h} style={{ textAlign: h === "Customer" ? "left" : "right", padding: "6px 8px", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>
              {w.slice(0, 40).map(r => (
                <tr key={r.partner_id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 8px" }}>{r.company_name}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{INR(r.outstanding)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{bk(r.overdue, r.overdue > 0 ? "var(--crit)" : "var(--muted)")}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: r.oldest_overdue_days > 60 ? "var(--crit)" : "var(--text)" }}>{r.oldest_overdue_days ? r.oldest_overdue_days + "d" : "—"}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--muted)" }}>{day(r.last_reminder)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: r.promise_date ? "var(--gold)" : "var(--muted)" }}>{day(r.promise_date)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={() => logNote(r)} style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", fontSize: 11.5, cursor: "pointer", marginRight: 5 }}>Log</button>
                    <button onClick={() => remind(r)} disabled={busyId === r.partner_id || !(r.overdue > 0)} title={r.phone ? "Send WhatsApp reminder" : "No WhatsApp number on file"}
                            style={{ background: r.overdue > 0 ? "var(--green-dim)" : "var(--bg)", color: r.overdue > 0 ? "var(--green)" : "var(--muted)", border: "none", borderRadius: 6, padding: "4px 9px", fontSize: 11.5, fontWeight: 600, cursor: r.overdue > 0 ? "pointer" : "not-allowed" }}>
                      {busyId === r.partner_id ? "…" : "Remind"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ ...sub, marginTop: 10 }}>Worst-overdue first. "Remind" sends the approved WhatsApp reminder (needs the customer's number + consent). Read-only on the ledger — no money is allocated here.</div>
    </div>
  );
}

// TDS centre — editable section master (rates/thresholds, no hardcodes) + a
// per-invoice deduction calculator. Suggestions only; Busy posts the statutory
// TDS entry. Self-contained like the other panels.
function TdsCenter() {
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState({});       // code -> draft row being edited
  const [msg, setMsg] = useState("");
  const [calc, setCalc] = useState({ section_code: "194C", amount: "", variant: "std", has_pan: true, fy_prior: "" });
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    try { const r = await fetch(`${API}/api/ai/tds/sections`, { headers: auth() }); const j = await r.json(); if (r.ok) setData(j); }
    catch { /* ignore */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (row) => {
    setMsg("");
    try {
      const r = await fetch(`${API}/api/ai/tds/sections`, { method: "PUT", headers: jsonH(), body: JSON.stringify(row) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setMsg(`Saved ${j.code}.`); setEdit(e => { const n = { ...e }; delete n[row.code]; return n; }); load();
    } catch (e) { setMsg(e.message); }
  };
  const del = async (code) => {
    if (!window.confirm(`Remove TDS section ${code}? (It only affects the MES suggestion.)`)) return;
    setMsg("");
    try { const r = await fetch(`${API}/api/ai/tds/sections/${encodeURIComponent(code)}`, { method: "DELETE", headers: auth() });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || `Failed (${r.status})`); setMsg(`Removed ${code}.`); load();
    } catch (e) { setMsg(e.message); }
  };
  const runCalc = async () => {
    setMsg(""); setResult(null);
    try {
      const body = { ...calc, amount: Number(calc.amount) || 0, fy_prior: Number(calc.fy_prior) || 0 };
      const r = await fetch(`${API}/api/ai/tds/compute`, { method: "POST", headers: jsonH(), body: JSON.stringify(body) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || `Failed (${r.status})`); setResult(j);
    } catch (e) { setMsg(e.message); }
  };

  const sections = data?.sections || [];
  const blank = { code: "", name: "", rate_pct: 0, rate_label: "", rate_alt_pct: "", rate_alt_label: "", no_pan_pct: 20, threshold_single: 0, threshold_aggregate: 0, notes: "", active: true };
  const th = { textAlign: "left", padding: "4px 6px", color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".03em", whiteSpace: "nowrap" };
  const td = { padding: "4px 6px", fontSize: 12.5, verticalAlign: "top" };
  const inp = { width: "100%", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 6px", color: "var(--text)", fontSize: 12.5 };
  const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" });
  const sel = { ...inp, width: "auto" };
  const Cell = ({ code, field, w, step }) => {
    const e = edit[code]; if (!e) return null;
    return <input style={{ ...inp, width: w || "100%" }} type={step !== undefined ? "number" : "text"} step={step} value={e[field] ?? ""} onChange={ev => setEdit(s => ({ ...s, [code]: { ...s[code], [field]: ev.target.value } }))} />;
  };

  return (
    <div style={{ ...card, marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <div style={{ ...label, fontSize: 13 }}>🧾 TDS centre <span style={chip("var(--surface)", "var(--purple)")}>editable master · FY 2026-27</span></div>
        <button style={btn("var(--bg)", "var(--link)")} onClick={() => setEdit(e => ({ ...e, "": { ...blank } }))}>+ Add section</button>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: msg.startsWith("Saved") || msg.startsWith("Removed") ? "var(--green)" : "var(--crit)", marginBottom: 8 }}>{msg}</div>}

      {/* Section master */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead><tr>
            <th style={th}>Section</th><th style={th}>Nature</th><th style={th}>Rate %</th><th style={th}>Alt %</th>
            <th style={th}>No-PAN %</th><th style={th}>Single ₹</th><th style={th}>FY agg ₹</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {edit[""] && (
              <tr style={{ background: "var(--bg)" }}>
                <td style={td}><Cell code="" field="code" w={70} /></td>
                <td style={td}><Cell code="" field="name" /></td>
                <td style={td}><Cell code="" field="rate_pct" w={60} step="0.001" /></td>
                <td style={td}><Cell code="" field="rate_alt_pct" w={60} step="0.001" /></td>
                <td style={td}><Cell code="" field="no_pan_pct" w={60} step="0.001" /></td>
                <td style={td}><Cell code="" field="threshold_single" w={90} step="1" /></td>
                <td style={td}><Cell code="" field="threshold_aggregate" w={90} step="1" /></td>
                <td style={td}><button style={btn("var(--green)", "#032")} onClick={() => save(edit[""])}>Save</button></td>
              </tr>
            )}
            {sections.map(s => {
              const e = edit[s.code];
              return (
                <tr key={s.code} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={td}><b>{s.code}</b></td>
                  {e ? <>
                    <td style={td}><Cell code={s.code} field="name" /></td>
                    <td style={td}><Cell code={s.code} field="rate_pct" w={60} step="0.001" /></td>
                    <td style={td}><Cell code={s.code} field="rate_alt_pct" w={60} step="0.001" /></td>
                    <td style={td}><Cell code={s.code} field="no_pan_pct" w={60} step="0.001" /></td>
                    <td style={td}><Cell code={s.code} field="threshold_single" w={90} step="1" /></td>
                    <td style={td}><Cell code={s.code} field="threshold_aggregate" w={90} step="1" /></td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <button style={btn("var(--green)", "#032")} onClick={() => save({ ...s, ...e })}>Save</button>{" "}
                      <button style={btn("var(--surface)", "var(--muted)")} onClick={() => setEdit(x => { const n = { ...x }; delete n[s.code]; return n; })}>✕</button>
                    </td>
                  </> : <>
                    <td style={td}>{s.name}{s.notes && <div style={{ ...sub, marginTop: 2 }}>{s.notes}</div>}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{Number(s.rate_pct)}%{s.rate_label && <div style={sub}>{s.rate_label}</div>}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{s.rate_alt_pct != null ? `${Number(s.rate_alt_pct)}%` : "—"}{s.rate_alt_label && <div style={sub}>{s.rate_alt_label}</div>}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{Number(s.no_pan_pct)}%</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{Number(s.threshold_single) ? INR(s.threshold_single) : "—"}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{Number(s.threshold_aggregate) ? INR(s.threshold_aggregate) : "—"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <button style={btn("var(--bg)", "var(--link)")} onClick={() => setEdit(x => ({ ...x, [s.code]: { ...s } }))}>Edit</button>{" "}
                      <button style={btn("var(--surface)", "var(--crit)")} onClick={() => del(s.code)}>Del</button>
                    </td>
                  </>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Deduction calculator */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
        <div style={{ ...label, fontSize: 12, marginBottom: 6 }}>Deduction calculator</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select style={sel} value={calc.section_code} onChange={e => setCalc(c => ({ ...c, section_code: e.target.value }))}>
            {sections.map(s => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
          </select>
          <input style={{ ...inp, width: 130 }} type="number" placeholder="Amount ₹" value={calc.amount} onChange={e => setCalc(c => ({ ...c, amount: e.target.value }))} />
          <input style={{ ...inp, width: 150 }} type="number" placeholder="Paid earlier this FY" value={calc.fy_prior} onChange={e => setCalc(c => ({ ...c, fy_prior: e.target.value }))} />
          <select style={sel} value={calc.variant} onChange={e => setCalc(c => ({ ...c, variant: e.target.value }))}>
            <option value="std">Standard rate</option><option value="alt">Alt rate</option>
          </select>
          <label style={{ fontSize: 12.5, display: "flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={calc.has_pan} onChange={e => setCalc(c => ({ ...c, has_pan: e.target.checked }))} /> Has PAN
          </label>
          <button style={btn("var(--link)", "#fff")} onClick={runCalc}>Compute</button>
        </div>
        {result && (
          <div style={{ marginTop: 10, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "baseline" }}>
            <div><div style={label}>TDS to deduct</div><div style={{ ...big, color: result.tds_amount ? "var(--gold-2)" : "var(--muted)" }}>{INR(result.tds_amount)}</div></div>
            <div><div style={label}>Rate applied</div><div style={big}>{result.rate_pct}% · {result.variant}</div></div>
            <div><div style={label}>Net payable</div><div style={big}>{INR(result.net_payable)}</div></div>
            {result.dutiable_base !== result.amount && <div><div style={label}>On value</div><div style={big}>{INR(result.dutiable_base)}</div></div>}
            <div style={{ ...sub, flexBasis: "100%" }}>{result.note}</div>
          </div>
        )}
      </div>
      <div style={{ ...sub, marginTop: 10 }}>{data?.note || "Rates/thresholds are a starting point — confirm with your CA. Editing here changes only the MES suggestion; Busy remains the statutory TDS book."}</div>
    </div>
  );
}

// GST returns — GSTR-3B (outward from MES, ITC from an uploaded GSTR-2B) and the
// 2B uploader. Self-contained: own period + fetch, so it doesn't touch the main load.
function GstReturns() {
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (per) => {
    try {
      const r = await fetch(`${API}/api/ai/gst/gstr3b?period=${per}`, { headers: auth() });
      const j = await r.json();
      if (r.ok) setData(j);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { load(period); }, [period, load]);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";
    setBusy(true); setMsg("");
    try {
      const text = await f.text();
      const r = await fetch(`${API}/api/ai/gst/gstr2b/import`, { method: "POST", headers: jsonH(), body: JSON.stringify({ json: text, period }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setMsg(`GSTR-2B loaded for ${j.period}: ${j.invoice_count} invoice(s), ${j.supplier_count} supplier(s), eligible ITC ${INR(j.eligible_itc.total)}.`);
      load(period);
    } catch (e2) { setMsg(e2.message); }
    finally { setBusy(false); }
  };

  const o = data?.section_3_1_outward, itc = data?.section_4_itc, net = data?.net_tax_payable;
  const Line = ({ k, v, c }) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
      <span style={{ color: "var(--muted)" }}>{k}</span><span style={{ fontVariantNumeric: "tabular-nums", color: c || "var(--text)" }}>{v}</span>
    </div>
  );

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        <div style={{ ...label, fontSize: 13 }}>🧾 GST returns — GSTR-3B</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
                 style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 13 }} />
          <label style={{ display: "inline-block", background: "var(--surface)", color: "var(--text)", border: "none", borderRadius: 7, padding: "6px 12px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
            {busy ? "Loading…" : "Upload GSTR-2B (JSON)"}
            <input type="file" accept=".json,application/json" onChange={onFile} style={{ display: "none" }} />
          </label>
        </div>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: msg.includes("eligible") ? "var(--green)" : "var(--crit)", marginBottom: 8 }}>{msg}</div>}

      {o ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
          <div>
            <div style={{ ...label, fontSize: 11, marginBottom: 4 }}>3.1 Outward (sales) · MES</div>
            <Line k="Taxable (net of CN)" v={INR(o.net_taxable)} />
            <Line k="Output tax (net)" v={INR(o.net_output_tax)} />
            <Line k="Invoices" v={o.gross.invoices} />
            {o.credit_notes.count > 0 && <Line k="Credit notes" v={`${o.credit_notes.count} · ${INR(o.credit_notes.tax)}`} />}
          </div>
          <div>
            <div style={{ ...label, fontSize: 11, marginBottom: 4 }}>4. ITC (purchases)</div>
            {itc?.available ? (
              <>
                <Line k="IGST" v={INR(itc.igst)} /><Line k="CGST" v={INR(itc.cgst)} /><Line k="SGST" v={INR(itc.sgst)} />
                <Line k="Eligible ITC" v={INR(itc.total)} c="var(--green)" />
                <div style={{ ...sub }}>From GSTR-2B · {itc.as_of ? new Date(itc.as_of).toLocaleDateString("en-GB") : ""}</div>
              </>
            ) : (
              <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{busyChip} <div style={{ marginTop: 6 }}>Upload the GSTR-2B JSON for {period} to fill ITC and compute net tax.</div></div>
            )}
          </div>
          <div>
            <div style={{ ...label, fontSize: 11, marginBottom: 4 }}>Net tax payable {net?.indicative && <span style={chip("var(--gold-dim)", "var(--gold)")}>indicative</span>}</div>
            {net?.indicative ? (
              <>
                <Line k="IGST" v={INR(net.igst)} /><Line k="CGST" v={INR(net.cgst)} /><Line k="SGST" v={INR(net.sgst)} />
                <div style={{ ...sub }}>Output − eligible ITC per head. Verify set-off order before filing.</div>
              </>
            ) : <div style={{ color: "var(--muted)", fontSize: 12.5 }}>Needs ITC — upload GSTR-2B.</div>}
          </div>
        </div>
      ) : <div style={{ color: "var(--muted)", fontSize: 13 }}>Pick a period to prepare GSTR-3B.</div>}

      <div style={{ ...sub, marginTop: 10 }}>Outward from MES tax invoices; ITC from your uploaded GSTR-2B. Prepared for review — nothing is filed or paid. Verify on the portal before submission.</div>
    </div>
  );
}
