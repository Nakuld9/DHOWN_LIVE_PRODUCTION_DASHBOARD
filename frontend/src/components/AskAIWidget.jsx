// Floating Ask-AI button — a round FAB on every page that opens a compact chat
// popup, so you can ask the agent fleet from anywhere without leaving the screen.
// Shares the same /api/ai/ask endpoint as the full Ask AI page.

import React, { useState, useRef, useEffect } from "react";

const jsonH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const SUGGESTIONS = ["How did we do this week?", "How much production today?", "How much yarn stock?", "What's stuck at the dye house?", "What customer follow-ups are pending?"];

export default function AskAIWidget() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const [idle, setIdle] = useState(false);

  // Auto-hide: after a few seconds of no activity the button fades and slides mostly
  // off the right edge; any mouse move / scroll / touch / keypress brings it back.
  useEffect(() => {
    let t;
    const reset = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 4000); };
    const evs = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];
    evs.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(t); evs.forEach(e => window.removeEventListener(e, reset)); };
  }, []);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy, open]);

  const ask = async (question) => {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setQ(""); setBusy(true);
    setTurns(t => [...t, { q: text, pending: true }]);
    try {
      const r = await fetch(`/api/ai/ask`, { method: "POST", headers: jsonH(), body: JSON.stringify({ question: text }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setTurns(t => t.map((x, i) => i === t.length - 1 ? { q: text, answer: j.answer, tools: j.tools_used, confidence: j.confidence } : x));
    } catch (e) {
      setTurns(t => t.map((x, i) => i === t.length - 1 ? { q: text, err: e.message } : x));
    } finally { setBusy(false); }
  };

  const confColor = (c) => c >= 0.75 ? "var(--green)" : c >= 0.6 ? "var(--gold)" : "var(--crit)";

  return (
    <>
      {/* Panel */}
      {open && (
        <div style={{
          position: "fixed", right: 20, bottom: 94, width: "min(380px, calc(100vw - 32px))",
          height: "min(520px, calc(100vh - 130px))", background: "var(--bg)", border: "1px solid var(--border)",
          borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,.5)", zIndex: 10000,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)" }}>
            <div>
              <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: 14 }}>🤖 Ask AI</div>
              <div style={{ color: "var(--muted)", fontSize: 11 }}>Answers from live data — no guesses</div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {!turns.length && (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => ask(s)} style={{ textAlign: "left", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--link)", borderRadius: 8, padding: "8px 11px", fontSize: 13, cursor: "pointer" }}>{s}</button>
                ))}
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ alignSelf: "flex-end", background: "var(--surface)", borderRadius: "10px 10px 2px 10px", padding: "7px 11px", maxWidth: "85%", fontSize: 13, color: "var(--text)" }}>{t.q}</div>
                <div style={{ alignSelf: "flex-start", maxWidth: "90%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px 10px 10px 2px", padding: "9px 12px" }}>
                  {t.pending ? <span style={{ color: "var(--muted)", fontSize: 13 }}>Thinking…</span>
                    : t.err ? <span style={{ color: "var(--crit)", fontSize: 13 }}>{t.err}</span>
                    : <>
                      <div style={{ fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{t.answer}</div>
                      <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 10, color: "var(--muted)", flexWrap: "wrap" }}>
                        {t.tools?.length ? <span>🔧 {t.tools.join(", ")}</span> : <span>no tools</span>}
                        <span>confidence <b style={{ color: confColor(t.confidence) }}>{Math.round((t.confidence ?? 0) * 100)}%</b></span>
                      </div>
                    </>}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div style={{ padding: 10, borderTop: "1px solid var(--border)", display: "flex", gap: 7 }}>
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && ask()} disabled={busy}
              placeholder="Ask about production, stock, quality…" style={{ flex: 1, padding: "9px 11px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13 }} />
            <button onClick={() => ask()} disabled={busy || !q.trim()} style={{ background: "var(--yellow)", color: "#000", border: "none", borderRadius: 8, padding: "0 15px", fontWeight: 700, cursor: "pointer", opacity: busy || !q.trim() ? 0.5 : 1 }}>➤</button>
          </div>
        </div>
      )}

      {/* Floating button — auto-hides when idle, returns on activity/hover */}
      <button
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setIdle(false)}
        title="Ask AI"
        style={{
          position: "fixed", right: 90, bottom: 24, width: 52, height: 52, borderRadius: "50%",
          background: "var(--yellow)", color: "var(--bg)", border: "none", cursor: "pointer",
          fontSize: 23, boxShadow: "0 6px 20px rgba(244,174,31,.4)", zIndex: 10001,
          display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
          transition: "opacity .4s ease, transform .4s ease",
          opacity: (idle && !open) ? 0.12 : 1,
          transform: (idle && !open) ? "translateX(62%)" : "none",
        }}
      >
        {open ? "✕" : "🤖"}
      </button>
    </>
  );
}
