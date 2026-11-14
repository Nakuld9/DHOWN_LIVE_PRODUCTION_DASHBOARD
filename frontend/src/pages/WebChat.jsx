// Public customer web-chat widget — the "Chat with us" experience for website
// visitors who are NOT on WhatsApp. It talks to /api/webchat/* (no login) and the
// conversation lands in the same CRM inbox as WhatsApp, tagged channel='WEB'.
//
// Standalone by design: no sidebar, no auth, same-origin fetch. It fills its
// container, so a company website embeds it as a floating iframe (see the embed
// snippet in the repo docs) or links to /chat directly.

import React, { useState, useEffect, useRef, useCallback } from "react";

const API = "";
const SKEY = "dhown_webchat_session";
const NKEY = "dhown_webchat_name";

function getSession() {
  let s = localStorage.getItem(SKEY);
  if (!s) {
    s = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem(SKEY, s);
  }
  return s;
}
async function readJson(r) { const t = await r.text(); try { return JSON.parse(t); } catch { throw new Error(r.ok ? "Bad response" : `Error ${r.status}`); } }

const YELLOW = "var(--gold)";
const BG = "var(--surface)", SURFACE = "var(--surface)", BORDER = "var(--border)", TEXT = "var(--text)", MUTED = "var(--muted)";

export default function WebChat() {
  const [session] = useState(getSession);
  const [company, setCompany] = useState("our team");
  const [name, setName] = useState(() => localStorage.getItem(NKEY) || "");
  const [askName, setAskName] = useState(() => !localStorage.getItem(NKEY));
  const [msgs, setMsgs] = useState([]);            // { role:'user'|'bot', text }
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await readJson(await fetch(`${API}/api/webchat/config`));
        if (cfg.company) setCompany(cfg.company);
        const h = await readJson(await fetch(`${API}/api/webchat/history?session=${encodeURIComponent(session)}`));
        if (h.messages && h.messages.length) { setMsgs(h.messages.map((m) => ({ role: m.role, text: m.text }))); scrollDown(); }
        else if (cfg.greeting) setMsgs([{ role: "bot", text: cfg.greeting }]);
      } catch { setMsgs([{ role: "bot", text: "Hi! How can we help you today?" }]); }
    })();
  }, [session, scrollDown]);

  // Poll history so a staff member replying from the CRM inbox reaches the visitor.
  // Only refresh when the server has MORE messages than we're showing, so it never
  // clobbers an optimistic bubble mid-send.
  useEffect(() => {
    const id = setInterval(async () => {
      if (busy) return;
      try {
        const h = await readJson(await fetch(`${API}/api/webchat/history?session=${encodeURIComponent(session)}`));
        if (h.messages && h.messages.length > msgs.length) {
          setMsgs(h.messages.map((m) => ({ role: m.role, text: m.text }))); scrollDown();
        }
      } catch { /* transient */ }
    }, 6000);
    return () => clearInterval(id);
  }, [session, msgs.length, busy, scrollDown]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text }]);
    setBusy(true); scrollDown();
    try {
      const j = await readJson(await fetch(`${API}/api/webchat/message`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, text, name }),
      }));
      setMsgs((m) => [...m, { role: "bot", text: j.reply || "Thanks — we'll get back to you shortly." }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "bot", text: "Sorry, that didn't go through. Please try again." }]);
    } finally { setBusy(false); scrollDown(); }
  };

  const saveName = () => { localStorage.setItem(NKEY, name.trim()); setAskName(false); };

  const bubble = (m, i) => (
    <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 8 }}>
      <div style={{
        maxWidth: "82%", padding: "9px 13px", borderRadius: 12, fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word",
        background: m.role === "user" ? YELLOW : SURFACE,
        color: m.role === "user" ? "var(--on-gold)" : TEXT,
        border: m.role === "user" ? "none" : `1px solid ${BORDER}`,
        borderBottomRightRadius: m.role === "user" ? 3 : 12,
        borderBottomLeftRadius: m.role === "user" ? 12 : 3,
      }}>{m.text}</div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: BG, color: TEXT, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: `1px solid ${BORDER}`, background: "var(--surface)" }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: YELLOW, color: "var(--on-gold)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 17 }}>D</div>
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{company}</div>
          <div style={{ fontSize: 11.5, color: "var(--green)" }}>● Online · usually replies instantly</div>
        </div>
      </div>

      {/* Messages */}
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "14px 14px 6px" }}>
        {msgs.map(bubble)}
        {busy && (
          <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
            <div style={{ padding: "9px 14px", borderRadius: 12, background: SURFACE, border: `1px solid ${BORDER}`, color: MUTED, fontSize: 14 }}>typing…</div>
          </div>
        )}
      </div>

      {/* Name prompt (once) */}
      {askName && (
        <div style={{ padding: "10px 14px", borderTop: `1px solid ${BORDER}`, background: "var(--surface)", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12.5, color: MUTED, whiteSpace: "nowrap" }}>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && saveName()} placeholder="optional"
            style={{ flex: 1, background: BG, border: `1px solid ${BORDER}`, borderRadius: 7, padding: "7px 10px", color: TEXT, fontSize: 13 }} />
          <button onClick={saveName} style={{ background: "var(--surface)", color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 7, padding: "7px 12px", fontSize: 12.5, cursor: "pointer" }}>Continue</button>
        </div>
      )}

      {/* Composer */}
      <div style={{ display: "flex", gap: 8, padding: 12, borderTop: `1px solid ${BORDER}`, background: "var(--surface)" }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1} placeholder="Type your message…"
          style={{ flex: 1, resize: "none", background: BG, border: `1px solid ${BORDER}`, borderRadius: 9, padding: "10px 12px", color: TEXT, fontSize: 14, fontFamily: "inherit", maxHeight: 120 }} />
        <button onClick={send} disabled={busy || !input.trim()} style={{ background: YELLOW, color: "var(--on-gold)", border: "none", borderRadius: 9, padding: "0 18px", fontWeight: 700, fontSize: 14, cursor: busy || !input.trim() ? "default" : "pointer", opacity: busy || !input.trim() ? 0.5 : 1 }}>Send</button>
      </div>
    </div>
  );
}
