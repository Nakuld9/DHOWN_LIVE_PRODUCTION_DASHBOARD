// Shift Production Entry — record what a machine knitted in a shift when there's no
// data collector. Each roll weight becomes a closed greige roll, so production
// summary, the dashboard, greige stock and the inspection worklist all update.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const input = { padding: "8px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6 };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 6, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" });
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600 };
const td = { padding: "8px 10px", fontSize: 13, borderTop: "1px solid var(--surface)" };
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—");

export default function ShiftProductionEntry() {
  const [machines, setMachines] = useState([]);
  const [recent, setRecent] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ machine_id: "", shift: "A", date: new Date().toISOString().slice(0, 10) });
  const [weights, setWeights] = useState([""]);          // one input per roll
  const [quick, setQuick] = useState({ count: "", weight: "" });

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 6000); };

  const loadRecent = useCallback(async () => {
    try { const r = await fetch(`${API}/api/production-entry/recent`, { headers: auth() }); const j = await r.json(); if (r.ok) setRecent(Array.isArray(j) ? j : []); } catch {}
  }, []);
  useEffect(() => {
    (async () => {
      try { const m = await fetch(`${API}/api/machines`, { headers: auth() }).then(r => r.ok ? r.json() : []); setMachines(Array.isArray(m) ? m : (m.machines || [])); } catch {}
    })();
    loadRecent();
  }, [loadRecent]);

  const setW = (i, v) => setWeights(w => w.map((x, j) => j === i ? v : x));
  const addRow = () => setWeights(w => [...w, ""]);
  const rmRow = (i) => setWeights(w => w.filter((_, j) => j !== i));
  const addBulk = () => {
    const n = Math.max(0, parseInt(quick.count) || 0), wt = quick.weight;
    if (n > 0 && Number(wt) > 0) { setWeights(w => [...w.filter(x => x !== ""), ...Array(n).fill(String(wt))]); setQuick({ count: "", weight: "" }); }
  };

  const valid = weights.map(Number).filter(n => n > 0);
  const total = Math.round(valid.reduce((s, n) => s + n, 0) * 100) / 100;
  const canSave = form.machine_id && form.shift && valid.length > 0 && !busy;

  const save = async () => {
    setErr(""); setBusy(true);
    try {
      const r = await fetch(`${API}/api/production-entry`, { method: "POST", headers: jsonH(),
        body: JSON.stringify({ ...form, rolls: valid.map(w => ({ weight_kg: w })) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      flash(`Recorded ${j.rolls} rolls · ${j.total_kg} kg for ${j.machine_id} shift ${j.shift}.`);
      setWeights([""]);
      loadRecent();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Shift Production Entry</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        Record a shift's rolls by hand (no collector needed). Each roll becomes greige stock and feeds the dashboards and AI.
      </div>

      {err && <div style={{ ...card, marginBottom: 12, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}
      {msg && <div style={{ ...card, marginBottom: 12, borderColor: "var(--green-dim)", color: "var(--green)" }}>{msg}</div>}

      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>Machine<br />
            <select style={{ ...input, width: "100%" }} value={form.machine_id} onChange={e => setForm(f => ({ ...f, machine_id: e.target.value }))}>
              <option value="">Select…</option>
              {machines.map(m => <option key={m.machine_id} value={m.machine_id}>{m.machine_id}{m.machine_name && m.machine_name !== m.machine_id ? ` (${m.machine_name})` : ""}</option>)}
            </select></label>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>Shift<br />
            <select style={{ ...input, width: "100%" }} value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value }))}>
              <option value="A">A (Day)</option><option value="B">B (Night)</option>
            </select></label>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>Date<br />
            <input type="date" style={{ ...input, width: "100%" }} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></label>
        </div>

        {/* Quick add */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid var(--surface)" }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>Add<br /><input style={{ ...input, width: 70 }} type="number" placeholder="qty" value={quick.count} onChange={e => setQuick(q => ({ ...q, count: e.target.value }))} /></label>
          <span style={{ color: "var(--muted)", paddingBottom: 8 }}>rolls of</span>
          <label style={{ fontSize: 12, color: "var(--muted)" }}><br /><input style={{ ...input, width: 90 }} type="number" step="0.1" placeholder="kg each" value={quick.weight} onChange={e => setQuick(q => ({ ...q, weight: e.target.value }))} /></label>
          <button style={btn("var(--surface)", "var(--text)")} onClick={addBulk}>+ Add these</button>
        </div>

        {/* Per-roll weights */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: 13 }}>Roll weights (kg)</div>
          <button style={btn("var(--surface)", "var(--text)")} onClick={addRow}>+ Add roll</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {weights.map((w, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input style={{ ...input, width: 90 }} type="number" step="0.1" placeholder={`#${i + 1}`} value={w} onChange={e => setW(i, e.target.value)} />
              {weights.length > 1 && <button onClick={() => rmRow(i)} style={{ ...btn("var(--crit-dim)", "var(--crit)"), padding: "6px 9px" }}>✕</button>}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
          <div style={{ color: "var(--text)", fontSize: 14 }}><b>{valid.length}</b> rolls · <b>{total}</b> kg</div>
          <button style={{ ...btn("var(--yellow)", "#000"), opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }} disabled={!canSave} onClick={save}>{busy ? "Saving…" : "Record production"}</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Recent manual entries</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Roll</th><th style={th}>Machine</th><th style={th}>Shift</th><th style={{ ...th, textAlign: "right" }}>kg</th></tr></thead>
            <tbody>
              {!recent.length && <tr><td colSpan={5} style={{ ...td, color: "var(--muted)" }}>No manual entries yet.</td></tr>}
              {recent.slice(0, 50).map(r => (
                <tr key={r.roll_id}>
                  <td style={td}>{day(r.closed_at)}</td>
                  <td style={{ ...td, color: "var(--yellow)", fontFamily: "monospace", fontSize: 11 }}>{r.roll_id}</td>
                  <td style={td}>{r.machine_id}</td>
                  <td style={td}>{r.shift}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.weight_kg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
