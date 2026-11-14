// Needle Capacity by Machine — set how many needles a full set holds, per machine.
// Every machine has a cylinder bed. The second bed is DIAL needles on IL/RB and
// SINKERS on SJ/TV — stored in separate columns (dial_needles / sinker_count) and
// edited through one "Dial / Sinker" column that maps to the right field per machine.
// A formula suggestion (π × diameter × gauge) pre-fills; the mill overrides with the
// exact spec. Grouped by gauge so the 18G / 20G / 24G / 28G sets are easy to fill.

import React, { useState, useEffect, useCallback } from "react";

const th = { padding: "10px 12px", textAlign: "left", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", whiteSpace: "nowrap" };
const td = { padding: "8px 12px", borderBottom: "1px solid var(--border-soft)", fontSize: 13, verticalAlign: "middle" };
const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const cell = { width: 92, padding: "7px 8px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, boxSizing: "border-box", textAlign: "right", fontVariantNumeric: "tabular-nums" };
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9 };

export default function NeedleCapacity() {
  const [rows, setRows] = useState([]);
  const [edits, setEdits] = useState({});     // machine_id -> { field: value }
  const [savingId, setSavingId] = useState("");
  const [savedId, setSavedId] = useState("");
  const [open, setOpen] = useState(false);
  const [setFor, setSetFor] = useState(null);   // machine whose part-set is being edited
  const [catalog, setCatalog] = useState([]);
  const [chosen, setChosen] = useState({});      // part_id -> { on, qty }
  const [cfgList, setCfgList] = useState([]);    // configs of the machine in the editor
  const [selCfg, setSelCfg] = useState(null);    // config id being edited (null = single set)

  const load = useCallback(async () => {
    try { const r = await fetch("/api/needle-capacity"); setRows(await r.json()); } catch (e) { /* */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Read a value: pending edit first, else persisted. `field` is a column name.
  const valOf = (m, field) => {
    const e = edits[m.machine_id];
    if (e && e[field] !== undefined) return e[field];
    return m[field] == null ? "" : m[field];
  };
  const setVal = (id, field, v) => setEdits((s) => ({ ...s, [id]: { ...s[id], [field]: v } }));
  const useSuggested = (m) => setEdits((s) => ({ ...s, [m.machine_id]: { cylinder_needles: m.suggested_cylinder ?? "", [m.secondary_field]: m.suggested_secondary ?? "" } }));

  const save = async (m) => {
    setSavingId(m.machine_id);
    try {
      const body = { cylinder_needles: valOf(m, "cylinder_needles"), [m.secondary_field]: valOf(m, m.secondary_field) };
      const r = await fetch(`/api/needle-capacity/${m.machine_id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      setSavedId(m.machine_id); setTimeout(() => setSavedId(""), 1500);
      setEdits((s) => { const n = { ...s }; delete n[m.machine_id]; return n; });
      load();
    } catch (e) { /* */ } finally { setSavingId(""); }
  };

  // Load one config's (or the single set's) part lines into the checkbox map.
  const loadSetParts = async (machineId, cfgId) => {
    const q = cfgId != null ? `?config_id=${cfgId}` : "";
    const cur = await fetch(`/api/needle-capacity/${machineId}/parts${q}`).then((r) => r.json());
    const map = {};
    (Array.isArray(cur) ? cur : []).forEach((p) => { map[p.part_id] = { on: true, qty: p.default_qty ?? "", bed: p.bed || (/sinker/i.test(p.category || "") ? "SINKER" : "CYLINDER") }; });
    setChosen(map);
  };

  // Open the set editor: load catalog, the machine's configs, and the active set.
  const openSet = async (m) => {
    setSetFor(m); setChosen({}); setCatalog([]); setCfgList([]); setSelCfg(null);
    try {
      const [cat, cfgs] = await Promise.all([
        fetch("/api/needle-capacity/parts-catalog").then((r) => r.json()),
        fetch(`/api/needle-capacity/${m.machine_id}/configs`).then((r) => r.json()),
      ]);
      setCatalog(Array.isArray(cat) ? cat : []);
      const configs = Array.isArray(cfgs) ? cfgs : [];
      setCfgList(configs);
      const active = configs.find((c) => c.is_active) || configs[0];
      const cfgId = active ? active.id : null;
      setSelCfg(cfgId);
      await loadSetParts(m.machine_id, cfgId);
    } catch (e) { /* */ }
  };
  const pickCfg = async (cfgId) => { setSelCfg(cfgId); await loadSetParts(setFor.machine_id, cfgId); };
  const saveSet = async () => {
    const parts = Object.entries(chosen).filter(([, v]) => v.on).map(([part_id, v]) => ({ part_id, default_qty: v.qty, bed: v.bed }));
    try {
      await fetch(`/api/needle-capacity/${setFor.machine_id}/parts`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parts, config_id: selCfg }) });
      setSetFor(null); load();
    } catch (e) { /* */ }
  };
  const addConfig = async () => {
    const label = window.prompt("New config name (e.g. 28G):"); if (!label) return;
    const gauge = window.prompt("Gauge for this config (e.g. 28):", "");
    try {
      await fetch(`/api/needle-capacity/${setFor.machine_id}/configs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, gauge }) });
      const cfgs = await fetch(`/api/needle-capacity/${setFor.machine_id}/configs`).then((r) => r.json());
      setCfgList(cfgs); const nw = cfgs[cfgs.length - 1]; setSelCfg(nw.id); await loadSetParts(setFor.machine_id, nw.id); load();
    } catch (e) { /* */ }
  };
  const activateCfg = async (cfgId) => {
    try {
      await fetch(`/api/needle-capacity/${setFor.machine_id}/activate`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config_id: cfgId }) });
      const cfgs = await fetch(`/api/needle-capacity/${setFor.machine_id}/configs`).then((r) => r.json());
      setCfgList(cfgs); load();
    } catch (e) { /* */ }
  };

  // group by gauge
  const byGauge = {};
  rows.forEach((m) => { const g = m.gauge || "—"; (byGauge[g] = byGauge[g] || []).push(m); });
  const gauges = Object.keys(byGauge).sort((a, b) => Number(a) - Number(b));

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--faint)", letterSpacing: ".16em", textTransform: "uppercase" }}>Machine Spec</div>
          <h2 style={{ margin: "4px 0 0", fontFamily: "var(--mono)", fontWeight: 800, fontSize: 19, letterSpacing: ".02em", textTransform: "uppercase" }}>Needle Capacity by Machine</h2>
        </div>
        <button onClick={() => setOpen((v) => !v)} style={{ background: open ? "var(--surface)" : "var(--yellow)", color: open ? "var(--text)" : "var(--on-gold)", border: open ? "1px solid var(--border)" : "none", borderRadius: 7, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{open ? "Hide" : "Edit capacity"}</button>
      </div>

      {open && (
        <div style={{ ...card, overflowX: "auto" }}>
          <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
            Every machine has a cylinder bed. The second bed is <b style={{ color: "var(--text)" }}>dial needles</b> on IL / RB and <b style={{ color: "var(--text)" }}>sinkers</b> on SJ / TV. Suggested = π × diameter × gauge — override with your exact spec.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead><tr>
              <th style={th}>Machine</th><th style={th}>Type</th><th style={{ ...th, textAlign: "right" }}>Dia</th><th style={{ ...th, textAlign: "right" }}>Gauge</th>
              <th style={{ ...th, textAlign: "right" }}>Cylinder</th><th style={{ ...th, textAlign: "right" }}>Dial / Sinker</th><th style={{ ...th, textAlign: "right" }}>Total</th><th style={{ ...th, textAlign: "right" }}></th>
            </tr></thead>
            {gauges.map((g) => (
              <tbody key={g}>
                <tr><td colSpan={8} style={{ padding: "8px 12px", background: "var(--surface)", fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--yellow)" }}>{g}G</td></tr>
                {byGauge[g].map((m) => {
                  const cyl = Number(valOf(m, "cylinder_needles")) || 0;
                  const sec = Number(valOf(m, m.secondary_field)) || 0;
                  const dirty = !!edits[m.machine_id];
                  return (
                    <tr key={m.machine_id}>
                      <td style={{ ...td, fontWeight: 600 }}>{m.machine_name || m.machine_id}</td>
                      <td style={td}><span style={{ fontFamily: "var(--mono)", fontSize: 11, color: m.double_bed ? "#7c8aa5" : "var(--muted)" }}>{m.machine_type}{m.double_bed ? " · 2-bed" : ""}</span></td>
                      <td style={tdNum}>{m.diameter || "—"}″</td>
                      <td style={tdNum}>{m.gauge || "—"}</td>
                      <td style={tdNum}>
                        <input type="number" min="0" value={valOf(m, "cylinder_needles")} onChange={(e) => setVal(m.machine_id, "cylinder_needles", e.target.value)}
                          placeholder={m.suggested_cylinder ?? ""} style={cell} />
                      </td>
                      <td style={tdNum}>
                        <input type="number" min="0" value={valOf(m, m.secondary_field)} onChange={(e) => setVal(m.machine_id, m.secondary_field, e.target.value)} placeholder={m.suggested_secondary ?? ""} style={cell} />
                        <div style={{ fontSize: 9, color: "var(--faint)", fontFamily: "var(--mono)", letterSpacing: ".08em", marginTop: 2 }}>{m.secondary_kind}</div>
                      </td>
                      <td style={{ ...tdNum, fontWeight: 700 }}>{(cyl + sec) ? (cyl + sec).toLocaleString("en-IN") : "—"}</td>
                      <td style={{ ...tdNum, whiteSpace: "nowrap" }}>
                        <button onClick={() => useSuggested(m)} title="Fill from formula" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 5, padding: "4px 8px", fontSize: 11, cursor: "pointer", marginRight: 6 }}>↺ Suggest</button>
                        <button onClick={() => save(m)} disabled={!dirty || savingId === m.machine_id} style={{ background: savedId === m.machine_id ? "var(--green)" : (dirty ? "var(--yellow)" : "var(--surface)"), color: dirty || savedId === m.machine_id ? "var(--on-gold)" : "var(--faint)", border: "none", borderRadius: 5, padding: "4px 12px", fontSize: 11, fontWeight: 700, cursor: dirty ? "pointer" : "default" }}>
                          {savedId === m.machine_id ? "✓ Saved" : savingId === m.machine_id ? "…" : "Save"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {!open && (
        <div style={{ ...card, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead><tr><th style={th}>Machine</th><th style={th}>Type</th><th style={{ ...th, textAlign: "right" }}>Gauge</th><th style={{ ...th, textAlign: "right" }}>Cylinder</th><th style={{ ...th, textAlign: "right" }}>Dial / Sinker</th><th style={{ ...th, textAlign: "right" }}>Full Set</th><th style={{ ...th, textAlign: "right" }}>Part Set</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.machine_id}>
                  <td style={{ ...td, fontWeight: 600 }}>{m.machine_name || m.machine_id}</td>
                  <td style={{ ...td, fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>{m.machine_type}{m.double_bed ? " · 2-bed" : ""}</td>
                  <td style={tdNum}>{m.gauge || "—"}G</td>
                  <td style={tdNum}>{m.cylinder_needles ? m.cylinder_needles.toLocaleString("en-IN") : <span style={{ color: "var(--faint)" }}>not set</span>}</td>
                  <td style={tdNum}>{m.secondary_value ? <>{Number(m.secondary_value).toLocaleString("en-IN")}<span style={{ color: "var(--faint)", fontSize: 10, fontFamily: "var(--mono)" }}> {m.secondary_kind === "DIAL" ? "D" : "S"}</span></> : <span style={{ color: "var(--faint)" }}>not set</span>}</td>
                  <td style={{ ...tdNum, fontWeight: 700, color: m.total_needles ? "var(--text)" : "var(--faint)" }}>{m.total_needles ? m.total_needles.toLocaleString("en-IN") : "—"}</td>
                  <td style={{ ...tdNum, whiteSpace: "nowrap" }}>
                    {m.config_count > 0 && <span title="active config" style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, color: "var(--on-gold)", background: "var(--yellow)", borderRadius: 4, padding: "1px 6px", marginRight: 6 }}>{m.active_config || "?"}</span>}
                    <button onClick={() => openSet(m)} style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 5, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>⚙ Parts</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Part-set editor: which parts this machine uses + full-set quantity */}
      {setFor && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 20, overflowY: "auto" }}>
          <div style={{ ...card, borderColor: "var(--yellow)", width: "min(96vw, 620px)", padding: 20, margin: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <h3 style={{ margin: 0, fontFamily: "var(--mono)", fontWeight: 800, textTransform: "uppercase", fontSize: 16 }}>{setFor.machine_name || setFor.machine_id} · Part Set</h3>
              <button onClick={() => setSetFor(null)} style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", padding: "5px 12px", borderRadius: 6, cursor: "pointer" }}>Close</button>
            </div>
            {/* Config bar — convertible machines carry a set per gauge config. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)" }}>Config</span>
              {cfgList.length === 0 && <span style={{ fontSize: 12, color: "var(--faint)" }}>single set</span>}
              {cfgList.map((c) => (
                <button key={c.id} onClick={() => pickCfg(c.id)} title={c.gauge ? `${c.gauge}G` : ""}
                  style={{ background: selCfg === c.id ? "var(--yellow)" : "var(--surface)", color: selCfg === c.id ? "var(--on-gold)" : "var(--text)", border: "1px solid " + (selCfg === c.id ? "var(--yellow)" : "var(--border)"), borderRadius: 99, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {c.label}{c.is_active ? " ●" : ""}
                </button>
              ))}
              <button onClick={addConfig} style={{ background: "transparent", color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 99, padding: "4px 12px", fontSize: 12, cursor: "pointer" }}>+ Config</button>
              {selCfg && cfgList.find((c) => c.id === selCfg && !c.is_active) && (
                <button onClick={() => activateCfg(selCfg)} style={{ marginLeft: "auto", background: "var(--green)", color: "var(--bg)", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Set active (convert)</button>
              )}
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 12 }}>Tick the parts this machine uses{cfgList.length ? " in this config" : ""}. Full-set qty pre-loads a needle change. The <b style={{ color: "var(--text)" }}>active ●</b> config is what a change uses.</div>
            {catalog.length === 0 ? <div style={{ color: "var(--muted)", padding: 16, textAlign: "center" }}>Loading…</div> : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr>{["", "Part", "Bed", "Stock", "Full-set qty"].map((c) => <th key={c} style={th}>{c}</th>)}</tr></thead>
                <tbody>
                  {catalog.map((p) => {
                    const isSinker = /sinker/i.test(p.category || "");
                    const c = chosen[p.id] || { on: false, qty: "", bed: isSinker ? "SINKER" : "CYLINDER" };
                    return (
                      <tr key={p.id}>
                        <td style={{ ...td, width: 30 }}><input type="checkbox" checked={!!c.on} onChange={(e) => setChosen((s) => ({ ...s, [p.id]: { ...c, on: e.target.checked } }))} /></td>
                        <td style={{ ...td, fontWeight: 600 }}>{p.part_name}<span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--faint)", marginLeft: 6 }}>{p.category}</span></td>
                        <td style={td}>
                          {isSinker
                            ? <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>SINKER</span>
                            : <select value={c.bed || "CYLINDER"} disabled={!c.on} onChange={(e) => setChosen((s) => ({ ...s, [p.id]: { ...c, bed: e.target.value } }))} style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 5, padding: "5px 6px", fontSize: 11, opacity: c.on ? 1 : 0.4 }}>
                                <option value="CYLINDER">Cylinder</option>
                                <option value="DIAL">Dial</option>
                              </select>}
                        </td>
                        <td style={tdNum}>{Number(p.current_stock).toLocaleString("en-IN")}</td>
                        <td style={tdNum}><input type="number" min="0" value={c.qty} disabled={!c.on} onChange={(e) => setChosen((s) => ({ ...s, [p.id]: { ...c, qty: e.target.value } }))} style={{ ...cell, opacity: c.on ? 1 : 0.4 }} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button onClick={saveSet} style={{ flex: 1, background: "var(--yellow)", color: "var(--on-gold)", border: "none", padding: 12, borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>Save Part Set</button>
              <button onClick={() => setSetFor(null)} style={{ flex: 1, background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", padding: 12, borderRadius: 7, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
