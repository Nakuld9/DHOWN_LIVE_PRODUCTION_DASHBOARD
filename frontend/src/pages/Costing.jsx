import React, { useState, useEffect, useCallback, useRef } from "react";

const API = "";
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const inr = (n) => `₹${parseFloat(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (n, d = 1) => parseFloat(n || 0).toFixed(d);

const TABS = ["Dashboard", "Knitting Variance", "BOM Variance", "AI Assistant"];
const QUICK_QS = [
  "Most expensive batch this month",
  "Which vendor costs most per kg?",
  "What is the wastage cost this month?",
  "Cost per kg by fabric type",
  "How much yarn cost have we spent this month?",
  "Which machine has the worst knitting loss?",
  "Is any machine losing more yarn than the 1% standard?",
  "Compare knitting rates across fabrics",
];

// ── DASHBOARD ──────────────────────────────────────────────
function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/costing/summary?from=${from}&to=${to}`, { headers: h() });
      setData(await r.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { load(); }, []);

  const thS = { padding: "10px 14px", textAlign: "left", color: "var(--muted)", fontSize: 12, fontWeight: 600, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  const tdS = (color = "var(--text)") => ({ padding: "9px 14px", borderBottom: "1px solid var(--bg)", fontSize: 13, color });

  if (loading) return <div style={{ color: "var(--muted)", padding: 40, textAlign: "center" }}>Loading cost data...</div>;
  if (!data) return null;

  const { byComponent = [], byFabric = [], total_spend_rs, wastage_rs, jobwork_rs, snapshots = [] } = data;
  const bestFabric = [...byFabric].sort((a, b) => parseFloat(a.cost_per_kg) - parseFloat(b.cost_per_kg))[0];

  // Build trend data from snapshots (last 30 days, by fabric)
  const fabricLines = {};
  snapshots.forEach(s => {
    if (!s.fabric_type) return;
    if (!fabricLines[s.fabric_type]) fabricLines[s.fabric_type] = [];
    fabricLines[s.fabric_type].push({ date: s.snapshot_date?.slice(0, 10), cost_per_kg: parseFloat(s.cost_per_kg) });
  });

  const LINE_COLORS = ["var(--yellow)", "var(--green)", "var(--purple)", "var(--crit)", "var(--gold)", "var(--link)"];

  return (
    <div>
      {/* Date filter */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18, alignItems: "flex-end" }}>
        {[["From", from, setFrom], ["To", to, setTo]].map(([lbl, val, set]) => (
          <div key={lbl}>
            <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 3 }}>{lbl}</div>
            <input type="date" value={val} onChange={e => set(e.target.value)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 5, padding: "7px 10px", color: "var(--text)", fontSize: 13 }} />
          </div>
        ))}
        <button onClick={load} style={{ background: "var(--yellow)", color: "var(--bg)", border: "none", borderRadius: 6, padding: "8px 18px", fontWeight: "bold", cursor: "pointer" }}>Apply</button>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 22 }}>
        {[
          ["Total Spend", inr(total_spend_rs), "var(--link)"],
          ["Jobwork Cost", inr(jobwork_rs), "var(--purple)"],
          ["Wastage Cost", inr(wastage_rs), "var(--crit)"],
          ["Best Cost Fabric", bestFabric ? `${bestFabric.fabric_type}\n${inr(bestFabric.cost_per_kg)}/kg` : "—", "var(--green)"],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: "var(--surface)", border: `1px solid ${c}44`, borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 4 }}>{l}</div>
            <div style={{ color: c, fontSize: 18, fontWeight: "bold", whiteSpace: "pre-line", lineHeight: 1.3 }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 22 }}>
        {/* By fabric table */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", color: "var(--yellow)", fontWeight: "bold", fontSize: 13 }}>Cost by Fabric Type</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "var(--border)" }}>
              {["Fabric", "Total Kg", "Total Cost", "₹/kg"].map(c => <th key={c} style={thS}>{c}</th>)}
            </tr></thead>
            <tbody>
              {byFabric.map((r, i) => {
                const cpk = parseFloat(r.cost_per_kg || 0);
                const cpkColor = cpk < 200 ? "var(--green)" : cpk < 280 ? "var(--gold)" : "var(--crit)";
                return (
                  <tr key={i} style={{ background: i % 2 ? "var(--bg)" : "transparent" }}>
                    <td style={tdS()}>{r.fabric_type || "—"}</td>
                    <td style={tdS()}>{fmt(r.total_kg)} kg</td>
                    <td style={tdS()}>{inr(r.total_rs)}</td>
                    <td style={tdS(cpkColor)}><strong>{inr(r.cost_per_kg)}</strong></td>
                  </tr>
                );
              })}
              {byFabric.length === 0 && <tr><td colSpan={4} style={{ ...tdS("var(--border)"), textAlign: "center", padding: 30 }}>No cost data yet — approve rolls to generate entries</td></tr>}
            </tbody>
          </table>
        </div>

        {/* By component breakdown */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", color: "var(--yellow)", fontWeight: "bold", fontSize: 13 }}>Cost by Component</div>
          <div style={{ padding: "12px 16px" }}>
            {byComponent.length === 0 && <div style={{ color: "var(--border)", textAlign: "center", padding: 20 }}>No entries yet</div>}
            {byComponent.map((c, i) => {
              const total = byComponent.reduce((s, x) => s + parseFloat(x.total_rs), 0);
              const pct = total > 0 ? (parseFloat(c.total_rs) / total * 100) : 0;
              const colors = { YARN: "var(--yellow)", JOBWORK_DYEING: "var(--purple)", JOBWORK_FINISHING: "var(--green)", JOBWORK_DYEING_FINISHING: "var(--purple)", WASTAGE: "var(--crit)", LABOUR: "var(--gold)", MACHINE: "var(--link)" };
              const color = colors[c.cost_component] || "var(--muted)";
              return (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13 }}>
                    <span style={{ color }}>{c.cost_component.replace(/_/g, " ")}</span>
                    <span style={{ color: "var(--text)" }}>{inr(c.total_rs)} <span style={{ color: "var(--border)", fontSize: 11 }}>({pct.toFixed(0)}%)</span></span>
                  </div>
                  <div style={{ height: 8, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Cost/kg trend (simple SVG) */}
      {Object.keys(fabricLines).length > 0 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
          <div style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: 13, marginBottom: 12 }}>Cost/kg Trend (last 30 days)</div>
          <CostTrend fabricLines={fabricLines} colors={LINE_COLORS} />
        </div>
      )}
    </div>
  );
}

