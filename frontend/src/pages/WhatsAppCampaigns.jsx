// WhatsApp marketing campaigns (blasts). Business-initiated bulk sends using an
// APPROVED MARKETING template, only to customers who opted in to marketing.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });
const day = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(/\//g, "-") : "—");

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };
const inp = { width: "100%", padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 13, boxSizing: "border-box" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "8px 15px", fontWeight: 700, fontSize: 13, cursor: "pointer" });
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "8px 10px", fontSize: 13, borderTop: "1px solid var(--border)", whiteSpace: "nowrap" };
const chip = (s) => ({ DRAFT: "var(--muted)", QUEUED: "var(--link)", SENDING: "var(--gold)", DONE: "var(--green)", CANCELLED: "var(--crit)" }[s] || "var(--muted)");

export default function WhatsAppCampaigns() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ name: "", template_name: "", lang: "en", body_params: "", category: "", only_customers: true });
  const [prev, setPrev] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(() => { fetch(`${API}/api/wa/campaigns`, { headers: auth() }).then(r => r.json()).then(d => setRows(Array.isArray(d) ? d : [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const audience = () => ({ category: form.category || undefined, only_customers: form.only_customers });
  const doPreview = async () => {
    setErr("");
    const r = await fetch(`${API}/api/wa/campaigns/preview`, { method: "POST", headers: jsonH(), body: JSON.stringify({ audience: audience() }) });
    const out = await r.json(); if (r.ok) setPrev(out); else setErr(out.error);
  };
  const create = async () => {
    setErr(""); setBusy("create");
    try {
      const body_params = form.body_params.split("\n").map(s => s.trim()).filter(Boolean);
      const r = await fetch(`${API}/api/wa/campaigns`, { method: "POST", headers: jsonH(), body: JSON.stringify({ name: form.name, template_name: form.template_name, lang: form.lang, body_params, audience: audience() }) });
      const out = await r.json(); if (!r.ok) throw new Error(out.error);
      setForm({ name: "", template_name: "", lang: "en", body_params: "", category: "", only_customers: true }); setPrev(null); load();
    } catch (e) { setErr(e.message); }
    setBusy("");
  };
  const act = async (id, path, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(id + path); setErr("");
    try {
      const r = await fetch(`${API}/api/wa/campaigns/${id}/${path}`, { method: "POST", headers: jsonH(), body: JSON.stringify({}) });
      const out = await r.json(); if (!r.ok) throw new Error(out.error);
      if (path === "send" && out.remaining > 0) { /* keep going */ await act(id, "send"); return; }
      load();
    } catch (e) { setErr(e.message); }
    setBusy("");
  };

  return (
    <div style={{ padding: 20, color: "var(--text)", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1000 }}>
      <h2 style={{ margin: 0, fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase" }}>📣 WhatsApp Campaigns</h2>
      <div style={{ ...card, borderColor: "var(--gold)", background: "rgba(245,158,11,.06)", fontSize: 12.5, color: "var(--text)" }}>
        ⚠ Marketing messages are sent <b>only to customers who explicitly opted in to marketing</b>, using an <b>approved MARKETING template</b> from Meta. Opt-outs are always honoured. If nobody has opted in, a campaign reaches no one — that is correct and lawful.
      </div>
      {err && <div style={{ color: "var(--crit)", fontSize: 13 }}>{err}</div>}

      {/* Create */}
      <div style={card}>
        <div style={{ ...label, marginBottom: 10 }}>New campaign</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><div style={{ ...label, fontSize: 10, marginBottom: 3 }}>Campaign name</div><input style={inp} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><div style={{ ...label, fontSize: 10, marginBottom: 3 }}>Approved MARKETING template name</div><input style={inp} placeholder="e.g. diwali_offer_2026" value={form.template_name} onChange={e => setForm({ ...form, template_name: e.target.value })} /></div>
          <div><div style={{ ...label, fontSize: 10, marginBottom: 3 }}>Language</div><input style={inp} value={form.lang} onChange={e => setForm({ ...form, lang: e.target.value })} /></div>
          <div><div style={{ ...label, fontSize: 10, marginBottom: 3 }}>Customer category (optional)</div><input style={inp} placeholder="all if blank" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ ...label, fontSize: 10, marginBottom: 3 }}>Template body variables (one per line; use {"{{name}}"} for the customer's name)</div>
          <textarea style={{ ...inp, minHeight: 60, fontFamily: "var(--mono)" }} value={form.body_params} onChange={e => setForm({ ...form, body_params: e.target.value })} placeholder={"{{name}}\n20%"} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 13 }}>
          <input type="checkbox" checked={form.only_customers} onChange={e => setForm({ ...form, only_customers: e.target.checked })} /> Only mapped customers (with a partner record)
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <button onClick={doPreview} style={btn("var(--bg)", "var(--text)")}>Preview audience</button>
          <button onClick={create} disabled={busy === "create" || !form.name || !form.template_name} style={{ ...btn("var(--yellow)", "#000"), opacity: (!form.name || !form.template_name) ? 0.5 : 1 }}>Create campaign</button>
          {prev && <span style={{ fontSize: 13, color: prev.count ? "var(--text)" : "var(--gold)" }}>{prev.count} opted-in recipient(s){prev.note ? ` — ${prev.note}` : ""}</span>}
        </div>
        {prev && prev.sample?.length > 0 && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>e.g. {prev.sample.map(s => s.name || s.phone).slice(0, 8).join(", ")}…</div>}
      </div>

      {/* List */}
      <div style={{ ...card, overflowX: "auto" }}>
        <div style={{ ...label, marginBottom: 10 }}>Campaigns</div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead><tr>{["Name", "Template", "Status", "Total", "Sent", "Failed", "Skipped", "Updated", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={9} style={{ ...td, color: "var(--muted)" }}>No campaigns yet.</td></tr>}
            {rows.map(c => (
              <tr key={c.campaign_id}>
                <td style={{ ...td, fontWeight: 600 }}>{c.name}</td>
                <td style={td}>{c.template_name}</td>
                <td style={td}><span style={{ background: chip(c.status), color: "#000", padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{c.status}</span></td>
                <td style={td}>{c.total}</td><td style={td}>{c.sent}</td><td style={{ ...td, color: c.failed ? "var(--crit)" : undefined }}>{c.failed}</td><td style={td}>{c.skipped}</td>
                <td style={td}>{day(c.updated_at)}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  {["DRAFT", "QUEUED"].includes(c.status) && <button onClick={() => act(c.campaign_id, "enqueue")} style={{ ...btn("var(--bg)", "var(--text)"), padding: "4px 9px", marginRight: 5 }}>{busy === c.campaign_id + "enqueue" ? "…" : "Enqueue"}</button>}
                  {["QUEUED", "SENDING"].includes(c.status) && <button onClick={() => act(c.campaign_id, "send", `Send campaign "${c.name}" to ${c.total} opted-in customer(s)?`)} style={{ ...btn("var(--yellow)", "#000"), padding: "4px 9px", marginRight: 5 }}>{busy === c.campaign_id + "send" ? "Sending…" : "Send"}</button>}
                  {!["DONE", "CANCELLED"].includes(c.status) && <button onClick={() => act(c.campaign_id, "cancel", "Cancel this campaign?")} style={{ ...btn("var(--bg)", "var(--crit)"), padding: "4px 9px" }}>Cancel</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
