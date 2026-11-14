// Compliance — the clocks that run out quietly.
//
// Ordered by consequence, not by date. An expired e-way bill is a fine at a
// checkpost today; a return sitting in draft is money we are wrongly chasing.
// A screen sorted newest-first would bury the thing expiring this afternoon
// under things logged this morning.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "8px 10px", textAlign: "left", fontSize: 13, borderTop: "1px solid var(--surface)" };
const money = (v) => (v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`);
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—");

export default function Compliance() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`${API}/api/reports/compliance`, { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setD(j);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !d) return <div style={{ padding: 20, color: "var(--muted)" }}>Loading…</div>;

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Compliance Board</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        Everything with a deadline attached, in one place, ordered by what costs money soonest.
        This board is read-only — to raise or cancel an e-way bill, use{" "}
        <a href="/eway" style={{ color: "var(--yellow)" }}>E-way Bills</a>.
      </div>

      {err && <div style={{ ...card, marginBottom: 12, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}

      {d && d.statutory && (
        <Section title="Statutory due dates" tone="var(--gold)"
                 note={d.statutory.assumptions}>
          <Table
            head={["Obligation", "Category", "Period", "Due date", "In"]}
            rows={d.statutory.items.map((s) => {
              const col = s.days_until <= 3 ? "var(--crit)" : s.days_until <= 7 ? "var(--gold-deep)" : "var(--muted)";
              return [
                <span key="n" style={{ fontWeight: 600 }} title={s.note || ""}>{s.name}</span>,
                <span key="c" style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".06em", padding: "2px 8px", borderRadius: 99, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--muted)" }}>{s.category}</span>,
                s.period || "—",
                day(s.due_date),
                <span key="d" style={{ color: col, fontWeight: 700 }}>{s.days_until < 0 ? "overdue" : s.days_until === 0 ? "today" : `${s.days_until}d`}</span>,
              ];
            })}
          />
        </Section>
      )}

      {d && d.clear && (
        <div style={{ ...card, borderColor: "var(--green-dim)", color: "var(--green)" }}>
          ✓ Nothing outstanding. No e-way bills near expiry, every dispatch has a proof of delivery,
          no returns waiting on a decision, and every credit note is applied.
        </div>
      )}

      {d && !d.clear && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
            <KPI title="E-WAY EXPIRED" value={d.eway.expired}
                 color={d.eway.expired ? "var(--crit)" : "var(--green)"} sub="fine risk at a checkpost" />
            <KPI title="E-WAY EXPIRING" value={d.eway.expiring}
                 color={d.eway.expiring ? "var(--gold)" : "var(--green)"}
                 sub={`within ${d.settings.eway_within_hours}h`} />
            <KPI title="PODS OUTSTANDING" value={d.pod.count}
                 color={d.pod.count ? "var(--gold)" : "var(--green)"} sub={money(d.pod.value)} />
            <KPI title="RETURNS PENDING" value={d.returns.count}
                 color={d.returns.count ? "var(--gold)" : "var(--green)"} sub={money(d.returns.value)} />
            <KPI title="CREDIT NOTES UNAPPLIED" value={d.credit_notes.count}
                 color={d.credit_notes.count ? "var(--gold)" : "var(--green)"} sub={money(d.credit_notes.value)} />
          </div>

          {d.eway.items.length > 0 && (
            <Section title="E-way bills expiring or expired" tone="var(--crit)"
                     note="Goods moving on an expired bill are a detention risk, and the fine lands on us.">
              <Table
                head={["E-way no.", "Customer", "Dispatch", "Vehicle", "Valid until", "Left", "Value"]}
                rows={d.eway.items.map(e => [
                  e.eway_no, e.company_name || "—", e.dispatch_number || "—", e.vehicle_number || "—",
                  e.valid_until ? new Date(e.valid_until).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-') : "—",
                  <span key="h" style={{ color: e.expired ? "var(--crit)" : "var(--gold)", fontWeight: 600 }}>
                    {e.expired ? "EXPIRED" : `${e.hours_left}h`}
                  </span>,
                  money(e.doc_value),
                ])}
              />
            </Section>
          )}

          {d.pod.items.length > 0 && (
            <Section title="Dispatches with no proof of delivery" tone="var(--gold)"
                     note={`Older than ${d.settings.pod_older_than_days} days. "We never received it" is unanswerable without a POD.`}>
              <Table
                head={["Challan", "Date", "Customer", "Vehicle", "LR", "Days", "Value"]}
                rows={d.pod.items.map(p => [
                  p.dispatch_number, day(p.dispatch_date), p.company_name || "—",
                  p.vehicle_number || "—", p.lr_number || "—",
                  <b key="d" style={{ color: p.days_since > 14 ? "var(--crit)" : "var(--gold)" }}>{p.days_since}</b>,
                  money(p.grand_total),
                ])}
              />
            </Section>
          )}

          {d.returns.items.length > 0 && (
            <Section title="Sales returns waiting on a decision" tone="var(--gold)"
                     note="Goods are back but the customer has not been credited — we are still chasing money for fabric in our own warehouse.">
              <Table
                head={["Return", "Date", "Customer", "Reason", "Disposition", "Open", "Value"]}
                rows={d.returns.items.map(r => [
                  r.return_number, day(r.return_date), r.company_name || "—",
                  (r.reason || "").replace(/_/g, " "), r.disposition || "—",
                  `${r.days_open}d`, money(r.total_value),
                ])}
              />
            </Section>
          )}

          {d.credit_notes.items.length > 0 && (
            <Section title="Credit notes not applied to an invoice" tone="var(--gold)"
                     note="The customer has been promised the money back and is still being chased for it.">
              <Table
                head={["Note", "Date", "Customer", "Amount", "Unapplied", ""]}
                rows={d.credit_notes.items.map(n => [
                  n.note_number, day(n.note_date), n.company_name || "—",
                  money(n.amount), <b key="u" style={{ color: "var(--gold)" }}>{money(n.unapplied)}</b>,
                  <a key="p" href="#"
                     onClick={(ev) => { ev.preventDefault(); openPdf(n.note_id, setErr); }}
                     style={{ color: "var(--yellow)", cursor: "pointer" }}>PDF</a>,
                ])}
              />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

// The PDF route needs the bearer token, so it cannot be a plain link.
async function openPdf(id, setErr) {
  try {
    const r = await fetch(`${API}/api/wa/credit-notes/${id}/pdf`, { headers: auth() });
    if (!r.ok) {
      let m = `Could not open the credit note (${r.status})`;
      try { const j = await r.json(); if (j.error) m = j.error; } catch { /* not JSON */ }
      throw new Error(m);
    }
    const url = URL.createObjectURL(await r.blob());
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { setErr(e.message); }
}

function KPI({ title, value, sub, color }) {
  return (
    <div style={card}>
      <div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: 0.4 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: color || "var(--text)" }}>{value}</div>
      {sub && <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, note, tone, children }) {
  return (
    <div style={{ ...card, marginTop: 14 }}>
      <div style={{ color: tone, fontWeight: 700, fontSize: 14 }}>{title}</div>
      {note && <div style={{ color: "var(--muted)", fontSize: 12, margin: "4px 0 10px" }}>{note}</div>}
      {children}
    </div>
  );
}

function Table({ head, rows }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
        <thead><tr>{head.map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={td}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
