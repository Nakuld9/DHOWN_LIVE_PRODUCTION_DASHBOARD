import React, { useState, useEffect, useCallback, useMemo } from "react";
import PrintChallan from "../components/PrintChallan";

const API = "";
const token = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token()}` });

const STATUS_COLORS = { DRAFT: "var(--gold)", APPROVED: "var(--green)", REJECTED: "var(--crit)", CANCELLED: "var(--crit)" };
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—";
const fmtKg = (v) => v != null ? parseFloat(v).toFixed(3) : "—";

const cell = { padding: "6px 8px", border: "1px solid var(--surface)", fontSize: 12 };
const cinp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, padding: "5px 7px", color: "var(--text)", fontSize: 12, boxSizing: "border-box" };
const fieldInp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, padding: "5px 8px", color: "var(--text)", fontSize: 13, boxSizing: "border-box" };

const emptyLot = () => ({ lot_id: null, yarn_type: "", supplier_lot_no: "", brand: "", color: "", count: "", location: "", cones: "", net_weight_kg: "", rate_per_kg: "" });
const emptyHeader = () => ({ supplier_name: "", supplier_invoice: "", receipt_date: new Date().toISOString().slice(0, 10), vehicle_number: "", received_by: "", notes: "" });

export default function GRN() {
  const [grns,         setGrns]         = useState([]);
  const [selected,     setSelected]     = useState(null);
  const [printing,     setPrinting]     = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');
  const [yarnItems,    setYarnItems]    = useState([]);
  const [partners,     setPartners]     = useState([]);
  const [saving,       setSaving]       = useState(false);

  // mode: 'view' | 'new' | 'edit'
  const [mode,   setMode]   = useState("view");
  const [header, setHeader] = useState(emptyHeader());
  const [lots,   setLots]   = useState([emptyLot()]);

  const itemNameMap = useMemo(() => Object.fromEntries((yarnItems || []).map(i => [i.item_code, i.item_name])), [yarnItems]);
  const cityMap     = useMemo(() => Object.fromEntries((partners || []).map(p => [p.company_name, p.city])), [partners]);

  const loadYarnItems = useCallback(async () => {
    try { const r = await fetch(`${API}/api/erp/items?category=YARN&limit=200&status=ACTIVE`, { headers: h() }); const j = await r.json(); setYarnItems(j.data || j || []); } catch {}
  }, []);
  const loadPartners = useCallback(async () => {
    try { const r = await fetch(`${API}/api/erp/partners?role=SUPPLIER&active=true&limit=200`, { headers: h() }); const j = await r.json(); setPartners(j.data || j || []); } catch {}
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo)   params.set('to', dateTo);
      const url = `${API}/api/grn${params.toString() ? `?${params}` : ''}`;
      const r = await fetch(url, { headers: h() });
      const j = await r.json();
      setGrns(j.data || []);
    } catch {}
    setLoading(false);
  }, [statusFilter, dateFrom, dateTo]);

  useEffect(() => { load(); loadYarnItems(); loadPartners(); }, [load, loadYarnItems, loadPartners]);

  const loadDetail = async (id) => {
    const r = await fetch(`${API}/api/grn/${id}`, { headers: h() });
    const j = await r.json();
    setSelected(j);
    setMode("view");
  };

  useEffect(() => {
    if (mode === "view" && !selected && grns.length > 0) loadDetail(grns[0].grn_id);
  }, [grns]); // eslint-disable-line

  const docIdx = grns.findIndex(g => g.grn_id === selected?.grn_id);
  const navTo  = (i) => { if (i >= 0 && i < grns.length) loadDetail(grns[i].grn_id); };

  // ── Add / Edit ──
  const startNew = () => {
    setSelected(null); setHeader(emptyHeader()); setLots([emptyLot()]); setMode("new");
  };
  const startEdit = () => {
    if (!selected) return;
    setHeader({ supplier_name: selected.supplier_name || "", supplier_invoice: selected.supplier_invoice || "", receipt_date: selected.receipt_date?.slice(0, 10) || "", vehicle_number: selected.vehicle_number || "", received_by: selected.received_by || "", notes: selected.notes || "" });
    setLots((selected.lots || []).map(l => ({ lot_id: l.lot_id, yarn_type: l.yarn_type || "", supplier_lot_no: l.supplier_lot_no || l.lot_number || "", brand: l.brand || "", color: l.color || "", count: l.count || "", location: l.location || "", cones: l.cones || "", net_weight_kg: l.net_weight_kg || "", rate_per_kg: l.rate_per_kg || "" })));
    if (!(selected.lots || []).length) setLots([emptyLot()]);
    setMode("edit");
  };
  const cancelEdit = () => {
    setMode("view");
    if (selected) loadDetail(selected.grn_id);
    else if (grns.length) loadDetail(grns[0].grn_id);
  };

  const setLot = (idx, field, value) => setLots(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  const addLotRow = () => setLots(prev => [...prev, emptyLot()]);
  const removeLotRow = (idx) => setLots(prev => prev.length === 1 ? [emptyLot()] : prev.filter((_, i) => i !== idx));

  const save = async () => {
    if (!header.supplier_name) { alert("Select a supplier"); return; }
    const filled = lots.filter(l => l.yarn_type && l.net_weight_kg);
    if (!filled.length) { alert("Add at least one item with weight"); return; }
    setSaving(true);
    try {
      let grnId;
      if (mode === "new") {
        const r = await fetch(`${API}/api/grn`, { method: "POST", headers: h(), body: JSON.stringify(header) });
        if (!r.ok) { const e = await r.json(); alert(e.error || "Failed"); setSaving(false); return; }
        const created = await r.json();
        grnId = created.grn_id || created.id;
        for (const lot of filled) await fetch(`${API}/api/grn/${grnId}/lots`, { method: "POST", headers: h(), body: JSON.stringify(lot) });
      } else {
        grnId = selected.grn_id;
        await fetch(`${API}/api/grn/${grnId}`, { method: "PUT", headers: h(), body: JSON.stringify(header) });
        // Reconcile lots: delete removed, add new (edited = delete+add)
        const origIds = (selected.lots || []).map(l => l.lot_id);
        const keepIds = filled.filter(l => l.lot_id).map(l => l.lot_id);
        for (const oid of origIds) if (!keepIds.includes(oid)) await fetch(`${API}/api/grn/${grnId}/lots/${oid}`, { method: "DELETE", headers: h() });
        for (const lot of filled) {
          if (lot.lot_id) { await fetch(`${API}/api/grn/${grnId}/lots/${lot.lot_id}`, { method: "DELETE", headers: h() }); }
          await fetch(`${API}/api/grn/${grnId}/lots`, { method: "POST", headers: h(), body: JSON.stringify(lot) });
        }
      }
      await load();
      await loadDetail(grnId);
      setMode("view");
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const approve = async (id) => { await fetch(`${API}/api/grn/${id}/approve`, { method: "PUT", headers: h() }); if (selected?.grn_id === id) loadDetail(id); load(); };
  const delGrn  = async () => { if (!window.confirm("DELETE this DRAFT GRN? Number will be freed.")) return; await fetch(`${API}/api/grn/${selected.grn_id}`, { method: "DELETE", headers: h() }); setSelected(null); await load(); };
  const cancelGrn = async () => { if (!window.confirm("CANCEL this GRN? Number stays, stock reversed.")) return; const r = await fetch(`${API}/api/grn/${selected.grn_id}/cancel`, { method: "PUT", headers: h() }); if (!r.ok) { const e = await r.json(); alert(e.error); return; } loadDetail(selected.grn_id); load(); };

  const editing = mode === "new" || mode === "edit";
  const viewLots  = selected?.lots || [];
  const gridLots  = editing ? lots : viewLots;
  const totalNet  = gridLots.reduce((s, l) => s + parseFloat(l.net_weight_kg || 0), 0);
  const totalVal  = gridLots.reduce((s, l) => s + parseFloat(l.net_weight_kg || 0) * parseFloat(l.rate_per_kg || 0), 0);
  const totalPkgs = gridLots.reduce((s, l) => s + parseInt(l.cones || 0), 0);
  const totalCount= editing ? lots.filter(l => l.yarn_type && l.net_weight_kg).length : viewLots.length;

  const HEADER_FIELDS = editing ? [
    ["GRN No.", editing && mode === "new" ? "(auto)" : selected?.grn_number, "var(--yellow)", null],
    ["Date", null, null, "receipt_date"],
    ["Party Name", null, null, "supplier_name"],
    ["City", cityMap[header.supplier_name] || "—", null, null],
    ["Invoice No.", null, null, "supplier_invoice"],
    ["Vehicle", null, null, "vehicle_number"],
    ["Received By", null, null, "received_by"],
    ["Remarks", null, null, "notes"],
  ] : [
    ["GRN No.", selected?.grn_number, "var(--yellow)"],
    ["Date", fmtDate(selected?.receipt_date)],
    ["Party Name", selected?.supplier_name],
    ["City", cityMap[selected?.supplier_name] || "—"],
    ["Invoice No.", selected?.supplier_invoice || "—"],
    ["Vehicle", selected?.vehicle_number || "—"],
    ["Received By", selected?.received_by || "—"],
    ["Status", selected?.status, STATUS_COLORS[selected?.status]],
  ];

  const show = editing || selected;

  return (
    <>
    <div style={{ padding: 20, color: "var(--text)", fontFamily: "Inter, sans-serif" }}>

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: "var(--yellow)", fontSize: 24 }}>Goods Receipt Notes</h2>
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>Yarn & Raw Material Inward Register</div>
      </div>

      {/* Navigator bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", flexWrap: "wrap", opacity: editing ? 0.5 : 1, pointerEvents: editing ? "none" : "auto" }}>
        <button onClick={startNew} style={{ background: "var(--green)", color: "var(--bg)", border: "none", padding: "7px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>+ Add</button>
        <span style={{ color: "var(--muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>GRN</span>
        <select value={selected?.grn_id || ""} onChange={e => e.target.value && loadDetail(e.target.value)}
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--yellow)", borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "monospace", fontWeight: 700, minWidth: 300 }}>
          <option value="">— List View ({grns.length}) —</option>
          {grns.map(g => <option key={g.grn_id} value={g.grn_id}>{g.grn_number} · {g.supplier_name} · {g.receipt_date?.slice(0, 10)} · {g.status}</option>)}
        </select>
        {selected && !editing && docIdx >= 0 && <span style={{ color: "var(--muted)", fontSize: 12 }}>{grns.length - docIdx} / {grns.length}</span>}
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          <button onClick={() => navTo(grns.length - 1)} disabled={docIdx < 0 || docIdx >= grns.length - 1} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: docIdx >= grns.length - 1 ? "var(--surface-2)" : "var(--link)", padding: "7px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>⏮ First</button>
          <button onClick={() => navTo(docIdx + 1)} disabled={docIdx < 0 || docIdx >= grns.length - 1} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: docIdx >= grns.length - 1 ? "var(--surface-2)" : "var(--link)", padding: "7px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>◀ Previous</button>
          <button onClick={() => navTo(docIdx - 1)} disabled={docIdx <= 0} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: docIdx <= 0 ? "var(--surface-2)" : "var(--link)", padding: "7px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Next ▶</button>
          <button onClick={() => navTo(0)} disabled={!grns.length} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--gold-2)", padding: "7px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Last ⏭</button>
        </div>
      </div>

      {loading && !show ? <div style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>Loading...</div>
        : !show && grns.length === 0 ? <div style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>No GRNs yet — click + New GRN to create the first one.</div>
        : !show ? <div style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>Select a GRN from List View, or use ⏭ Last for the latest.</div>
        : null}

      {/* ── Document card (view + inline entry) ── */}
      {show && (
        <div style={{ background: "var(--surface)", border: `1px solid ${editing ? "var(--yellow)" : "var(--border)"}`, borderRadius: 12, overflow: "hidden", minHeight: 460, display: "flex", flexDirection: "column" }}>

          <div style={{ background: "var(--surface)", color: "var(--yellow)", textAlign: "center", fontWeight: 500, fontSize: 15, padding: 8, letterSpacing: 1 }}>
            {mode === "new" ? "New Goods Receipt Note" : mode === "edit" ? "Edit Goods Receipt Note" : "Goods Receipt Note"}
          </div>

          {/* Header field grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: "1px solid var(--border)" }}>
            {HEADER_FIELDS.map(([label, val, color, key], i) => (
              <div key={label} style={{ padding: "9px 14px", borderRight: (i + 1) % 4 !== 0 ? "1px solid var(--surface)" : "none", borderTop: i >= 4 ? "1px solid var(--surface)" : "none" }}>
                <div style={{ color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 3, fontWeight: 700 }}>{label}</div>
                {editing && key === "supplier_name" ? (
                  <select value={header.supplier_name} onChange={e => setHeader(f => ({ ...f, supplier_name: e.target.value }))} style={fieldInp}>
                    <option value="">— Select —</option>
                    {partners.map(p => <option key={p.partner_id} value={p.company_name}>{p.company_name}</option>)}
                  </select>
                ) : editing && key === "receipt_date" ? (
                  <input type="date" value={header.receipt_date} onChange={e => setHeader(f => ({ ...f, receipt_date: e.target.value }))} style={fieldInp} />
                ) : editing && key ? (
                  <input value={header[key]} onChange={e => setHeader(f => ({ ...f, [key]: e.target.value }))} style={fieldInp} placeholder={label} />
                ) : (
                  <div style={{ color: color || "var(--text)", fontSize: 14, fontWeight: 700, fontFamily: label === "GRN No." ? "monospace" : "inherit", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{val || "—"}</div>
                )}
              </div>
            ))}
          </div>

          {/* Items grid */}
          <div style={{ flex: 1, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ color: "var(--muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Items ({totalCount})</span>
              {editing && <button onClick={addLotRow} style={{ background: "var(--border)", color: "var(--yellow)", border: "1px solid var(--gold)", borderRadius: 5, padding: "5px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>+ Add Row</button>}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead>
                <tr style={{ background: "var(--surface)" }}>
                  {[["Sr", 34], ["Item Name", null], ["Colour / Shade", 110], ["Lot No", 90], ["Brand", 90], ["Boxes", 70], ["Weight (kg)", 95], ["Rate", 70], ["Amount", 90], editing ? ["", 30] : null].filter(Boolean).map(([hh, w]) => (
                    <th key={hh} style={{ width: w || "auto", padding: "8px 10px", textAlign: (hh === "Weight (kg)" || hh === "Rate" || hh === "Amount" || hh === "Boxes") ? "right" : "left", color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, border: "1px solid var(--surface)" }}>{hh}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {editing ? lots.map((lot, i) => {
                  const val = parseFloat(lot.net_weight_kg || 0) * parseFloat(lot.rate_per_kg || 0);
                  return (
                    <tr key={i}>
                      <td style={{ ...cell, color: "var(--muted)" }}>{i + 1}</td>
                      <td style={{ ...cell, padding: "3px 4px" }}>
                        <select value={lot.yarn_type} onChange={e => setLot(i, "yarn_type", e.target.value)} style={cinp}>
                          <option value="">— Select yarn —</option>
                          {yarnItems.map(it => <option key={it.item_id} value={it.item_code}>{it.item_name}</option>)}
                        </select>
                      </td>
                      <td style={{ ...cell, padding: "3px 4px" }}><input value={lot.color} onChange={e => setLot(i, "color", e.target.value)} style={cinp} placeholder="Grey" /></td>
                      <td style={{ ...cell, padding: "3px 4px" }}><input value={lot.supplier_lot_no} onChange={e => setLot(i, "supplier_lot_no", e.target.value)} style={cinp} placeholder="Lot" /></td>
                      <td style={{ ...cell, padding: "3px 4px" }}><input value={lot.brand} onChange={e => setLot(i, "brand", e.target.value)} style={cinp} placeholder="Brand" /></td>
                      <td style={{ ...cell, padding: "3px 4px" }}><input type="number" value={lot.cones} onChange={e => setLot(i, "cones", e.target.value)} style={{ ...cinp, textAlign: "right" }} placeholder="0" /></td>
                      <td style={{ ...cell, padding: "3px 4px" }}><input type="number" step="0.001" value={lot.net_weight_kg} onChange={e => setLot(i, "net_weight_kg", e.target.value)} style={{ ...cinp, textAlign: "right" }} placeholder="0.000" /></td>
                      <td style={{ ...cell, padding: "3px 4px" }}><input type="number" step="0.01" value={lot.rate_per_kg} onChange={e => setLot(i, "rate_per_kg", e.target.value)} style={{ ...cinp, textAlign: "right" }} placeholder="0" /></td>
                      <td style={{ ...cell, color: "var(--pink)", textAlign: "right" }}>{val > 0 ? val.toFixed(2) : "—"}</td>
                      <td style={{ ...cell, padding: "3px 4px", textAlign: "center" }}><button onClick={() => removeLotRow(i)} style={{ background: "transparent", border: "none", color: "var(--crit)", cursor: "pointer", fontSize: 15 }}>×</button></td>
                    </tr>
                  );
                }) : viewLots.map((lot, i) => {
                  const val = parseFloat(lot.net_weight_kg || 0) * parseFloat(lot.rate_per_kg || 0);
                  return (
                    <tr key={lot.lot_id} style={{ background: i % 2 === 1 ? "var(--surface)" : "transparent" }}>
                      <td style={{ ...cell, color: "var(--muted)" }}>{i + 1}</td>
                      <td style={{ ...cell, color: "var(--yellow)", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{itemNameMap[lot.yarn_type] || lot.yarn_type}</td>
                      <td style={{ ...cell, color: "var(--pink)" }}>{lot.color || "—"}</td>
                      <td style={{ ...cell, color: "var(--muted)", fontFamily: "monospace" }}>{lot.supplier_lot_no || lot.lot_number || "—"}</td>
                      <td style={{ ...cell, color: "var(--muted)" }}>{lot.brand || "—"}</td>
                      <td style={{ ...cell, color: "var(--purple)", textAlign: "right" }}>{lot.cones || "—"}</td>
                      <td style={{ ...cell, color: "var(--green-2)", fontWeight: 700, textAlign: "right" }}>{fmtKg(lot.net_weight_kg)}</td>
                      <td style={{ ...cell, color: "var(--muted)", textAlign: "right" }}>{lot.rate_per_kg ? parseFloat(lot.rate_per_kg).toFixed(2) : "—"}</td>
                      <td style={{ ...cell, color: "var(--pink)", textAlign: "right" }}>{val > 0 ? val.toFixed(2) : "—"}</td>
                    </tr>
                  );
                })}
                {!editing && Array.from({ length: Math.max(0, 6 - viewLots.length) }).map((_, i) => (
                  <tr key={`b${i}`} style={{ background: (viewLots.length + i) % 2 === 1 ? "var(--surface)" : "transparent" }}>
                    {Array.from({ length: 9 }).map((__, j) => <td key={j} style={{ ...cell }}>&nbsp;</td>)}
                  </tr>
                ))}
                <tr style={{ background: "var(--surface)" }}>
                  <td colSpan={5} style={{ ...cell, color: "var(--muted)", fontWeight: 700, textAlign: "right" }}>TOTAL — {totalCount} lot(s)</td>
                  <td style={{ ...cell, color: "var(--purple)", fontWeight: 700, textAlign: "right" }}>{totalPkgs || "—"}</td>
                  <td style={{ ...cell, color: "var(--green-2)", fontWeight: 700, textAlign: "right" }}>{totalNet.toFixed(3)}</td>
                  <td style={{ ...cell }}></td>
                  <td style={{ ...cell, color: "var(--pink)", fontWeight: 700, textAlign: "right" }}>{totalVal > 0 ? totalVal.toFixed(2) : "—"}</td>
                  {editing && <td style={{ ...cell }}></td>}
                </tr>
              </tbody>
            </table>
            {!editing && selected?.notes && (
              <div style={{ marginTop: 12, background: "var(--surface)", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "var(--muted)" }}>
                <span style={{ color: "var(--muted)", fontSize: 10, textTransform: "uppercase" }}>Remarks: </span>{selected.notes}
              </div>
            )}
          </div>

          {/* Bottom button strip */}
          <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--border)", background: "var(--surface)", flexWrap: "wrap" }}>
            {editing ? (<>
              <button onClick={save} disabled={saving} style={{ background: saving ? "var(--green-dim)" : "var(--green)", color: "var(--bg)", border: "none", padding: "8px 22px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>{saving ? "Saving..." : "💾 Save"}</button>
              <button onClick={cancelEdit} style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>✕ Cancel</button>
            </>) : (<>
              <button onClick={startNew} style={{ background: "var(--green)", color: "var(--bg)", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>+ Add</button>
              <button onClick={selected?.status === "DRAFT" ? startEdit : () => alert("Only DRAFT GRNs can be edited. Cancel the approved GRN first to make changes.")}
                style={{ background: "var(--link)", color: "var(--text)", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, opacity: selected?.status === "DRAFT" ? 1 : 0.6 }}>✎ Edit</button>
              <button onClick={selected?.status === "APPROVED" ? cancelGrn : delGrn}
                style={{ background: "var(--crit)", color: "var(--text)", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🗑 Delete</button>
              {selected?.status === "DRAFT" && <button onClick={() => approve(selected.grn_id)} style={{ background: "var(--green)", color: "var(--text)", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✓ Approve</button>}
              <button onClick={() => setPrinting(true)} style={{ background: "var(--border)", color: "var(--link)", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🖨 Print</button>
            </>)}
          </div>
        </div>
      )}
    </div>

    {printing && selected && <PrintChallan type="GRN" data={selected} onClose={() => setPrinting(false)} />}
    </>
  );
}