function CostTrend({ fabricLines, colors }) {
  const W = 700, H = 180, PAD = { l: 56, r: 12, t: 10, b: 32 };
  const allPoints = Object.values(fabricLines).flat();
  if (!allPoints.length) return null;
  const allDates = [...new Set(allPoints.map(p => p.date))].sort();
  const allVals = allPoints.map(p => p.cost_per_kg).filter(v => v > 0);
  if (!allVals.length) return null;
  const minV = Math.min(...allVals) * 0.9, maxV = Math.max(...allVals) * 1.05;
  const xOf = (date) => PAD.l + (allDates.indexOf(date) / Math.max(allDates.length - 1, 1)) * (W - PAD.l - PAD.r);
  const yOf = (val) => PAD.t + (1 - (val - minV) / (maxV - minV)) * (H - PAD.t - PAD.b);
  const fabrics = Object.keys(fabricLines);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H} style={{ display: "block" }}>
        {/* Y gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const y = PAD.t + (1 - f) * (H - PAD.t - PAD.b);
          const val = minV + f * (maxV - minV);
          return <g key={f}>
            <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y + 4} fontSize={10} fill="var(--muted)" textAnchor="end">₹{val.toFixed(0)}</text>
          </g>;
        })}
        {/* X labels (first + last) */}
        {allDates.length > 0 && <>
          <text x={xOf(allDates[0])} y={H - 6} fontSize={10} fill="var(--muted)" textAnchor="middle">{allDates[0]?.slice(5)}</text>
          <text x={xOf(allDates[allDates.length - 1])} y={H - 6} fontSize={10} fill="var(--muted)" textAnchor="middle">{allDates[allDates.length - 1]?.slice(5)}</text>
        </>}
        {/* Lines */}
        {fabrics.map((fab, fi) => {
          const pts = [...fabricLines[fab]].sort((a, b) => a.date.localeCompare(b.date));
          if (pts.length < 2) return null;
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.date).toFixed(1)},${yOf(p.cost_per_kg).toFixed(1)}`).join(" ");
          return <g key={fab}>
            <path d={d} fill="none" stroke={colors[fi % colors.length]} strokeWidth={2} />
            {pts.map((p, i) => <circle key={i} cx={xOf(p.date)} cy={yOf(p.cost_per_kg)} r={3} fill={colors[fi % colors.length]} />)}
          </g>;
        })}
      </svg>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
        {fabrics.map((fab, fi) => (
          <div key={fab} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <div style={{ width: 20, height: 3, background: colors[fi % colors.length], borderRadius: 2 }} />
            <span style={{ color: "var(--muted)" }}>{fab}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── AI ASSISTANT ───────────────────────────────────────────
function AIAssistant() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [modelName, setModelName] = useState("llama-3.3-70b-versatile");
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const ask = async (question) => {
    if (!question.trim()) return;
    const q = question.trim();
    setInput("");
    setMessages(m => [...m, { role: "user", text: q }]);
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/costing/ask`, { method: "POST", headers: h(), body: JSON.stringify({ question: q }) });
      const j = await r.json();
      if (j.model) setModelName(j.model);
      setMessages(m => [...m, { role: "ai", text: j.answer || j.error, dataUsed: j.data_used, model: j.model }]);
    } catch (e) {
      setMessages(m => [...m, { role: "ai", text: "Cannot reach backend. Check server is running.", dataUsed: null }]);
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 260px)", minHeight: 400 }}>
      {/* Quick question buttons */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {QUICK_QS.map(q => (
          <button key={q} onClick={() => ask(q)} disabled={loading}
            style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 20, padding: "5px 14px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "var(--yellow)"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}>
            {q}
          </button>
        ))}
      </div>

      {/* Chat messages */}
      <div style={{ flex: 1, overflowY: "auto", background: "var(--bg)", borderRadius: 10, border: "1px solid var(--border)", padding: 16, marginBottom: 12 }}>
        {messages.length === 0 && (
          <div style={{ color: "var(--border)", textAlign: "center", marginTop: 60 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🦙</div>
            <div style={{ color: "var(--muted)" }}>Powered by <strong style={{ color: "var(--yellow)" }}>Groq</strong> · model: <code style={{ color: "var(--green)" }}>{modelName}</code></div>
            <div style={{ marginTop: 8 }}>Ask about costs, margins, wastage, vendors...</div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 16, display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "75%", padding: "10px 14px", borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "2px 12px 12px 12px",
              background: m.role === "user" ? "var(--border)" : "var(--surface)",
              border: m.role === "ai" ? "1px solid var(--border)" : "none",
              color: "var(--text)", fontSize: 14, lineHeight: 1.55,
            }}>
              {m.role === "ai" && <div style={{ color: "var(--yellow)", fontSize: 11, fontWeight: "bold", marginBottom: 6 }}>⚡ GROQ {m.model ? `· ${m.model}` : ""}</div>}
              {m.text}
            </div>
            {/* Data used */}
            {m.role === "ai" && m.dataUsed && (
              <details style={{ maxWidth: "75%", marginTop: 4 }}>
                <summary style={{ color: "var(--border)", fontSize: 11, cursor: "pointer" }}>▸ View data used</summary>
                <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 12px", marginTop: 4, fontSize: 11, color: "var(--muted)", whiteSpace: "pre-wrap", fontFamily: "monospace", maxHeight: 200, overflowY: "auto" }}>
                  {JSON.stringify(m.dataUsed, null, 2)}
                </div>
              </details>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--muted)", fontSize: 13 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--yellow)", animation: `pulse 1.2s ${i * 0.2}s infinite` }} />)}
            </div>
            Thinking...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ display: "flex", gap: 10 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !loading && ask(input)}
          placeholder="Ask about costs, wastage, margins, vendor comparison..."
          disabled={loading}
          style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 16px", color: "var(--text)", fontSize: 14 }}
        />
        <button onClick={() => ask(input)} disabled={loading || !input.trim()}
          style={{ background: input.trim() ? "var(--yellow)" : "var(--border)", color: input.trim() ? "var(--bg)" : "var(--border)", border: "none", borderRadius: 8, padding: "12px 20px", fontWeight: "bold", cursor: input.trim() ? "pointer" : "default", fontSize: 14, transition: "all 0.2s" }}>
          Send
        </button>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  );
}

