// Approval matrix — who signs off what, by document value.
//
// The bands were seeded from code and editable only by SQL. The point of the
// screen is not the editing; it is that a band set can be wrong in ways the
// live lookup hides — an overlap resolves arbitrarily and a gap falls through
// to hardcoded defaults — so coverage is shown before the rows are.
//
// The "what would happen" box is the other half: it asks the same code the
// system asks, so you see the policy as applied rather than as written.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600 };
const td = { padding: "9px 10px", textAlign: "left", fontSize: 13, borderTop: "1px solid var(--surface)" };
const numTd = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const input = { padding: "8px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, boxSizing: "border-box" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 6, padding: "7px 13px", fontWeight: 600, fontSize: 13, cursor: "pointer" });

const money = (v) => (v === null || v === undefined ? "open" : `₹${Number(v).toLocaleString("en-IN")}`);

export default function ApprovalMatrix() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(null);   // doc_type being added to
  const [form, setForm] = useState({ min_value: "", max_value: "", required_role: "SUPERVISOR" });
  const [probe, setProbe] = useState({ doc_type: "ORDER", value: "500000", result: null });

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch(`${API}/api/settings/approval-matrix`, { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setData(j);
    } catch (e) { setErr(e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runProbe = async () => {
    try {
      const r = await fetch(
        `${API}/api/settings/approval-matrix/preview?doc_type=${probe.doc_type}&value=${encodeURIComponent(probe.value)}`,
        { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setProbe(p => ({ ...p, result: j }));
    } catch (e) { setErr(e.message); }
  };

  const save = async (docType) => {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/api/settings/approval-matrix`, {
        method: "POST", headers: jsonH(),
        body: JSON.stringify({
          doc_type: docType,
          min_value: Number(form.min_value) || 0,
          max_value: form.max_value === "" ? null : Number(form.max_value),
          required_role: form.required_role,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setAdding(null); setForm({ min_value: "", max_value: "", required_role: "SUPERVISOR" });
      flash("Band added."); load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const retire = async (id) => {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/api/settings/approval-matrix/${id}`, { method: "DELETE", headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      flash("Band retired — the row is kept so past approvals stay explainable.");
      load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (!data) return <div style={{ padding: 20, color: "var(--muted)" }}>{err || "Loading…"}</div>;

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Approval Matrix</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        Who has to approve a document, by its value. Bands must run from zero upwards with no gap and no
        overlap — a gap falls back to built-in defaults, and an overlap makes the rule arbitrary.
      </div>

      {err && <div style={{ ...card, marginBottom: 12, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}
      {msg && <div style={{ ...card, marginBottom: 12, borderColor: "var(--green-dim)", color: "var(--green)" }}>{msg}</div>}

      {/* The policy as applied, asked of the same code the system uses. */}
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
          What would happen?
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select style={input} value={probe.doc_type}
                  onChange={e => setProbe(p => ({ ...p, doc_type: e.target.value, result: null }))}>
            {data.doc_types.map(t => <option key={t}>{t}</option>)}
          </select>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>worth ₹</span>
          <input style={{ ...input, width: 140 }} value={probe.value}
                 onChange={e => setProbe(p => ({ ...p, value: e.target.value, result: null }))} />
          <button style={btn("var(--yellow)", "#000")} onClick={runProbe}>Check</button>
          {probe.result && (
            <span style={{ fontSize: 13 }}>
              {probe.result.falls_back
                ? <b style={{ color: "var(--crit)" }}>No band matches — falls back to the built-in default.</b>
                : <>needs <b style={{ color: "var(--green)" }}>{probe.result.required_role}</b></>}
              {probe.result.ambiguous &&
                <b style={{ color: "var(--crit)" }}> · {probe.result.matched} bands match — ambiguous!</b>}
            </span>
          )}
        </div>
      </div>

      {data.doc_types.map(t => {
        const m = data.matrix[t] || { bands: [], problems: [], covered: false };
        return (
          <div key={t} style={{ ...card, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={{ color: "var(--yellow)", fontWeight: 700 }}>{t}</div>
              <span style={{ fontSize: 12, color: m.covered ? "var(--green)" : "var(--crit)", fontWeight: 600 }}>
                {m.covered ? "✓ fully covered" : "✗ has gaps or overlaps"}
              </span>
            </div>

            {m.problems.map((p, i) => (
              <div key={i} style={{ color: "var(--gold)", fontSize: 12, marginTop: 6 }}>⚠ {p}</div>
            ))}

            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "right" }}>From</th>
                  <th style={{ ...th, textAlign: "right" }}>Up to</th>
                  <th style={th}>Approved by</th>
                  <th style={th}>Status</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {!m.bands.length && (
                  <tr><td colSpan={5} style={{ ...td, color: "var(--muted)" }}>No bands — built-in defaults apply.</td></tr>
                )}
                {m.bands.map(b => (
                  <tr key={b.rule_id} style={{ opacity: b.is_active ? 1 : 0.45 }}>
                    <td style={numTd}>{money(b.min_value)}</td>
                    <td style={numTd}>{money(b.max_value)}</td>
                    <td style={td}><b>{b.required_role}</b></td>
                    <td style={{ ...td, fontSize: 12, color: b.is_active ? "var(--green)" : "var(--muted)" }}>
                      {b.is_active ? "active" : "retired"}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {b.is_active && (
                        <button style={btn("var(--crit-dim)", "var(--crit)")} disabled={busy}
                                onClick={() => retire(b.rule_id)}>Retire</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {adding === t ? (
              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input style={{ ...input, width: 120 }} placeholder="From" value={form.min_value}
                       onChange={e => setForm(f => ({ ...f, min_value: e.target.value }))} />
                <input style={{ ...input, width: 120 }} placeholder="Up to (blank = open)" value={form.max_value}
                       onChange={e => setForm(f => ({ ...f, max_value: e.target.value }))} />
                <select style={input} value={form.required_role}
                        onChange={e => setForm(f => ({ ...f, required_role: e.target.value }))}>
                  {data.roles.map(r => <option key={r}>{r}</option>)}
                </select>
                <button style={btn("var(--green)", "#000")} disabled={busy} onClick={() => save(t)}>Add</button>
                <button style={btn("var(--surface)", "var(--text)")} onClick={() => setAdding(null)}>Cancel</button>
              </div>
            ) : (
              <button style={{ ...btn("var(--surface)", "var(--text)"), marginTop: 10 }}
                      onClick={() => setAdding(t)}>+ Add a band</button>
            )}
          </div>
        );
      })}

      <div style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.6 }}>
        Retiring a band keeps the row. An approval granted last month was granted under the band as it
        stood then, and deleting it would make that decision unexplainable.
      </div>
    </div>
  );
}
