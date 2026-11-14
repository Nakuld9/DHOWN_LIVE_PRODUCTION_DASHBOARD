import React, { useEffect, useState } from "react";
import QRScanner from "../components/QRScanner";

// Mobile-first Quality Inspection screen for supervisors on the shop floor.
// Self-contained: own login, big touch targets. Reuses existing QC endpoints.
const API = ``;
const tok = () => localStorage.getItem("dhown_token");
const authH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });

const GRADES = [
  { g: "A", label: "A · Excellent", color: "var(--green)" },
  { g: "B", label: "B · Good", color: "var(--gold)" },
  { g: "C", label: "C · Acceptable", color: "var(--gold)" },
  { g: "R", label: "R · Reject", color: "var(--crit)" },
];

const wrap = { minHeight: "100vh", background: "var(--surface)", color: "var(--text)", fontFamily: "Inter, system-ui, sans-serif", padding: "16px", boxSizing: "border-box" };
const bigInp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px", color: "var(--text)", fontSize: 17, boxSizing: "border-box", marginBottom: 12 };
const bigBtn = (bg) => ({ width: "100%", background: bg, color: "var(--bg)", border: "none", borderRadius: 12, padding: "16px", fontSize: 18, fontWeight: 700, cursor: "pointer" });

function Login({ onLogin }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const r = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: p }) });
      const j = await r.json();
      if (!r.ok || !j.token) { setErr(j.error || "Login failed"); setBusy(false); return; }
      localStorage.setItem("dhown_token", j.token);
      onLogin();
    } catch { setErr("Cannot reach server"); setBusy(false); }
  };
  return (
    <div style={wrap}>
      <div style={{ textAlign: "center", margin: "40px 0 24px" }}>
        <div style={{ color: "var(--yellow)", fontSize: 26, fontWeight: 700 }}>DHOWN QC</div>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Shop-floor quality inspection</div>
      </div>
      {err && <div style={{ background: "#ef444422", border: "1px solid var(--crit)", color: "var(--crit)", padding: 12, borderRadius: 10, marginBottom: 12, fontSize: 14 }}>{err}</div>}
      <input style={bigInp} placeholder="Username" value={u} onChange={e => setU(e.target.value)} autoCapitalize="off" />
      <input style={bigInp} type="password" placeholder="Password" value={p} onChange={e => setP(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
      <button style={{ ...bigBtn("var(--yellow)"), opacity: busy ? 0.6 : 1 }} onClick={submit} disabled={busy}>{busy ? "Signing in…" : "Sign In"}</button>
    </div>
  );
}

export default function MobileQC() {
  const [authed, setAuthed] = useState(!!tok());
  const [rolls, setRolls] = useState([]);
  const [defectTypes, setDefectTypes] = useState([]);
  const [search, setSearch] = useState("");
  const [rollId, setRollId] = useState("");
  const [grade, setGrade] = useState("");
  const [defectType, setDefectType] = useState("");
  const [defectCount, setDefectCount] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  useEffect(() => {
    if (!authed) return;
    fetch(`${API}/api/rolls`, { headers: authH() }).then(r => r.json()).then(d => setRolls(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${API}/api/quality-defect-types`, { headers: authH() }).then(r => r.json()).then(d => setDefectTypes(Array.isArray(d) ? d : [])).catch(() => {});
  }, [authed]);

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  const filtered = search ? rolls.filter(r => r.roll_id.toLowerCase().includes(search.toLowerCase())).slice(0, 8) : [];

  const reset = () => { setRollId(""); setGrade(""); setDefectType(""); setDefectCount(""); setNotes(""); setSearch(""); };

  // Scan a roll label → select that roll and close the scanner (one-shot).
  const scanPickRoll = async (id) => {
    const roll = rolls.find(r => r.roll_id === id);
    if (!roll) return { ok: false, note: "unknown roll" };
    setRollId(id);
    setShowScanner(false);
    return { ok: true, note: "selected" };
  };

  const save = async () => {
    if (!rollId) { setMsg({ err: true, t: "Pick a roll first" }); return; }
    if (!grade) { setMsg({ err: true, t: "Select a grade" }); return; }
    setSaving(true); setMsg(null);
    try {
      const r = await fetch(`${API}/api/quality-inspections`, {
        method: "POST", headers: authH(),
        body: JSON.stringify({ roll_id: rollId, inspection_type: "final", grade, defect_type: defectType || null, defect_count: defectCount ? parseInt(defectCount) : 0, notes: notes || null }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg({ err: true, t: j.error || "Save failed" }); setSaving(false); return; }
      setMsg({ err: false, t: `Saved inspection #${j.inspection_id} — Grade ${j.grade || grade}` });
      reset();
    } catch { setMsg({ err: true, t: "Cannot reach server" }); }
    setSaving(false);
  };

  return (
    <div style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ color: "var(--yellow)", fontSize: 20, fontWeight: 700 }}>Quality Inspection</div>
        <button onClick={() => { localStorage.removeItem("dhown_token"); setAuthed(false); }}
          style={{ background: "transparent", border: "1px solid var(--crit)", color: "var(--crit)", borderRadius: 8, padding: "6px 12px", fontSize: 13 }}>Logout</button>
      </div>

      {msg && <div style={{ background: msg.err ? "#ef444422" : "#22c55e22", border: `1px solid ${msg.err ? "var(--crit)" : "var(--green)"}`, color: msg.err ? "var(--crit)" : "var(--green)", padding: 14, borderRadius: 10, marginBottom: 14, fontSize: 15, fontWeight: 600 }}>{msg.t}</div>}

      {/* Roll picker */}
      <label style={{ color: "var(--muted)", fontSize: 13, display: "block", marginBottom: 6 }}>Roll</label>
      {rollId ? (
        <div style={{ ...bigInp, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--yellow)" }}>{rollId}</span>
          <button onClick={() => setRollId("")} style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 18 }}>✕</button>
        </div>
      ) : (
        <>
          <button onClick={() => setShowScanner(true)}
            style={{ ...bigBtn("var(--surface)"), color: "var(--link)", border: "1px solid var(--border)", marginBottom: 12 }}>
            📷 Scan Roll Label
          </button>
          <input style={bigInp} placeholder="…or type roll ID to search" value={search} onChange={e => setSearch(e.target.value)} autoCapitalize="off" />
          {filtered.map(r => (
            <div key={r.roll_id} onClick={() => { setRollId(r.roll_id); setSearch(""); }}
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginBottom: 8, cursor: "pointer" }}>
              <div style={{ fontFamily: "monospace", color: "var(--yellow)", fontWeight: 700 }}>{r.roll_id}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{r.fabric_type || "—"} · {r.machine_id || ""}</div>
            </div>
          ))}
        </>
      )}

      {/* Grade — big buttons */}
      <label style={{ color: "var(--muted)", fontSize: 13, display: "block", margin: "8px 0 6px" }}>Grade</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        {GRADES.map(({ g, label, color }) => (
          <button key={g} onClick={() => setGrade(g)}
            style={{ background: grade === g ? color : "var(--surface)", color: grade === g ? "var(--bg)" : color, border: `2px solid ${color}`, borderRadius: 12, padding: "16px 8px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>

      {/* Defect */}
      <label style={{ color: "var(--muted)", fontSize: 13, display: "block", marginBottom: 6 }}>Defect (optional)</label>
      <select style={bigInp} value={defectType} onChange={e => setDefectType(e.target.value)}>
        <option value="">No defect</option>
        {defectTypes.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
      </select>
      {defectType && <input style={bigInp} type="number" placeholder="Defect count" value={defectCount} onChange={e => setDefectCount(e.target.value)} />}

      <textarea style={{ ...bigInp, minHeight: 70 }} placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />

      <button style={{ ...bigBtn(saving ? "var(--green-dim)" : "var(--green)"), marginTop: 4 }} onClick={save} disabled={saving}>
        {saving ? "Saving…" : "✓ Save Inspection"}
      </button>

      {showScanner && (
        <QRScanner
          title="Scan Roll for Inspection"
          hint="Point the camera at the roll's label."
          onScan={scanPickRoll}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
