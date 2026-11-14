// AI Insights — the proactive feed. Polls the deterministic rules endpoint and
// surfaces what needs attention, each with an action and an "Ask AI" that hands the
// question to the agent fleet on the Ask AI screen.
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const SEV = {
  crit: { c: "var(--crit)", label: "Critical" },
  warn: { c: "var(--gold)", label: "Warning" },
  info: { c: "var(--link)", label: "Info" },
};

export default function AIInsights() {
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ai/insights", { headers: { Authorization: `Bearer ${localStorage.getItem("dhown_token")}` } });
      const j = await r.json();
      if (r.ok && Array.isArray(j)) setItems(j);
    } catch { /* keep last */ }
    finally { setLoaded(true); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const askAI = (q) => { try { sessionStorage.setItem("dhown_ai_q", q); } catch {} nav("/ask-ai"); };

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 15px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ color: "var(--yellow)" }}>✦</span>
        <h3 style={{ margin: 0, fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>AI Insights</h3>
        {items.length > 0 && <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--on-gold)", background: "var(--yellow)", borderRadius: 99, padding: "1px 7px", fontWeight: 700 }}>{items.length}</span>}
        <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".1em" }}>auto · 30s</span>
      </div>

      {items.length === 0 ? (
        <div style={{ padding: "22px 15px", color: loaded ? "var(--green)" : "var(--muted)", fontFamily: "var(--mono)", fontSize: 13 }}>
          {loaded ? "✓ All clear — nothing needs attention." : "Checking…"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: 12 }}>
          {items.map((it) => {
            const s = SEV[it.severity] || SEV.info;
            return (
              <div key={it.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: `3px solid ${s.c}`, borderRadius: 9, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: s.c, background: `${s.c}1f`, border: `1px solid ${s.c}33`, borderRadius: 99, padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.c }} />{it.category}
                  </span>
                  <b style={{ fontSize: 13.5 }}>{it.title}</b>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.5 }}>{it.evidence}</div>
                <div style={{ display: "flex", gap: 7, marginTop: 11 }}>
                  {it.action && (
                    <button onClick={() => nav(it.action.to)} style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{it.action.label}</button>
                  )}
                  {it.ask && (
                    <button onClick={() => askAI(it.ask)} style={{ background: "transparent", color: "var(--yellow)", border: "1px solid var(--yellow-edge, var(--gold-edge))", borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>✦ Ask AI</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
