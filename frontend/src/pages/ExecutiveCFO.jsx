// Executive CFO dashboard — CFO module §4. One consolidated view of cash, revenue,
// receivables/payables, debt, cash-flow, budget and profitability. MES-sourced KPIs
// show live; Busy-only ones are clearly marked "In Busy", never faked.
import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const inr = (n) => (n === null || n === undefined ? null : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 }));
const fmt = (k) => { if (k.value === null || !k.available) return null; if (k.unit === "INR") return inr(k.value); if (k.unit === "PCT") return k.value + "%"; if (k.unit === "DAYS") return k.value + " d"; return String(k.value); };
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };

export default function ExecutiveCFO() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { fetch(`${API}/api/cfo/dashboard`, { headers: auth() }).then(r => r.json()).then(j => j.error ? setErr(j.error) : setD(j)).catch(e => setErr(e.message)); }, []);

  const Kpi = (k) => {
    const v = fmt(k);
    const alert = k.key === "overdue_receivables" && k.value > 0;
    return (
      <div key={k.key} style={{ background: "var(--bg)", borderRadius: 10, padding: "13px 15px", flex: "1 1 180px", minWidth: 160, opacity: k.available ? 1 : 0.7 }}>
        <div style={{ ...label, fontSize: 10.5 }}>{k.label}</div>
        <div style={{ fontSize: 21, fontWeight: 700, marginTop: 5, color: alert ? "var(--crit)" : "var(--text)" }}>
          {v != null ? v : <span style={{ fontSize: 13, fontWeight: 600, color: "var(--gold)" }}>In Busy</span>}
        </div>
        <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>{k.source}</div>
      </div>
    );
  };

  const Section = ({ title, to, children, note }) => (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={label}>{title}</div>
        {to && <Link to={to} style={{ fontSize: 12, color: "var(--accent, var(--gold))", textDecoration: "none" }}>Open →</Link>}
      </div>
      {children || <div style={{ color: "var(--muted)", fontSize: 13 }}>{note}</div>}
    </div>
  );

  if (err) return <div style={{ padding: 20, color: "var(--crit)" }}>Could not load CFO dashboard: {err}</div>;
  if (!d) return <div style={{ padding: 20, color: "var(--muted)" }}>Loading CFO dashboard…</div>;

  const mini = { display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13 };
  const stat = (lb, val, c) => <div><div style={{ ...label, fontSize: 10 }}>{lb}</div><div style={{ fontSize: 16, fontWeight: 700, color: c || "var(--text)" }}>{val}</div></div>;

  return (
    <div style={{ padding: 18, maxWidth: 1240, margin: "0 auto" }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>📈 Executive CFO Dashboard</h2>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>Consolidated from live MES data + the CFO modules. Figures that live in Busy are marked "In Busy" until the Busy read bridge is connected.</div>
      </div>

      <div style={{ ...card, display: "flex", gap: 10, flexWrap: "wrap" }}>
        {d.kpis.map(Kpi)}
      </div>

      <Section title="Debt & loans" to="/debt-management" note={!d.debt ? "No facilities yet." : null}>
        {d.debt && <div style={mini}>
          {stat("Outstanding", inr(d.debt.total_outstanding))}
          {stat("Service next 30d", inr(d.debt.service_next_30d))}
          {stat("Service next 90d", inr(d.debt.service_next_90d))}
          {stat("Overdue", inr(d.debt.overdue_amount), d.debt.overdue_amount > 0 ? "var(--crit)" : undefined)}
          {stat("Remaining interest", inr(d.debt.remaining_interest))}
        </div>}
      </Section>

      <Section title="Cash-flow forecast" to="/cash-flow" note={!d.cashflow.available ? d.cashflow.note : null}>
        {d.cashflow.available && <>
          <div style={mini}>
            {stat("Opening cash", inr(d.cashflow.opening_cash))}
            {stat(`Closing (wk ${d.cashflow.horizon_weeks})`, inr(d.cashflow.closing_cash))}
            {stat("Lowest closing", inr(d.cashflow.min_closing), d.cashflow.weeks_below_buffer > 0 ? "var(--crit)" : undefined)}
            {stat("Weeks below buffer", d.cashflow.weeks_below_buffer, d.cashflow.weeks_below_buffer > 0 ? "var(--crit)" : "var(--green)")}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>{d.cashflow.opening_source}</div>
        </>}
      </Section>

      <Section title="Budget vs actual (current FY)" to="/budgets" note={!d.budget.available ? d.budget.note : null}>
        {d.budget.available && <div style={mini}>
          {stat("Version", d.budget.version)}
          {stat("Revenue budget", inr(d.budget.revenue_budget))}
          {stat("Revenue actual", inr(d.budget.revenue_actual))}
          {stat("Variance", inr(d.budget.revenue_variance), d.budget.revenue_variance >= 0 ? "var(--green)" : "var(--crit)")}
          {stat("Variance %", d.budget.revenue_variance_pct == null ? "—" : d.budget.revenue_variance_pct + "%")}
        </div>}
      </Section>

      <Section title="Manufacturing profitability" to="/profitability" note={!d.profitability.available ? d.profitability.note : null}>
        {d.profitability.available && <div style={mini}>
          {stat("Produced", d.profitability.total_produced_kg + " kg")}
          {d.profitability.best && stat("Best contribution/kg", `${d.profitability.best.dim}: ₹${d.profitability.best.contribution_per_kg}`, "var(--green)")}
          {d.profitability.worst && stat("Weakest contribution/kg", `${d.profitability.worst.dim}: ₹${d.profitability.worst.contribution_per_kg}`, d.profitability.worst.contribution_per_kg < 0 ? "var(--crit)" : undefined)}
        </div>}
      </Section>

      {d.working_capital && <Section title="Working capital">
        <div style={mini}>
          {stat("DSO", d.working_capital.dso_days == null ? "—" : d.working_capital.dso_days + " d")}
          {stat("DPO", d.working_capital.dpo_days == null ? "—" : d.working_capital.dpo_days + " d")}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>{d.working_capital.note}</div>
      </Section>}

      <div style={{ fontSize: 11, color: "var(--muted)", padding: "4px 2px" }}>{d.busy_gap}</div>
    </div>
  );
}
