// Debt & Loans — CFO module §10. Facility register + amortization schedule +
// debt-service calendar + portfolio summary. Schedules are computed from the
// stored terms; nothing is read from or posted to Busy.
import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });
const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB").replace(/\//g, "-") : "—");
const inr = (n) => (n === null || n === undefined || n === "" ? "—" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };
const inp = { background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 9px", fontSize: 13, boxSizing: "border-box", width: "100%" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 7, padding: "6px 13px", fontWeight: 600, fontSize: 12, cursor: "pointer" });
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "8px 10px", fontSize: 13, borderTop: "1px solid var(--border)" };
const rtd = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

const TYPES = ["TERM_LOAN", "MACHINERY", "WORKING_CAPITAL", "CC_OD", "OTHER", "PROJECT"];
const TYPE_LABEL = { TERM_LOAN: "Term loan", MACHINERY: "Machinery", WORKING_CAPITAL: "Working capital", CC_OD: "CC / OD", OTHER: "Other", PROJECT: "Project" };
const FREQ = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"];

const emptyForm = {
  lender: "", lender_ref: "", facility_type: "TERM_LOAN", sanctioned_amount: "", disbursed_amount: "",
  outstanding_amount: "", interest_rate: "", rate_type: "FIXED", repayment_frequency: "MONTHLY",
  tenure_months: "", moratorium_months: "0", moratorium_type: "NONE", balloon_amount: "0",
  start_date: "", first_due_date: "", security: "", notes: "", status: "ACTIVE", source: "LENDER_CONFIRMED",
};