// ── KNITTING VARIANCE ──────────────────────────────────────
function KnittingVariance() {
  const firstOfMonth = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };
  const [from, setFrom] = useState(firstOfMonth);
  const [to,   setTo]   = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/costing/knitting-variance?from=${from}&to=${to}`, { headers: h() });
      setRows(await r.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const STATUS_COLOR = { UNFAVORABLE: "var(--crit)", FAVORABLE: "var(--green)", ON_TARGET: "var(--yellow)" };
  const STATUS_BG    = { UNFAVORABLE: "#7f1d1d22", FAVORABLE: "#14532d22", ON_TARGET: "#78350f22" };

  // Summary totals
  const totals = rows.reduce((acc, r) => ({
    yarn: acc.yarn + parseFloat(r.yarn_issued_kg || 0),
    fabric: acc.fabric + parseFloat(r.fabric_produced_kg || 0),
    stdLoss: acc.stdLoss + parseFloat(r.std_loss_kg || 0),
    actualLoss: acc.actualLoss + parseFloat(r.actual_loss_kg || 0),
    variance: acc.variance + parseFloat(r.variance_kg || 0),
  }), { yarn: 0, fabric: 0, stdLoss: 0, actualLoss: 0, variance: 0 });

  const unfav = rows.filter(r => r.variance_status === "UNFAVORABLE").length;
  const fav   = rows.filter(r => r.variance_status === "FAVORABLE").length;

  const thS = { padding: "10px 14px", textAlign: "left", color: "var(--muted)", fontSize: 12, fontWeight: 600, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  const tdS = { padding: "9px 14px", borderBottom: "1px solid var(--surface)", fontSize: 13 };

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
        {[["From", from, setFrom], ["To", to, setTo]].map(([lbl, val, set]) => (
          <div key={lbl}>
            <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 3 }}>{lbl}</div>
            <input type="date" value={val} onChange={e => set(e.target.value)}
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 5, padding: "7px 10px", color: "var(--text)", fontSize: 13 }} />
          </div>
        ))}
        <button onClick={load} style={{ background: "var(--yellow)", color: "var(--bg)", border: "none", borderRadius: 6, padding: "8px 18px", fontWeight: "bold", cursor: "pointer" }}>Apply</button>
        <button onClick={() => {
          const csvRows = [["Date","Machine","Yarn Issued (kg)","Fabric Out (kg)","Rolls","Std Loss %","Std Loss (kg)","Actual Loss (kg)","Variance (kg)","Status"].join(",")];
          rows.forEach(r => csvRows.push([r.date, r.machine_name||r.machine_id, r.yarn_issued_kg, r.fabric_produced_kg, r.roll_count, r.std_loss_pct, r.std_loss_kg, r.actual_loss_kg, r.variance_kg, r.variance_status].join(",")));
          const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csvRows.join("\n")], { type: "text/csv" }));
          a.download = `knitting_variance_${from}_${to}.csv`; a.click();
        }} style={{ background: "var(--border)", color: "var(--link)", border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: "bold", cursor: "pointer", fontSize: 13 }}>
          ⬇ CSV
        </button>
        <button onClick={() => {
          const w = window.open("", "_blank");
          const rowsHtml = rows.map(r => `<tr>
            <td>${r.date}</td><td>${r.machine_name || r.machine_id || "—"}</td>
            <td>${r.yarn_issued_kg}</td><td>${r.fabric_produced_kg}</td><td>${r.roll_count}</td>
            <td>${r.std_loss_pct}%</td><td>${r.std_loss_kg}</td><td>${r.actual_loss_kg}</td>
            <td>${parseFloat(r.variance_kg) >= 0 ? "+" : ""}${r.variance_kg}</td><td>${r.variance_status.replace("_", " ")}</td>
          </tr>`).join("");
          w.document.write(`<html><head><title>Knitting Variance ${from} to ${to}</title>
            <style>
              body{font-family:Arial,sans-serif;padding:20px;color:#111}
              h2{margin:0 0 4px} .sub{color:#666;font-size:12px;margin-bottom:16px}
              table{width:100%;border-collapse:collapse;font-size:12px}
              th,td{border:1px solid #999;padding:6px 10px;text-align:left}
              th{background:#eee}
              .totals{margin-top:12px;font-size:13px}
            </style></head><body>
            <h2>DHOWN Hosiery Mills — Knitting Variance Report</h2>
            <div class="sub">Period: ${from} to ${to} · Printed: ${new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-')}</div>
            <table><thead><tr><th>Date</th><th>Machine</th><th>Yarn Issued (kg)</th><th>Fabric Out (kg)</th><th>Rolls</th><th>Std Loss %</th><th>Std Loss (kg)</th><th>Actual Loss (kg)</th><th>Variance (kg)</th><th>Status</th></tr></thead>
            <tbody>${rowsHtml}</tbody></table>
            <div class="totals"><strong>Totals:</strong> Yarn issued ${fmt(totals.yarn, 2)} kg · Fabric out ${fmt(totals.fabric, 2)} kg · Std loss ${fmt(totals.stdLoss, 2)} kg · Actual loss ${fmt(totals.actualLoss, 2)} kg · Net variance ${totals.variance >= 0 ? "+" : ""}${fmt(totals.variance, 2)} kg</div>
            </body></html>`);
          w.document.close();
          w.print();
        }} disabled={rows.length === 0}
          style={{ background: "var(--green-dim)", color: "var(--green-edge)", border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: "bold", cursor: rows.length ? "pointer" : "default", fontSize: 13, opacity: rows.length ? 1 : 0.5 }}>
          🖨 Print
        </button>
      </div>

      {/* Summary KPIs */}
      {rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
          {[
            ["Yarn Issued",    `${fmt(totals.yarn, 2)} kg`,       "var(--link)"],
            ["Fabric Out",     `${fmt(totals.fabric, 2)} kg`,     "var(--green)"],
            ["Std Loss",       `${fmt(totals.stdLoss, 2)} kg`,    "var(--muted)"],
            ["Actual Loss",    `${fmt(totals.actualLoss, 2)} kg`, "var(--gold)"],
            ["Net Variance",   `${totals.variance >= 0 ? "+" : ""}${fmt(totals.variance, 2)} kg`,
              totals.variance > 0.1 ? "var(--crit)" : totals.variance < -0.1 ? "var(--green)" : "var(--yellow)"],
          ].map(([lbl, val, color]) => (
            <div key={lbl} style={{ background: "var(--surface)", border: `1px solid ${color}44`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 4 }}>{lbl}</div>
              <div style={{ color, fontSize: 20, fontWeight: "bold" }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Status badges */}
      {rows.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <span style={{ background: "#7f1d1d33", color: "var(--crit)", border: "1px solid #ef444444", borderRadius: 20, padding: "4px 14px", fontSize: 12, fontWeight: "bold" }}>
            {unfav} UNFAVORABLE
          </span>
          <span style={{ background: "#14532d33", color: "var(--green)", border: "1px solid #10b98144", borderRadius: 20, padding: "4px 14px", fontSize: 12, fontWeight: "bold" }}>
            {fav} FAVORABLE
          </span>
          <span style={{ background: "#78350f33", color: "var(--yellow)", border: "1px solid #f4ae1f44", borderRadius: 20, padding: "4px 14px", fontSize: 12, fontWeight: "bold" }}>
            {rows.length - unfav - fav} ON TARGET
          </span>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>Loading variance data...</div>
      ) : rows.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 40, textAlign: "center", color: "var(--border)" }}>
          No data for this period. Issue yarn and approve rolls to generate variance entries.
        </div>
      ) : (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "var(--border)" }}>
              {["Date","Machine","Yarn Issued","Fabric Out","Rolls","Std Loss %","Std Loss","Actual Loss","Variance","Status"].map(c => (
                <th key={c} style={thS}>{c}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const varKg = parseFloat(r.variance_kg);
                const varColor = r.variance_status === "UNFAVORABLE" ? "var(--crit)" : r.variance_status === "FAVORABLE" ? "var(--green)" : "var(--yellow)";
                return (
                  <tr key={i} style={{ background: i % 2 ? "var(--bg)" : "transparent" }}>
                    <td style={{ ...tdS, color: "var(--text)", fontWeight: 500 }}>{r.date}</td>
                    <td style={{ ...tdS, color: "var(--link)", fontFamily: "monospace" }}>{r.machine_name || r.machine_id || "—"}</td>
                    <td style={{ ...tdS, color: "var(--text)" }}>{r.yarn_issued_kg} kg</td>
                    <td style={{ ...tdS, color: "var(--green)", fontWeight: 600 }}>{r.fabric_produced_kg} kg</td>
                    <td style={{ ...tdS, color: "var(--muted)" }}>{r.roll_count}</td>
                    <td style={{ ...tdS, color: "var(--muted)" }}>{r.std_loss_pct}%</td>
                    <td style={{ ...tdS, color: "var(--muted)" }}>{r.std_loss_kg} kg</td>
                    <td style={{ ...tdS, color: "var(--gold)" }}>{r.actual_loss_kg} kg</td>
                    <td style={{ ...tdS, color: varColor, fontWeight: "bold" }}>
                      {varKg >= 0 ? "+" : ""}{r.variance_kg} kg
                    </td>
                    <td style={{ ...tdS }}>
                      <span style={{ background: STATUS_BG[r.variance_status], color: STATUS_COLOR[r.variance_status], border: `1px solid ${STATUS_COLOR[r.variance_status]}44`, borderRadius: 12, padding: "3px 10px", fontSize: 11, fontWeight: "bold" }}>
                        {r.variance_status.replace("_", " ")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ color: "var(--border)", fontSize: 11, marginTop: 12 }}>
        Variance = Actual Loss − Standard Loss ({rows[0]?.std_loss_pct || 1}% of yarn issued). Positive = more waste than standard (UNFAVORABLE). Negative = less waste (FAVORABLE).
      </div>
    </div>
  );
}

// ── BOM VARIANCE ──────────────────────────────────────────
function BOMVariance() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().slice(0,10);
  const weekAgo = new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/costing/bom-variance?from=${from}&to=${to}`, { headers: h() });
      setData(await r.json());
    } catch {} finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const totalStd = data.reduce((s,r) => s + parseFloat(r.std_consumption_kg), 0);
  const totalAct = data.reduce((s,r) => s + parseFloat(r.actual_consumption_kg), 0);
  const totalVar = totalAct - totalStd;

  const printReport = () => {
    const w = window.open('','','width=900,height=700');
    w.document.write(`<html><head><title>BOM Variance Report</title>
      <style>body{font-family:Arial,sans-serif;padding:20px}table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:right}th{background:#f5f5f5;text-align:left}
      .over{color:red;font-weight:bold}.short{color:var(--idle);font-weight:bold}.ok{color:green}
      h2{margin-bottom:5px}p{color:#666;margin:0 0 15px}</style></head><body>
      <h2>BOM Variance Report</h2><p>${from} to ${to}</p>
      <table><thead><tr><th>Machine</th><th>Fabric</th><th>Produced (kg)</th><th>Yarn</th><th>BOM%</th>
      <th>Std (kg)</th><th>Actual (kg)</th><th>Variance (kg)</th><th>Var%</th><th>Status</th></tr></thead><tbody>`);
    data.forEach(r => {
      const cls = r.status === 'OVER' ? 'over' : r.status === 'SHORT' ? 'short' : 'ok';
      w.document.write(`<tr><td style="text-align:left">${r.machine_id}</td><td style="text-align:left">${r.fabric_code}</td>
        <td>${r.fabric_produced_kg}</td><td style="text-align:left">${r.yarn_code} — ${r.yarn_name}</td>
        <td>${r.bom_pct}%</td><td>${r.std_consumption_kg}</td><td>${r.actual_consumption_kg}</td>
        <td class="${cls}">${r.variance_kg}</td><td class="${cls}">${r.variance_pct}%</td>
        <td class="${cls}">${r.status}</td></tr>`);
    });
    w.document.write(`<tr style="font-weight:bold;background:#f0f0f0"><td colspan="5" style="text-align:left">TOTAL</td>
      <td>${totalStd.toFixed(3)}</td><td>${totalAct.toFixed(3)}</td><td>${totalVar.toFixed(3)}</td>
      <td>${totalStd>0?((totalVar/totalStd)*100).toFixed(1):'0.0'}%</td><td></td></tr>`);
    w.document.write('</tbody></table></body></html>');
    w.document.close();
    w.print();
  };

  const statusColor = (s) => s === 'OVER' ? 'var(--crit)' : s === 'SHORT' ? 'var(--gold)' : 'var(--green)';

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label style={{ color: "var(--muted)", fontSize: 12 }}>From
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              style={{ marginLeft: 6, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 4, padding: "5px 8px", fontSize: 13 }} />
          </label>
          <label style={{ color: "var(--muted)", fontSize: 12 }}>To
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              style={{ marginLeft: 6, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 4, padding: "5px 8px", fontSize: 13 }} />
          </label>
        </div>
        <button onClick={printReport} style={{ background: "var(--border)", color: "var(--link)", border: "none", borderRadius: 5, padding: "7px 16px", cursor: "pointer", fontSize: 13 }}>🖨 Print</button>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
        <div style={{ background: "var(--bg)", borderRadius: 8, padding: 14, border: "1px solid var(--border)" }}>
          <div style={{ color: "var(--muted)", fontSize: 11 }}>Std Consumption</div>
          <div style={{ color: "var(--text)", fontSize: 20, fontWeight: 700 }}>{totalStd.toFixed(1)} kg</div>
        </div>
        <div style={{ background: "var(--bg)", borderRadius: 8, padding: 14, border: "1px solid var(--border)" }}>
          <div style={{ color: "var(--muted)", fontSize: 11 }}>Actual Consumption</div>
          <div style={{ color: "var(--text)", fontSize: 20, fontWeight: 700 }}>{totalAct.toFixed(1)} kg</div>
        </div>
        <div style={{ background: "var(--bg)", borderRadius: 8, padding: 14, border: "1px solid var(--border)" }}>
          <div style={{ color: "var(--muted)", fontSize: 11 }}>Total Variance</div>
          <div style={{ color: totalVar > 0.5 ? "var(--crit)" : totalVar < -0.5 ? "var(--gold)" : "var(--green)", fontSize: 20, fontWeight: 700 }}>
            {totalVar > 0 ? "+" : ""}{totalVar.toFixed(1)} kg
          </div>
        </div>
        <div style={{ background: "var(--bg)", borderRadius: 8, padding: 14, border: "1px solid var(--border)" }}>
          <div style={{ color: "var(--muted)", fontSize: 11 }}>Variance %</div>
          <div style={{ color: totalVar > 0.5 ? "var(--crit)" : totalVar < -0.5 ? "var(--gold)" : "var(--green)", fontSize: 20, fontWeight: 700 }}>
            {totalStd > 0 ? ((totalVar/totalStd)*100).toFixed(1) : "0.0"}%
          </div>
        </div>
      </div>

      {loading ? <div style={{ color: "var(--muted)", padding: 40, textAlign: "center" }}>Loading...</div> : data.length === 0 ? (
        <div style={{ color: "var(--border)", padding: 40, textAlign: "center" }}>No BOM variance data. Ensure fabrics have BOM defined and rolls are approved in this date range.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--border)" }}>
                {["Machine", "Fabric", "Produced (kg)", "Rolls", "Yarn", "BOM %", "Std (kg)", "Actual (kg)", "Variance (kg)", "Var %", "Status"].map(c => (
                  <th key={c} style={{ padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? "var(--bg)" : "transparent", borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "7px 10px", color: "var(--yellow)", fontWeight: 600 }}>{r.machine_id}</td>
                  <td style={{ padding: "7px 10px" }}>{r.fabric_code}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.fabric_produced_kg}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.roll_count}</td>
                  <td style={{ padding: "7px 10px" }}><span style={{ color: "var(--purple)" }}>{r.yarn_code}</span> — {r.yarn_name}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.bom_pct}%</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.std_consumption_kg}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.actual_consumption_kg}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: statusColor(r.status), fontWeight: 700 }}>
                    {parseFloat(r.variance_kg) > 0 ? "+" : ""}{r.variance_kg}
                  </td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: statusColor(r.status), fontWeight: 700 }}>
                    {parseFloat(r.variance_pct) > 0 ? "+" : ""}{r.variance_pct}%
                  </td>
                  <td style={{ padding: "7px 10px" }}>
                    <span style={{ background: statusColor(r.status) + "22", color: statusColor(r.status), padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── MAIN PAGE ──────────────────────────────────────────────
export default function Costing() {
  const [tab, setTab] = useState(0);

  return (
    <div style={{ padding: 20, color: "var(--text)", background: "var(--bg)", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: "var(--yellow)" }}>₹ Costing</h2>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>FIFO yarn costing · Knitting variance · AI assistant (Groq)</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 22, borderBottom: "1px solid var(--border)" }}>
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            style={{ padding: "10px 22px", border: "none", borderBottom: tab === i ? "2px solid var(--gold)" : "2px solid transparent", background: "transparent", color: tab === i ? "var(--yellow)" : "var(--muted)", cursor: "pointer", fontWeight: tab === i ? "bold" : 400, fontSize: 14 }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 0 && <Dashboard />}
      {tab === 1 && <KnittingVariance />}
      {tab === 2 && <BOMVariance />}
      {tab === 3 && <AIAssistant />}
    </div>
  );
}
