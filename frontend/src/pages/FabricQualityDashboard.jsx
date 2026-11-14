// Fabric quality dashboard — reads /api/fabric-inspection/report.
//
// Answers the three questions a quality manager asks: how much passed (grade
// split), what is causing the failures (defect Pareto), and which machine is the
// worst offender (per-machine reject table). All from the 4-point inspections.

import React, { useState, useEffect, useCallback } from "react";
import AskAIButton from "../components/AskAIButton";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, padding: 16 };
const input = { padding: "8px 11px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, fontFamily: "var(--mono)", fontSize: 13 };
const th = { fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)", textAlign: "left", padding: "10px 12px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const td = { padding: "10px 12px", fontSize: 13, borderTop: "1px solid var(--border-soft)" };
const numTd = { ...td, textAlign: "right", fontFamily: "var(--mono)", fontVariantNumeric: "tabular-nums" };
const GC = { A: "var(--green)", B: "var(--gold)", REJECT: "var(--crit)", UNGRADED: "var(--muted)" };
const PARETO = "var(--gold-deep)";
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };

const StatTile = ({ label, value, unit, rail, tone, lead }) => (
  <div style={{ background: lead ? "linear-gradient(150deg,var(--surface),var(--surface) 62%)" : "var(--surface)", border: `1px solid ${lead ? "var(--gold-dim)" : "var(--border)"}`, borderRadius: 9, padding: "13px 14px", position: "relative", overflow: "hidden", flex: 1, minWidth: 128 }}>
    <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: rail }} />
    <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
    <div style={{ fontFamily: "var(--mono)", fontSize: 23, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-.02em", marginTop: 8, lineHeight: 1, color: lead ? "var(--yellow)" : (tone || "var(--text)") }}>
      {value}{unit && <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>{unit}</span>}
    </div>
  </div>
);

const Panel = ({ title, children }) => (
  <div style={card}>
    <div style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 14 }}>{title}</div>
    {children}
  </div>
);

const Bar = ({ value, max, color, label, right }) => (
  <div style={{ marginBottom: 10 }}>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
      <span style={{ color: "var(--text)" }}>{label}</span><span style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 11 }}>{right}</span>
    </div>
    <div style={{ background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 4, height: 12, overflow: "hidden" }}>
      <div style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, height: "100%", background: color, borderRadius: 3, minWidth: value > 0 ? 3 : 0 }} />
    </div>
  </div>
);

