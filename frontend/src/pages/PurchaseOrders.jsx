import React, { useEffect, useState, useCallback } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—";
const rupee = n => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS = {
  DRAFT: "var(--muted)", SENT: "var(--link)", PARTIALLY_RECEIVED: "var(--gold)",
  RECEIVED: "var(--green)", CANCELLED: "var(--crit)",
};

const inp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 11px", color: "var(--text)", fontSize: 14, boxSizing: "border-box" };
const lbl = { color: "var(--muted)", fontSize: 12, marginBottom: 4, display: "block" };
const th = { padding: "10px 8px", textAlign: "left", color: "var(--yellow)", fontSize: 13, borderBottom: "2px solid var(--surface)", whiteSpace: "nowrap" };
const td = { padding: "10px 8px", borderBottom: "1px solid rgba(22,52,93,0.4)", fontSize: 14 };
const btn = (bg, fg = "#000") => ({ background: bg, color: fg, border: "none", padding: "6px 12px", borderRadius: 6, fontWeight: "bold", cursor: "pointer", fontSize: 12 });

const emptyItem = () => ({ item_name: "", quantity: "", uom: "KG", rate: "" });
const emptyPO = () => ({
  supplier_name: "", partner_id: "", supplier_mobile: "", order_date: new Date().toISOString().slice(0, 10),
  expected_date: "", payment_terms: "", notes: "", items: [emptyItem()],
});

