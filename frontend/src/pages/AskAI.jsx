// Ask AI — a chat box for the agent fleet. Today the Production agent answers
// production & machine questions, grounded in live data. Every answer shows which
// tools it used and a grounding-confidence score, so you can see where it came from.

import React, { useState, useRef, useEffect } from "react";

const API = "";
const jsonH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const input = { flex: 1, padding: "11px 12px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14 };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "11px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer" });

const SUGGESTIONS = [
  "How did we do this week?",
  "How much production today?",
  "How much yarn stock do we have?",
  "What's our reject rate this month?",
  "What's stuck at the dye house?",
  "What customer follow-ups are pending?",
];

export default function AskAI() {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState([]); // {q, answer, tools, confidence, err}
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy]);

  const ask = async (question) => {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setQ(""); setBusy(true);
    setTurns(t => [...t, { q: text, pending: true }]);
    try {
      const r = await fetch(`${API}/api/ai/ask`, { method: "POST", headers: jsonH(), body: JSON.stringify({ question: text }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setTurns(t => t.map((x, i) => i === t.length - 1 ? { q: text, answer: j.answer, tools: j.tools_used, confidence: j.confidence, agent: j.agent } : x));
    } catch (e) {
      setTurns(t => t.map((x, i) => i === t.length - 1 ? { q: text, err: e.message } : x));
    } finally { setBusy(false); }
  };

  // If an AI Insight sent us here with a pending question, ask it automatically.
  useEffect(() => {
    let pending;
    try { pending = sessionStorage.getItem("dhown_ai_q"); sessionStorage.removeItem("dhown_ai_q"); } catch {}
    if (pending) ask(pending);
  }, []); // eslint-disable-line

  const confColor = (c) => c >= 0.75 ? "var(--green)" : c >= 0.6 ? "var(--gold)" : "var(--crit)";

  return (
    <div style={{ padding: 20, color: "var(--text)", maxWidth: 860, margin: "0 auto" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Ask AI</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        A fleet of agents (production, inventory, quality, job-work, maintenance, costing, purchase, dispatch, sales) answers from live data — reporting only what the system recorded, never a guess.
      </div>

      {!turns.length && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {SUGGESTIONS.map(s => (
            <button key={s} style={{ ...btn("var(--surface)", "var(--link)"), border: "1px solid var(--border)", fontWeight: 500, fontSize: 13, padding: "8px 12px" }} onClick={() => ask(s)}>{s}</button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
        {turns.map((t, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ alignSelf: "flex-end", background: "var(--surface)", borderRadius: "12px 12px 2px 12px", padding: "9px 13px", maxWidth: "80%", fontSize: 14 }}>{t.q}</div>
            <div style={{ alignSelf: "flex-start", maxWidth: "88%", ...card, borderRadius: "12px 12px 12px 2px", padding: "12px 15px" }}>
              {t.pending ? <span style={{ color: "var(--muted)" }}>Thinking…</span>
                : t.err ? <span style={{ color: "var(--crit)" }}>{t.err}</span>
                : <>
                  <div style={{ fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{t.answer}</div>
                  <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 11, color: "var(--muted)", flexWrap: "wrap" }}>
                    {t.tools?.length ? <span>🔧 {t.tools.join(", ")}</span> : <span>no tools used</span>}
                    <span>confidence <b style={{ color: confColor(t.confidence) }}>{Math.round((t.confidence ?? 0) * 100)}%</b></span>
                  </div>
                </>}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div style={{ display: "flex", gap: 8, position: "sticky", bottom: 12 }}>
        <input style={input} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && ask()} placeholder="Ask about production or machines…" disabled={busy} />
        <button style={{ ...btn("var(--yellow)", "#000"), opacity: busy || !q.trim() ? 0.5 : 1 }} disabled={busy || !q.trim()} onClick={() => ask()}>Ask</button>
      </div>
    </div>
  );
}
