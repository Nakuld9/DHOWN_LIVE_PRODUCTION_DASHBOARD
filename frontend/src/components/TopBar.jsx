// TopBar — the redesigned application shell's utility bar (Phase 2).
// Global search (⌘K), unit + shift context, alerts, AI, and the user profile.
// Non-breaking: it sits above page content and adds shell utilities; page
// headers still render below it.
import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

const C = {
  bar: "var(--surface)", border: "var(--border)", text: "var(--text)", muted: "var(--muted)",
  faint: "var(--faint)", yellow: "var(--gold)", surface: "var(--surface)", crit: "var(--crit)",
};

export default function TopBar() {
  const nav = useNavigate();
  const [shift, setShift] = useState(null);
  const [now, setNow] = useState(new Date());
  const [openK, setOpenK] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef(null);

  // Theme preference: "light" | "dark" | "system" (white-green-gold in both).
  // "system" follows the OS via prefers-color-scheme. Persisted per browser.
  const [themePref, setThemePref] = useState(() => {
    try { return localStorage.getItem("dhown_theme") || "light"; } catch { return "light"; }
  });
  useEffect(() => {
    const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const apply = () => {
      const eff = themePref === "system" ? (mq && mq.matches ? "dark" : "light") : themePref;
      try {
        document.documentElement.setAttribute("data-theme", eff);
        localStorage.setItem("dhown_theme", themePref);
      } catch {}
    };
    apply();
    if (themePref === "system" && mq) {
      mq.addEventListener ? mq.addEventListener("change", apply) : mq.addListener(apply);
      return () => { mq.removeEventListener ? mq.removeEventListener("change", apply) : mq.removeListener(apply); };
    }
  }, [themePref]);
  // cycle Light -> Dark -> Auto(system) -> Light
  const cycleTheme = () => setThemePref((t) => (t === "light" ? "dark" : t === "dark" ? "system" : "light"));
  const themeIcon = themePref === "light" ? "☀" : themePref === "dark" ? "☾" : "🖥";
  const themeNext = themePref === "light" ? "dark" : themePref === "dark" ? "auto (system)" : "light";

  let user = {};
  try { user = JSON.parse(localStorage.getItem("dhown_user") || "{}"); } catch { user = {}; }

  useEffect(() => {
    const fetchShift = async () => {
      try {
        const r = await fetch("/api/analytics/shifts", { headers: { Authorization: `Bearer ${localStorage.getItem("dhown_token")}` } });
        const d = await r.json();
        setShift(d.current_shift || null);
      } catch { setShift(null); }
    };
    fetchShift();
    const t1 = setInterval(fetchShift, 60000);
    const t2 = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);

  // ⌘K / Ctrl-K global search
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpenK((o) => !o); }
      if (e.key === "Escape") setOpenK(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (openK) setTimeout(() => inputRef.current?.focus(), 30); }, [openK]);

  const displayShift = shift ?? (now.getHours() >= 8 && now.getHours() < 20 ? "A" : "B");
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("en-GB").split("/").join("-");
  const initials = (user.full_name || user.username || "U").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  // Command-palette destinations (subset — the real search can grow later).
  const DESTS = [
    { t: "Dashboard", to: "/" }, { t: "Operations Dashboard", to: "/operations" },
    { t: "Machines", to: "/machines" }, { t: "Production", to: "/production" },
    { t: "Work Orders", to: "/work-orders" }, { t: "Rolls", to: "/rolls" },
    { t: "Yarn Store", to: "/yarn-store" }, { t: "Finished Goods", to: "/finished-goods" },
    { t: "Dispatch", to: "/dispatch" }, { t: "Sales Orders", to: "/sales-orders" },
    { t: "Invoice OCR", to: "/invoice-ocr" }, { t: "Shade Cards", to: "/shade-cards" },
    { t: "Job-work Reconciliation", to: "/jobwork-reconciliation" }, { t: "Quality Inspection", to: "/quality-inspection" },
    { t: "Maintenance", to: "/maintenance" }, { t: "Reports", to: "/reports" },
    { t: "Ask AI", to: "/ask-ai" }, { t: "AI Approvals", to: "/ai-approvals" }, { t: "Settings", to: "/settings" },
  ];
  const matches = q.trim() ? DESTS.filter((d) => d.t.toLowerCase().includes(q.toLowerCase())) : DESTS.slice(0, 8);
  const go = (to) => { setOpenK(false); setQ(""); nav(to); };

  const sel = { fontFamily: "var(--mono)", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", color: C.text, fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".05em", cursor: "pointer" };
  const icon = { position: "relative", background: "var(--surface)", border: `1px solid ${C.border}`, color: C.muted, width: 34, height: 34, borderRadius: 6, fontSize: 15, cursor: "pointer" };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", background: C.bar, borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, zIndex: 50 }}>
        <button onClick={() => setOpenK(true)} title="Search (Ctrl+K)"
          style={{ flex: 1, maxWidth: 420, display: "flex", alignItems: "center", gap: 9, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", color: C.faint, fontSize: 13, cursor: "text" }}>
          ⌕ <span>Search machines, orders, pages…</span>
          <kbd style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10, background: "var(--surface)", border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 6px", color: C.muted }}>Ctrl K</kbd>
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ ...sel, cursor: "default", color: C.muted }}>{dateStr}</span>
        <span style={sel}>Shift {displayShift}</span>
        <span style={{ ...sel, cursor: "default" }} className="mono">{timeStr}</span>
        <button style={icon} title={`Theme: ${themePref} — click for ${themeNext}`} onClick={cycleTheme}>{themeIcon}</button>
        <button style={icon} title="Alerts" onClick={() => nav("/alerts")}>◔</button>
        <button style={{ ...icon, background: "var(--gold-dim)", borderColor: "var(--gold-edge)", color: C.yellow }} title="AI Assistant" onClick={() => nav("/ask-ai")}>✦</button>
        <div title={user.full_name || user.username} onClick={() => nav("/settings")}
          style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}>
          <span style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--surface)", border: "1px solid var(--gold-edge)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, color: C.yellow }}>{initials}</span>
        </div>
      </div>

      {openK && (
        <div onClick={() => setOpenK(false)}
          style={{ position: "fixed", inset: 0, background: "#05050799", zIndex: 300, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: 560, maxWidth: "92vw", background: "var(--surface)", border: "1px solid var(--gold-edge)", borderRadius: 13, boxShadow: "0 10px 30px -12px rgba(0,0,0,.85)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "15px 18px", borderBottom: `1px solid ${C.border}`, color: C.yellow }}>
              ⌕ <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) go(matches[0].to); }}
                placeholder="Jump to a page…" autoComplete="off"
                style={{ flex: 1, background: "none", border: 0, outline: "none", color: C.text, fontSize: 16 }} />
            </div>
            <div style={{ maxHeight: 340, overflowY: "auto", padding: 8 }}>
              {matches.map((d) => (
                <div key={d.to} onClick={() => go(d.to)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 11px", borderRadius: 6, color: C.muted, cursor: "pointer" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.color = "var(--gold-2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.muted; }}>
                  <span>◦</span>{d.t}
                </div>
              ))}
              {matches.length === 0 && <div style={{ padding: 16, color: C.faint, fontSize: 13 }}>No match.</div>}
            </div>
            <div style={{ textAlign: "center", padding: 12, fontFamily: "var(--mono)", fontSize: 10, color: C.faint, letterSpacing: ".12em", textTransform: "uppercase" }}>Enter open · Esc close</div>
          </div>
        </div>
      )}
    </>
  );
}
