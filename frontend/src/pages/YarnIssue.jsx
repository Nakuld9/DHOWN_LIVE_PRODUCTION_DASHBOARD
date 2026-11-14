import React, { useState, useEffect, useCallback } from "react";
import PrintChallan from "../components/PrintChallan";

const API = "";
const token = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token()}` });
const fmtKg = v => v != null ? parseFloat(v).toFixed(3) : "—";
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—";
const today = () => new Date().toISOString().slice(0, 10);

const STATUS_COLORS = { ISSUED: "var(--gold)", CLOSED: "var(--green)", PARTIAL: "var(--link)", CANCELLED: "var(--crit)" };
const cell = { padding: "6px 8px", border: "1px solid var(--surface)", fontSize: 12 };
const cinp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, padding: "5px 7px", color: "var(--text)", fontSize: 12, boxSizing: "border-box" };
const fieldInp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, padding: "5px 8px", color: "var(--text)", fontSize: 13, boxSizing: "border-box" };

const emptyRow = () => ({ yarn_type: "", lot_id: "", issued_kg: "", issued_cones: "" });
const emptyHeader = () => ({ machine_id: "", issued_by: "", received_by: "", issue_date: today(), notes: "" });

// ── Reusable navigator bar ──
function NavBar({ label, list, selId, idKey, optLabel, onSelect, disabled, onAdd }) {
  const idx = list.findIndex(x => x[idKey] === selId);
  const go = (i) => { if (i >= 0 && i < list.length) onSelect(list[i][idKey]); };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", flexWrap: "wrap", opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      {onAdd && <button onClick={onAdd} style={{ background: "var(--green)", color: "var(--bg)", border: "none", padding: "7px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>+ Add</button>}
      <span style={{ color: "var(--muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
      <select value={selId || ""} onChange={e => e.target.value && onSelect(e.target.value)}
        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--yellow)", borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "monospace", fontWeight: 700, minWidth: 320 }}>
        <option value="">— List View ({list.length}) —</option>
        {list.map(x => <option key={x[idKey]} value={x[idKey]}>{optLabel(x)}</option>)}
      </select>
      {selId && idx >= 0 && <span style={{ color: "var(--muted)", fontSize: 12 }}>{list.length - idx} / {list.length}</span>}
      <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
        <button onClick={() => go(list.length - 1)} disabled={idx < 0 || idx >= list.length - 1} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: idx >= list.length - 1 ? "var(--surface-2)" : "var(--link)", padding: "7px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>⏮ First</button>
        <button onClick={() => go(idx + 1)} disabled={idx < 0 || idx >= list.length - 1} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: idx >= list.length - 1 ? "var(--surface-2)" : "var(--link)", padding: "7px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>◀ Previous</button>
        <button onClick={() => go(idx - 1)} disabled={idx <= 0} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: idx <= 0 ? "var(--surface-2)" : "var(--link)", padding: "7px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Next ▶</button>
        <button onClick={() => go(0)} disabled={!list.length} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--gold-2)", padding: "7px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Last ⏭</button>
      </div>
    </div>
  );
}

export default function YarnIssue() {
  const [tab, setTab] = useState("issues"); // 'issues' | 'returns'

  const [issues,   setIssues]   = useState([]);
  const [selected, setSelected] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");

  const [machines,  setMachines]  = useState([]);
  const [yarns,     setYarns]     = useState([]);
  const [yarnItems, setYarnItems] = useState([]);

  const [mode,   setMode]   = useState("view");
  const [header, setHeader] = useState(emptyHeader());
  const [rows,   setRows]   = useState([emptyRow()]);

  // Returns
  const [returns,   setReturns]   = useState([]);
  const [selRet,    setSelRet]    = useState(null);
  const [retMode,   setRetMode]   = useState("view");
  const [retHeader, setRetHeader] = useState({ issue_id: "", return_date: today(), notes: "" });
  const [retRows,   setRetRows]   = useState([]);
  const [retSaving, setRetSaving] = useState(false);
  const [retError,  setRetError]  = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch(`${API}/api/yarn-issues`, { headers: h() }); setIssues(await r.json()); } catch {}
    setLoading(false);
  }, []);
  const loadReturns = useCallback(async () => {
    try { const r = await fetch(`${API}/api/yarn-returns`, { headers: h() }); setReturns(await r.json()); } catch {}
  }, []);
  const loadMeta = useCallback(async () => {
    try {
      const [m, y, items] = await Promise.all([
        fetch(`${API}/api/machines`, { headers: h() }).then(r => r.json()),
        fetch(`${API}/api/yarn-store?status=IN_STORE`, { headers: h() }).then(r => r.json()),
        fetch(`${API}/api/erp/items?category=YARN&limit=200&status=ACTIVE`, { headers: h() }).then(r => r.json()),
      ]);
      setMachines(Array.isArray(m) ? m : []);
      setYarns(Array.isArray(y) ? y : []);
      const itemList = items.data || items || [];
      setYarnItems(Array.isArray(itemList) ? itemList : []);
    } catch {}
  }, []);

  useEffect(() => { load(); loadReturns(); loadMeta(); }, [load, loadReturns, loadMeta]);

  const loadDetail = async (id) => { const r = await fetch(`${API}/api/yarn-issues/${id}`, { headers: h() }); setSelected(await r.json()); setMode("view"); };
  const loadRetDetail = async (id) => { const r = await fetch(`${API}/api/yarn-returns/${id}`, { headers: h() }); setSelRet(await r.json()); setRetMode("view"); };

  useEffect(() => { if (tab === "issues" && mode === "view" && !selected && issues.length > 0) loadDetail(issues[0].issue_id); }, [issues, tab]); // eslint-disable-line
  useEffect(() => { if (tab === "returns" && retMode === "view" && !selRet && returns.length > 0) loadRetDetail(returns[0].return_id); }, [returns, tab]); // eslint-disable-line

  // ── Issue entry ──
  const startNew = () => { loadMeta(); setSelected(null); setHeader(emptyHeader()); setRows([emptyRow()]); setError(""); setMode("new"); };
  const cancelEntry = () => { setMode("view"); setError(""); if (selected) loadDetail(selected.issue_id); else if (issues.length) loadDetail(issues[0].issue_id); };
  const setRow = (idx, field, value) => setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  const addRow = () => setRows(prev => [...prev, emptyRow()]);
  const removeRow = (idx) => setRows(prev => prev.length === 1 ? [emptyRow()] : prev.filter((_, i) => i !== idx));

  const save = async () => {
    setError("");
    if (!header.machine_id) { setError("Select a machine"); return; }
    const items = rows.filter(r => r.lot_id && r.issued_kg);
    if (!items.length) { setError("Add at least one yarn lot with quantity"); return; }
    for (const row of items) { const lot = yarns.find(l => String(l.lot_id) === String(row.lot_id)); if (lot && parseFloat(row.issued_kg) > parseFloat(lot.current_stock_kg)) { setError(`Lot ${lot.lot_number}: only ${parseFloat(lot.current_stock_kg).toFixed(3)} kg available`); return; } }
    const machine = machines.find(m => String(m.machine_id) === String(header.machine_id));
    const payload = { ...header, machine_name: machine?.name || machine?.machine_name || header.machine_id, items: items.map(r => { const lot = yarns.find(l => String(l.lot_id) === String(r.lot_id)); return { lot_id: parseInt(r.lot_id), lot_number: lot?.lot_number, yarn_type: lot?.yarn_type, color: lot?.color, available_kg: lot?.current_stock_kg, issued_kg: parseFloat(r.issued_kg), issued_cones: parseInt(r.issued_cones || 0) }; }) };
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/yarn-issues`, { method: "POST", headers: h(), body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) { setError(j.error || "Failed to save"); setSaving(false); return; }
      await load(); await loadMeta(); await loadDetail(j.issue_id || j.id); setMode("view");
    } catch { setError("Network error"); }
    setSaving(false);
  };
  const cancelIssue = async () => { if (!window.confirm("CANCEL this issue? Number stays, stock returned.")) return; const r = await fetch(`${API}/api/yarn-issues/${selected.issue_id}/cancel`, { method: "PUT", headers: { Authorization: `Bearer ${token()}` } }); if (!r.ok) { const e = await r.json(); alert(e.error); return; } loadDetail(selected.issue_id); load(); loadMeta(); };
  const delIssue = async () => { if (!window.confirm("DELETE this issue completely? Number will be freed.")) return; const r = await fetch(`${API}/api/yarn-issues/${selected.issue_id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token()}` } }); if (!r.ok) { const e = await r.json(); alert(e.error); return; } setSelected(null); load(); loadMeta(); };

  // ── Return entry ──
  const returnableIssues = issues.filter(i => i.status === "ISSUED");
  const startNewReturn = () => { setSelRet(null); setRetHeader({ issue_id: "", return_date: today(), notes: "" }); setRetRows([]); setRetError(""); setRetMode("new"); };
  const cancelRetEntry = () => { setRetMode("view"); setRetError(""); if (selRet) loadRetDetail(selRet.return_id); else if (returns.length) loadRetDetail(returns[0].return_id); };
  const pickIssue = async (issue_id) => {
    setRetHeader(f => ({ ...f, issue_id }));
    setRetRows([]);
    if (!issue_id) return;
    const d = await fetch(`${API}/api/yarn-issues/${issue_id}`, { headers: h() }).then(r => r.json());
    setRetRows((d.items || []).map(it => {
      const issued = parseFloat(it.issued_kg || 0), already = parseFloat(it.returned_kg || 0);
      return { item_id: it.item_id, item_name: it.item_name || it.yarn_type, lot_number: it.supplier_lot_no || it.lot_number, color: it.color, issued, already, remaining: issued - already, return_kg: "" };
    }));
  };
  const retTotal = retRows.reduce((s, r) => s + parseFloat(r.return_kg || 0), 0);
  const saveReturn = async () => {
    setRetError("");
    if (!retHeader.issue_id) { setRetError("Select an issue to return against"); return; }
    const rets = retRows.filter(r => parseFloat(r.return_kg) > 0);
    if (!rets.length) { setRetError("Enter at least one return quantity"); return; }
    for (const r of retRows) { const qty = parseFloat(r.return_kg || 0); if (qty > r.remaining) { setRetError(`${r.lot_number}: max returnable is ${r.remaining.toFixed(3)} kg`); return; } }
    setRetSaving(true);
    try {
      const r = await fetch(`${API}/api/yarn-returns`, { method: "POST", headers: h(), body: JSON.stringify({ issue_id: parseInt(retHeader.issue_id), return_date: retHeader.return_date, notes: retHeader.notes, returns: rets.map(x => ({ item_id: x.item_id, returned_kg: parseFloat(x.return_kg) })) }) });
      const j = await r.json();
      if (!r.ok) { setRetError(j.error || "Failed"); setRetSaving(false); return; }
      await loadReturns(); await load(); await loadMeta(); await loadRetDetail(j.return_id); setRetMode("view");
    } catch { setRetError("Network error"); }
    setRetSaving(false);
  };

  // Derived (issues)
  const editing = mode === "new";
  const viewItems = selected?.items || [];
  const machineName = editing ? (machines.find(m => String(m.machine_id) === String(header.machine_id))?.name || machines.find(m => String(m.machine_id) === String(header.machine_id))?.machine_name || "—") : selected?.machine_name;
  const totalIssued = editing ? rows.reduce((s, r) => s + parseFloat(r.issued_kg || 0), 0) : viewItems.reduce((s, it) => s + parseFloat(it.issued_kg || 0), 0);
  const totalReturned = viewItems.reduce((s, it) => s + parseFloat(it.returned_kg || 0), 0);
  const totalConsumed = viewItems.reduce((s, it) => s + parseFloat(it.consumed_kg || it.issued_kg || 0), 0);
  const totalCount = editing ? rows.filter(r => r.lot_id && r.issued_kg).length : viewItems.length;
  const show = editing || selected;

  const retEditing = retMode === "new";
  const retShow = retEditing || selRet;
  const retViewItems = selRet?.items || [];

  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)} style={{ padding: "8px 20px", border: "none", borderBottom: `2px solid ${tab === id ? "var(--yellow)" : "transparent"}`, background: "transparent", color: tab === id ? "var(--yellow)" : "var(--muted)", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>{label}</button>
  );

  return (
    <>
    <div style={{ padding: 20, color: "var(--text)", fontFamily: "Inter, sans-serif" }}>

      <div style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0, color: "var(--yellow)", fontSize: 24 }}>Yarn Issue & Return</h2>
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>Issue yarn lots to machines · return balance yarn to store</div>
      </div>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        <TabBtn id="issues" label="Yarn Issues" />
        <TabBtn id="returns" label="Yarn Returns" />
      </div>

      {/* ══ ISSUES TAB ══ */}
      {tab === "issues" && (<>
        <NavBar label="Issue" list={issues} selId={selected?.issue_id} idKey="issue_id" disabled={editing} onAdd={startNew}
          onSelect={loadDetail} optLabel={i => `${i.issue_number} · ${i.machine_name || `M#${i.machine_id}`} · ${i.issue_date?.slice(0, 10)} · ${i.status}`} />

        {loading && !show ? <div style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>Loading...</div>
          : !show && issues.length === 0 ? <div style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No yarn issues yet — click + Add to create the first one.</div>
          : !show ? <div style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>Select an issue from List View, or use ⏭ Last for the latest.</div>
          : null}

        {show && (
          <div style={{ background: "var(--surface)", border: `1px solid ${editing ? "var(--yellow)" : "var(--border)"}`, borderRadius: 12, overflow: "hidden", minHeight: 460, display: "flex", flexDirection: "column" }}>
            <div style={{ background: "var(--surface)", color: "var(--yellow)", textAlign: "center", fontWeight: 500, fontSize: 15, padding: 8, letterSpacing: 1 }}>{editing ? "New Yarn Issue to Machine" : "Yarn Issue to Machine"}</div>
            {error && <div style={{ background: "#ef444422", borderBottom: "1px solid var(--crit)", padding: "8px 16px", color: "var(--crit)", fontSize: 13 }}>{error}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: "1px solid var(--border)" }}>
              {[
                ["Issue No.", editing ? "(auto)" : selected?.issue_number, "var(--yellow)", null],
                ["Date", editing ? null : fmtDate(selected?.issue_date), null, "issue_date"],
                ["Machine", machineName, null, "machine_id"],
                ["Received By", editing ? null : (selected?.received_by || "—"), null, "received_by"],
                ["Issued By", editing ? null : (selected?.issued_by || "—"), null, "issued_by"],
                ["Notes", editing ? null : (selected?.notes || "—"), null, "notes"],
                ["", "", null, "_blank"],
                ["Status", editing ? "NEW" : selected?.status, editing ? "var(--yellow)" : STATUS_COLORS[selected?.status], null],
              ].map(([label, val, color, key], i) => (
                <div key={i} style={{ padding: "9px 14px", borderRight: (i + 1) % 4 !== 0 ? "1px solid var(--surface)" : "none", borderTop: i >= 4 ? "1px solid var(--surface)" : "none" }}>
                  <div style={{ color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 3, fontWeight: 700 }}>{label}</div>
                  {editing && key === "machine_id" ? (
                    <select value={header.machine_id} onChange={e => setHeader(f => ({ ...f, machine_id: e.target.value }))} style={fieldInp}>
                      <option value="">— Select machine —</option>
                      {machines.map(m => <option key={m.machine_id} value={m.machine_id}>{m.name || m.machine_name || m.machine_id}{m.fabric ? ` (${m.fabric})` : ""}</option>)}
                    </select>
                  ) : editing && key === "issue_date" ? (
                    <input type="date" value={header.issue_date} onChange={e => setHeader(f => ({ ...f, issue_date: e.target.value }))} style={fieldInp} />
                  ) : editing && key && key !== "_blank" ? (
                    <input value={header[key]} onChange={e => setHeader(f => ({ ...f, [key]: e.target.value }))} style={fieldInp} placeholder={label} />
                  ) : (
                    <div style={{ color: color || "var(--text)", fontSize: 14, fontWeight: 700, fontFamily: label === "Issue No." ? "monospace" : "inherit", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{val || (label ? "—" : "")}</div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ flex: 1, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ color: "var(--muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Yarn Lots ({totalCount})</span>
                {editing && <button onClick={addRow} style={{ background: "var(--border)", color: "var(--yellow)", border: "1px solid var(--gold)", borderRadius: 5, padding: "5px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>+ Add Row</button>}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <thead>
                  <tr style={{ background: "var(--surface)" }}>
                    {(editing ? [["Sr", 34], ["Yarn Type", null], ["Lot No", 150], ["Colour", 90], ["Avail (kg)", 90], ["Boxes", 70], ["Issue (kg)", 100], ["", 30]]
                      : [["Sr", 34], ["Yarn Type", null], ["Lot No", 130], ["Colour", 90], ["Boxes", 70], ["Issued (kg)", 100], ["Returned", 90], ["Consumed", 100]]
                    ).map(([hh, w]) => <th key={hh} style={{ width: w || "auto", padding: "8px 10px", textAlign: (["Avail (kg)", "Boxes", "Issue (kg)", "Issued (kg)", "Returned", "Consumed"].includes(hh)) ? "right" : "left", color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, border: "1px solid var(--surface)" }}>{hh}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {editing ? rows.map((row, i) => {
                    const filteredLots = row.yarn_type ? yarns.filter(l => l.yarn_type === row.yarn_type) : [];
                    const lot = yarns.find(l => String(l.lot_id) === String(row.lot_id));
                    const over = lot && parseFloat(row.issued_kg) > parseFloat(lot.current_stock_kg);
                    return (
                      <tr key={i}>
                        <td style={{ ...cell, color: "var(--muted)" }}>{i + 1}</td>
                        <td style={{ ...cell, padding: "3px 4px" }}>
                          <select value={row.yarn_type} onChange={e => { setRow(i, "yarn_type", e.target.value); setRow(i, "lot_id", ""); }} style={cinp}>
                            <option value="">— Select yarn —</option>
                            {yarnItems.map(it => <option key={it.item_id} value={it.item_code}>{it.item_name}</option>)}
                          </select>
                        </td>
                        <td style={{ ...cell, padding: "3px 4px" }}>
                          <select value={row.lot_id} onChange={e => setRow(i, "lot_id", e.target.value)} style={cinp} disabled={!row.yarn_type}>
                            <option value="">{row.yarn_type ? `— ${filteredLots.length} lot(s) —` : "— yarn first —"}</option>
                            {filteredLots.map(l => <option key={l.lot_id} value={l.lot_id}>{l.supplier_lot_no || l.lot_number} — {parseFloat(l.current_stock_kg).toFixed(1)} kg{l.brand ? ` (${l.brand})` : ""}</option>)}
                          </select>
                        </td>
                        <td style={{ ...cell, color: "var(--muted)" }}>{lot?.color || "—"}</td>
                        <td style={{ ...cell, color: "var(--green-2)", textAlign: "right", fontWeight: 600 }}>{lot ? fmtKg(lot.current_stock_kg) : "—"}</td>
                        <td style={{ ...cell, padding: "3px 4px" }}><input type="number" value={row.issued_cones} onChange={e => setRow(i, "issued_cones", e.target.value)} style={{ ...cinp, textAlign: "right" }} placeholder="0" /></td>
                        <td style={{ ...cell, padding: "3px 4px" }}><input type="number" step="0.001" value={row.issued_kg} onChange={e => setRow(i, "issued_kg", e.target.value)} style={{ ...cinp, textAlign: "right", border: `1px solid ${over ? "var(--crit)" : "var(--border)"}` }} placeholder="0.000" />{over && <div style={{ fontSize: 9, color: "var(--crit)" }}>over stock</div>}</td>
                        <td style={{ ...cell, padding: "3px 4px", textAlign: "center" }}><button onClick={() => removeRow(i)} style={{ background: "transparent", border: "none", color: "var(--crit)", cursor: "pointer", fontSize: 15 }}>×</button></td>
                      </tr>
                    );
                  }) : viewItems.map((item, i) => (
                    <tr key={item.item_id} style={{ background: i % 2 === 1 ? "var(--surface)" : "transparent" }}>
                      <td style={{ ...cell, color: "var(--muted)" }}>{i + 1}</td>
                      <td style={{ ...cell, color: "var(--yellow)", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.item_name || item.yarn_type}</td>
                      <td style={{ ...cell, color: "var(--muted)", fontFamily: "monospace" }}>{item.supplier_lot_no || item.lot_number}</td>
                      <td style={{ ...cell, color: "var(--muted)" }}>{item.color || "—"}</td>
                      <td style={{ ...cell, color: "var(--purple)", textAlign: "right" }}>{item.issued_cones || "—"}</td>
                      <td style={{ ...cell, color: "var(--gold-2)", textAlign: "right", fontWeight: 700 }}>{fmtKg(item.issued_kg)}</td>
                      <td style={{ ...cell, color: "var(--muted)", textAlign: "right" }}>{parseFloat(item.returned_kg || 0) > 0 ? fmtKg(item.returned_kg) : "—"}</td>
                      <td style={{ ...cell, color: "var(--gold)", textAlign: "right", fontWeight: 700 }}>{fmtKg(item.consumed_kg || item.issued_kg)}</td>
                    </tr>
                  ))}
                  {!editing && Array.from({ length: Math.max(0, 6 - viewItems.length) }).map((_, i) => (
                    <tr key={`b${i}`} style={{ background: (viewItems.length + i) % 2 === 1 ? "var(--surface)" : "transparent" }}>{Array.from({ length: 8 }).map((__, j) => <td key={j} style={{ ...cell }}>&nbsp;</td>)}</tr>
                  ))}
                  <tr style={{ background: "var(--surface)" }}>
                    {editing ? (<>
                      <td colSpan={4} style={{ ...cell, color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>TOTAL — {totalCount} lot(s)</td>
                      <td style={{ ...cell }}></td><td style={{ ...cell }}></td>
                      <td style={{ ...cell, color: "var(--gold-2)", fontWeight: 700, textAlign: "right" }}>{totalIssued > 0 ? totalIssued.toFixed(3) : "—"}</td>
                      <td style={{ ...cell }}></td>
                    </>) : (<>
                      <td colSpan={5} style={{ ...cell, color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>TOTAL — {totalCount} lot(s)</td>
                      <td style={{ ...cell, color: "var(--gold-2)", fontWeight: 700, textAlign: "right" }}>{totalIssued.toFixed(3)}</td>
                      <td style={{ ...cell, color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>{totalReturned > 0 ? totalReturned.toFixed(3) : "—"}</td>
                      <td style={{ ...cell, color: "var(--gold)", fontWeight: 700, textAlign: "right" }}>{totalConsumed.toFixed(3)}</td>
                    </>)}
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--border)", background: "var(--surface)", flexWrap: "wrap" }}>
              {editing ? (<>
                <button onClick={save} disabled={saving} style={{ background: saving ? "var(--green-dim)" : "var(--green)", color: "var(--bg)", border: "none", padding: "8px 22px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>{saving ? "Saving..." : "💾 Save"}</button>
                <button onClick={cancelEntry} style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>✕ Cancel</button>
              </>) : (<>
                <button onClick={startNew} style={{ background: "var(--green)", color: "var(--bg)", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>+ Add</button>
                {selected?.status !== "CANCELLED" && <button onClick={cancelIssue} style={{ background: "var(--crit)", color: "var(--text)", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✕ Cancel</button>}
                <button onClick={delIssue} style={{ background: "var(--crit)", color: "var(--text)", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🗑 Delete</button>
                <button onClick={() => setPrinting(true)} style={{ background: "var(--border)", color: "var(--link)", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🖨 Print</button>
              </>)}
            </div>
          </div>
        )}
      </>)}

      {/* ══ RETURNS TAB ══ */}
      {tab === "returns" && (<>
        <NavBar label="Return" list={returns} selId={selRet?.return_id} idKey="return_id" disabled={retEditing} onAdd={startNewReturn}
          onSelect={loadRetDetail} optLabel={r => `${r.return_number} · ${r.machine_name || `M#${r.machine_id}`} · ${r.return_date?.slice(0, 10)} · ${parseFloat(r.total_kg || 0).toFixed(1)} kg`} />

        {!retShow && returns.length === 0 ? <div style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No yarn returns yet — click + Add to record a return.</div>
          : !retShow ? <div style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>Select a return from List View, or use ⏭ Last for the latest.</div>
          : null}

        {retShow && (
          <div style={{ background: "var(--surface)", border: `1px solid ${retEditing ? "var(--gold)" : "var(--border)"}`, borderRadius: 12, overflow: "hidden", minHeight: 420, display: "flex", flexDirection: "column" }}>
            <div style={{ background: "var(--crit-dim)", color: "var(--gold-2)", textAlign: "center", fontWeight: 500, fontSize: 15, padding: 8, letterSpacing: 1 }}>{retEditing ? "New Yarn Return to Store" : "Yarn Return to Store"}</div>
            {retError && <div style={{ background: "#ef444422", borderBottom: "1px solid var(--crit)", padding: "8px 16px", color: "var(--crit)", fontSize: 13 }}>{retError}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: "1px solid var(--border)" }}>
              {[
                ["Return No.", retEditing ? "(auto)" : selRet?.return_number, "var(--gold-2)", null],
                ["Date", retEditing ? null : fmtDate(selRet?.return_date), null, "return_date"],
                ["Against Issue", retEditing ? null : selRet?.issue_number, null, "issue_id"],
                ["Machine", retEditing ? (returnableIssues.find(i => String(i.issue_id) === String(retHeader.issue_id))?.machine_name || "—") : selRet?.machine_name, null, null],
                ["Notes", retEditing ? null : (selRet?.notes || "—"), null, "notes"],
              ].map(([label, val, color, key], i) => (
                <div key={i} style={{ padding: "9px 14px", borderRight: (i + 1) % 4 !== 0 ? "1px solid var(--surface)" : "none", borderTop: i >= 4 ? "1px solid var(--surface)" : "none" }}>
                  <div style={{ color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 3, fontWeight: 700 }}>{label}</div>
                  {retEditing && key === "issue_id" ? (
                    <select value={retHeader.issue_id} onChange={e => pickIssue(e.target.value)} style={fieldInp}>
                      <option value="">— Select issue —</option>
                      {returnableIssues.map(i => <option key={i.issue_id} value={i.issue_id}>{i.issue_number} · {i.machine_name}</option>)}
                    </select>
                  ) : retEditing && key === "return_date" ? (
                    <input type="date" value={retHeader.return_date} onChange={e => setRetHeader(f => ({ ...f, return_date: e.target.value }))} style={fieldInp} />
                  ) : retEditing && key === "notes" ? (
                    <input value={retHeader.notes} onChange={e => setRetHeader(f => ({ ...f, notes: e.target.value }))} style={fieldInp} placeholder="Notes" />
                  ) : (
                    <div style={{ color: color || "var(--text)", fontSize: 14, fontWeight: 700, fontFamily: label === "Return No." ? "monospace" : "inherit", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{val || "—"}</div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ flex: 1, padding: "14px 16px" }}>
              <span style={{ color: "var(--muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Returned Lots ({retEditing ? retRows.filter(r => parseFloat(r.return_kg) > 0).length : retViewItems.length})</span>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: 8 }}>
                <thead>
                  <tr style={{ background: "var(--surface)" }}>
                    {(retEditing ? [["Sr", 34], ["Yarn", null], ["Lot No", 130], ["Colour", 90], ["Issued", 90], ["Already", 90], ["Remaining", 90], ["Return (kg)", 110]]
                      : [["Sr", 34], ["Yarn", null], ["Lot No", 140], ["Colour", 110], ["Returned (kg)", 120]]
                    ).map(([hh, w]) => <th key={hh} style={{ width: w || "auto", padding: "8px 10px", textAlign: (["Issued", "Already", "Remaining", "Return (kg)", "Returned (kg)"].includes(hh)) ? "right" : "left", color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, border: "1px solid var(--surface)" }}>{hh}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {retEditing ? (retRows.length ? retRows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ ...cell, color: "var(--muted)" }}>{i + 1}</td>
                      <td style={{ ...cell, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.item_name}</td>
                      <td style={{ ...cell, color: "var(--yellow)", fontFamily: "monospace" }}>{r.lot_number}</td>
                      <td style={{ ...cell, color: "var(--muted)" }}>{r.color || "—"}</td>
                      <td style={{ ...cell, textAlign: "right", color: "var(--muted)" }}>{r.issued.toFixed(3)}</td>
                      <td style={{ ...cell, textAlign: "right", color: "var(--muted)" }}>{r.already > 0 ? r.already.toFixed(3) : "—"}</td>
                      <td style={{ ...cell, textAlign: "right", color: r.remaining > 0 ? "var(--green)" : "var(--border)", fontWeight: 600 }}>{r.remaining.toFixed(3)}</td>
                      <td style={{ ...cell, padding: "3px 4px" }}>
                        {r.remaining > 0 ? (
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <input type="number" step="0.001" min="0" max={r.remaining} value={r.return_kg} onChange={e => setRetRows(rr => rr.map((x, idx) => idx === i ? { ...x, return_kg: e.target.value } : x))} style={{ ...cinp, textAlign: "right" }} placeholder="0.000" />
                            <button onClick={() => setRetRows(rr => rr.map((x, idx) => idx === i ? { ...x, return_kg: r.remaining.toFixed(3) } : x))} style={{ background: "var(--border)", color: "var(--link)", border: "none", borderRadius: 4, padding: "4px 6px", cursor: "pointer", fontSize: 10 }}>All</button>
                          </div>
                        ) : <span style={{ color: "var(--border)", fontSize: 11 }}>Fully returned</span>}
                      </td>
                    </tr>
                  )) : <tr><td colSpan={8} style={{ ...cell, textAlign: "center", color: "var(--border)", padding: 24 }}>Select an issue above to load its lots</td></tr>)
                  : retViewItems.map((it, i) => (
                    <tr key={it.id} style={{ background: i % 2 === 1 ? "var(--surface)" : "transparent" }}>
                      <td style={{ ...cell, color: "var(--muted)" }}>{i + 1}</td>
                      <td style={{ ...cell, color: "var(--yellow)", fontWeight: 700 }}>{it.item_name}</td>
                      <td style={{ ...cell, color: "var(--muted)", fontFamily: "monospace" }}>{it.supplier_lot_no || it.lot_number}</td>
                      <td style={{ ...cell, color: "var(--muted)" }}>{it.color || "—"}</td>
                      <td style={{ ...cell, color: "var(--green)", textAlign: "right", fontWeight: 700 }}>{fmtKg(it.returned_kg)}</td>
                    </tr>
                  ))}
                  {retEditing && (
                    <tr style={{ background: "var(--surface)" }}>
                      <td colSpan={7} style={{ ...cell, color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>TOTAL RETURNING</td>
                      <td style={{ ...cell, color: "var(--gold-2)", fontWeight: 700, textAlign: "right" }}>{retTotal > 0 ? retTotal.toFixed(3) : "—"}</td>
                    </tr>
                  )}
                  {!retEditing && (
                    <tr style={{ background: "var(--surface)" }}>
                      <td colSpan={4} style={{ ...cell, color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>TOTAL</td>
                      <td style={{ ...cell, color: "var(--green)", fontWeight: 700, textAlign: "right" }}>{parseFloat(selRet?.total_kg || 0).toFixed(3)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
              {retEditing ? (<>
                <button onClick={saveReturn} disabled={retSaving} style={{ background: retSaving ? "var(--crit-dim)" : "var(--gold)", color: "var(--bg)", border: "none", padding: "8px 22px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>{retSaving ? "Saving..." : "💾 Save Return"}</button>
                <button onClick={cancelRetEntry} style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>✕ Cancel</button>
              </>) : (
                <button onClick={startNewReturn} style={{ background: "var(--green)", color: "var(--bg)", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>+ Add</button>
              )}
            </div>
          </div>
        )}
      </>)}
    </div>

    {printing && selected && <PrintChallan type="YARN_ISSUE" data={selected} onClose={() => setPrinting(false)} />}
    </>
  );
}
