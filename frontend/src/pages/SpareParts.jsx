import React, { useEffect, useState, useCallback } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });
const fmtDate = d => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-') : "—";

const MOVES = { RECEIVED: "var(--green)", CONSUMED: "var(--crit)", ADJUSTMENT: "var(--gold)", RETURNED: "var(--link)" };
const inp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 11px", color: "var(--text)", fontSize: 14, boxSizing: "border-box", marginBottom: 10 };
const lbl = { color: "var(--muted)", fontSize: 12, marginBottom: 4, display: "block" };
const emptyPart = () => ({ part_name: "", sku: "", category: "GENERAL", unit: "pcs", min_stock: 0, current_stock: 0, location: "", notes: "" });
const emptyMv = (type = "RECEIVED") => ({ movement_type: type, quantity: "", reference: "", notes: "", unit_cost: "", gst_rate: 18, supplier: "", machine_id: "" });
const inr = (n) => n == null || n === "" ? "—" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

// Small inline row to add a line to an already-saved receipt.
function AddLineRow({ parts, onAdd }) {
  const [pid, setPid] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const go = () => { if (!pid || !(Number(qty) > 0)) { alert("Pick a part and quantity"); return; } onAdd(pid, qty, cost); setPid(""); setQty(""); setCost(""); };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
      <select style={{ ...inp, marginBottom: 0, flex: 1 }} value={pid} onChange={e => setPid(e.target.value)}>
        <option value="">+ Add line…</option>
        {parts.map(p => <option key={p.id} value={p.id}>{p.part_name}</option>)}
      </select>
      <input style={{ ...inp, marginBottom: 0, width: 90 }} type="number" step="0.01" placeholder="qty" value={qty} onChange={e => setQty(e.target.value)} />
      <input style={{ ...inp, marginBottom: 0, width: 100 }} type="number" step="0.01" placeholder="₹/unit" value={cost} onChange={e => setCost(e.target.value)} />
      <button onClick={go} style={{ background: "var(--green)", color: "var(--bg)", border: "none", padding: "9px 14px", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Add</button>
    </div>
  );
}

export default function SpareParts() {
  const [parts, setParts] = useState([]);
  const [machines, setMachines] = useState([]);
  const [lowOnly, setLowOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyPart());
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(null); // part being moved
  const [mv, setMv] = useState(emptyMv());
  const [history, setHistory] = useState(null); // {part, rows}
  const [view, setView] = useState("inventory"); // inventory | purchases
  const [grns, setGrns] = useState([]);
  const [newRec, setNewRec] = useState(null);    // create-receipt draft
  const [openRec, setOpenRec] = useState(null);  // opened receipt {…header, lines}

  const load = useCallback(async () => {
    try { const r = await fetch(`${API}/api/spare-parts${lowOnly ? "?low=1" : ""}`, { headers: h() }); setParts(await r.json()); } catch {}
  }, [lowOnly]);
  useEffect(() => { load(); }, [load]);

  const loadGrns = useCallback(async () => {
    try { const r = await fetch(`${API}/api/spare-parts/grn`, { headers: h() }); setGrns(await r.json()); } catch {}
  }, []);
  useEffect(() => { if (view === "purchases") loadGrns(); }, [view, loadGrns]);

  const emptyRec = () => ({ grn_date: new Date().toISOString().slice(0, 10), supplier: "", reference: "", notes: "", lines: [{ part_id: "", quantity: "", unit_cost: "", gst_rate: 18 }] });
  const recSub = (lines) => (lines || []).reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);
  const recGst = (lines) => (lines || []).reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0) * ((Number(l.gst_rate) || 0) / 100), 0);
  const recGrand = (lines) => recSub(lines) + recGst(lines);

  const saveNewRec = async () => {
    const lines = newRec.lines.filter(l => l.part_id && Number(l.quantity) > 0);
    if (!lines.length) { alert("Add at least one part with a quantity"); return; }
    const r = await fetch(`${API}/api/spare-parts/grn`, { method: "POST", headers: h(), body: JSON.stringify({ ...newRec, lines }) });
    if (!r.ok) { const e = await r.json(); alert(e.error || "Failed"); return; }
    setNewRec(null); loadGrns(); load();
  };
  const openReceipt = async (id) => {
    try { const r = await fetch(`${API}/api/spare-parts/grn/${id}`, { headers: h() }); setOpenRec(await r.json()); } catch {}
  };
  const saveGrnHeader = async () => {
    const r = await fetch(`${API}/api/spare-parts/grn/${openRec.id}`, { method: "PUT", headers: h(), body: JSON.stringify({ grn_date: openRec.grn_date, supplier: openRec.supplier, reference: openRec.reference, notes: openRec.notes }) });
    if (!r.ok) { const e = await r.json(); alert(e.error || "Failed"); return; }
    loadGrns();
  };
  const saveLine = async (line) => {
    const r = await fetch(`${API}/api/spare-parts/purchases/${line.id}`, { method: "PUT", headers: h(), body: JSON.stringify({ quantity: line.quantity, unit_cost: line.unit_cost, gst_rate: line.gst_rate }) });
    if (!r.ok) { const e = await r.json(); alert(e.error || "Failed"); return; }
    openReceipt(openRec.id); loadGrns(); load();
  };
  const delLine = async (lineId) => {
    if (!window.confirm("Remove this line? Stock will be reversed.")) return;
    const r = await fetch(`${API}/api/spare-parts/purchases/${lineId}`, { method: "DELETE", headers: h() });
    if (!r.ok) { const e = await r.json(); alert(e.error || "Failed"); return; }
    openReceipt(openRec.id); loadGrns(); load();
  };
  const addLine = async (part_id, quantity, unit_cost) => {
    const r = await fetch(`${API}/api/spare-parts/grn/${openRec.id}/line`, { method: "POST", headers: h(), body: JSON.stringify({ part_id, quantity, unit_cost }) });
    if (!r.ok) { const e = await r.json(); alert(e.error || "Failed"); return; }
    openReceipt(openRec.id); loadGrns(); load();
  };
  const delGrn = async (id) => {
    if (!window.confirm("Delete this whole receipt? All its stock will be reversed.")) return;
    const r = await fetch(`${API}/api/spare-parts/grn/${id}`, { method: "DELETE", headers: h() });
    if (!r.ok) { const e = await r.json(); alert(e.error || "Failed"); return; }
    setOpenRec(null); loadGrns(); load();
  };
  useEffect(() => { (async () => { try { const r = await fetch(`${API}/api/machines`, { headers: h() }); const d = await r.json(); setMachines(Array.isArray(d) ? d : []); } catch {} })(); }, []);

  // Open the movement modal preset to receive (purchase) or issue (to a machine).
  const openMove = (p, type) => { setMoving(p); setMv(emptyMv(type)); };

  const openNew = () => { setForm(emptyPart()); setEditId(null); setShowForm(true); };
  const openEdit = (p) => { setForm({ ...p }); setEditId(p.id); setShowForm(true); };

  const save = async () => {
    if (!form.part_name) { alert("Part name is required"); return; }
    setSaving(true);
    try {
      const url = editId ? `${API}/api/spare-parts/${editId}` : `${API}/api/spare-parts`;
      const r = await fetch(url, { method: editId ? "PUT" : "POST", headers: h(), body: JSON.stringify(form) });
      if (!r.ok) { const e = await r.json(); alert(e.error || "Failed"); setSaving(false); return; }
      setShowForm(false); await load();
    } catch { alert("Network error"); }
    setSaving(false);
  };

  const del = async (id) => {
    if (!window.confirm("Delete this spare part?")) return;
    const r = await fetch(`${API}/api/spare-parts/${id}`, { method: "DELETE", headers: h() });
    if (!r.ok) { const e = await r.json(); alert(e.error); return; }
    load();
  };

  const submitMove = async () => {
    if (mv.quantity === "" || parseFloat(mv.quantity) < 0) { alert("Enter a valid quantity"); return; }
    let r;
    if (mv.movement_type === "RECEIVED") {
      // A single receive is a one-line receipt document, so it shows in the navigator.
      r = await fetch(`${API}/api/spare-parts/grn`, { method: "POST", headers: h(), body: JSON.stringify({
        supplier: mv.supplier, reference: mv.reference, notes: mv.notes,
        lines: [{ part_id: moving.id, quantity: mv.quantity, unit_cost: mv.unit_cost, gst_rate: mv.gst_rate }],
      }) });
    } else {
      // Value an issue at the part's stock cost so per-machine spend is populated.
      const payload = { ...mv };
      if (mv.movement_type === "CONSUMED" && (mv.unit_cost === "" || mv.unit_cost == null)) payload.unit_cost = moving.avg_cost || moving.last_unit_cost || "";
      r = await fetch(`${API}/api/spare-parts/${moving.id}/movements`, { method: "POST", headers: h(), body: JSON.stringify(payload) });
    }
    if (!r.ok) { const e = await r.json(); alert(e.error || "Failed"); return; }
    setMoving(null); setMv(emptyMv()); load();
  };

  const openHistory = async (p) => {
    try { const r = await fetch(`${API}/api/spare-parts/${p.id}/movements`, { headers: h() }); setHistory({ part: p, rows: await r.json() }); } catch {}
  };

  const lowCount = parts.filter(p => p.is_low).length;

  return (
    <div style={{ padding: 20, color: "var(--text)", minHeight: "100vh", fontFamily: "Inter, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, color: "var(--yellow)", fontSize: 24 }}>Spare Parts Inventory</h2>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>Stock levels · receive / consume / adjust · low-stock alerts</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setLowOnly(v => !v)} style={{ background: lowOnly ? "var(--crit)" : "var(--surface)", color: lowOnly ? "#fff" : "var(--crit)", border: "1px solid var(--crit-dim)", padding: "9px 14px", borderRadius: 7, cursor: "pointer", fontWeight: 600 }}>⚠ Low Stock{!lowOnly && lowCount ? ` (${lowCount})` : ""}</button>
          <button onClick={openNew} style={{ background: "var(--green)", color: "var(--bg)", border: "none", padding: "9px 18px", borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>+ Add Part</button>
        </div>
      </div>

      {/* Inventory / Receipts tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, borderBottom: "1px solid var(--border)", alignItems: "center" }}>
        {[["inventory", "Inventory"], ["purchases", "Receipts"]].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)} style={{ background: "transparent", border: "none", borderBottom: view === k ? "2px solid var(--yellow)" : "2px solid transparent", color: view === k ? "var(--text)" : "var(--muted)", padding: "9px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: -1 }}>{label}</button>
        ))}
        {view === "purchases" && <button onClick={() => setNewRec(emptyRec())} style={{ marginLeft: "auto", marginBottom: 6, background: "var(--green)", color: "var(--bg)", border: "none", padding: "8px 16px", borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>+ New Receipt</button>}
      </div>

      {view === "inventory" && (parts.length === 0 ? (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: 50 }}>No spare parts. Click + Add Part.</div>
      ) : (
        <div style={{ overflowX: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
            <thead>
              <tr style={{ background: "var(--surface)", color: "var(--muted)", textAlign: "left" }}>
                {["Part", "Category", "Stock", "Unit Cost", "Stock Value", "Location", "Actions"].map(c => <th key={c} style={{ padding: "10px 12px" }}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {parts.map(p => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--surface)", background: p.is_low ? "var(--crit-dim)" : "transparent" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>{p.part_name}{p.sku ? <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 11 }}> · {p.sku}</span> : null}</td>
                  <td style={{ padding: "10px 12px", color: "var(--link)" }}>{p.category}</td>
                  <td style={{ padding: "10px 12px", fontWeight: 700, color: p.is_low ? "var(--crit)" : "var(--green)" }}>{p.current_stock} {p.unit}{p.is_low && " ⚠"}</td>
                  <td style={{ padding: "10px 12px", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{inr(p.last_unit_cost)}</td>
                  <td style={{ padding: "10px 12px", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{p.last_unit_cost ? inr(Number(p.current_stock) * Number(p.avg_cost || p.last_unit_cost)) : "—"}</td>
                  <td style={{ padding: "10px 12px", color: "var(--muted)" }}>{p.location || "—"}</td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    <button onClick={() => openMove(p, "RECEIVED")} style={{ background: "var(--green)", color: "var(--bg)", border: "none", padding: "5px 10px", borderRadius: 5, cursor: "pointer", fontSize: 11, marginRight: 5, fontWeight: 700 }}>+ Buy</button>
                    <button onClick={() => openMove(p, "CONSUMED")} style={{ background: "var(--link)", color: "var(--text)", border: "none", padding: "5px 10px", borderRadius: 5, cursor: "pointer", fontSize: 11, marginRight: 5 }}>→ Issue</button>
                    <button onClick={() => openHistory(p)} style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", padding: "5px 10px", borderRadius: 5, cursor: "pointer", fontSize: 11, marginRight: 5 }}>History</button>
                    <button onClick={() => openEdit(p)} style={{ background: "transparent", color: "var(--yellow)", border: "1px solid var(--crit-dim)", padding: "5px 10px", borderRadius: 5, cursor: "pointer", fontSize: 11, marginRight: 5 }}>Edit</button>
                    <button onClick={() => del(p.id)} style={{ background: "transparent", color: "var(--crit)", border: "1px solid var(--crit-dim)", padding: "5px 9px", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Receipts document navigator */}
      {view === "purchases" && (
        <div style={{ overflowX: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
          {grns.length === 0 ? (
            <div style={{ color: "var(--muted)", textAlign: "center", padding: 50 }}>No receipts yet. Click <b>+ New Receipt</b> to receive multiple parts, or <b>+ Buy</b> a single part in Inventory.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
              <thead>
                <tr style={{ background: "var(--surface)", color: "var(--muted)", textAlign: "left" }}>
                  {["Receipt #", "Date", "Supplier", "Items", "Total ₹ (incl GST)", "Ref", "Actions"].map(c => <th key={c} style={{ padding: "10px 12px" }}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {grns.map(g => (
                  <tr key={g.id} style={{ borderTop: "1px solid var(--surface)", cursor: "pointer" }} onClick={() => openReceipt(g.id)}>
                    <td style={{ padding: "10px 12px", fontWeight: 700, color: "var(--yellow)" }}>{g.grn_no}</td>
                    <td style={{ padding: "10px 12px", color: "var(--muted)", whiteSpace: "nowrap" }}>{g.grn_date ? new Date(g.grn_date).toLocaleDateString("en-GB") : "—"}</td>
                    <td style={{ padding: "10px 12px" }}>{g.supplier || "—"}</td>
                    <td style={{ padding: "10px 12px", fontVariantNumeric: "tabular-nums" }}>{g.line_count}</td>
                    <td style={{ padding: "10px 12px", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{inr(g.total_amount)}</td>
                    <td style={{ padding: "10px 12px", color: "var(--muted)" }}>{g.reference || "—"}</td>
                    <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                      <button onClick={(e) => { e.stopPropagation(); openReceipt(g.id); }} style={{ background: "transparent", color: "var(--yellow)", border: "1px solid var(--crit-dim)", padding: "5px 10px", borderRadius: 5, cursor: "pointer", fontSize: 11, marginRight: 5 }}>Open</button>
                      <button onClick={(e) => { e.stopPropagation(); delGrn(g.id); }} style={{ background: "transparent", color: "var(--crit)", border: "1px solid var(--crit-dim)", padding: "5px 9px", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* New Receipt modal — multi-line receiving */}
      {newRec && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 20, overflowY: "auto" }}>
          <div style={{ background: "var(--bg)", border: "1px solid var(--green)", borderRadius: 10, width: "min(96vw, 720px)", padding: 22, margin: "auto" }}>
            <h3 style={{ color: "var(--green)", margin: "0 0 14px" }}>New Goods Receipt</h3>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 130 }}><label style={lbl}>Date</label><input style={inp} type="date" value={newRec.grn_date} onChange={e => setNewRec(r => ({ ...r, grn_date: e.target.value }))} /></div>
              <div style={{ flex: 1, minWidth: 130 }}><label style={lbl}>Supplier</label><input style={inp} value={newRec.supplier} onChange={e => setNewRec(r => ({ ...r, supplier: e.target.value }))} /></div>
              <div style={{ flex: 1, minWidth: 130 }}><label style={lbl}>Reference (PO/Invoice)</label><input style={inp} value={newRec.reference} onChange={e => setNewRec(r => ({ ...r, reference: e.target.value }))} /></div>
            </div>
            <label style={{ ...lbl, marginTop: 6 }}>Lines</label>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 8 }}>
              <thead><tr style={{ color: "var(--muted)", textAlign: "left" }}>{["Part", "Qty", "Unit ₹", "GST %", "Total ₹", ""].map(c => <th key={c} style={{ padding: "4px 6px", fontSize: 11 }}>{c}</th>)}</tr></thead>
              <tbody>
                {newRec.lines.map((l, i) => (
                  <tr key={i}>
                    <td style={{ padding: "3px 6px" }}>
                      <select style={{ ...inp, marginBottom: 0 }} value={l.part_id} onChange={e => setNewRec(r => { const ls = [...r.lines]; ls[i] = { ...ls[i], part_id: e.target.value }; return { ...r, lines: ls }; })}>
                        <option value="">Select…</option>
                        {parts.map(p => <option key={p.id} value={p.id}>{p.part_name}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "3px 6px", width: 80 }}><input style={{ ...inp, marginBottom: 0 }} type="number" step="0.01" value={l.quantity} onChange={e => setNewRec(r => { const ls = [...r.lines]; ls[i] = { ...ls[i], quantity: e.target.value }; return { ...r, lines: ls }; })} /></td>
                    <td style={{ padding: "3px 6px", width: 90 }}><input style={{ ...inp, marginBottom: 0 }} type="number" step="0.01" value={l.unit_cost} onChange={e => setNewRec(r => { const ls = [...r.lines]; ls[i] = { ...ls[i], unit_cost: e.target.value }; return { ...r, lines: ls }; })} /></td>
                    <td style={{ padding: "3px 6px", width: 64 }}><input style={{ ...inp, marginBottom: 0 }} type="number" step="0.01" value={l.gst_rate} onChange={e => setNewRec(r => { const ls = [...r.lines]; ls[i] = { ...ls[i], gst_rate: e.target.value }; return { ...r, lines: ls }; })} /></td>
                    <td style={{ padding: "3px 6px", fontVariantNumeric: "tabular-nums", color: "var(--muted)", whiteSpace: "nowrap" }}>{inr((Number(l.quantity) || 0) * (Number(l.unit_cost) || 0) * (1 + (Number(l.gst_rate) || 0) / 100))}</td>
                    <td style={{ padding: "3px 6px" }}>{newRec.lines.length > 1 && <button onClick={() => setNewRec(r => ({ ...r, lines: r.lines.filter((_, j) => j !== i) }))} style={{ background: "transparent", color: "var(--crit)", border: "none", cursor: "pointer", fontSize: 15 }}>×</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => setNewRec(r => ({ ...r, lines: [...r.lines, { part_id: "", quantity: "", unit_cost: "", gst_rate: 18 }] }))} style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>+ Add line</button>
            <div style={{ textAlign: "right", margin: "12px 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.8 }}>
              Subtotal {inr(recSub(newRec.lines))} &nbsp;·&nbsp; GST {inr(recGst(newRec.lines))}<br />
              <span style={{ fontSize: 16, color: "var(--text)" }}>Grand total <b style={{ color: "var(--yellow)" }}>{inr(recGrand(newRec.lines))}</b></span>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={saveNewRec} style={{ flex: 1, background: "var(--green)", color: "var(--bg)", border: "none", padding: 12, borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>Save Receipt</button>
              <button onClick={() => setNewRec(null)} style={{ flex: 1, background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", padding: 12, borderRadius: 7, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Open / edit receipt */}
      {openRec && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 20, overflowY: "auto" }}>
          <div style={{ background: "var(--bg)", border: "1px solid var(--yellow)", borderRadius: 10, width: "min(96vw, 720px)", padding: 22, margin: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ color: "var(--yellow)", margin: 0 }}>{openRec.grn_no}</h3>
              <button onClick={() => setOpenRec(null)} style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", padding: "5px 12px", borderRadius: 6, cursor: "pointer" }}>Close</button>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 130 }}><label style={lbl}>Date</label><input style={inp} type="date" value={(openRec.grn_date || "").slice(0, 10)} onChange={e => setOpenRec(r => ({ ...r, grn_date: e.target.value }))} /></div>
              <div style={{ flex: 1, minWidth: 130 }}><label style={lbl}>Supplier</label><input style={inp} value={openRec.supplier || ""} onChange={e => setOpenRec(r => ({ ...r, supplier: e.target.value }))} /></div>
              <div style={{ flex: 1, minWidth: 130 }}><label style={lbl}>Reference</label><input style={inp} value={openRec.reference || ""} onChange={e => setOpenRec(r => ({ ...r, reference: e.target.value }))} /></div>
              <button onClick={saveGrnHeader} style={{ alignSelf: "flex-end", marginBottom: 10, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", padding: "9px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Save header</button>
            </div>
            <label style={lbl}>Lines</label>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ color: "var(--muted)", textAlign: "left" }}>{["Part", "Qty", "Unit ₹", "GST %", "Total ₹", ""].map(c => <th key={c} style={{ padding: "5px 6px", fontSize: 11 }}>{c}</th>)}</tr></thead>
              <tbody>
                {(openRec.lines || []).map((l, i) => (
                  <tr key={l.id} style={{ borderTop: "1px solid var(--surface)" }}>
                    <td style={{ padding: "5px 6px", fontWeight: 600 }}>{l.part_name}</td>
                    <td style={{ padding: "5px 6px", width: 80 }}><input style={{ ...inp, marginBottom: 0 }} type="number" step="0.01" value={l.quantity} onChange={e => setOpenRec(r => { const ls = [...r.lines]; ls[i] = { ...ls[i], quantity: e.target.value }; return { ...r, lines: ls }; })} /></td>
                    <td style={{ padding: "5px 6px", width: 90 }}><input style={{ ...inp, marginBottom: 0 }} type="number" step="0.01" value={l.unit_cost ?? ""} onChange={e => setOpenRec(r => { const ls = [...r.lines]; ls[i] = { ...ls[i], unit_cost: e.target.value }; return { ...r, lines: ls }; })} /></td>
                    <td style={{ padding: "5px 6px", width: 64 }}><input style={{ ...inp, marginBottom: 0 }} type="number" step="0.01" value={l.gst_rate ?? ""} onChange={e => setOpenRec(r => { const ls = [...r.lines]; ls[i] = { ...ls[i], gst_rate: e.target.value }; return { ...r, lines: ls }; })} /></td>
                    <td style={{ padding: "5px 6px", fontVariantNumeric: "tabular-nums", color: "var(--muted)", whiteSpace: "nowrap" }}>{inr((Number(l.quantity) || 0) * (Number(l.unit_cost) || 0) * (1 + (Number(l.gst_rate) || 0) / 100))}</td>
                    <td style={{ padding: "5px 6px", whiteSpace: "nowrap" }}>
                      <button onClick={() => saveLine(l)} style={{ background: "var(--yellow)", color: "var(--on-gold)", border: "none", padding: "4px 9px", borderRadius: 5, cursor: "pointer", fontSize: 11, marginRight: 4, fontWeight: 700 }}>Save</button>
                      <button onClick={() => delLine(l.id)} style={{ background: "transparent", color: "var(--crit)", border: "1px solid var(--crit-dim)", padding: "4px 8px", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <AddLineRow parts={parts} onAdd={addLine} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 14 }}>
              <button onClick={() => delGrn(openRec.id)} style={{ background: "transparent", color: "var(--crit)", border: "1px solid var(--crit-dim)", padding: "9px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12 }}>Delete receipt</button>
              <div style={{ textAlign: "right", fontSize: 13, color: "var(--muted)", lineHeight: 1.8 }}>
                Subtotal {inr(recSub(openRec.lines))} &nbsp;·&nbsp; GST {inr(recGst(openRec.lines))}<br />
                <span style={{ fontSize: 16, color: "var(--text)" }}>Grand total <b style={{ color: "var(--yellow)" }}>{inr(recGrand(openRec.lines))}</b></span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit modal */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "var(--bg)", border: "1px solid var(--green)", borderRadius: 10, width: "min(96vw, 520px)", padding: 22 }}>
            <h3 style={{ color: "var(--green)", margin: "0 0 14px" }}>{editId ? "Edit Spare Part" : "New Spare Part"}</h3>
            <label style={lbl}>Part Name *</label>
            <input style={inp} value={form.part_name} onChange={e => setForm(f => ({ ...f, part_name: e.target.value }))} />
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}><label style={lbl}>SKU</label><input style={inp} value={form.sku || ""} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} /></div>
              <div style={{ flex: 1 }}><label style={lbl}>Category</label><input style={inp} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} /></div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}><label style={lbl}>Unit</label><input style={inp} value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} /></div>
              <div style={{ flex: 1 }}><label style={lbl}>Min Stock</label><input style={inp} type="number" value={form.min_stock} onChange={e => setForm(f => ({ ...f, min_stock: e.target.value }))} /></div>
              {!editId && <div style={{ flex: 1 }}><label style={lbl}>Opening Stock</label><input style={inp} type="number" value={form.current_stock} onChange={e => setForm(f => ({ ...f, current_stock: e.target.value }))} /></div>}
            </div>
            <label style={lbl}>Location</label>
            <input style={inp} value={form.location || ""} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Rack A-3" />
            <label style={lbl}>Notes</label>
            <textarea style={{ ...inp, minHeight: 54 }} value={form.notes || ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            {editId && <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 10 }}>Tip: use ± Stock to change quantity — editing here does not alter current stock.</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={save} disabled={saving} style={{ flex: 1, background: "var(--green)", color: "var(--bg)", border: "none", padding: 12, borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>{saving ? "Saving…" : "Save"}</button>
              <button onClick={() => setShowForm(false)} style={{ flex: 1, background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", padding: 12, borderRadius: 7, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Stock movement modal */}
      {moving && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "var(--bg)", border: "1px solid var(--link)", borderRadius: 10, width: "min(96vw, 440px)", padding: 22 }}>
            <h3 style={{ color: "var(--link)", margin: "0 0 4px" }}>Stock Movement</h3>
            <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 14 }}>{moving.part_name} · current {moving.current_stock} {moving.unit}</div>
            <label style={lbl}>Type</label>
            <select style={inp} value={mv.movement_type} onChange={e => setMv(m => ({ ...m, movement_type: e.target.value }))}>
              <option value="RECEIVED">RECEIVED (add)</option>
              <option value="CONSUMED">CONSUMED (subtract)</option>
              <option value="RETURNED">RETURNED (add)</option>
              <option value="ADJUSTMENT">ADJUSTMENT (set to)</option>
            </select>
            <label style={lbl}>{mv.movement_type === "ADJUSTMENT" ? "Set stock to" : "Quantity"}</label>
            <input style={inp} type="number" step="0.01" value={mv.quantity} onChange={e => setMv(m => ({ ...m, quantity: e.target.value }))} />

            {/* Purchase: unit cost + supplier. Feeds stock value + auto needle/sinker rates. */}
            {(mv.movement_type === "RECEIVED" || mv.movement_type === "RETURNED") && (
              <>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1.4 }}><label style={lbl}>Unit cost ₹ (ex-GST)</label><input style={inp} type="number" step="0.01" value={mv.unit_cost} onChange={e => setMv(m => ({ ...m, unit_cost: e.target.value }))} placeholder={moving.last_unit_cost || ""} /></div>
                  <div style={{ width: 80 }}><label style={lbl}>GST %</label><input style={inp} type="number" step="0.01" value={mv.gst_rate} onChange={e => setMv(m => ({ ...m, gst_rate: e.target.value }))} /></div>
                  <div style={{ flex: 1 }}><label style={lbl}>Supplier</label><input style={inp} value={mv.supplier} onChange={e => setMv(m => ({ ...m, supplier: e.target.value }))} /></div>
                </div>
                {Number(mv.quantity) > 0 && Number(mv.unit_cost) > 0 && (
                  <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>
                    Base <b style={{ color: "var(--text)" }}>{inr(Number(mv.quantity) * Number(mv.unit_cost))}</b>
                    {" + GST "}{inr(Number(mv.quantity) * Number(mv.unit_cost) * (Number(mv.gst_rate) || 0) / 100)}
                    {" = "}<b style={{ color: "var(--text)" }}>{inr(Number(mv.quantity) * Number(mv.unit_cost) * (1 + (Number(mv.gst_rate) || 0) / 100))}</b>
                  </div>
                )}
              </>
            )}

            {/* Issue: which machine the part goes to, so spend rolls up per machine. */}
            {mv.movement_type === "CONSUMED" && (
              <>
                <label style={lbl}>Issue to machine</label>
                <select style={inp} value={mv.machine_id} onChange={e => setMv(m => ({ ...m, machine_id: e.target.value }))}>
                  <option value="">— not machine-specific —</option>
                  {machines.map(m => <option key={m.machine_id} value={m.machine_id}>{m.machine_name || m.machine_id}</option>)}
                </select>
                {moving.avg_cost || moving.last_unit_cost ? <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>Issue value ≈ <b style={{ color: "var(--text)" }}>{inr(Number(mv.quantity || 0) * Number(moving.avg_cost || moving.last_unit_cost))}</b> at stock cost</div> : null}
              </>
            )}

            <label style={lbl}>Reference</label>
            <input style={inp} value={mv.reference} onChange={e => setMv(m => ({ ...m, reference: e.target.value }))} placeholder="e.g. PO / invoice / WO id" />
            <label style={lbl}>Notes</label>
            <input style={inp} value={mv.notes} onChange={e => setMv(m => ({ ...m, notes: e.target.value }))} />
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button onClick={submitMove} style={{ flex: 1, background: "var(--link)", color: "var(--text)", border: "none", padding: 12, borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>Apply</button>
              <button onClick={() => setMoving(null)} style={{ flex: 1, background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", padding: 12, borderRadius: 7, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* History modal */}
      {history && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, width: "min(96vw, 620px)", maxHeight: "80vh", overflowY: "auto", padding: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ color: "var(--yellow)", margin: 0 }}>Movement History — {history.part.part_name}</h3>
              <button onClick={() => setHistory(null)} style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", padding: "5px 12px", borderRadius: 6, cursor: "pointer" }}>Close</button>
            </div>
            {history.rows.length === 0 ? <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>No movements yet.</div> : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ color: "var(--muted)", textAlign: "left" }}>{["When", "Type", "Qty", "Unit ₹", "Total ₹", "Machine / Supplier", "By"].map(c => <th key={c} style={{ padding: "6px 8px" }}>{c}</th>)}</tr></thead>
                <tbody>
                  {history.rows.map(r => (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--surface)" }}>
                      <td style={{ padding: "6px 8px", color: "var(--muted)" }}>{fmtDate(r.created_at)}</td>
                      <td style={{ padding: "6px 8px", color: MOVES[r.movement_type], fontWeight: 600 }}>{r.movement_type}</td>
                      <td style={{ padding: "6px 8px" }}>{r.quantity}</td>
                      <td style={{ padding: "6px 8px", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{inr(r.unit_cost)}</td>
                      <td style={{ padding: "6px 8px", fontVariantNumeric: "tabular-nums" }}>{Number(r.total_cost) ? inr(r.total_cost) : "—"}</td>
                      <td style={{ padding: "6px 8px", color: "var(--muted)" }}>{r.machine_id || r.supplier || "—"}</td>
                      <td style={{ padding: "6px 8px", color: "var(--muted)" }}>{r.created_by || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
