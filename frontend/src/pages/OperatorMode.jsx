// Operator Mode — a full-screen, large-touch shop-floor UI. Big machine cards,
// big status, and the four actions a floor operator needs (open/close roll, report/
// resolve downtime) as large buttons with an on-screen number pad — minimal typing.
// Reuses the same APIs as the machine detail screen; nothing new on the backend.

import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const API = "";
const tok = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });
const shiftNow = () => (new Date().getHours() >= 8 && new Date().getHours() < 20 ? "D" : "N");

const ST = {
  RUNNING: { c: "var(--green)", label: "RUNNING" },
  DOWNTIME: { c: "var(--crit)", label: "DOWN" },
  STOPPED: { c: "var(--crit)", label: "STOPPED" },
  OFFLINE: { c: "var(--gold)", label: "OFFLINE" },
  NO_DATA: { c: "var(--faint)", label: "NO SIGNAL" },
};
const REASONS = ["Yarn Break", "Needle Break", "Fabric Fault", "Power Cut", "Maintenance", "Operator Absent", "Yarn Change", "Quality Issue", "Other"];

export default function OperatorMode() {
  const nav = useNavigate();
  const [machines, setMachines] = useState([]);
  const [sel, setSel] = useState(null);       // selected machine id
  const [sheet, setSheet] = useState(null);   // 'menu' | 'close' | 'downtime'
  const [weight, setWeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);        // {text, err}
  const [time, setTime] = useState(new Date());

  const load = useCallback(async () => {
    try { const r = await fetch(`${API}/api/machines`, { headers: h() }); const d = await r.json(); setMachines(Array.isArray(d) ? d : []); } catch {}
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);

  const machine = machines.find(m => m.machine_id === sel) || null;
  const flash = (text, err = false) => { setMsg({ text, err }); setTimeout(() => setMsg(null), 3500); };
  const closeSheet = () => { setSel(null); setSheet(null); setWeight(""); };

  const openMachine = (m) => { setSel(m.machine_id); setSheet("menu"); setWeight(""); };

  const openRoll = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/rolls`, { method: "POST", headers: h(), body: JSON.stringify({ machine_id: sel, shift: shiftNow(), start_counter: 0 }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Failed");
      flash(`Roll opened on ${sel}`); closeSheet(); load();
    } catch (e) { flash(e.message, true); } finally { setBusy(false); }
  };
  const closeRoll = async () => {
    if (!machine?.roll_id) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/rolls/${machine.roll_id}/close`, { method: "PUT", headers: h(), body: JSON.stringify({ actual_weight_kg: weight ? parseFloat(weight) : null }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Failed");
      flash(`Roll closed · ${weight || "?"} kg`); closeSheet(); load();
    } catch (e) { flash(e.message, true); } finally { setBusy(false); }
  };
  const reportDowntime = async (reason) => {
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/downtime`, { method: "POST", headers: h(), body: JSON.stringify({ machine_id: sel, reason, shift: shiftNow() }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Failed");
      flash(`Downtime: ${reason}`); closeSheet(); load();
    } catch (e) { flash(e.message, true); } finally { setBusy(false); }
  };
  const resolveDowntime = async () => {
    setBusy(true);
    try {
      const list = await fetch(`${API}/api/downtime/open`, { headers: h() }).then(r => r.json());
      const dt = Array.isArray(list) ? list.find(x => x.machine_id === sel) : null;
      if (!dt) { flash("No open downtime", true); setBusy(false); return; }
      const r = await fetch(`${API}/api/downtime/${dt.id}/close`, { method: "PUT", headers: h() });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      flash("Downtime resolved"); closeSheet(); load();
    } catch (e) { flash(e.message, true); } finally { setBusy(false); }
  };

  const key = (k) => setWeight(w => k === "⌫" ? w.slice(0, -1) : (k === "." && w.includes(".")) ? w : (w + k).slice(0, 7));

  const hasOpenRoll = machine && machine.roll_id && machine.roll_status === "OPEN";
  const isDown = machine && machine.live_status === "DOWNTIME";

  const BIGBTN = { border: "none", borderRadius: 16, padding: "22px", fontSize: 22, fontWeight: 800, cursor: "pointer", width: "100%", letterSpacing: ".02em" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg)", color: "var(--text)", display: "flex", flexDirection: "column", zIndex: 1 }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 22px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <div style={{ fontFamily: "var(--mono)", fontWeight: 800, fontSize: 20, letterSpacing: ".04em", textTransform: "uppercase" }}>
          <span style={{ color: "var(--yellow)" }}>●</span> Operator Mode
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 22, fontFamily: "var(--mono)" }}>
          <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "var(--faint)", letterSpacing: ".1em" }}>SHIFT</div><div style={{ fontSize: 20, fontWeight: 700, color: "var(--yellow)" }}>{shiftNow() === "D" ? "DAY" : "NIGHT"}</div></div>
          <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "var(--faint)", letterSpacing: ".1em" }}>TIME</div><div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{time.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div></div>
          <button onClick={() => nav("/")} style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 20px", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>Exit ✕</button>
        </div>
      </div>

      {msg && <div style={{ padding: "14px 22px", fontSize: 18, fontWeight: 700, background: msg.err ? "var(--crit-dim)" : "var(--green-dim)", color: msg.err ? "var(--crit-edge)" : "var(--green)" }}>{msg.err ? "✗ " : "✓ "}{msg.text}</div>}

      {/* Machine cards */}
      <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {machines.map(m => {
            const s = ST[m.live_status] || ST.NO_DATA;
            const nd = m.live_status === "NO_DATA";
            const eff = nd || !m.rpm_target ? "--" : Math.round(((m.rpm || 0) / m.rpm_target) * 100) + "%";
            return (
              <button key={m.machine_id} onClick={() => openMachine(m)}
                style={{ textAlign: "left", background: "var(--surface)", border: `1px solid var(--border)`, borderLeft: `6px solid ${s.c}`, borderRadius: 16, padding: 18, cursor: "pointer", color: "var(--text)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 30, fontWeight: 800 }}>{m.machine_id}</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 800, letterSpacing: ".06em", color: s.c, background: `${s.c}1f`, border: `1px solid ${s.c}55`, borderRadius: 99, padding: "5px 12px", display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.c }} />{s.label}
                  </span>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>{m.fabric || "—"} · {m.operator_name || m.assigned_operator || "No operator"}</div>
                <div style={{ display: "flex", gap: 24, marginTop: 14 }}>
                  <div><div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)", letterSpacing: ".08em" }}>RPM</div><div style={{ fontFamily: "var(--mono)", fontSize: 26, fontWeight: 800 }}>{nd ? "--" : (m.rpm || 0)}</div></div>
                  <div><div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)", letterSpacing: ".08em" }}>EFF</div><div style={{ fontFamily: "var(--mono)", fontSize: 26, fontWeight: 800, color: "var(--yellow)" }}>{eff}</div></div>
                  <div><div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)", letterSpacing: ".08em" }}>TODAY</div><div style={{ fontFamily: "var(--mono)", fontSize: 26, fontWeight: 800 }}>{nd ? "--" : Number(m.today_production_kg || 0).toFixed(0)}<span style={{ fontSize: 13, color: "var(--muted)" }}>kg</span></div></div>
                </div>
                {m.roll_id && m.roll_status === "OPEN" && <div style={{ marginTop: 12, fontFamily: "var(--mono)", fontSize: 13, color: "var(--green)" }}>● Roll {m.roll_id} open</div>}
              </button>
            );
          })}
          {machines.length === 0 && <div style={{ color: "var(--muted)", fontSize: 18, padding: 40 }}>Loading machines…</div>}
        </div>
      </div>

      {/* Action sheet */}
      {machine && (
        <div onClick={closeSheet} style={{ position: "fixed", inset: 0, background: "#04070ecc", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "min(560px, 96vw)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "20px 20px 0 0", padding: 22, maxHeight: "92vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 28, fontWeight: 800 }}>{machine.machine_id}</span>
              <span style={{ color: "var(--muted)", fontSize: 15 }}>{machine.fabric || ""}</span>
              <button onClick={closeSheet} style={{ marginLeft: "auto", background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 12, width: 46, height: 46, fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>

            {sheet === "menu" && (
              <div style={{ display: "grid", gap: 12 }}>
                {!hasOpenRoll
                  ? <button disabled={busy} onClick={openRoll} style={{ ...BIGBTN, background: "var(--green)", color: "var(--bg)" }}>▶ OPEN ROLL</button>
                  : <button disabled={busy} onClick={() => setSheet("close")} style={{ ...BIGBTN, background: "var(--crit)", color: "var(--text)" }}>⏹ CLOSE ROLL</button>}
                {isDown
                  ? <button disabled={busy} onClick={resolveDowntime} style={{ ...BIGBTN, background: "var(--green)", color: "var(--bg)" }}>✓ RESOLVE DOWNTIME</button>
                  : <button disabled={busy} onClick={() => setSheet("downtime")} style={{ ...BIGBTN, background: "var(--crit-dim)", color: "var(--crit-edge)", border: "1px solid var(--crit-dim)" }}>⚠ REPORT DOWNTIME</button>}
                <button onClick={() => nav(`/machine/${machine.machine_id}`)} style={{ ...BIGBTN, background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", fontSize: 18, padding: 18 }}>Full machine details →</button>
              </div>
            )}

            {sheet === "close" && (
              <div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 8 }}>Roll weight (kg)</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 44, fontWeight: 800, textAlign: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 0", marginBottom: 14, minHeight: 30 }}>{weight || <span style={{ color: "var(--faint)" }}>0</span>}<span style={{ fontSize: 18, color: "var(--muted)" }}> kg</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"].map(k => (
                    <button key={k} onClick={() => key(k)} style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 0", fontSize: 24, fontWeight: 700, cursor: "pointer" }}>{k}</button>
                  ))}
                </div>
                <button disabled={busy} onClick={closeRoll} style={{ ...BIGBTN, background: "var(--crit)", color: "var(--text)", marginTop: 14 }}>{busy ? "…" : "⏹ CONFIRM CLOSE"}</button>
              </div>
            )}

            {sheet === "downtime" && (
              <div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 10 }}>Reason for stop</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                  {REASONS.map(r => (
                    <button key={r} disabled={busy} onClick={() => reportDowntime(r)} style={{ background: "var(--crit-dim)", color: "var(--crit-edge)", border: "1px solid var(--crit-dim)", borderRadius: 12, padding: "18px 12px", fontSize: 17, fontWeight: 700, cursor: "pointer" }}>{r}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
