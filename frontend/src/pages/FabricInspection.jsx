// Fabric 4-point inspection & grading.
//
// The inspector picks a roll, enters the piece it measured (length in metres,
// width in mm), then adds each defect with its size — the grade updates live as
// they go, computed by the server so the screen can never disagree with what gets
// saved. A REJECT quarantines the roll on save.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600 };
const td = { padding: "8px 10px", fontSize: 13, borderTop: "1px solid var(--surface)" };
const input = { padding: "8px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, width: "100%" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 6, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" });
const GRADE_COLOR = { A: "var(--green)", B: "var(--gold)", REJECT: "var(--crit)", UNGRADED: "var(--muted)" };
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—");

const GradeBadge = ({ g }) => (
  <span style={{ color: GRADE_COLOR[g] || "var(--muted)", fontWeight: 700, fontSize: 12,
    border: `1px solid ${GRADE_COLOR[g] || "var(--muted)"}`, borderRadius: 6, padding: "2px 8px" }}>{g}</span>
);

export default function FabricInspection() {
  const [thresholds, setThresholds] = useState({ aMax: 40, bMax: 80 });
  const [defectTypes, setDefectTypes] = useState([]);
  const [history, setHistory] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ roll_id: "", stage: "GREIGE", inspected_length_m: "", width_mm: "", notes: "" });
  const [defects, setDefects] = useState([]);
  const [preview, setPreview] = useState(null);
  const [pendingRolls, setPendingRolls] = useState([]);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 6000); };

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/fabric-inspection?`, { headers: auth() });
      const j = await r.json();
      if (r.ok) setHistory(Array.isArray(j) ? j : []);
    } catch { /* non-fatal */ }
  }, []);

  const loadPending = useCallback(async (stage) => {
    try {
      const r = await fetch(`${API}/api/fabric-inspection/pending?stage=${stage}`, { headers: auth() });
      const j = await r.json();
      if (r.ok) setPendingRolls(Array.isArray(j.rolls) ? j.rolls : []);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [t, d] = await Promise.all([
          fetch(`${API}/api/fabric-inspection/thresholds`, { headers: auth() }).then(r => r.json()),
          fetch(`${API}/api/quality-defect-types`, { headers: auth() }).then(r => r.ok ? r.json() : []),
        ]);
        if (t && t.aMax) setThresholds(t);
        setDefectTypes(Array.isArray(d) ? d : []);
      } catch { /* defaults are fine */ }
    })();
    loadHistory();
  }, [loadHistory]);

  // Reload the "awaiting inspection" worklist whenever the stage changes.
  useEffect(() => { loadPending(form.stage); }, [form.stage, loadPending]);

  // Live grade preview — the server is the single source of the grade.
  useEffect(() => {
    const L = Number(form.inspected_length_m), W = Number(form.width_mm);
    if (!(L > 0) || !(W > 0)) { setPreview(null); return; }
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/api/fabric-inspection/preview`, {
          method: "POST", headers: jsonH(),
          body: JSON.stringify({ inspected_length_m: L, width_mm: W, defects: cleanDefects(defects) }),
        });
        if (r.ok) setPreview(await r.json());
      } catch { /* ignore preview errors */ }
    }, 300);
    return () => clearTimeout(id);
  }, [form.inspected_length_m, form.width_mm, defects]);

  const cleanDefects = (list) => list
    .filter(d => Number(d.sizeInches) > 0 || d.isHole)
    .map(d => ({ defect_type: d.defect_type || null, sizeInches: Number(d.sizeInches) || 0, isHole: !!d.isHole, count: Math.max(1, Number(d.count) || 1) }));

  const addDefect = () => setDefects(d => [...d, { defect_type: defectTypes[0]?.name || "", sizeInches: "", isHole: false, count: 1 }]);
  const setDefect = (i, k, v) => setDefects(d => d.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const rmDefect = (i) => setDefects(d => d.filter((_, j) => j !== i));

  const save = async () => {
    setErr(""); setBusy(true);
    try {
      const r = await fetch(`${API}/api/fabric-inspection`, {
        method: "POST", headers: jsonH(),
        body: JSON.stringify({ ...form, inspected_length_m: Number(form.inspected_length_m), width_mm: Number(form.width_mm), defects: cleanDefects(defects) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      flash(`Roll ${form.roll_id} graded ${j.score.grade} — ${j.score.pointsPer100SqYd} pts/100 sq yd${j.quarantined ? " · roll quarantined" : ""}.`);
      setForm(f => ({ ...f, roll_id: "", inspected_length_m: "", width_mm: "", notes: "" }));
      setDefects([]); setPreview(null);
      loadHistory(); loadPending(form.stage);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const canSave = form.roll_id && Number(form.inspected_length_m) > 0 && Number(form.width_mm) > 0 && !busy;

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Fabric Inspection — 4-Point</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        Grade greige &amp; finished rolls by the 4-point system. A ≤ {thresholds.aMax} · B ≤ {thresholds.bMax} points per 100 sq yd (set in Settings).
      </div>

      {err && <div style={{ ...card, marginBottom: 12, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}
      {msg && <div style={{ ...card, marginBottom: 12, borderColor: "var(--green-dim)", color: "var(--green)" }}>{msg}</div>}

      {/* Awaiting inspection — the worklist. Click a roll to inspect it. */}
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
          Awaiting {form.stage === "FINISHED" ? "finished" : "greige"} inspection · {pendingRolls.length}
        </div>
        {!pendingRolls.length ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Nothing waiting — all {form.stage === "FINISHED" ? "finished fabric" : "knit rolls"} at this stage is inspected.</div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {pendingRolls.slice(0, 40).map(p => (
              <button key={p.roll_id} onClick={() => setForm(f => ({ ...f, roll_id: p.roll_id }))}
                title={`${p.fabric_type || ""} ${p.weight ? Math.round(Number(p.weight)) + "kg" : ""}`}
                style={{ background: form.roll_id === p.roll_id ? "var(--yellow)" : "var(--surface)", color: form.roll_id === p.roll_id ? "#000" : "var(--link)",
                  border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "monospace", cursor: "pointer" }}>
                {p.roll_id}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(220px,1fr)", gap: 14, alignItems: "start" }}>
        {/* Entry */}
        <div style={card}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Roll ID
              <input style={input} value={form.roll_id} onChange={e => setForm(f => ({ ...f, roll_id: e.target.value }))} placeholder="e.g. IL1-0432" />
            </label>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Stage
              <select style={input} value={form.stage} onChange={e => setForm(f => ({ ...f, stage: e.target.value }))}>
                <option value="GREIGE">Greige</option><option value="FINISHED">Finished</option>
              </select>
            </label>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Length (m)
              <input style={input} type="number" step="0.01" value={form.inspected_length_m} onChange={e => setForm(f => ({ ...f, inspected_length_m: e.target.value }))} />
            </label>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Width (mm)
              <input style={input} type="number" step="1" value={form.width_mm} onChange={e => setForm(f => ({ ...f, width_mm: e.target.value }))} />
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0" }}>
            <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: 13 }}>Defects</div>
            <button style={btn("var(--surface)", "var(--text)")} onClick={addDefect}>+ Add defect</button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
              <thead><tr>
                <th style={th}>Defect</th><th style={{ ...th, width: 90 }}>Size (in)</th>
                <th style={{ ...th, width: 60 }}>Hole</th><th style={{ ...th, width: 70 }}>Count</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {!defects.length && <tr><td colSpan={5} style={{ ...td, color: "var(--muted)" }}>No defects — a clean roll grades A.</td></tr>}
                {defects.map((d, i) => (
                  <tr key={i}>
                    <td style={td}>
                      <select style={input} value={d.defect_type} onChange={e => setDefect(i, "defect_type", e.target.value)}>
                        {defectTypes.map(t => <option key={t.id || t.name} value={t.name}>{t.name}</option>)}
                        {!defectTypes.length && <option value="">(defect)</option>}
                      </select>
                    </td>
                    <td style={td}><input style={input} type="number" step="0.1" value={d.sizeInches} onChange={e => setDefect(i, "sizeInches", e.target.value)} /></td>
                    <td style={{ ...td, textAlign: "center" }}><input type="checkbox" checked={d.isHole} onChange={e => setDefect(i, "isHole", e.target.checked)} /></td>
                    <td style={td}><input style={input} type="number" min="1" value={d.count} onChange={e => setDefect(i, "count", e.target.value)} /></td>
                    <td style={{ ...td, textAlign: "right" }}><button style={btn("var(--crit-dim)", "var(--crit)")} onClick={() => rmDefect(i)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <textarea style={{ ...input, marginTop: 12, minHeight: 50 }} placeholder="Notes (optional)" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          <div style={{ marginTop: 12 }}>
            <button style={{ ...btn("var(--yellow)", "#000"), opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }} disabled={!canSave} onClick={save}>
              {busy ? "Saving…" : "Save inspection"}
            </button>
          </div>
        </div>

        {/* Live grade */}
        <div style={{ ...card, textAlign: "center", position: "sticky", top: 12 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, letterSpacing: 1, textTransform: "uppercase" }}>Live grade</div>
          <div style={{ fontSize: 44, fontWeight: 800, margin: "10px 0", color: GRADE_COLOR[preview?.grade] || "#334" }}>
            {preview?.grade || "—"}
          </div>
          <div style={{ fontSize: 13, color: "var(--text)" }}>
            {preview ? <><b>{preview.pointsPer100SqYd ?? "—"}</b> pts / 100 sq yd</> : "Enter length & width"}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
            {preview ? `${preview.totalPoints} total points · ${preview.areaSqYards} sq yd inspected` : ""}
          </div>
        </div>
      </div>

      {/* History */}
      <div style={{ ...card, marginTop: 16 }}>
        <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Recent inspections</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead><tr>
              <th style={th}>Date</th><th style={th}>Roll</th><th style={th}>Stage</th>
              <th style={{ ...th, textAlign: "right" }}>Pts/100sqyd</th><th style={{ ...th, textAlign: "right" }}>Total</th>
              <th style={th}>Grade</th><th style={th}>By</th>
            </tr></thead>
            <tbody>
              {!history.length && <tr><td colSpan={7} style={{ ...td, color: "var(--muted)" }}>No inspections yet.</td></tr>}
              {history.map(h => (
                <tr key={h.inspection_id}>
                  <td style={td}>{day(h.created_at)}</td>
                  <td style={{ ...td, color: "var(--yellow)", fontFamily: "monospace" }}>{h.roll_id}</td>
                  <td style={td}>{h.stage}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{h.points_per_100sqyd ?? "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{h.total_points}</td>
                  <td style={td}><GradeBadge g={h.grade} /></td>
                  <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>{h.inspector || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
