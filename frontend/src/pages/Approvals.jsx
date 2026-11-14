// AI Approvals — the queue where agent-drafted actions wait for a human. A
// supervisor approves (which executes the action) or rejects it. Nothing an agent
// drafts takes effect until it is approved here.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 6, padding: "7px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" });
const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-') : "—");

// Read a response as JSON, but tolerate a non-JSON body (e.g. a tunnel 502 HTML
// page during a backend restart) with a clean message instead of a raw
// "Unexpected token '<'" parse error.
async function readJson(r) {
  const text = await r.text();
  try { return JSON.parse(text); }
  catch {
    if (!r.ok) throw new Error(`Server unavailable (${r.status}). Please retry in a moment.`);
    throw new Error("Unexpected response from the server. Please retry.");
  }
}
const STATUS_COLOR = { PENDING: "var(--gold)", EXECUTED: "var(--green)", REJECTED: "var(--muted)", FAILED: "var(--crit)" };

export default function Approvals() {
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState("PENDING");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(null);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 6000); };

  const load = useCallback(async () => {
    setErr("");
    try {
      const q = tab === "ALL" ? "" : `?status=${tab}`;
      const r = await fetch(`${API}/api/ai/approvals${q}`, { headers: auth() });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setRows(Array.isArray(j) ? j : []);
    } catch (e) { setErr(e.message); }
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const act = async (id, kind) => {
    setBusy(id); setErr("");
    try {
      const body = kind === "reject" ? { reason: window.prompt("Reason for rejecting (optional):", "") || null } : {};
      const r = await fetch(`${API}/api/ai/approvals/${id}/${kind}`, { method: "POST", headers: jsonH(), body: JSON.stringify(body) });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      flash(kind === "approve" ? `Approved and executed${j.result?.work_order_id ? ` — WO #${j.result.work_order_id}` : ""}.` : "Rejected.");
      load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>AI Approvals</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        Actions the AI has drafted. Nothing takes effect until a supervisor approves it here — approving runs the action.
      </div>

      {err && <div style={{ ...card, marginBottom: 12, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}
      {msg && <div style={{ ...card, marginBottom: 12, borderColor: "var(--green-dim)", color: "var(--green)" }}>{msg}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {["PENDING", "EXECUTED", "REJECTED", "ALL"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? "var(--yellow)" : "var(--surface)", tab === t ? "#000" : "var(--link)"), border: "1px solid var(--border)" }}>{t}</button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {!rows.length && <div style={{ ...card, color: "var(--muted)" }}>Nothing here.</div>}
        {rows.map(a => (
          <div key={a.approval_id} style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ minWidth: 260, flex: 1 }}>
              <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 600 }}>{a.summary || a.tool}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span>🤖 {a.agent} · <code style={{ color: "var(--link)" }}>{a.tool}</code></span>
                <span>by {a.proposed_by || "—"}</span>
                <span>{when(a.created_at)}</span>
                {a.decided_by && <span>· {a.status.toLowerCase()} by {a.decided_by}</span>}
                {a.reason && <span>· “{a.reason}”</span>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: STATUS_COLOR[a.status] || "var(--muted)", fontWeight: 700, fontSize: 12, border: `1px solid ${STATUS_COLOR[a.status] || "var(--muted)"}`, borderRadius: 6, padding: "2px 8px" }}>{a.status}</span>
              {a.status === "PENDING" && (
                <>
                  <button style={{ ...btn("var(--green-dim)", "var(--green)"), opacity: busy === a.approval_id ? 0.5 : 1 }} disabled={busy === a.approval_id} onClick={() => act(a.approval_id, "approve")}>Approve</button>
                  <button style={{ ...btn("var(--crit-dim)", "var(--crit)"), opacity: busy === a.approval_id ? 0.5 : 1 }} disabled={busy === a.approval_id} onClick={() => act(a.approval_id, "reject")}>Reject</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 14 }}>
        The action to run is frozen when it is drafted — approving runs exactly what was proposed. Only a supervisor (or accounts) can approve.
      </div>
    </div>
  );
}
