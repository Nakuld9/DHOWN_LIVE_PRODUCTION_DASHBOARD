// Manufacturing profitability — CFO module §7. Contribution per kg by fabric /
// machine / grade from real production + costing + dispatch realisation. Shows a
// margin only where both cost and realisation are known; flags the rest honestly.
import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });
const rs = (n) => (n === null || n === undefined ? "—" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const kg = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 1 }) + " kg");
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };
const inp = { background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 13, boxSizing: "border-box" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 7, padding: "6px 13px", fontWeight: 600, fontSize: 12, cursor: "pointer" });
const th = { padding: "7px 9px", textAlign: "right", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "7px 9px", fontSize: 12.5, borderTop: "1px solid var(--border)", textAlign: "right", fontVariantNumeric: "tabular-nums" };
const DIMS = [["fabric", "Fabric type"], ["machine", "Machine"], ["grade", "Quality grade"]];
const QBADGE = { complete: ["var(--green-dim)", "var(--green)", "complete"], cost_only: ["var(--crit-dim)", "var(--gold)", "cost only"], realisation_only: ["var(--crit-dim)", "var(--gold)", "sales only"], none: ["var(--bg)", "var(--muted)", "—"] };

export default function ManufacturingProfitability() {
  const [dim, setDim] = useState("fabric");
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [d, c] = await Promise.all([
      fetch(`${API}/api/profitability?dimension=${dim}`, { headers: auth() }).then(r => r.json()),
      fetch(`${API}/api/profitability/config`, { headers: auth() }).then(r => r.json()),
    ]);
    if (!d.error) setData(d);
    if (!c.error) setCfg(c);
  }, [dim]);
  useEffect(() => { load(); }, [load]);

  const saveCfg = async () => {
    const r = await fetch(`${API}/api/profitability/config`, { method: "PUT", headers: jsonH(), body: JSON.stringify({ overhead_monthly: cfg.overhead_monthly, allocation_basis: cfg.allocation_basis }) });
    if (r.ok) { setMsg("Saved."); setTimeout(() => setMsg(""), 2000); load(); } else alert((await r.json()).error || "Failed");
  };

  return (
    <div style={{ padding: 18, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>🏭 Manufacturing Profitability</h2>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>Contribution per kg by fabric / machine / grade from real production, costing and dispatch realisation. A margin shows only where both cost and realisation are known.</div>
      </div>
      {msg && <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 10 }}>{msg}</div>}

      <div style={{ ...card, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {DIMS.map(([v, l]) => <button key={v} style={btn(dim === v ? "var(--accent, var(--gold))" : "var(--bg)", dim === v ? "var(--surface)" : "var(--text)")} onClick={() => setDim(v)}>{l}</button>)}
        </div>
        {cfg && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginLeft: "auto", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={{ ...label, fontSize: 10 }}>Monthly overhead pool</span><input style={{ ...inp, width: 140 }} type="number" value={cfg.overhead_monthly ?? 0} onChange={e => setCfg({ ...cfg, overhead_monthly: e.target.value })} /></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={{ ...label, fontSize: 10 }}>Allocation basis</span>
              <select style={inp} value={cfg.allocation_basis} onChange={e => setCfg({ ...cfg, allocation_basis: e.target.value })}><option value="PRODUCTION_KG">Production kg</option><option value="EQUAL">Equal split</option></select></div>
            <button style={btn("var(--accent, var(--gold))", "var(--surface)")} onClick={saveCfg}>Save</button>
          </div>
        )}
      </div>

      {data && !data.has_production && (
        <div style={{ ...card, borderColor: "var(--gold)" }}>
          <div style={{ color: "var(--gold)", fontWeight: 600, fontSize: 14, marginBottom: 6 }}>No production recorded in this window</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{data.note}</div>
        </div>
      )}

      {data && data.has_production && (
        <div style={card}>
          <div style={{ ...label, marginBottom: 8 }}>By {data.dimension_label} · {data.from} → {data.to} · {kg(data.total_produced_kg)} produced · overhead for window {rs(data.overhead_for_window)} ({data.allocation_basis === "EQUAL" ? "equal split" : "by kg"})</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                {[["left", data.dimension_label], ["right", "Produced"], ["right", "Yarn ₹"], ["right", "Knit ₹"], ["right", "Cost/kg"], ["right", "Realisation/kg"], ["right", "Contribution/kg"], ["right", "Margin %"], ["right", "O/H ₹/kg"], ["right", "Op profit/kg"], ["left", "Data"]].map(([al, h], i) => <th key={i} style={{ ...th, textAlign: al }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {data.rows.map((r, i) => {
                  const q = QBADGE[r.data_quality] || QBADGE.none;
                  return (
                    <tr key={i}>
                      <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{r.dim}</td>
                      <td style={td}>{kg(r.produced_kg)}</td>
                      <td style={td}>{rs(r.yarn_cost)}</td>
                      <td style={td}>{rs(r.knitting_cost)}</td>
                      <td style={td}>{rs(r.direct_cost_per_kg)}</td>
                      <td style={td}>{rs(r.realisation_per_kg)}</td>
                      <td style={{ ...td, fontWeight: 600, color: r.contribution_per_kg == null ? "var(--muted)" : r.contribution_per_kg >= 0 ? "var(--green)" : "var(--crit)" }}>{rs(r.contribution_per_kg)}</td>
                      <td style={{ ...td, color: r.margin_pct == null ? "var(--muted)" : r.margin_pct >= 0 ? "var(--green)" : "var(--crit)" }}>{r.margin_pct == null ? "—" : r.margin_pct + "%"}</td>
                      <td style={td}>{rs(r.overhead_per_kg)}</td>
                      <td style={{ ...td, color: r.op_profit_per_kg == null ? "var(--muted)" : r.op_profit_per_kg >= 0 ? "var(--green)" : "var(--crit)" }}>{rs(r.op_profit_per_kg)}</td>
                      <td style={{ ...td, textAlign: "left" }}><span style={{ fontSize: 10.5, background: q[0], color: q[1], padding: "2px 7px", borderRadius: 5 }}>{q[2]}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 8 }}>{data.note}</div>
        </div>
      )}
    </div>
  );
}