export default function DebtManagement() {
  const [list, setList] = useState([]);
  const [summary, setSummary] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [sel, setSel] = useState(null);       // facility detail {row, schedule, totals}
  const [form, setForm] = useState(null);      // create/edit form or null
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const [l, s, c] = await Promise.all([
        fetch(`${API}/api/loans`, { headers: auth() }).then(r => r.json()),
        fetch(`${API}/api/loans/summary`, { headers: auth() }).then(r => r.json()),
        fetch(`${API}/api/loans/calendar`, { headers: auth() }).then(r => r.json()),
      ]);
      setList(Array.isArray(l) ? l : []);
      setSummary(s && !s.error ? s : null);
      setCalendar(c && !c.error ? c : null);
    } catch (e) { setMsg(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openDetail = async (id) => {
    const d = await fetch(`${API}/api/loans/${id}`, { headers: auth() }).then(r => r.json());
    if (!d.error) setSel(d);
  };
  const save = async () => {
    const edit = form.facility_id;
    const r = await fetch(`${API}/api/loans${edit ? "/" + edit : ""}`, {
      method: edit ? "PUT" : "POST", headers: jsonH(), body: JSON.stringify(form),
    });
    const d = await r.json();
    if (!r.ok) { alert(d.error || "Save failed"); return; }
    setForm(null); setMsg(edit ? "Facility updated." : "Facility created."); setTimeout(() => setMsg(""), 3000);
    load(); if (sel) openDetail(sel.row.facility_id);
  };
  const recordPay = async (facilityId, installment_no, total_due) => {
    const amt = window.prompt(`Payment amount for installment #${installment_no} (due ${inr(total_due)}):`, total_due);
    if (amt == null) return;
    const r = await fetch(`${API}/api/loans/${facilityId}/payments`, { method: "POST", headers: jsonH(), body: JSON.stringify({ installment_no, amount: Number(amt) }) });
    if (r.ok) { openDetail(facilityId); load(); } else alert((await r.json()).error || "Failed");
  };

  const F = ({ k, lb, type = "text", opts }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ ...label, fontSize: 10 }}>{lb}</span>
      {opts ? (
        <select style={inp} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })}>
          {opts.map(o => <option key={o} value={o}>{TYPE_LABEL[o] || o.replace(/_/g, " ")}</option>)}
        </select>
      ) : (
        <input style={inp} type={type} value={form[k] ?? ""} onChange={e => setForm({ ...form, [k]: e.target.value })} />
      )}
    </div>
  );

  const Stat = ({ k, v, c }) => (
    <div style={{ background: "var(--bg)", borderRadius: 8, padding: "12px 14px", flex: "1 1 150px" }}>
      <div style={label}>{k}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: c || "var(--text)", marginTop: 4 }}>{v}</div>
    </div>
  );

  return (
    <div style={{ padding: 18, maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0 }}>🏛️ Debt & Loans</h2>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Facility register + computed amortization. Schedules are modelled from the stored terms — nothing is read from Busy.</div>
        </div>
        <button style={btn("var(--accent, var(--gold))", "var(--surface)")} onClick={() => setForm({ ...emptyForm })}>+ Add facility</button>
      </div>
      {msg && <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 10 }}>{msg}</div>}

      {summary && (
        <div style={{ ...card, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Stat k="Total outstanding" v={inr(summary.total_outstanding)} />
          <Stat k="Sanctioned" v={inr(summary.total_sanctioned)} />
          <Stat k="Remaining interest" v={inr(summary.remaining_interest)} />
          <Stat k="Service — next 30 days" v={inr(summary.service_next_30d)} />
          <Stat k="Service — next 90 days" v={inr(summary.service_next_90d)} />
          <Stat k="Overdue" v={inr(summary.overdue_amount)} c={summary.overdue_amount > 0 ? "var(--crit)" : undefined} />
        </div>
      )}

      <div style={card}>
        <div style={{ ...label, marginBottom: 8 }}>Facilities</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              {["Code", "Lender", "Type", "Sanctioned", "Outstanding", "Rate", "Next due", "Status", ""].map((h, i) =>
                <th key={i} style={{ ...th, textAlign: i >= 3 && i <= 5 ? "right" : "left" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {!list.length && <tr><td style={{ ...td, color: "var(--muted)" }} colSpan={9}>No facilities yet. Add one to model its schedule.</td></tr>}
              {list.map(f => (
                <tr key={f.facility_id}>
                  <td style={td}>{f.loan_code || "—"}</td>
                  <td style={td}>{f.lender}{f.source === "MANUAL_ASSUMPTION" && <span style={{ fontSize: 10, color: "var(--gold)", marginLeft: 5 }}>assumed</span>}</td>
                  <td style={td}>{TYPE_LABEL[f.facility_type] || f.facility_type}</td>
                  <td style={rtd}>{inr(f.sanctioned_amount)}</td>
                  <td style={rtd}>{inr(f.outstanding_amount)}</td>
                  <td style={rtd}>{f.interest_rate}% {f.rate_type === "FLOATING" ? "fl" : ""}</td>
                  <td style={td}>{day(f.next_due_date)}</td>
                  <td style={td}><span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 5, background: f.status === "ACTIVE" ? "var(--green-dim)" : "var(--bg)", color: f.status === "ACTIVE" ? "var(--green)" : "var(--muted)" }}>{f.status}</span></td>
                  <td style={td}>
                    <button style={btn("var(--bg)", "var(--text)")} onClick={() => openDetail(f.facility_id)}>Schedule</button>{" "}
                    <button style={btn("var(--bg)", "var(--text)")} onClick={() => setForm({ ...emptyForm, ...f, start_date: f.start_date ? f.start_date.slice(0, 10) : "", first_due_date: f.first_due_date ? f.first_due_date.slice(0, 10) : "" })}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {calendar && calendar.installments && calendar.installments.length > 0 && (
        <div style={card}>
          <div style={{ ...label, marginBottom: 8 }}>Debt-service calendar — next 12 months ({inr(calendar.totals.total)} total)</div>
          <div style={{ overflowX: "auto", maxHeight: 260, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Due", "Facility", "#", "Principal", "Interest", "Total", "Status"].map((h, i) => <th key={i} style={{ ...th, textAlign: i >= 3 && i <= 5 ? "right" : "left" }}>{h}</th>)}</tr></thead>
              <tbody>
                {calendar.installments.map((r, i) => (
                  <tr key={i}>
                    <td style={td}>{day(r.due_date)}</td>
                    <td style={td}>{r.loan_code} <span style={{ color: "var(--muted)" }}>{r.lender}</span>{r.is_balloon && <span style={{ fontSize: 10, color: "var(--gold)", marginLeft: 4 }}>balloon</span>}</td>
                    <td style={td}>{r.installment_no}</td>
                    <td style={rtd}>{inr(r.principal_due)}</td>
                    <td style={rtd}>{inr(r.interest_due)}</td>
                    <td style={rtd}>{inr(r.total_due)}</td>
                    <td style={td}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Schedule detail */}
      {sel && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: 24, zIndex: 50, overflowY: "auto" }} onClick={() => setSel(null)}>
          <div style={{ ...card, maxWidth: 760, width: "100%", marginTop: 20 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>{sel.row.loan_code} — {sel.row.lender}</h3>
              <button style={btn("var(--bg)", "var(--text)")} onClick={() => setSel(null)}>✕</button>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>
              {TYPE_LABEL[sel.row.facility_type]} · {sel.row.interest_rate}% {sel.row.rate_type} · {sel.row.repayment_frequency?.toLowerCase()} ·
              {sel.totals.installments} installments · total interest {inr(sel.totals.total_interest)} · paid {inr(sel.totals.total_paid)}
            </div>
            {sel.schedule.length === 0
              ? <div style={{ color: "var(--muted)", fontSize: 13 }}>Revolving facility (CC/OD) — interest accrues on utilisation; no fixed amortization schedule.</div>
              : (
                <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>{["#", "Due", "Opening", "Principal", "Interest", "Total", "Closing", ""].map((h, i) => <th key={i} style={{ ...th, textAlign: i >= 2 && i <= 6 ? "right" : "left" }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {sel.schedule.map(s => (
                        <tr key={s.installment_no} style={{ opacity: s.status === "PAID" ? 0.55 : 1 }}>
                          <td style={td}>{s.installment_no}{s.is_balloon && " 🎈"}</td>
                          <td style={td}>{day(s.due_date)}</td>
                          <td style={rtd}>{inr(s.opening_balance)}</td>
                          <td style={rtd}>{inr(s.principal_due)}</td>
                          <td style={rtd}>{inr(s.interest_due)}</td>
                          <td style={rtd}>{inr(s.total_due)}</td>
                          <td style={rtd}>{inr(s.closing_balance)}</td>
                          <td style={td}>{s.status === "PAID" ? <span style={{ color: "var(--green)" }}>paid</span> : <button style={btn("var(--bg)", "var(--text)")} onClick={() => recordPay(sel.row.facility_id, s.installment_no, s.total_due)}>Pay</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </div>
      )}

      {/* Create / edit form */}
      {form && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: 24, zIndex: 50, overflowY: "auto" }} onClick={() => setForm(null)}>
          <div style={{ ...card, maxWidth: 680, width: "100%", marginTop: 10 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{form.facility_id ? "Edit facility" : "Add facility"}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <F k="lender" lb="Lender *" />
              <F k="lender_ref" lb="Lender reference" />
              <F k="facility_type" lb="Type" opts={TYPES} />
              <F k="source" lb="Source" opts={["LENDER_CONFIRMED", "MANUAL_ASSUMPTION"]} />
              <F k="sanctioned_amount" lb="Sanctioned (₹) *" type="number" />
              <F k="disbursed_amount" lb="Disbursed (₹)" type="number" />
              <F k="outstanding_amount" lb="Outstanding (₹)" type="number" />
              <F k="interest_rate" lb="Interest rate (% p.a.)" type="number" />
              <F k="rate_type" lb="Rate type" opts={["FIXED", "FLOATING"]} />
              <F k="repayment_frequency" lb="Frequency" opts={FREQ} />
              <F k="tenure_months" lb="Tenure (months)" type="number" />
              <F k="moratorium_months" lb="Moratorium (months)" type="number" />
              <F k="moratorium_type" lb="Moratorium type" opts={["NONE", "INTEREST_ONLY", "FULL"]} />
              <F k="balloon_amount" lb="Balloon (₹)" type="number" />
              <F k="start_date" lb="Start date" type="date" />
              <F k="first_due_date" lb="First due date" type="date" />
              <F k="status" lb="Status" opts={["ACTIVE", "PROPOSED", "CLOSED"]} />
            </div>
            <div style={{ marginTop: 10 }}><F k="security" lb="Security / notes" /></div>
            <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 8 }}>CC/OD is revolving — no amortization schedule is generated. For a term/machinery loan, tenure + first due date + rate are required.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button style={btn("var(--accent, var(--gold))", "var(--surface)")} onClick={save}>{form.facility_id ? "Save & regenerate" : "Create"}</button>
              <button style={btn("var(--bg)", "var(--text)")} onClick={() => setForm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