export default function FabricQualityDashboard() {
  const [range, setRange] = useState({ stage: "", from: monthStart(), to: new Date().toISOString().slice(0, 10) });
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setErr(""); setLoading(true);
    try {
      const q = new URLSearchParams();
      if (range.stage) q.set("stage", range.stage);
      if (range.from) q.set("from", range.from);
      if (range.to) q.set("to", range.to);
      const r = await fetch(`${API}/api/fabric-inspection/report?${q}`, { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setData(j);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const grades = data?.grades || [];
  const gm = Object.fromEntries(grades.map(g => [g.grade, Number(g.rolls)]));
  const totalRolls = grades.reduce((s, g) => s + Number(g.rolls), 0);
  const totalM = grades.reduce((s, g) => s + Number(g.metres || 0), 0);
  const maxGrade = Math.max(1, ...grades.map(g => Number(g.rolls)));
  const fpy = pct((gm.A || 0) + (gm.B || 0), totalRolls);
  const rejectRate = pct(gm.REJECT || 0, totalRolls);

  const pareto = data?.pareto || [];
  const totalPts = pareto.reduce((s, d) => s + Number(d.points), 0);
  const maxPts = Math.max(1, ...pareto.map(d => Number(d.points)));
  let cum = 0;

  const byMachine = data?.byMachine || [];

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--faint)", letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 7 }}>Quality · 4-Point Grading</div>
          <h1 style={{ margin: 0, fontFamily: "var(--mono)", fontWeight: 800, fontSize: 24, letterSpacing: ".02em", textTransform: "uppercase" }}>Fabric Quality</h1>
        </div>
        <div style={{ marginLeft: "auto" }}><AskAIButton question="Break down today's fabric rejections by machine and defect type, and what should I prioritise?" /></div>
      </div>

      {err && <div style={{ ...card, marginBottom: 12, borderColor: "var(--crit-dim)", color: "var(--crit-edge)" }}>{err}</div>}

      {/* Filters */}
      <div style={{ ...card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14, padding: "12px 14px" }}>
        <select style={input} value={range.stage} onChange={e => setRange(r => ({ ...r, stage: e.target.value }))}>
          <option value="">All stages</option><option value="GREIGE">Greige</option><option value="FINISHED">Finished</option>
        </select>
        <input type="date" style={input} value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
        <span style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 12 }}>to</span>
        <input type="date" style={input} value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
      </div>

      {loading ? <div style={{ ...card, textAlign: "center", color: "var(--muted)", padding: 30 }}>Loading…</div> : (
        <>
          {/* KPI tiles */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <StatTile label="First-Pass Yield" value={fpy} unit="%" rail="var(--yellow)" lead />
            <StatTile label="Rolls Inspected" value={totalRolls} rail="var(--mnt)" />
            <StatTile label="A-Grade" value={pct(gm.A || 0, totalRolls)} unit="%" rail={GC.A} tone={GC.A} />
            <StatTile label="B-Grade" value={pct(gm.B || 0, totalRolls)} unit="%" rail={GC.B} tone={GC.B} />
            <StatTile label="Reject Rate" value={rejectRate} unit="%" rail={GC.REJECT} tone={rejectRate > 0 ? GC.REJECT : "var(--text)"} />
            <StatTile label="Metres" value={Math.round(totalM).toLocaleString("en-IN")} rail="var(--mnt)" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }}>
            {/* Grade distribution */}
            <Panel title="Grade Distribution">
              {!totalRolls && <div style={{ color: "var(--muted)", fontSize: 13 }}>No inspections in this period.</div>}
              {["A", "B", "REJECT", "UNGRADED"].filter(g => gm[g]).map(g => (
                <Bar key={g} value={gm[g]} max={maxGrade} color={GC[g]} label={g} right={`${gm[g]} rolls · ${pct(gm[g], totalRolls)}%`} />
              ))}
            </Panel>

            {/* Defect Pareto */}
            <Panel title="Defect Pareto — by penalty points">
              {!pareto.length && <div style={{ color: "var(--muted)", fontSize: 13 }}>No defects recorded.</div>}
              {pareto.map(d => {
                cum += Number(d.points);
                return <Bar key={d.defect_type || "?"} value={Number(d.points)} max={maxPts} color={PARETO}
                  label={d.defect_type || "(unspecified)"} right={`${d.points} pts · ${pct(cum, totalPts)}% cum`} />;
              })}
            </Panel>
          </div>

          {/* Per-machine */}
          <div style={{ ...card, marginTop: 14, padding: 0 }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", padding: "13px 15px", borderBottom: "1px solid var(--border)" }}>By Machine — worst offenders first</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                <thead><tr>
                  <th style={th}>Machine</th><th style={{ ...th, textAlign: "right" }}>Inspected</th>
                  <th style={{ ...th, textAlign: "right" }}>A</th><th style={{ ...th, textAlign: "right" }}>B</th>
                  <th style={{ ...th, textAlign: "right" }}>Reject</th><th style={{ ...th, textAlign: "right" }}>Reject %</th>
                  <th style={{ ...th, textAlign: "right" }}>Points</th>
                </tr></thead>
                <tbody>
                  {!byMachine.length && <tr><td colSpan={7} style={{ ...td, color: "var(--muted)", textAlign: "center", padding: 30 }}>No data.</td></tr>}
                  {byMachine.map(m => {
                    const rr = pct(Number(m.rejects), Number(m.inspections));
                    return (
                      <tr key={m.machine_id}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--surface)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <td style={{ ...td, color: "var(--yellow)", fontFamily: "var(--mono)", fontWeight: 700 }}>{m.machine_id}</td>
                        <td style={numTd}>{m.inspections}</td>
                        <td style={{ ...numTd, color: GC.A }}>{m.a_grade}</td>
                        <td style={{ ...numTd, color: GC.B }}>{m.b_grade}</td>
                        <td style={{ ...numTd, color: GC.REJECT }}>{m.rejects}</td>
                        <td style={{ ...numTd, color: rr > 5 ? GC.REJECT : "var(--text)", fontWeight: rr > 5 ? 700 : 400 }}>{rr}%</td>
                        <td style={numTd}>{m.points}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
