// AI performance — what the assistant is actually doing.
//
// wa_ai_actions had recorded every run since the CRM went in and nothing read
// it. This measures behaviour, not quality: whether an answer was GOOD is what
// the eval harness is for. What this answers is which tools it leans on, how
// often it is unsure, how much it sends unattended, and whether any of that
// changed after a prompt or model edit.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600 };
const td = { padding: "8px 10px", textAlign: "left", fontSize: 13, borderTop: "1px solid var(--surface)" };
const numTd = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const input = { padding: "8px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6 };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 6, padding: "8px 15px", fontWeight: 600, fontSize: 13, cursor: "pointer" });

export default function AIPerformance() {
  const [range, setRange] = useState({ from: "", to: "" });
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const p = new URLSearchParams();
      if (range.from) p.set("from", range.from);
      if (range.to) p.set("to", range.to);
      const r = await fetch(`${API}/api/reports/ai-performance?${p}`, { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setD(j);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, []);   // eslint-disable-line

  const maxDay = d && d.daily.length ? Math.max(...d.daily.map(x => x.runs)) : 1;

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>AI Performance</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        What the assistant is doing — not whether it was right. Answer quality is what the
        eval harness measures; this is behaviour, and whether it has changed.
      </div>

      <div style={{ ...card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input type="date" style={input} value={range.from}
               onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
        <span style={{ color: "var(--muted)" }}>to</span>
        <input type="date" style={input} value={range.to}
               onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
        <button style={btn("var(--yellow)", "#000")} disabled={loading} onClick={load}>
          {loading ? "Loading…" : "Refresh"}
        </button>
        {(range.from || range.to) && (
          <button style={btn("var(--surface)", "var(--text)")} onClick={() => { setRange({ from: "", to: "" }); }}>
            All time
          </button>
        )}
      </div>

      {err && <div style={{ ...card, marginTop: 12, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}

      {d && d.empty && (
        <div style={{ ...card, marginTop: 12, color: "var(--muted)" }}>
          The assistant has not run in this period. Nothing to report — which is different from
          everything being zero.
        </div>
      )}

      {d && !d.empty && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginTop: 14 }}>
            <KPI title="RUNS" value={d.totals.runs} sub={`${d.totals.conversations} conversations`} />
            <KPI title="SENT AUTOMATICALLY" value={d.totals.auto_sent} sub={`${d.totals.auto_rate}% of runs`} />
            <KPI title="HELD FOR A HUMAN" value={d.totals.held_for_human}
                 color="var(--green)" sub="by design, not failure" />
            <KPI title="AVG CONFIDENCE"
                 value={d.confidence.average === null ? "—" : d.confidence.average}
                 sub={`${d.confidence.scored} scored`} />
            <KPI title="LOW CONFIDENCE" value={d.confidence.low_confidence}
                 color={d.confidence.low_confidence ? "var(--gold)" : "var(--green)"}
                 sub={`${d.confidence.low_rate}% of scored`} />
          </div>

          {d.confidence.unscored > 0 && (
            <div style={{ ...card, marginTop: 12, color: "var(--muted)", fontSize: 12 }}>
              {d.confidence.unscored} run(s) predate confidence scoring and are excluded from the
              average rather than counted as certain.
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, marginTop: 14 }}>
            <div style={card}>
              <Title>Tools used</Title>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={th}>Tool</th><th style={{ ...th, textAlign: "right" }}>Calls</th><th style={{ ...th, textAlign: "right" }}>Failed</th></tr></thead>
                <tbody>
                  {d.tools.map(t => (
                    <tr key={t.tool}>
                      <td style={td}>{t.tool}</td>
                      <td style={numTd}>{t.calls}</td>
                      <td style={{ ...numTd, color: t.failed ? "var(--crit)" : "var(--muted)" }}>{t.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.unused_tools && d.unused_tools.length > 0 && (
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 10 }}>
                  <b style={{ color: "var(--gold)" }}>Never chosen:</b> {d.unused_tools.join(", ")}.
                  A tool the model never picks is either described badly or unnecessary.
                </div>
              )}
            </div>

            <div style={card}>
              <Title>What customers ask</Title>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={th}>Intent</th><th style={{ ...th, textAlign: "right" }}>Count</th></tr></thead>
                <tbody>
                  {d.intents.map(i => (
                    <tr key={i.intent}>
                      <td style={td}>{i.intent.replace(/_/g, " ")}</td>
                      <td style={numTd}>{i.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ ...card, marginTop: 14 }}>
            <Title>Daily volume</Title>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120, overflowX: "auto", paddingTop: 8 }}>
              {[...d.daily].reverse().map(x => (
                <div key={x.day} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 34 }}>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80 }}>
                    <div title={`${x.runs} runs`}
                         style={{ width: 10, height: `${(x.runs / maxDay) * 100}%`, background: "var(--link)", minHeight: 2 }} />
                    <div title={`${x.auto} auto-sent`}
                         style={{ width: 10, height: `${(x.auto / maxDay) * 100}%`, background: "var(--green)", minHeight: x.auto ? 2 : 0 }} />
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 9, marginTop: 5 }}>{x.day.slice(5)}</div>
                </div>
              ))}
              <div style={{ marginLeft: 10, fontSize: 12, alignSelf: "flex-start" }}>
                <div><span style={{ display: "inline-block", width: 9, height: 9, background: "var(--link)", marginRight: 6 }} />runs</div>
                <div style={{ marginTop: 4 }}><span style={{ display: "inline-block", width: 9, height: 9, background: "var(--green)", marginRight: 6 }} />auto-sent</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Title({ children }) {
  return <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{children}</div>;
}

function KPI({ title, value, sub, color }) {
  return (
    <div style={card}>
      <div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: 0.4 }}>{title}</div>
      <div style={{ fontSize: 21, fontWeight: 700, marginTop: 4, color: color || "var(--text)" }}>{value}</div>
      {sub && <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
