// Cash-flow forecast — CFO module §5. Rolling weekly forecast: real bank opening
// cash, exact loan obligations, modelled collections/supplier payments, recurring
// assumptions, per-cell overrides, and minimum-buffer alerts. Forecast, not actuals.
import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });
const k = (n) => { const v = Number(n) || 0; return (v < 0 ? "-" : "") + "₹" + Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 }); };
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };
const inp = { background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 13, boxSizing: "border-box" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 7, padding: "6px 13px", fontWeight: 600, fontSize: 12, cursor: "pointer" });
const th = { padding: "6px 7px", textAlign: "right", color: "var(--muted)", fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "4px 7px", fontSize: 12, borderTop: "1px solid var(--border)", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const lhead = { ...td, textAlign: "left", position: "sticky", left: 0, background: "var(--surface)", whiteSpace: "nowrap" };

const INFLOW = [["COLLECTIONS", "Collections"], ["OTHER_RECEIPTS", "Other receipts"]];
const OUTFLOW = [["SUPPLIER_PAYMENTS", "Supplier payments"], ["LOAN_PRINCIPAL", "Loan principal"], ["LOAN_INTEREST", "Loan interest"], ["WAGES", "Wages"], ["UTILITIES", "Utilities"], ["ADMIN_SELLING", "Admin & selling"], ["STATUTORY", "GST/TDS/statutory"], ["CAPEX", "Capex"], ["OTHER_OUTFLOW", "Other"]];
const SCEN = ["BASE", "UPSIDE", "DOWNSIDE"];

export default function CashFlowForecast() {
  const [list, setList] = useState([]);
  const [fid, setFid] = useState(null);
  const [scenario, setScenario] = useState("BASE");
  const [fc, setFc] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState("");

  const loadList = useCallback(async () => {
    const l = await fetch(`${API}/api/cashflow`, { headers: auth() }).then(r => r.json());
    setList(Array.isArray(l) ? l : []);
    if (!fid && l.length) setFid(l[0].forecast_id);
  }, [fid]);
  useEffect(() => { loadList(); }, [loadList]);

  const loadForecast = useCallback(async () => {
    if (!fid) return;
    const f = await fetch(`${API}/api/cashflow/${fid}/forecast?scenario=${scenario}`, { headers: auth() }).then(r => r.json());
    if (!f.error) { setFc(f); setCfg(f.forecast); }
  }, [fid, scenario]);
  useEffect(() => { loadForecast(); }, [loadForecast]);

  const create = async () => {
    const name = window.prompt("Forecast name:", "13-week cash flow");
    if (!name) return;
    const r = await fetch(`${API}/api/cashflow`, { method: "POST", headers: jsonH(), body: JSON.stringify({ name, horizon_weeks: 13, min_buffer: 0, assumptions: {} }) });
    const d = await r.json();
    if (r.ok) { await loadList(); setFid(d.row.forecast_id); } else alert(d.error || "Failed");
  };

  const saveCfg = async () => {
    const a = cfg.assumptions && typeof cfg.assumptions === "object" ? cfg.assumptions : {};
    const r = await fetch(`${API}/api/cashflow/${fid}`, { method: "PUT", headers: jsonH(), body: JSON.stringify({ ...cfg, assumptions: a }) });
    if (r.ok) { setMsg("Saved."); setTimeout(() => setMsg(""), 2000); loadForecast(); } else alert((await r.json()).error || "Failed");
  };

  const override = async (line_key, week) => {
    const cur = fc.weeks[week - 1].lines[line_key];
    const amt = window.prompt(`Override ${line_key} for week ${week} (currently ${k(cur)}):`, cur);
    if (amt == null) return;
    const reason = window.prompt("Reason (kept in the audit trail):", "") || "";
    const r = await fetch(`${API}/api/cashflow/${fid}/override`, { method: "POST", headers: jsonH(), body: JSON.stringify({ week_index: week, line_key, amount: Number(amt), reason, scenario }) });
    if (r.ok) loadForecast(); else alert((await r.json()).error || "Failed");
  };

  const setAssum = (key, v) => setCfg(c => ({ ...c, assumptions: { ...(typeof c.assumptions === "object" ? c.assumptions : {}), [key]: v } }));
  const A = (cfg && typeof cfg.assumptions === "object") ? cfg.assumptions : {};

  const Row = ({ lk, lb, editable, bold }) => (
    <tr>
      <td style={{ ...lhead, fontWeight: bold ? 700 : 400 }}>{lb}</td>
      {fc.weeks.map(w => {
        const ovr = fc.overrides?.find(o => o.week_index === w.week && o.line_key === lk);
        return (
          <td key={w.week} style={{ ...td, cursor: editable ? "pointer" : "default", color: ovr ? "var(--gold)" : "var(--text)", fontWeight: bold ? 700 : 400 }}
            onClick={editable ? () => override(lk, w.week) : undefined} title={ovr ? `Overridden (was ${k(ovr.original_amount)}): ${ovr.reason || ""}` : editable ? "click to override" : ""}>
            {k(w.lines[lk])}{ovr ? " *" : ""}
          </td>
        );
      })}
    </tr>
  );

  return (
    <div style={{ padding: 18, maxWidth: 1300, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0 }}>💧 Cash-flow Forecast</h2>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Rolling weekly forecast — real bank opening cash + exact loan dues; collections & supplier payments are modelled. This is a forecast, not an actual bank balance.</div>
        </div>
        <button style={btn("var(--accent, var(--gold))", "var(--surface)")} onClick={create}>+ New forecast</button>
      </div>
      {msg && <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 10 }}>{msg}</div>}

      <div style={{ ...card, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ ...label, fontSize: 10 }}>Forecast</span>
          <select style={inp} value={fid || ""} onChange={e => setFid(e.target.value)}>{list.map(f => <option key={f.forecast_id} value={f.forecast_id}>{f.name}</option>)}</select>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          {SCEN.map(s => <button key={s} style={btn(scenario === s ? "var(--accent, var(--gold))" : "var(--bg)", scenario === s ? "var(--surface)" : "var(--text)")} onClick={() => setScenario(s)}>{s}</button>)}
        </div>
      </div>

      {cfg && (
        <div style={{ ...card, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={{ ...label, fontSize: 10 }}>Opening cash override (blank = bank feed)</span><input style={{ ...inp, width: 160 }} type="number" value={cfg.opening_cash_override ?? ""} onChange={e => setCfg({ ...cfg, opening_cash_override: e.target.value === "" ? null : e.target.value })} /></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={{ ...label, fontSize: 10 }}>Min buffer</span><input style={{ ...inp, width: 120 }} type="number" value={cfg.min_buffer ?? 0} onChange={e => setCfg({ ...cfg, min_buffer: e.target.value })} /></div>
          {[["weekly_wages", "Wages/wk"], ["weekly_utilities", "Utilities/wk"], ["weekly_admin_selling", "Admin/wk"], ["weekly_statutory", "Statutory/wk"], ["weekly_other_outflow", "Other out/wk"], ["weekly_other_receipts", "Other in/wk"]].map(([key, lb]) => (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={{ ...label, fontSize: 10 }}>{lb}</span><input style={{ ...inp, width: 100 }} type="number" value={A[key] ?? ""} onChange={e => setAssum(key, e.target.value)} /></div>
          ))}
          <button style={btn("var(--accent, var(--gold))", "var(--surface)")} onClick={saveCfg}>Save assumptions</button>
        </div>
      )}

      {fc && (
        <>
          <div style={{ ...card, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[["Opening cash", k(fc.opening_cash), "var(--text)"], ["Closing (wk " + fc.horizon_weeks + ")", k(fc.summary.closing_cash), fc.summary.closing_cash < fc.min_buffer ? "var(--crit)" : "var(--green)"], ["Lowest closing", k(fc.summary.min_closing), fc.summary.min_closing < fc.min_buffer ? "var(--crit)" : "var(--text)"], ["Weeks below buffer", fc.summary.weeks_below_buffer, fc.summary.weeks_below_buffer > 0 ? "var(--crit)" : "var(--green)"]].map(([kk, v, c]) => (
              <div key={kk} style={{ background: "var(--bg)", borderRadius: 8, padding: "12px 14px", flex: "1 1 160px" }}><div style={label}>{kk}</div><div style={{ fontSize: 20, fontWeight: 700, color: c, marginTop: 4 }}>{v}</div></div>
            ))}
          </div>
          <div style={{ ...label, marginBottom: 4 }}>Opening cash source: <span style={{ color: "var(--text)" }}>{fc.opening_source}</span></div>

          {fc.alerts.length > 0 && (
            <div style={{ ...card, borderColor: "var(--crit)" }}>
              <div style={{ color: "var(--crit)", fontWeight: 600, fontSize: 13, marginBottom: 6 }}>⚠ {fc.alerts.length} week(s) below the minimum buffer</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{fc.alerts.map(a => `W${a.week} (${a.week_start}): closing ${k(a.closing)}, short ${k(a.shortfall)}`).join("  ·  ")}</div>
            </div>
          )}

          <div style={card}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1100 }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, background: "var(--surface)" }}>Week →</th>
                  {fc.weeks.map(w => <th key={w.week} style={{ ...th, color: w.below_buffer ? "var(--crit)" : "var(--muted)" }}>W{w.week}<br /><span style={{ fontWeight: 400 }}>{w.week_start.slice(5)}</span></th>)}
                </tr></thead>
                <tbody>
                  <tr><td style={{ ...lhead, fontWeight: 700 }}>Opening</td>{fc.weeks.map(w => <td key={w.week} style={{ ...td, fontWeight: 700 }}>{k(w.opening)}</td>)}</tr>
                  {INFLOW.map(([lk, lb]) => <Row key={lk} lk={lk} lb={"+ " + lb} editable />)}
                  <tr><td style={{ ...lhead, fontWeight: 700 }}>= Total inflow</td>{fc.weeks.map(w => <td key={w.week} style={{ ...td, fontWeight: 700, color: "var(--green)" }}>{k(w.total_inflow)}</td>)}</tr>
                  {OUTFLOW.map(([lk, lb]) => <Row key={lk} lk={lk} lb={"- " + lb} editable />)}
                  <tr><td style={{ ...lhead, fontWeight: 700 }}>= Total outflow</td>{fc.weeks.map(w => <td key={w.week} style={{ ...td, fontWeight: 700, color: "var(--crit)" }}>{k(w.total_outflow)}</td>)}</tr>
                  <tr><td style={{ ...lhead, fontWeight: 700 }}>Closing</td>{fc.weeks.map(w => <td key={w.week} style={{ ...td, fontWeight: 700, color: w.below_buffer ? "var(--crit)" : "var(--text)" }}>{k(w.closing)}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 8 }}>Click a + / - cell to override it (the original value and your reason are kept). {fc.disclaimer}</div>
          </div>
        </>
      )}

      {!list.length && <div style={{ ...card, color: "var(--muted)" }}>No forecasts yet. Create one to start planning liquidity.</div>}
    </div>
  );
}