export default function PurchaseOrders() {
  const [pos, setPos] = useState([]);
  const [filter, setFilter] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(emptyPO());
  const [saving, setSaving] = useState(false);
  const [partners, setPartners] = useState([]);
  const [items, setItems] = useState([]);
  const [expanded, setExpanded] = useState(null); // po_id whose items are shown
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const url = `${API}/api/purchase-orders${filter ? `?status=${filter}` : ""}`;
    try { const r = await fetch(url); const d = await r.json(); setPos(d.data || []); } catch {}
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch(`${API}/api/erp/partners`, { headers: h() })
      .then(r => r.json()).then(d => setPartners(d.data || d.partners || (Array.isArray(d) ? d : []))).catch(() => {});
    fetch(`${API}/api/erp/items?limit=500`)
      .then(r => r.json()).then(d => setItems(d.data || d.items || (Array.isArray(d) ? d : []))).catch(() => {});
  }, []);

  const flash = (m, ok = true) => { setMsg((ok ? "✓ " : "✗ ") + m); setTimeout(() => setMsg(""), 3000); };

  const lineTotal = it => (Number(it.quantity) || 0) * (Number(it.rate) || 0);
  const grand = form.items.reduce((s, it) => s + lineTotal(it), 0);

  const setItem = (i, k, v) => setForm(f => ({ ...f, items: f.items.map((it, j) => j === i ? { ...it, [k]: v } : it) }));
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, emptyItem()] }));
  const rmItem = i => setForm(f => ({ ...f, items: f.items.filter((_, j) => j !== i) }));

  const onPartner = pid => {
    const p = partners.find(x => String(x.partner_id) === String(pid));
    setForm(f => ({ ...f, partner_id: pid, supplier_name: p ? (p.company_name || p.short_name || f.supplier_name) : f.supplier_name }));
  };

  const create = async () => {
    if (!form.supplier_name.trim()) { flash("Supplier is required", false); return; }
    const valid = form.items.filter(it => it.item_name.trim() && Number(it.quantity) > 0);
    if (valid.length === 0) { flash("Add at least one line item with a name and quantity", false); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/purchase-orders`, {
        method: "POST", headers: h(),
        body: JSON.stringify({ ...form, partner_id: form.partner_id || null, items: valid }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      const po = await res.json();
      flash(`Created ${po.po_number}`);
      setForm(emptyPO()); setShowNew(false); load();
    } catch (e) { flash(e.message, false); } finally { setSaving(false); }
  };

  const act = async (id, path, label) => {
    try {
      const res = await fetch(`${API}/api/purchase-orders/${id}/${path}`, { method: "PUT", headers: h() });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      flash(label); load();
    } catch (e) { flash(e.message, false); }
  };

  const del = async id => {
    if (!window.confirm("Delete this purchase order?")) return;
    try {
      const res = await fetch(`${API}/api/purchase-orders/${id}`, { method: "DELETE", headers: h() });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      flash("Deleted"); load();
    } catch (e) { flash(e.message, false); }
  };

  const view = async id => {
    if (expanded === id) { setExpanded(null); return; }
    try { const r = await fetch(`${API}/api/purchase-orders/${id}`); const po = await r.json(); setExpanded(po.po_id); setPos(list => list.map(p => p.po_id === id ? { ...p, items: po.items } : p)); } catch {}
  };
  const notifySupplier = async po => {
    let to = po.supplier_mobile;
    if (!to) { to = window.prompt("Supplier WhatsApp number (91XXXXXXXXXX):", ""); if (!to) return; }
    try {
      const res = await fetch(`${API}/api/notify/po/${po.po_id}`, { method: "POST", headers: h(), body: JSON.stringify({ to }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      flash(d.skipped ? `Not sent: ${d.skipped}` : (d.ok ? `Sent to ${d.to} ✓` : `Failed: ${d.error || "unknown"}`));
    } catch (e) { flash(e.message, false); }
  };

  return (
    <div style={{ padding: 30, color: "var(--text)", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", fontSize: 40, margin: 0 }}>PURCHASE ORDERS</h1>
          <p style={{ color: "var(--muted)", margin: "4px 0 0" }}>Yarn & material orders to suppliers</p>
        </div>
        <button onClick={() => setShowNew(s => !s)} style={btn(showNew ? "var(--crit)" : "var(--green)", showNew ? "#fff" : "#000")}>
          {showNew ? "✕ Cancel" : "+ New Purchase Order"}
        </button>
      </div>

      {msg && <div style={{ marginBottom: 14, color: msg[0] === "✓" ? "var(--green)" : "var(--crit)", fontWeight: "bold" }}>{msg}</div>}

      {showNew && (
        <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <h3 style={{ color: "var(--yellow)", marginTop: 0 }}>New Purchase Order</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 16 }}>
            <div>
              <label style={lbl}>Supplier *</label>
              <select style={inp} value={form.partner_id} onChange={e => onPartner(e.target.value)}>
                <option value="">— Select / type below —</option>
                {partners.map(p => <option key={p.partner_id} value={p.partner_id}>{p.company_name || p.short_name}</option>)}
              </select>
              <input style={{ ...inp, marginTop: 6 }} placeholder="or type supplier name" value={form.supplier_name}
                onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))} />
            </div>
            <div><label style={lbl}>Order Date</label><input type="date" style={inp} value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} /></div>
            <div><label style={lbl}>Expected Delivery</label><input type="date" style={inp} value={form.expected_date} onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))} /></div>
            <div><label style={lbl}>Payment Terms</label><input style={inp} placeholder="e.g. 30 days" value={form.payment_terms} onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))} /></div>
            <div><label style={lbl}>Supplier WhatsApp</label><input style={inp} placeholder="91XXXXXXXXXX" value={form.supplier_mobile} onChange={e => setForm(f => ({ ...f, supplier_mobile: e.target.value }))} /></div>
          </div>

          {/* Line items */}
          <div style={{ overflowX: "auto" }}>
            <table width="100%" style={{ borderCollapse: "collapse", minWidth: 640 }}>
              <thead><tr>{["Item / Yarn", "Qty", "UOM", "Rate ₹", "Amount ₹", ""].map(x => <th key={x} style={th}>{x}</th>)}</tr></thead>
              <tbody>
                {form.items.map((it, i) => (
                  <tr key={i}>
                    <td style={td}>
                      <input list="po-items" style={inp} placeholder="Item / yarn name" value={it.item_name} onChange={e => setItem(i, "item_name", e.target.value)} />
                    </td>
                    <td style={{ ...td, width: 90 }}><input type="number" min="0" style={inp} value={it.quantity} onChange={e => setItem(i, "quantity", e.target.value)} /></td>
                    <td style={{ ...td, width: 80 }}>
                      <select style={inp} value={it.uom} onChange={e => setItem(i, "uom", e.target.value)}>
                        {["KG", "PCS", "BOX", "CONE", "MTR"].map(u => <option key={u}>{u}</option>)}
                      </select>
                    </td>
                    <td style={{ ...td, width: 110 }}><input type="number" min="0" style={inp} value={it.rate} onChange={e => setItem(i, "rate", e.target.value)} /></td>
                    <td style={{ ...td, width: 120, color: "var(--green)", fontWeight: "bold" }}>{rupee(lineTotal(it))}</td>
                    <td style={{ ...td, width: 40 }}>{form.items.length > 1 && <button onClick={() => rmItem(i)} style={btn("var(--crit-dim)", "#fff")}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="po-items">{items.map(it => <option key={it.item_id} value={it.item_name} />)}</datalist>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, flexWrap: "wrap", gap: 12 }}>
            <button onClick={addItem} style={btn("var(--surface)", "var(--yellow)")}>+ Add Line</button>
            <div style={{ fontSize: 18, fontWeight: "bold", color: "var(--yellow)" }}>Total: {rupee(grand)}</div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={lbl}>Notes</label>
            <textarea style={{ ...inp, minHeight: 60 }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <button onClick={create} disabled={saving} style={{ ...btn(saving ? "#888" : "var(--yellow)"), marginTop: 14, padding: "10px 24px", fontSize: 14 }}>
            {saving ? "Saving…" : "Create Purchase Order"}
          </button>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        {["", "DRAFT", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{ ...btn(filter === s ? "var(--yellow)" : "var(--surface)", filter === s ? "#000" : "var(--muted)"), border: "1px solid var(--border)" }}>
            {s || "All"}
          </button>
        ))}
      </div>

      {/* List */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflowX: "auto" }}>
        <table width="100%" style={{ borderCollapse: "collapse", minWidth: 900 }}>
          <thead><tr>{["PO Number", "Supplier", "Order Date", "Expected", "Items", "Total", "Status", "Actions"].map(x => <th key={x} style={th}>{x}</th>)}</tr></thead>
          <tbody>
            {pos.length === 0 && <tr><td colSpan="8" style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontStyle: "italic" }}>No purchase orders{filter ? ` in ${filter}` : ""}.</td></tr>}
            {pos.map(po => (
              <React.Fragment key={po.po_id}>
                <tr>
                  <td style={{ ...td, fontWeight: "bold", color: "var(--yellow)", cursor: "pointer" }} onClick={() => view(po.po_id)}>{po.po_number} {expanded === po.po_id ? "▾" : "▸"}</td>
                  <td style={td}>{po.supplier_name || "—"}</td>
                  <td style={td}>{fmtDate(po.order_date)}</td>
                  <td style={td}>{fmtDate(po.expected_date)}</td>
                  <td style={td}>{po.item_count} · {Number(po.total_qty || 0)} qty</td>
                  <td style={{ ...td, color: "var(--green)", fontWeight: "bold" }}>{rupee(po.total_amount)}</td>
                  <td style={td}><span style={{ background: (STATUS[po.status] || "#555") + "33", color: STATUS[po.status] || "#aaa", padding: "3px 10px", borderRadius: 4, fontSize: 12, fontWeight: "bold" }}>{po.status}</span></td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button onClick={() => notifySupplier(po)} style={btn("var(--green)", "#fff")}>📲 WhatsApp</button>
                      {po.status === "DRAFT" && <button onClick={() => act(po.po_id, "send", "Sent to supplier")} style={btn("var(--link)", "#fff")}>Send</button>}
                      {(po.status === "SENT" || po.status === "PARTIALLY_RECEIVED") && <button onClick={() => act(po.po_id, "receive", "Marked received")} style={btn("var(--green)")}>Receive</button>}
                      {["DRAFT", "SENT", "PARTIALLY_RECEIVED"].includes(po.status) && <button onClick={() => act(po.po_id, "cancel", "Cancelled")} style={btn("var(--crit-dim)", "#fff")}>Cancel</button>}
                      {["DRAFT", "CANCELLED"].includes(po.status) && <button onClick={() => del(po.po_id)} style={btn("var(--crit-dim)", "var(--crit-edge)")}>Delete</button>}
                    </div>
                  </td>
                </tr>
                {expanded === po.po_id && po.items && (
                  <tr><td colSpan="8" style={{ padding: 0, background: "var(--surface)" }}>
                    <table width="100%" style={{ borderCollapse: "collapse" }}>
                      <thead><tr>{["Item", "Qty", "UOM", "Rate", "Amount", "Received"].map(x => <th key={x} style={{ ...th, fontSize: 11, color: "var(--muted)" }}>{x}</th>)}</tr></thead>
                      <tbody>
                        {po.items.map(it => (
                          <tr key={it.po_item_id}>
                            <td style={td}>{it.item_name}</td>
                            <td style={td}>{Number(it.quantity)}</td>
                            <td style={td}>{it.uom}</td>
                            <td style={td}>{rupee(it.rate)}</td>
                            <td style={{ ...td, color: "var(--green)" }}>{rupee(it.amount)}</td>
                            <td style={td}>{Number(it.received_qty || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {po.notes && <div style={{ padding: "10px 12px", color: "var(--muted)", fontSize: 13 }}>Notes: {po.notes}</div>}
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
