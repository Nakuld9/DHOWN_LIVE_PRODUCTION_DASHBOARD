import React, { useState, useEffect, useCallback, useRef } from "react";

const API = "http://localhost:4000";
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

  const thS = { padding: "10px 14px", textAlign: "left", color: "#7da2d6", fontSize: 12, fontWeight: 600, borderBottom: "1px solid #1e3a5f", whiteSpace: "nowrap" };
  const tdS = (color = "#e2e8f0") => ({ padding: "9px 14px", borderBottom: "1px solid #081426", fontSize: 13, color });

  if (loading) return <div style={{ color: "#7da2d6", padding: 40, textAlign: "center" }}>Loading cost data...</div>;
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

  const LINE_COLORS = ["#f4ae1f", "#10b981", "#6366f1", "#ef4444", "#f59e0b", "#3b82f6"];

  return (
    <div>
      {/* Date filter */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18, alignItems: "flex-end" }}>
        {[["From", from, setFrom], ["To", to, setTo]].map(([lbl, val, set]) => (
          <div key={lbl}>
            <div style={{ color: "#7da2d6", fontSize: 11, marginBottom: 3 }}>{lbl}</div>
            <input type="date" value={val} onChange={e => set(e.target.value)} style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 5, padding: "7px 10px", color: "#e2e8f0", fontSize: 13 }} />
          </div>
        ))}
        <button onClick={load} style={{ background: "#f4ae1f", color: "#081426", border: "none", borderRadius: 6, padding: "8px 18px", fontWeight: "bold", cursor: "pointer" }}>Apply</button>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 22 }}>
        {[
          ["Total Spend", inr(total_spend_rs), "#60a5fa"],
          ["Jobwork Cost", inr(jobwork_rs), "#6366f1"],
          ["Wastage Cost", inr(wastage_rs), "#ef4444"],
          ["Best Cost Fabric", bestFabric ? `${bestFabric.fabric_type}\n${inr(bestFabric.cost_per_kg)}/kg` : "—", "#10b981"],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: "#0d1b2a", border: `1px solid ${c}44`, borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ color: "#7da2d6", fontSize: 11, marginBottom: 4 }}>{l}</div>
            <div style={{ color: c, fontSize: 18, fontWeight: "bold", whiteSpace: "pre-line", lineHeight: 1.3 }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 22 }}>
        {/* By fabric table */}
        <div style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e3a5f", color: "#f4ae1f", fontWeight: "bold", fontSize: 13 }}>Cost by Fabric Type</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#1e3a5f" }}>
              {["Fabric", "Total Kg", "Total Cost", "₹/kg"].map(c => <th key={c} style={thS}>{c}</th>)}
            </tr></thead>
            <tbody>
              {byFabric.map((r, i) => {
                const cpk = parseFloat(r.cost_per_kg || 0);
                const cpkColor = cpk < 200 ? "#10b981" : cpk < 280 ? "#f59e0b" : "#ef4444";
                return (
                  <tr key={i} style={{ background: i % 2 ? "#081426" : "transparent" }}>
                    <td style={tdS()}>{r.fabric_type || "—"}</td>
                    <td style={tdS()}>{fmt(r.total_kg)} kg</td>
                    <td style={tdS()}>{inr(r.total_rs)}</td>
                    <td style={tdS(cpkColor)}><strong>{inr(r.cost_per_kg)}</strong></td>
                  </tr>
                );
              })}
              {byFabric.length === 0 && <tr><td colSpan={4} style={{ ...tdS("#4a5568"), textAlign: "center", padding: 30 }}>No cost data yet — approve rolls to generate entries</td></tr>}
            </tbody>
          </table>
        </div>

        {/* By component breakdown */}
        <div style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e3a5f", color: "#f4ae1f", fontWeight: "bold", fontSize: 13 }}>Cost by Component</div>
          <div style={{ padding: "12px 16px" }}>
            {byComponent.length === 0 && <div style={{ color: "#4a5568", textAlign: "center", padding: 20 }}>No entries yet</div>}
            {byComponent.map((c, i) => {
              const total = byComponent.reduce((s, x) => s + parseFloat(x.total_rs), 0);
              const pct = total > 0 ? (parseFloat(c.total_rs) / total * 100) : 0;
              const colors = { YARN: "#f4ae1f", JOBWORK_DYEING: "#6366f1", JOBWORK_FINISHING: "#10b981", JOBWORK_DYEING_FINISHING: "#8b5cf6", WASTAGE: "#ef4444", LABOUR: "#f59e0b", MACHINE: "#60a5fa" };
              const color = colors[c.cost_component] || "#7da2d6";
              return (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13 }}>
                    <span style={{ color }}>{c.cost_component.replace(/_/g, " ")}</span>
                    <span style={{ color: "#e2e8f0" }}>{inr(c.total_rs)} <span style={{ color: "#4a5568", fontSize: 11 }}>({pct.toFixed(0)}%)</span></span>
                  </div>
                  <div style={{ height: 8, background: "#081426", borderRadius: 4, overflow: "hidden" }}>
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
        <div style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 10, padding: 16 }}>
          <div style={{ color: "#f4ae1f", fontWeight: "bold", fontSize: 13, marginBottom: 12 }}>Cost/kg Trend (last 30 days)</div>
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
            <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="#1e3a5f" strokeWidth={1} />
            <text x={PAD.l - 6} y={y + 4} fontSize={10} fill="#7da2d6" textAnchor="end">₹{val.toFixed(0)}</text>
          </g>;
        })}
        {/* X labels (first + last) */}
        {allDates.length > 0 && <>
          <text x={xOf(allDates[0])} y={H - 6} fontSize={10} fill="#7da2d6" textAnchor="middle">{allDates[0]?.slice(5)}</text>
          <text x={xOf(allDates[allDates.length - 1])} y={H - 6} fontSize={10} fill="#7da2d6" textAnchor="middle">{allDates[allDates.length - 1]?.slice(5)}</text>
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
            <span style={{ color: "#7da2d6" }}>{fab}</span>
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
            style={{ background: "#0d1b2a", color: "#7da2d6", border: "1px solid #1e3a5f", borderRadius: 20, padding: "5px 14px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#f4ae1f"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#1e3a5f"}>
            {q}
          </button>
        ))}
      </div>

      {/* Chat messages */}
      <div style={{ flex: 1, overflowY: "auto", background: "#081426", borderRadius: 10, border: "1px solid #1e3a5f", padding: 16, marginBottom: 12 }}>
        {messages.length === 0 && (
          <div style={{ color: "#4a5568", textAlign: "center", marginTop: 60 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🦙</div>
            <div style={{ color: "#7da2d6" }}>Powered by <strong style={{ color: "#f4ae1f" }}>Groq</strong> · model: <code style={{ color: "#10b981" }}>{modelName}</code></div>
            <div style={{ marginTop: 8 }}>Ask about costs, margins, wastage, vendors...</div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 16, display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "75%", padding: "10px 14px", borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "2px 12px 12px 12px",
              background: m.role === "user" ? "#1e3a5f" : "#0d1b2a",
              border: m.role === "ai" ? "1px solid #1e3a5f" : "none",
              color: "#e2e8f0", fontSize: 14, lineHeight: 1.55,
            }}>
              {m.role === "ai" && <div style={{ color: "#f4ae1f", fontSize: 11, fontWeight: "bold", marginBottom: 6 }}>⚡ GROQ {m.model ? `· ${m.model}` : ""}</div>}
              {m.text}
            </div>
            {/* Data used */}
            {m.role === "ai" && m.dataUsed && (
              <details style={{ maxWidth: "75%", marginTop: 4 }}>
                <summary style={{ color: "#4a5568", fontSize: 11, cursor: "pointer" }}>▸ View data used</summary>
                <div style={{ background: "#050d1a", border: "1px solid #1e3a5f", borderRadius: 6, padding: "8px 12px", marginTop: 4, fontSize: 11, color: "#7da2d6", whiteSpace: "pre-wrap", fontFamily: "monospace", maxHeight: 200, overflowY: "auto" }}>
                  {JSON.stringify(m.dataUsed, null, 2)}
                </div>
              </details>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", color: "#7da2d6", fontSize: 13 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#f4ae1f", animation: `pulse 1.2s ${i * 0.2}s infinite` }} />)}
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
          style={{ flex: 1, background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 8, padding: "12px 16px", color: "#e2e8f0", fontSize: 14 }}
        />
        <button onClick={() => ask(input)} disabled={loading || !input.trim()}
          style={{ background: input.trim() ? "#f4ae1f" : "#1e3a5f", color: input.trim() ? "#081426" : "#4a5568", border: "none", borderRadius: 8, padding: "12px 20px", fontWeight: "bold", cursor: input.trim() ? "pointer" : "default", fontSize: 14, transition: "all 0.2s" }}>
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

  const STATUS_COLOR = { UNFAVORABLE: "#ef4444", FAVORABLE: "#10b981", ON_TARGET: "#f4ae1f" };
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

  const thS = { padding: "10px 14px", textAlign: "left", color: "#7da2d6", fontSize: 12, fontWeight: 600, borderBottom: "1px solid #1e3a5f", whiteSpace: "nowrap" };
  const tdS = { padding: "9px 14px", borderBottom: "1px solid #0d1b2a", fontSize: 13 };

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
        {[["From", from, setFrom], ["To", to, setTo]].map(([lbl, val, set]) => (
          <div key={lbl}>
            <div style={{ color: "#7da2d6", fontSize: 11, marginBottom: 3 }}>{lbl}</div>
            <input type="date" value={val} onChange={e => set(e.target.value)}
              style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 5, padding: "7px 10px", color: "#e2e8f0", fontSize: 13 }} />
          </div>
        ))}
        <button onClick={load} style={{ background: "#f4ae1f", color: "#081426", border: "none", borderRadius: 6, padding: "8px 18px", fontWeight: "bold", cursor: "pointer" }}>Apply</button>
        <button onClick={() => {
          const csvRows = [["Date","Machine","Yarn Issued (kg)","Fabric Out (kg)","Rolls","Std Loss %","Std Loss (kg)","Actual Loss (kg)","Variance (kg)","Status"].join(",")];
          rows.forEach(r => csvRows.push([r.date, r.machine_name||r.machine_id, r.yarn_issued_kg, r.fabric_produced_kg, r.roll_count, r.std_loss_pct, r.std_loss_kg, r.actual_loss_kg, r.variance_kg, r.variance_status].join(",")));
          const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csvRows.join("\n")], { type: "text/csv" }));
          a.download = `knitting_variance_${from}_${to}.csv`; a.click();
        }} style={{ background: "#1e3a5f", color: "#93c5fd", border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: "bold", cursor: "pointer", fontSize: 13 }}>
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
            <div class="sub">Period: ${from} to ${to} · Printed: ${new Date().toLocaleString("en-IN")}</div>
            <table><thead><tr><th>Date</th><th>Machine</th><th>Yarn Issued (kg)</th><th>Fabric Out (kg)</th><th>Rolls</th><th>Std Loss %</th><th>Std Loss (kg)</th><th>Actual Loss (kg)</th><th>Variance (kg)</th><th>Status</th></tr></thead>
            <tbody>${rowsHtml}</tbody></table>
            <div class="totals"><strong>Totals:</strong> Yarn issued ${fmt(totals.yarn, 2)} kg · Fabric out ${fmt(totals.fabric, 2)} kg · Std loss ${fmt(totals.stdLoss, 2)} kg · Actual loss ${fmt(totals.actualLoss, 2)} kg · Net variance ${totals.variance >= 0 ? "+" : ""}${fmt(totals.variance, 2)} kg</div>
            </body></html>`);
          w.document.close();
          w.print();
        }} disabled={rows.length === 0}
          style={{ background: "#14532d", color: "#86efac", border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: "bold", cursor: rows.length ? "pointer" : "default", fontSize: 13, opacity: rows.length ? 1 : 0.5 }}>
          🖨 Print
        </button>
      </div>

      {/* Summary KPIs */}
      {rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
          {[
            ["Yarn Issued",    `${fmt(totals.yarn, 2)} kg`,       "#60a5fa"],
            ["Fabric Out",     `${fmt(totals.fabric, 2)} kg`,     "#10b981"],
            ["Std Loss",       `${fmt(totals.stdLoss, 2)} kg`,    "#7da2d6"],
            ["Actual Loss",    `${fmt(totals.actualLoss, 2)} kg`, "#f59e0b"],
            ["Net Variance",   `${totals.variance >= 0 ? "+" : ""}${fmt(totals.variance, 2)} kg`,
              totals.variance > 0.1 ? "#ef4444" : totals.variance < -0.1 ? "#10b981" : "#f4ae1f"],
          ].map(([lbl, val, color]) => (
            <div key={lbl} style={{ background: "#0d1b2a", border: `1px solid ${color}44`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ color: "#7da2d6", fontSize: 11, marginBottom: 4 }}>{lbl}</div>
              <div style={{ color, fontSize: 20, fontWeight: "bold" }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Status badges */}
      {rows.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <span style={{ background: "#7f1d1d33", color: "#ef4444", border: "1px solid #ef444444", borderRadius: 20, padding: "4px 14px", fontSize: 12, fontWeight: "bold" }}>
            {unfav} UNFAVORABLE
          </span>
          <span style={{ background: "#14532d33", color: "#10b981", border: "1px solid #10b98144", borderRadius: 20, padding: "4px 14px", fontSize: 12, fontWeight: "bold" }}>
            {fav} FAVORABLE
          </span>
          <span style={{ background: "#78350f33", color: "#f4ae1f", border: "1px solid #f4ae1f44", borderRadius: 20, padding: "4px 14px", fontSize: 12, fontWeight: "bold" }}>
            {rows.length - unfav - fav} ON TARGET
          </span>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ color: "#7da2d6", textAlign: "center", padding: 40 }}>Loading variance data...</div>
      ) : rows.length === 0 ? (
        <div style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 10, padding: 40, textAlign: "center", color: "#4a5568" }}>
          No data for this period. Issue yarn and approve rolls to generate variance entries.
        </div>
      ) : (
        <div style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#1e3a5f" }}>
              {["Date","Machine","Yarn Issued","Fabric Out","Rolls","Std Loss %","Std Loss","Actual Loss","Variance","Status"].map(c => (
                <th key={c} style={thS}>{c}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const varKg = parseFloat(r.variance_kg);
                const varColor = r.variance_status === "UNFAVORABLE" ? "#ef4444" : r.variance_status === "FAVORABLE" ? "#10b981" : "#f4ae1f";
                return (
                  <tr key={i} style={{ background: i % 2 ? "#081426" : "transparent" }}>
                    <td style={{ ...tdS, color: "#e2e8f0", fontWeight: 500 }}>{r.date}</td>
                    <td style={{ ...tdS, color: "#60a5fa", fontFamily: "monospace" }}>{r.machine_name || r.machine_id || "—"}</td>
                    <td style={{ ...tdS, color: "#e2e8f0" }}>{r.yarn_issued_kg} kg</td>
                    <td style={{ ...tdS, color: "#10b981", fontWeight: 600 }}>{r.fabric_produced_kg} kg</td>
                    <td style={{ ...tdS, color: "#7da2d6" }}>{r.roll_count}</td>
                    <td style={{ ...tdS, color: "#7da2d6" }}>{r.std_loss_pct}%</td>
                    <td style={{ ...tdS, color: "#7da2d6" }}>{r.std_loss_kg} kg</td>
                    <td style={{ ...tdS, color: "#f59e0b" }}>{r.actual_loss_kg} kg</td>
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

      <div style={{ color: "#4a5568", fontSize: 11, marginTop: 12 }}>
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
      .over{color:red;font-weight:bold}.short{color:#d97706;font-weight:bold}.ok{color:green}
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

  const statusColor = (s) => s === 'OVER' ? '#ef4444' : s === 'SHORT' ? '#f59e0b' : '#22c55e';

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label style={{ color: "#7da2d6", fontSize: 12 }}>From
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              style={{ marginLeft: 6, background: "#081426", border: "1px solid #1e3a5f", color: "#e2e8f0", borderRadius: 4, padding: "5px 8px", fontSize: 13 }} />
          </label>
          <label style={{ color: "#7da2d6", fontSize: 12 }}>To
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              style={{ marginLeft: 6, background: "#081426", border: "1px solid #1e3a5f", color: "#e2e8f0", borderRadius: 4, padding: "5px 8px", fontSize: 13 }} />
          </label>
        </div>
        <button onClick={printReport} style={{ background: "#1e3a5f", color: "#93c5fd", border: "none", borderRadius: 5, padding: "7px 16px", cursor: "pointer", fontSize: 13 }}>🖨 Print</button>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
        <div style={{ background: "#081426", borderRadius: 8, padding: 14, border: "1px solid #1e3a5f" }}>
          <div style={{ color: "#7da2d6", fontSize: 11 }}>Std Consumption</div>
          <div style={{ color: "#e2e8f0", fontSize: 20, fontWeight: 700 }}>{totalStd.toFixed(1)} kg</div>
        </div>
        <div style={{ background: "#081426", borderRadius: 8, padding: 14, border: "1px solid #1e3a5f" }}>
          <div style={{ color: "#7da2d6", fontSize: 11 }}>Actual Consumption</div>
          <div style={{ color: "#e2e8f0", fontSize: 20, fontWeight: 700 }}>{totalAct.toFixed(1)} kg</div>
        </div>
        <div style={{ background: "#081426", borderRadius: 8, padding: 14, border: "1px solid #1e3a5f" }}>
          <div style={{ color: "#7da2d6", fontSize: 11 }}>Total Variance</div>
          <div style={{ color: totalVar > 0.5 ? "#ef4444" : totalVar < -0.5 ? "#f59e0b" : "#22c55e", fontSize: 20, fontWeight: 700 }}>
            {totalVar > 0 ? "+" : ""}{totalVar.toFixed(1)} kg
          </div>
        </div>
        <div style={{ background: "#081426", borderRadius: 8, padding: 14, border: "1px solid #1e3a5f" }}>
          <div style={{ color: "#7da2d6", fontSize: 11 }}>Variance %</div>
          <div style={{ color: totalVar > 0.5 ? "#ef4444" : totalVar < -0.5 ? "#f59e0b" : "#22c55e", fontSize: 20, fontWeight: 700 }}>
            {totalStd > 0 ? ((totalVar/totalStd)*100).toFixed(1) : "0.0"}%
          </div>
        </div>
      </div>

      {loading ? <div style={{ color: "#7da2d6", padding: 40, textAlign: "center" }}>Loading...</div> : data.length === 0 ? (
        <div style={{ color: "#475569", padding: 40, textAlign: "center" }}>No BOM variance data. Ensure fabrics have BOM defined and rolls are approved in this date range.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#1e3a5f" }}>
                {["Machine", "Fabric", "Produced (kg)", "Rolls", "Yarn", "BOM %", "Std (kg)", "Actual (kg)", "Variance (kg)", "Var %", "Status"].map(c => (
                  <th key={c} style={{ padding: "8px 10px", textAlign: "left", color: "#7da2d6", fontSize: 11, fontWeight: 600, borderBottom: "1px solid #1e3a5f", whiteSpace: "nowrap" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? "#081426" : "transparent", borderBottom: "1px solid #1e3a5f" }}>
                  <td style={{ padding: "7px 10px", color: "#f4ae1f", fontWeight: 600 }}>{r.machine_id}</td>
                  <td style={{ padding: "7px 10px" }}>{r.fabric_code}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.fabric_produced_kg}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.roll_count}</td>
                  <td style={{ padding: "7px 10px" }}><span style={{ color: "#a78bfa" }}>{r.yarn_code}</span> — {r.yarn_name}</td>
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
    <div style={{ padding: 20, color: "#e2e8f0", background: "#050d1a", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: "#f4ae1f" }}>₹ Costing</h2>
          <div style={{ color: "#7da2d6", fontSize: 13, marginTop: 2 }}>FIFO yarn costing · Knitting variance · AI assistant (Groq)</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 22, borderBottom: "1px solid #1e3a5f" }}>
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            style={{ padding: "10px 22px", border: "none", borderBottom: tab === i ? "2px solid #f4ae1f" : "2px solid transparent", background: "transparent", color: tab === i ? "#f4ae1f" : "#7da2d6", cursor: "pointer", fontWeight: tab === i ? "bold" : 400, fontSize: 14 }}>
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
