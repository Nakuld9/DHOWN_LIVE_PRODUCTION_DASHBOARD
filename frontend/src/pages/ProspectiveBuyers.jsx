// Prospective Buyers — exhibition / imported leads with sample-dispatch tracking and
// follow-ups. Mark a sample sent (date + docket), set a follow-up, message on WhatsApp.
import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });
const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB").replace(/\//g, "-") : "—");

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };
const inp = { background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 9px", fontSize: 13, boxSizing: "border-box" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 7, padding: "5px 11px", fontWeight: 600, fontSize: 12, cursor: "pointer" });
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "8px 10px", fontSize: 13, borderTop: "1px solid var(--border)", verticalAlign: "top" };
const SCORE_COLOR = { HOT: "var(--crit)", WARM: "var(--gold)", COLD: "var(--muted)" };
const SAMPLE_COLOR = { TO_SEND: "var(--gold)", SENT: "var(--green)", NOT_REQUIRED: "var(--muted)" };

export default function ProspectiveBuyers() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [fSample, setFSample] = useState("");
  const [fScore, setFScore] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/wa/leads?prospects=1`, { headers: auth() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to load");
      setRows(Array.isArray(d) ? d : []);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = async (id, body) => {
    const r = await fetch(`${API}/api/wa/leads/${id}`, { method: "PATCH", headers: jsonH(), body: JSON.stringify(body) });
    if (r.ok) load(); else alert((await r.json()).error || "Failed");
  };
  const markSampleSent = async (lead) => {
    const docket = window.prompt(`Sample for ${lead.company || lead.name} — courier / docket no. (optional):`, "");
    if (docket === null) return;
    await patch(lead.lead_id, { sample_status: "SENT", sample_sent_date: new Date().toISOString().slice(0, 10), sample_docket: docket || null });
    if (window.confirm("Create a follow-up for this prospect in 7 days?")) await addFollowup(lead, 7);
  };
  const addFollowup = async (lead, days = 7) => {
    const note = window.prompt(`Follow-up note for ${lead.company || lead.name}:`, lead.sample_status === "SENT" ? "Follow up on sample feedback" : "Follow up / send sample");
    if (!note) return;
    const due = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
    const r = await fetch(`${API}/api/wa/followups`, { method: "POST", headers: jsonH(), body: JSON.stringify({ lead_id: lead.lead_id, note, due_date: due }) });
    if (r.ok) alert(`Follow-up set for ${day(due)}`); else alert((await r.json()).error || "Failed");
  };
  const waLink = (phone) => { const d = String(phone || "").replace(/\D/g, ""); return d ? `https://wa.me/${d.length === 10 ? "91" + d : d}` : null; };

  const filtered = rows.filter(r =>
    (!fSample || r.sample_status === fSample) &&
    (!fScore || r.score === fScore) &&
    (!q || `${r.company} ${r.contact_person || r.name} ${r.city} ${r.required_fabric} ${r.phone}`.toLowerCase().includes(q.toLowerCase()))
  ).sort((a, b) => (a.company || a.contact_person || a.name || "").localeCompare(b.company || b.contact_person || b.name || "", undefined, { sensitivity: "base" }));
  const n = (s) => rows.filter(r => r.sample_status === s).length;

  return (
    <div style={{ padding: 20, color: "var(--text)", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase" }}>🎯 Prospective Buyers</h2>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>Exhibition / imported leads · sample dispatch · follow-ups</div>
      </div>
      {err && <div style={{ color: "var(--crit)", fontSize: 13 }}>{err}</div>}

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
        {[["Total prospects", rows.length, "var(--text)"], ["Sample to send", n("TO_SEND"), "var(--gold)"], ["Sample sent", n("SENT"), "var(--green)"], ["🔥 Hot", rows.filter(r => r.score === "HOT").length, "var(--crit)"]].map(([k, v, c]) => (
          <div key={k} style={{ ...card, padding: 12 }}><div style={label}>{k}</div><div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: c }}>{v}</div></div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...inp, minWidth: 240 }} placeholder="Search company / contact / city / product…" value={q} onChange={e => setQ(e.target.value)} />
        <select style={inp} value={fSample} onChange={e => setFSample(e.target.value)}><option value="">All samples</option><option value="TO_SEND">To send</option><option value="SENT">Sent</option><option value="NOT_REQUIRED">Not required</option></select>
        <select style={inp} value={fScore} onChange={e => setFScore(e.target.value)}><option value="">All ratings</option><option value="HOT">Hot</option><option value="WARM">Warm</option><option value="COLD">Cold</option></select>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{filtered.length} shown</span>
      </div>

      <div style={{ ...card, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
          <thead><tr>{["Company / Contact", "Phone", "City", "Product / Requirement", "Rate", "Rating", "Sample", "Actions"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {!filtered.length && <tr><td colSpan={8} style={{ ...td, color: "var(--muted)" }}>No prospects match.</td></tr>}
            {filtered.map(r => (
              <tr key={r.lead_id}>
                <td style={td}><b>{r.company || "—"}</b>{(r.contact_person || r.name) ? <div style={{ color: "var(--muted)", fontSize: 12 }}>{r.contact_person || r.name}</div> : null}</td>
                <td style={td}>{r.phone || "—"}{r.phone2 ? <div style={{ color: "var(--muted)", fontSize: 11 }}>{r.phone2}</div> : null}</td>
                <td style={td}>{r.city || "—"}{r.state ? <div style={{ color: "var(--muted)", fontSize: 11 }}>{r.state}</div> : null}</td>
                <td style={{ ...td, maxWidth: 240, whiteSpace: "normal" }}>{r.required_fabric || "—"}{r.sample_note ? <div style={{ color: "var(--muted)", fontSize: 11 }}>📋 {r.sample_note}</div> : null}{r.remarks ? <div style={{ color: "var(--muted)", fontSize: 11 }}>{r.remarks}</div> : null}</td>
                <td style={td}>{r.rate_quoted || "—"}</td>
                <td style={td}>
                  <select value={r.score || "WARM"} onChange={e => patch(r.lead_id, { score: e.target.value })} style={{ ...inp, padding: "3px 6px", fontSize: 12, color: SCORE_COLOR[r.score] || "var(--text)", fontWeight: 700 }}>
                    {["HOT", "WARM", "COLD"].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td style={td}>
                  <span style={{ color: SAMPLE_COLOR[r.sample_status], fontWeight: 600, fontSize: 12 }}>{(r.sample_status || "").replace(/_/g, " ")}</span>
                  {r.sample_status === "SENT" && <div style={{ color: "var(--muted)", fontSize: 11 }}>{day(r.sample_sent_date)}{r.sample_docket ? ` · ${r.sample_docket}` : ""}</div>}
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {r.sample_status !== "SENT" && <button onClick={() => markSampleSent(r)} style={btn("var(--bg)", "var(--green)")}>📦 Sample sent</button>}
                    <button onClick={() => addFollowup(r)} style={btn("var(--bg)", "var(--text)")}>⏰ Follow-up</button>
                    {waLink(r.phone) && <a href={waLink(r.phone)} target="_blank" rel="noreferrer" style={{ ...btn("var(--green-dim)", "var(--green)"), textDecoration: "none" }}>WhatsApp</a>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
