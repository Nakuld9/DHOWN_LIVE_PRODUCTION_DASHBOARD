// Financial dashboard — receivables, collections and credit exposure.
//
// Ordered by what gets acted on. Overdue money and customers past their credit
// limit come first, because those are the rows someone picks up the phone
// about. The trend is last: useful, but nobody does anything about it today.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");

const card = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  padding: "16px",
};

const money = (v) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const moneyExact = (v) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const th = { padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const thL = { ...th, textAlign: "left" };
const td = { padding: "8px 10px", textAlign: "right", fontSize: 13, fontVariantNumeric: "tabular-nums", borderTop: "1px solid var(--surface)" };
const tdL = { ...td, textAlign: "left" };

const firstOfMonth = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };

export default function FinancialDashboard() {
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`${API}/api/reports/financial-dashboard?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setD(j);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  if (loading && !d) return <div style={{ padding: 20, color: "var(--muted)" }}>Loading…</div>;

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Financial Dashboard</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        Receivables are a position as at today. Collections are for the selected period.
      </div>

      <div style={{ ...card, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          Collections from<br />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                 style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 9px", marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          to<br />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                 style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 9px", marginTop: 4 }} />
        </label>
        <button onClick={load} disabled={loading}
                style={{ background: "var(--yellow)", color: "#000", border: "none", borderRadius: 6, padding: "9px 18px", fontWeight: 700, cursor: "pointer" }}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {err && <div style={{ ...card, marginTop: 14, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}

      {d && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginTop: 14 }}>
            <KPI title="OUTSTANDING" value={money(d.receivables.outstanding)}
                 sub={`${d.receivables.open_invoices} open invoices`} />
            <KPI title="OVERDUE" value={money(d.receivables.overdue)}
                 color={d.receivables.overdue > 0 ? "var(--crit)" : "var(--green)"}
                 sub={`${d.receivables.overdue_pct}% of the book`} />
            <KPI title="COLLECTED (PERIOD)" value={money(d.collections.received)}
                 color="var(--green)" sub={`${d.collections.receipts} receipts`} />
            <KPI title="UNAPPLIED CREDIT" value={money(d.receivables.unapplied_credit)}
                 color={d.receivables.unapplied_credit > 0 ? "var(--gold)" : undefined}
                 sub="paid, not yet against an invoice" />
            <KPI title="OVER CREDIT LIMIT" value={d.exposure.over_limit.length}
                 color={d.exposure.over_limit.length ? "var(--crit)" : "var(--green)"}
                 sub={`of ${d.exposure.customers_owing} owing`} />
            <KPI title="DSO (APPROX)" value={d.receivables.dso_days == null ? "—" : `${d.receivables.dso_days} days`}
                 sub="on 90 days of sales" />
          </div>

          {/* Ageing — the shape of the debt, not just its size. */}
          <div style={{ ...card, marginTop: 14 }}>
            <SectionTitle>Ageing</SectionTitle>
            <AgeingBar ageing={d.receivables.ageing} total={d.receivables.outstanding} />
          </div>

          {/* Over-limit first: these are the rows that stop an order going out. */}
          {d.exposure.over_limit.length > 0 && (
            <div style={{ ...card, marginTop: 14, borderColor: "var(--crit-dim)" }}>
              <SectionTitle color="var(--crit)">Over credit limit</SectionTitle>
              <Table
                head={["Customer", "Outstanding", "Limit", "Used", "Overdue", "Oldest"]}
                rows={d.exposure.over_limit.map(x => [
                  x.company_name, moneyExact(x.outstanding), moneyExact(x.credit_limit),
                  `${x.utilisation}%`, moneyExact(x.overdue),
                  x.oldest_overdue_days ? `${x.oldest_overdue_days}d` : "—",
                ])}
              />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 14, marginTop: 14 }}>
            <div style={card}>
              <SectionTitle>Top debtors</SectionTitle>
              <Table
                head={["Customer", "Outstanding", "Overdue", "Used"]}
                rows={d.exposure.top_debtors.map(x => [
                  x.company_name, moneyExact(x.outstanding), moneyExact(x.overdue),
                  x.utilisation == null ? "no limit" : `${x.utilisation}%`,
                ])}
                empty="Nobody owes anything."
              />
              {d.exposure.no_limit_set > 0 && (
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                  {d.exposure.no_limit_set} customer{d.exposure.no_limit_set === 1 ? " has" : "s have"} no
                  credit limit set, so exposure cannot be judged for them.
                </div>
              )}
            </div>

            <div style={card}>
              <SectionTitle>Collections by mode</SectionTitle>
              <Table
                head={["Mode", "Receipts", "Amount"]}
                rows={d.collections.by_mode.map(m => [m.mode, m.receipts, moneyExact(m.amount)])}
                empty="No receipts in this period."
              />
              {d.collections.on_account > 0 && (
                <div style={{ color: "var(--gold)", fontSize: 12, marginTop: 8 }}>
                  {moneyExact(d.collections.on_account)} of this is not yet applied to an invoice.
                </div>
              )}
            </div>
          </div>

          <div style={{ ...card, marginTop: 14 }}>
            <SectionTitle>Invoiced vs collected, last 12 months</SectionTitle>
            <TrendBars trend={d.trend} />
          </div>
        </>
      )}
    </div>
  );
}

function SectionTitle({ children, color }) {
  return (
    <div style={{ color: color || "var(--yellow)", fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
      {children}
    </div>
  );
}

function KPI({ title, value, sub, color }) {
  return (
    <div style={card}>
      <div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: 0.4 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: color || "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub && <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// A single stacked bar reads faster than five numbers, and the colour ramp
// carries the meaning: green is money that is not late yet, red is money that
// has been outstanding for over ninety days.
const AGE_BANDS = [
  ["current", "Not due", "var(--green)"],
  ["d1_30", "1–30", "var(--green)"],
  ["d31_60", "31–60", "var(--gold)"],
  ["d61_90", "61–90", "var(--idle)"],
  ["d90_plus", "90+", "var(--crit)"],
];

function AgeingBar({ ageing, total }) {
  if (!total) return <div style={{ color: "var(--muted)", fontSize: 13 }}>Nothing outstanding.</div>;
  return (
    <>
      <div style={{ display: "flex", height: 22, borderRadius: 6, overflow: "hidden", background: "var(--surface)" }}>
        {AGE_BANDS.map(([k, , colour]) => {
          const pct = (Number(ageing[k]) / total) * 100;
          if (!(pct > 0)) return null;
          return <div key={k} style={{ width: `${pct}%`, background: colour }} title={`${money(ageing[k])}`} />;
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10 }}>
        {AGE_BANDS.map(([k, label, colour]) => (
          <div key={k} style={{ fontSize: 12 }}>
            <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: colour, marginRight: 6 }} />
            <span style={{ color: "var(--muted)" }}>{label} days</span>{" "}
            <b style={{ fontVariantNumeric: "tabular-nums" }}>{money(ageing[k])}</b>
          </div>
        ))}
      </div>
    </>
  );
}

function TrendBars({ trend }) {
  const max = Math.max(1, ...trend.map(m => Math.max(m.invoiced, m.collected)));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 150, overflowX: "auto", paddingTop: 8 }}>
      {trend.map(m => (
        <div key={m.month} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 46 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 110 }}>
            <div title={`Invoiced ${money(m.invoiced)}`}
                 style={{ width: 14, height: `${(m.invoiced / max) * 100}%`, background: "var(--link)", borderRadius: "2px 2px 0 0", minHeight: m.invoiced > 0 ? 2 : 0 }} />
            <div title={`Collected ${money(m.collected)}`}
                 style={{ width: 14, height: `${(m.collected / max) * 100}%`, background: "var(--green)", borderRadius: "2px 2px 0 0", minHeight: m.collected > 0 ? 2 : 0 }} />
          </div>
          <div style={{ color: "var(--muted)", fontSize: 10, marginTop: 6 }}>{m.month.slice(5)}/{m.month.slice(2, 4)}</div>
        </div>
      ))}
      <div style={{ marginLeft: 12, fontSize: 12, alignSelf: "flex-start" }}>
        <div><span style={{ display: "inline-block", width: 9, height: 9, background: "var(--link)", marginRight: 6 }} />Invoiced</div>
        <div style={{ marginTop: 4 }}><span style={{ display: "inline-block", width: 9, height: 9, background: "var(--green)", marginRight: 6 }} />Collected</div>
      </div>
    </div>
  );
}

function Table({ head, rows, empty }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{head.map((h, i) => <th key={h} style={i === 0 ? thL : th}>{h}</th>)}</tr></thead>
        <tbody>
          {!rows.length && <tr><td colSpan={head.length} style={{ ...tdL, color: "var(--muted)" }}>{empty || "Nothing to show."}</td></tr>}
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} style={j === 0 ? tdL : td}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
