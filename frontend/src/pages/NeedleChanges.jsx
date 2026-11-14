// Needle & Sinker Changes — multi-line change documents. A change on a machine is a
// SET of parts (several needle butt types + sinkers). Each document draws its lines
// from spare stock at cost, tags them to the machine, and rolls up per-machine spend.

import React, { useState, useEffect, useCallback } from "react";

const th = { padding: "10px 12px", textAlign: "left", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", whiteSpace: "nowrap" };
const td = { padding: "10px 12px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 };
const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const input = { width: "100%", padding: "9px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, boxSizing: "border-box" };
const lbl = { fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)", display: "block", marginBottom: 4 };
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9 };
const inr = (n) => "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const emptyDoc = () => ({ machine_id: "", change_date: today(), reason: "", notes: "", change_type: "BREAKAGE", lines: [{ part_id: "", quantity: "" }] });

export default function NeedleChanges({ machines = [] }) {
  const [documents, setDocuments] = useState([]);
  const [summary, setSummary] = useState([]);
  const [parts, setParts] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [draft, setDraft] = useState(null);   // new change document
  const [openDoc, setOpenDoc] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/needle-changes");
      const d = await r.json();
      setDocuments(d.documents || []); setSummary(d.summary || []); setParts(d.parts || []);
      const cy = await (await fetch("/api/needle-changes/cycles")).json();
      setCycles(cy.cycles || []);
    } catch (e) { /* */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const priceOf = (partId) => { const p = parts.find((x) => String(x.id) === String(partId)); return p && p.price != null ? Number(p.price) : 0; };
  const partObj = (partId) => parts.find((x) => String(x.id) === String(partId));
  const draftTotal = (lines) => (lines || []).reduce((s, l) => s + (Number(l.quantity) || 0) * priceOf(l.part_id), 0);

  const save = async () => {
    setErr("");
    if (!draft.machine_id) { setErr("Select a machine"); return; }
    const lines = draft.lines.filter((l) => l.part_id && Number(l.quantity) > 0);
    if (!lines.length) { setErr("Add at least one part line with a quantity"); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/needle-changes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, lines, change_type: draft.change_type }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Save failed");
      setDraft(null); load();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  const open = async (id) => { try { const r = await fetch(`/api/needle-changes/${id}`); setOpenDoc(await r.json()); } catch (e) { /* */ } };
  const del = async (id) => {
    if (!window.confirm("Delete this needle change? Stock will be reversed.")) return;
    try { await fetch(`/api/needle-changes/${id}`, { method: "DELETE" }); setOpenDoc(null); load(); } catch (e) { /* */ }
  };

  const setLine = (i, key, v) => setDraft((d) => { const ls = [...d.lines]; ls[i] = { ...ls[i], [key]: v }; return { ...d, lines: ls }; });

  // Picking a machine pre-loads its usual part set (defined in Needle Capacity), so a
  // full change is one adjust-and-save instead of building the line list each time.
  const onMachine = async (machineId) => {
    setDraft((d) => ({ ...d, machine_id: machineId }));
    if (!machineId) return;
    try {
      const r = await fetch(`/api/needle-capacity/${machineId}/parts`);
      const set = await r.json();
      if (Array.isArray(set) && set.length) {
        setDraft((d) => ({ ...d, machine_id: machineId, lines: set.map((p) => ({ part_id: String(p.part_id), quantity: p.default_qty ?? "" })) }));
      }
    } catch (e) { /* leave the blank line */ }
  };
  const grandCost = summary.reduce((s, r) => s + Number(r.total_cost || 0), 0);

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--faint)", letterSpacing: ".16em", textTransform: "uppercase" }}>Consumables</div>
          <h2 style={{ margin: "4px 0 0", fontFamily: "var(--mono)", fontWeight: 800, fontSize: 19, letterSpacing: ".02em", textTransform: "uppercase" }}>Needle &amp; Sinker Changes</h2>
        </div>
        <button onClick={() => { setErr(""); setDraft(emptyDoc()); }} style={{ background: "var(--yellow)", color: "var(--on-gold)", border: "none", borderRadius: 7, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>+ New Change</button>
      </div>

      {/* Cost roll-up */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        {[
          { label: "Total Needle Spend", value: inr(grandCost), rail: "var(--yellow)" },
          { label: "Machines Serviced", value: summary.length, rail: "var(--mnt)" },
          { label: "Change Events", value: documents.length, rail: "var(--mnt)" },
        ].map((k) => (
          <div key={k.label} style={{ ...card, padding: "13px 14px", position: "relative", overflow: "hidden", flex: 1, minWidth: 150 }}>
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: k.rail }} />
            <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)" }}>{k.label}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 8, lineHeight: 1 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Per-machine summary */}
      {summary.length > 0 && (
        <div style={{ ...card, padding: 0, marginBottom: 16, overflowX: "auto" }}>
          <div style={{ padding: "11px 14px", fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>Cost by Machine</div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
            <thead><tr><th style={th}>Machine</th><th style={{ ...th, textAlign: "right" }}>Changes</th><th style={{ ...th, textAlign: "right" }}>Total Cost</th><th style={{ ...th, textAlign: "right" }}>Last</th></tr></thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.machine_id}>
                  <td style={td}>{s.machine_name || s.machine_id}</td>
                  <td style={tdNum}>{s.changes}</td>
                  <td style={{ ...tdNum, fontWeight: 700, color: "var(--yellow)" }}>{inr(s.total_cost)}</td>
                  <td style={{ ...tdNum, color: "var(--muted)" }}>{s.last_change ? new Date(s.last_change).toLocaleDateString("en-GB") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Needle life & cost — ₹/kg per bed cycle vs standard */}
      <div style={{ ...card, padding: 0, marginBottom: 16, overflowX: "auto" }}>
        <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)" }}>Needle Life &amp; Cost — actual ₹/kg per bed cycle</span>
          <span style={{ fontSize: 11, color: "var(--faint)", marginLeft: 8 }}>feeds the roll's actual knitting cost</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
          <thead><tr>
            <th style={th}>Machine</th><th style={th}>Cycle</th><th style={{ ...th, textAlign: "right" }}>Set ₹</th><th style={{ ...th, textAlign: "right" }}>Breakage ₹</th><th style={{ ...th, textAlign: "right" }}>Total ₹</th><th style={{ ...th, textAlign: "right" }}>Kg made</th><th style={{ ...th, textAlign: "right" }}>Actual ₹/kg</th>
          </tr></thead>
          <tbody>
            {cycles.length === 0 && <tr><td style={{ ...td, color: "var(--muted)" }} colSpan={7}>No needle-life cycles yet. Log a <b>Full bed replacement</b> to start one.</td></tr>}
            {cycles.map((c) => (
              <tr key={c.id}>
                <td style={{ ...td, fontWeight: 600 }}>{c.machine_name || c.machine_id}</td>
                <td style={td}>
                  {new Date(c.started_on).toLocaleDateString("en-GB")} → {c.open ? <span style={{ color: "var(--green)", fontWeight: 700 }}>OPEN</span> : new Date(c.ended_on).toLocaleDateString("en-GB")}
                </td>
                <td style={tdNum}>{inr(c.set_cost)}</td>
                <td style={tdNum}>{inr(c.breakage_cost)}</td>
                <td style={{ ...tdNum, fontWeight: 600 }}>{inr(c.total_cost)}</td>
                <td style={tdNum}>{c.kg_live != null ? Number(c.kg_live).toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}</td>
                <td style={{ ...tdNum, fontWeight: 700, color: "var(--yellow)" }}>{c.cost_per_kg_live != null ? "₹" + Number(c.cost_per_kg_live).toFixed(2) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Change documents navigator */}
      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "11px 14px", fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>Change Log</div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead><tr>
            <th style={th}>Date</th><th style={th}>Machine</th><th style={{ ...th, textAlign: "right" }}>Parts</th><th style={{ ...th, textAlign: "right" }}>Cost</th><th style={th}>Reason</th><th style={th}>By</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {documents.length === 0 && <tr><td style={{ ...td, color: "var(--muted)" }} colSpan={7}>No needle changes recorded yet.</td></tr>}
            {documents.map((r) => (
              <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => open(r.id)}>
                <td style={td}>{new Date(r.change_date).toLocaleDateString("en-GB")}</td>
                <td style={{ ...td, fontWeight: 600 }}>{r.machine_name || r.machine_id}</td>
                <td style={tdNum}>{r.line_count}</td>
                <td style={{ ...tdNum, fontWeight: 700 }}>{inr(r.total_cost)}</td>
                <td style={{ ...td, color: "var(--muted)" }}>{r.reason || "—"}</td>
                <td style={{ ...td, color: "var(--muted)" }}>{r.changed_by || "—"}</td>
                <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                  <button onClick={(e) => { e.stopPropagation(); open(r.id); }} style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 5, padding: "3px 9px", fontSize: 11, cursor: "pointer", marginRight: 5 }}>Open</button>
                  <button onClick={(e) => { e.stopPropagation(); del(r.id); }} style={{ background: "transparent", border: "1px solid var(--crit-dim)", color: "var(--crit)", borderRadius: 5, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New change document */}
      {draft && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 20, overflowY: "auto" }}>
          <div style={{ ...card, borderColor: "var(--yellow)", width: "min(96vw, 720px)", padding: 20, margin: "auto" }}>
            <h3 style={{ margin: "0 0 12px", fontFamily: "var(--mono)", fontWeight: 800, textTransform: "uppercase", fontSize: 17 }}>New Needle Change</h3>
            {err && <div style={{ color: "var(--crit-edge)", marginBottom: 10, fontSize: 13 }}>{err}</div>}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 140 }}><label style={lbl}>Machine</label>
                <select value={draft.machine_id} onChange={(e) => onMachine(e.target.value)} style={input}>
                  <option value="">Select…</option>
                  {machines.map((m) => <option key={m.machine_id} value={m.machine_id}>{m.machine_name || m.machine_id}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 130 }}><label style={lbl}>Date</label><input type="date" value={draft.change_date} onChange={(e) => setDraft((d) => ({ ...d, change_date: e.target.value }))} style={input} /></div>
              <div style={{ flex: 1, minWidth: 130 }}><label style={lbl}>Reason</label><input value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} placeholder="wear / breakage…" style={input} /></div>
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={lbl}>Change type</label>
              <div style={{ display: "flex", gap: 8 }}>
                {[["FULL_BED", "Full bed replacement", "Starts a new needle-life cycle"], ["BREAKAGE", "Breakage repair", "Adds to the machine's open cycle"]].map(([v, t, sub]) => (
                  <button key={v} type="button" onClick={() => setDraft((d) => ({ ...d, change_type: v }))}
                    style={{ flex: 1, textAlign: "left", background: draft.change_type === v ? "var(--yellow)" : "var(--surface)", color: draft.change_type === v ? "var(--on-gold)" : "var(--text)", border: "1px solid " + (draft.change_type === v ? "var(--yellow)" : "var(--border)"), borderRadius: 7, padding: "9px 12px", cursor: "pointer" }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{t}</div>
                    <div style={{ fontSize: 10.5, opacity: .8 }}>{sub}</div>
                  </button>
                ))}
              </div>
            </div>

            <label style={{ ...lbl, marginTop: 10 }}>Parts changed</label>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 8 }}>
              <thead><tr style={{ color: "var(--muted)", textAlign: "left" }}>{["Part", "Qty", "Rate ₹", "Line ₹", ""].map((c) => <th key={c} style={{ padding: "4px 6px", fontSize: 11 }}>{c}</th>)}</tr></thead>
              <tbody>
                {draft.lines.map((l, i) => {
                  const po = partObj(l.part_id);
                  return (
                    <tr key={i}>
                      <td style={{ padding: "3px 6px" }}>
                        <select style={{ ...input, marginBottom: 0 }} value={l.part_id} onChange={(e) => setLine(i, "part_id", e.target.value)}>
                          <option value="">Select part…</option>
                          {parts.map((p) => <option key={p.id} value={p.id}>{p.part_name} ({p.category})</option>)}
                        </select>
                        {po && <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 2 }}>stock {Number(po.current_stock).toLocaleString("en-IN")}{po.price != null ? ` · ${inr(po.price)}/pc` : " · no price"}</div>}
                      </td>
                      <td style={{ padding: "3px 6px", width: 90 }}><input style={{ ...input, marginBottom: 0 }} type="number" min="0" value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} /></td>
                      <td style={{ padding: "3px 6px", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>{inr(priceOf(l.part_id))}</td>
                      <td style={{ padding: "3px 6px", fontVariantNumeric: "tabular-nums", color: "var(--muted)", whiteSpace: "nowrap" }}>{inr((Number(l.quantity) || 0) * priceOf(l.part_id))}</td>
                      <td style={{ padding: "3px 6px" }}>{draft.lines.length > 1 && <button onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))} style={{ background: "transparent", color: "var(--crit)", border: "none", cursor: "pointer", fontSize: 15 }}>×</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, { part_id: "", quantity: "" }] }))} style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>+ Add part</button>
            <div style={{ textAlign: "right", margin: "12px 0", fontSize: 15 }}>Total: <b style={{ color: "var(--yellow)" }}>{inr(draftTotal(draft.lines))}</b></div>
            <div style={{ color: "var(--faint)", fontSize: 11, marginBottom: 10 }}>Each line is drawn from spare stock at its cost and tagged to the machine.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={save} disabled={saving} style={{ flex: 1, background: "var(--yellow)", color: "var(--on-gold)", border: "none", padding: 12, borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>{saving ? "Saving…" : "Save Change"}</button>
              <button onClick={() => setDraft(null)} style={{ flex: 1, background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", padding: 12, borderRadius: 7, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Open a change document */}
      {openDoc && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 20, overflowY: "auto" }}>
          <div style={{ ...card, width: "min(96vw, 640px)", padding: 20, margin: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontFamily: "var(--mono)", fontWeight: 800, textTransform: "uppercase", fontSize: 16 }}>{openDoc.machine_name || openDoc.machine_id} · {new Date(openDoc.change_date).toLocaleDateString("en-GB")}</h3>
              <button onClick={() => setOpenDoc(null)} style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", padding: "5px 12px", borderRadius: 6, cursor: "pointer" }}>Close</button>
            </div>
            {openDoc.reason && <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 10 }}>Reason: {openDoc.reason}</div>}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr>{["Part", "Qty", "Rate ₹", "Total ₹"].map((c) => <th key={c} style={th}>{c}</th>)}</tr></thead>
              <tbody>
                {(openDoc.lines || []).map((l) => (
                  <tr key={l.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{l.part_name}</td>
                    <td style={tdNum}>{Number(l.quantity).toLocaleString("en-IN")} {l.unit}</td>
                    <td style={tdNum}>{inr(l.unit_cost)}</td>
                    <td style={{ ...tdNum, fontWeight: 600 }}>{inr(l.total_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
              <button onClick={() => del(openDoc.id)} style={{ background: "transparent", color: "var(--crit)", border: "1px solid var(--crit-dim)", padding: "9px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12 }}>Delete change</button>
              <div style={{ fontSize: 15 }}>Total: <b style={{ color: "var(--yellow)" }}>{inr((openDoc.lines || []).reduce((s, l) => s + Number(l.total_cost || 0), 0))}</b></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
