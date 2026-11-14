// Budgets & scenarios — CFO module §11. Monthly budget per FY across BASE/UPSIDE/
// DOWNSIDE, with derive-from-base and budget-vs-actual. "Actual" is real MES data
// (invoices/receipts/loan schedules); Busy-only items show as "needs Busy".
import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });
const inr = (n) => (n === null || n === undefined || n === "" ? "—" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 }));
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };
const inp = { background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 13, boxSizing: "border-box" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 7, padding: "6px 13px", fontWeight: 600, fontSize: 12, cursor: "pointer" });
const th = { padding: "7px 8px", textAlign: "right", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "4px 6px", fontSize: 12, borderTop: "1px solid var(--border)", textAlign: "right" };
const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
const SCEN = ["BASE", "UPSIDE", "DOWNSIDE"];

export default function Budgets() {
  const [versions, setVersions] = useState([]);
  const [vid, setVid] = useState(null);
  const [data, setData] = useState(null);       // getVersion result
  const [scenario, setScenario] = useState("BASE");
  const [grid, setGrid] = useState({});          // {line_item: {period: amount}}
  const [variance, setVariance] = useState(null);
  const [tab, setTab] = useState("edit");        // edit | variance
  const [msg, setMsg] = useState("");

  const loadVersions = useCallback(async () => {
    const vs = await fetch(`${API}/api/budgets`, { headers: auth() }).then(r => r.json());
    setVersions(Array.isArray(vs) ? vs : []);
    if (!vid && vs.length) setVid(vs[0].version_id);
  }, [vid]);
  useEffect(() => { loadVersions(); }, [loadVersions]);

  const loadVersion = useCallback(async () => {
    if (!vid) return;
    const d = await fetch(`${API}/api/budgets/${vid}`, { headers: auth() }).then(r => r.json());
    if (!d.error) { setData(d); setGrid(d.scenarios[scenario] || {}); }
  }, [vid, scenario]);
  useEffect(() => { loadVersion(); }, [loadVersion]);

  const loadVariance = async () => {
    const v = await fetch(`${API}/api/budgets/${vid}/variance?scenario=${scenario}`, { headers: auth() }).then(r => r.json());
    if (!v.error) setVariance(v);
  };

  const setCell = (item, p, val) => setGrid(g => ({ ...g, [item]: { ...(g[item] || {}), [p]: val } }));
  const rowTotal = (item) => Object.values(grid[item] || {}).reduce((a, x) => a + (Number(x) || 0), 0);

  const saveScenario = async () => {
    const lines = [];
    (data.line_items || []).forEach(li => { for (let p = 1; p <= 12; p++) { const v = grid[li.key]?.[p]; if (v !== undefined && v !== "") lines.push({ line_item: li.key, period_month: p, amount: Number(v) || 0 }); } });
    const r = await fetch(`${API}/api/budgets/${vid}/lines`, { method: "PUT", headers: jsonH(), body: JSON.stringify({ scenario, lines }) });
    if (r.ok) { setMsg("Saved."); setTimeout(() => setMsg(""), 2500); loadVersion(); } else alert((await r.json()).error || "Failed");
  };

  const createVersion = async () => {
    const fy = window.prompt("Financial year (YY-YY, e.g. 26-27):", "26-27");
    if (!fy) return;
    const name = window.prompt("Version name:", "Annual budget");
    if (!name) return;
    const r = await fetch(`${API}/api/budgets`, { method: "POST", headers: jsonH(), body: JSON.stringify({ fy, name }) });
    const d = await r.json();
    if (r.ok) { await loadVersions(); setVid(d.row.version_id); } else alert(d.error || "Failed");
  };

  const derive = async (to) => {
    const pctR = window.prompt(`${to}: % change to REVENUE vs BASE (e.g. 10 or -8):`, to === "UPSIDE" ? "10" : "-10");
    if (pctR == null) return;
    const pctO = window.prompt(`${to}: % change to OPEX vs BASE:`, to === "UPSIDE" ? "-5" : "5");
    if (pctO == null) return;
    const r = await fetch(`${API}/api/budgets/${vid}/derive`, { method: "POST", headers: jsonH(), body: JSON.stringify({ to, deltas: { REVENUE: Number(pctR), OPEX: Number(pctO) } }) });
    if (r.ok) { setScenario(to); setMsg(`${to} derived from BASE.`); setTimeout(() => setMsg(""), 2500); } else alert((await r.json()).error || "Failed");
  };

  const activate = async () => {
    if (!window.confirm("Mark this version ACTIVE? Any other active version for this FY is archived.")) return;
    await fetch(`${API}/api/budgets/${vid}/status`, { method: "PUT", headers: jsonH(), body: JSON.stringify({ status: "ACTIVE" }) });
    loadVersions(); loadVersion();
  };

  const cur = versions.find(v => v.version_id == vid);
  const archived = cur && cur.status === "ARCHIVED";

  return (
    <div style={{ padding: 18, maxWidth: 1240, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0 }}>📊 Budgets & Scenarios</h2>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Monthly budgets per FY across base / upside / downside. Actuals are real MES data; Busy-only lines are flagged.</div>
        </div>
        <button style={btn("var(--accent, var(--gold))", "var(--surface)")} onClick={createVersion}>+ New version</button>
      </div>
      {msg && <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 10 }}>{msg}</div>}

      <div style={{ ...card, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ ...label, fontSize: 10 }}>Version</span>
          <select style={inp} value={vid || ""} onChange={e => setVid(e.target.value)}>
            {versions.map(v => <option key={v.version_id} value={v.version_id}>{v.fy} · {v.name} ({v.status})</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          {SCEN.map(s => (
            <button key={s} style={btn(scenario === s ? "var(--accent, var(--gold))" : "var(--bg)", scenario === s ? "var(--surface)" : "var(--text)")} onClick={() => setScenario(s)}>{s}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", marginLeft: "auto" }}>
          <button style={btn("var(--bg)", "var(--text)")} onClick={() => derive("UPSIDE")}>Derive upside</button>
          <button style={btn("var(--bg)", "var(--text)")} onClick={() => derive("DOWNSIDE")}>Derive downside</button>
          {cur && cur.status !== "ACTIVE" && <button style={btn("var(--bg)", "var(--text)")} onClick={activate}>Mark active</button>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button style={btn(tab === "edit" ? "var(--accent, var(--gold))" : "var(--bg)", tab === "edit" ? "var(--surface)" : "var(--text)")} onClick={() => setTab("edit")}>Edit budget</button>
        <button style={btn(tab === "variance" ? "var(--accent, var(--gold))" : "var(--bg)", tab === "variance" ? "var(--surface)" : "var(--text)")} onClick={() => { setTab("variance"); loadVariance(); }}>Budget vs actual</button>
      </div>

      {tab === "edit" && data && (
        <div style={card}>
          {archived && <div style={{ color: "var(--gold)", fontSize: 12, marginBottom: 8 }}>This version is archived (read-only). Create a new version to make changes.</div>}
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
              <thead><tr>
                <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, background: "var(--surface)" }}>Line item ({scenario})</th>
                {MONTHS.map(m => <th key={m} style={th}>{m}</th>)}
                <th style={{ ...th, color: "var(--text)" }}>Total</th>
              </tr></thead>
              <tbody>
                {(data.line_items || []).map(li => (
                  <tr key={li.key}>
                    <td style={{ ...td, textAlign: "left", position: "sticky", left: 0, background: "var(--surface)", whiteSpace: "nowrap" }}>{li.label}{li.unit === "PCT" ? " %" : li.unit === "KG" ? " (kg)" : ""}</td>
                    {MONTHS.map((m, i) => (
                      <td key={m} style={td}>
                        <input disabled={archived} style={{ ...inp, width: 68, padding: "4px 5px", textAlign: "right" }} type="number"
                          value={grid[li.key]?.[i + 1] ?? ""} onChange={e => setCell(li.key, i + 1, e.target.value)} />
                      </td>
                    ))}
                    <td style={{ ...td, fontWeight: 600 }}>{li.unit === "INR" ? inr(rowTotal(li.key)) : rowTotal(li.key).toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!archived && <button style={{ ...btn("var(--accent, var(--gold))", "var(--surface)"), marginTop: 12 }} onClick={saveScenario}>Save {scenario}</button>}
        </div>
      )}

      {tab === "variance" && variance && (
        <div style={card}>
          <div style={{ ...label, marginBottom: 8 }}>Budget vs actual — {variance.scenario}</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr>
                {["Line item", "Budget", "Actual", "Variance", "Var %", "Source"].map((h, i) => <th key={i} style={{ ...th, textAlign: i === 0 ? "left" : i === 5 ? "left" : "right" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {variance.rows.map(r => (
                  <tr key={r.line_item}>
                    <td style={{ ...td, textAlign: "left" }}>{r.label}</td>
                    <td style={td}>{r.unit === "INR" ? inr(r.budget_total) : r.budget_total.toLocaleString("en-IN")}</td>
                    <td style={td}>{r.actual_available ? (r.unit === "INR" ? inr(r.actual_total) : r.actual_total.toLocaleString("en-IN")) : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td style={{ ...td, color: r.variance == null ? "var(--muted)" : r.variance >= 0 ? "var(--green)" : "var(--crit)" }}>{r.variance == null ? "—" : inr(r.variance)}</td>
                    <td style={{ ...td, color: r.variance_pct == null ? "var(--muted)" : r.variance_pct >= 0 ? "var(--green)" : "var(--crit)" }}>{r.variance_pct == null ? "—" : r.variance_pct + "%"}</td>
                    <td style={{ ...td, textAlign: "left", color: r.actual_available ? "var(--text)" : "var(--gold)", fontSize: 11 }}>{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 8 }}>{variance.note}</div>
        </div>
      )}

      {!versions.length && <div style={{ ...card, color: "var(--muted)" }}>No budget versions yet. Create one to start planning.</div>}
    </div>
  );
}
