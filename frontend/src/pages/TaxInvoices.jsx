import React, { useEffect, useState, useCallback } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—";
const rupee = n => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

const STATUS = { DRAFT: "var(--muted)", ISSUED: "var(--link)", PAID: "var(--green)", CANCELLED: "var(--crit)" };

const inp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 11px", color: "var(--text)", fontSize: 14, boxSizing: "border-box" };
const lbl = { color: "var(--muted)", fontSize: 12, marginBottom: 4, display: "block" };
const th = { padding: "9px 7px", textAlign: "left", color: "var(--yellow)", fontSize: 12, borderBottom: "2px solid var(--surface)", whiteSpace: "nowrap" };
const td = { padding: "7px", borderBottom: "1px solid rgba(22,52,93,0.4)", fontSize: 13 };
const btn = (bg, fg = "#000") => ({ background: bg, color: fg, border: "none", padding: "6px 12px", borderRadius: 6, fontWeight: "bold", cursor: "pointer", fontSize: 12 });

const emptyLine = () => ({ item_name: "", hsn_code: "", quantity: "", uom: "KG", rate: "", gst_rate: 5 });
const emptyInv = () => ({
  customer_name: "", partner_id: "", customer_gstin: "", customer_state: "", customer_address: "",
  customer_mobile: "", place_of_supply: "", supply_type: "INTRA", invoice_date: new Date().toISOString().slice(0, 10),
  so_id: "", so_number: "", notes: "", items: [emptyLine()],
});

// Client-side preview mirroring the server GST computation.
function preview(items, supplyType) {
  const inter = supplyType === "INTER";
  let taxable = 0, cgst = 0, sgst = 0, igst = 0;
  items.forEach(it => {
    const t = r2((Number(it.quantity) || 0) * (Number(it.rate) || 0));
    const g = Number(it.gst_rate) || 0;
    taxable += t;
    if (inter) igst += r2(t * g / 100); else { cgst += r2(t * g / 200); sgst += r2(t * g / 200); }
  });
  taxable = r2(taxable); cgst = r2(cgst); sgst = r2(sgst); igst = r2(igst);
  const tax = r2(cgst + sgst + igst); const raw = r2(taxable + tax); const grand = Math.round(raw);
  return { taxable, cgst, sgst, igst, tax, round_off: r2(grand - raw), grand };
}

export default function TaxInvoices() {
  const [invs, setInvs] = useState([]);
  const [filter, setFilter] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(emptyInv());
  const [saving, setSaving] = useState(false);
  const [partners, setPartners] = useState([]);
  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [company, setCompany] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const url = `${API}/api/tax-invoices${filter ? `?status=${filter}` : ""}`;
    try { const r = await fetch(url); setInvs(await r.json()); } catch {}
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch(`${API}/api/erp/partners`, { headers: h() }).then(r => r.json()).then(d => setPartners(d.data || d.partners || (Array.isArray(d) ? d : []))).catch(() => {});
    fetch(`${API}/api/erp/items?limit=500`).then(r => r.json()).then(d => setItems(d.data || d.items || (Array.isArray(d) ? d : []))).catch(() => {});
    fetch(`${API}/api/sales-orders`).then(r => r.json()).then(d => setOrders(d.data || [])).catch(() => {});
    fetch(`${API}/api/settings`).then(r => r.json()).then(setCompany).catch(() => {});
  }, []);

  const flash = (m, ok = true) => { setMsg((ok ? "✓ " : "✗ ") + m); setTimeout(() => setMsg(""), 3000); };

  const setLine = (i, k, v) => setForm(f => ({ ...f, items: f.items.map((it, j) => j === i ? { ...it, [k]: v } : it) }));
  const addLine = () => setForm(f => ({ ...f, items: [...f.items, emptyLine()] }));
  const rmLine = i => setForm(f => ({ ...f, items: f.items.filter((_, j) => j !== i) }));

  const onPartner = pid => {
    const p = partners.find(x => String(x.partner_id) === String(pid));
    setForm(f => ({ ...f, partner_id: pid, customer_name: p ? (p.company_name || p.short_name || f.customer_name) : f.customer_name, customer_gstin: p && p.gstin ? p.gstin : f.customer_gstin }));
  };
  const onSO = sid => { const so = orders.find(x => String(x.so_id) === String(sid)); setForm(f => ({ ...f, so_id: sid, so_number: so ? so.so_number : "" })); };

  const pv = preview(form.items, form.supply_type);

  const create = async () => {
    if (!form.customer_name.trim()) { flash("Customer is required", false); return; }
    const valid = form.items.filter(it => it.item_name.trim() && Number(it.quantity) > 0);
    if (valid.length === 0) { flash("Add at least one line item", false); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/tax-invoices`, { method: "POST", headers: h(), body: JSON.stringify({ ...form, so_id: form.so_id || null, items: valid }) });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      const inv = await res.json();
      flash(`Created ${inv.invoice_number}`); setForm(emptyInv()); setShowNew(false); load();
    } catch (e) { flash(e.message, false); } finally { setSaving(false); }
  };

  const act = async (id, path, label) => {
    try { const res = await fetch(`${API}/api/tax-invoices/${id}/${path}`, { method: "PUT", headers: h() }); if (!res.ok) throw new Error((await res.json()).error || "Failed"); flash(label); load(); }
    catch (e) { flash(e.message, false); }
  };
  const del = async id => {
    if (!window.confirm("Delete this invoice?")) return;
    try { const res = await fetch(`${API}/api/tax-invoices/${id}`, { method: "DELETE", headers: h() }); if (!res.ok) throw new Error((await res.json()).error || "Failed"); flash("Deleted"); load(); }
    catch (e) { flash(e.message, false); }
  };
  const view = async id => {
    if (expanded === id) { setExpanded(null); return; }
    try { const r = await fetch(`${API}/api/tax-invoices/${id}`); const inv = await r.json(); setExpanded(inv.invoice_id); setInvs(list => list.map(x => x.invoice_id === id ? inv : x)); } catch {}
  };
  const notifyCustomer = async inv => {
    let to = inv.customer_mobile;
    if (!to) { to = window.prompt("Customer WhatsApp number (91XXXXXXXXXX):", ""); if (!to) return; }
    try {
      const res = await fetch(`${API}/api/notify/invoice/${inv.invoice_id}`, { method: "POST", headers: h(), body: JSON.stringify({ to }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      flash(d.skipped ? `Not sent: ${d.skipped}` : (d.ok ? `Sent to ${d.to} ✓` : `Failed: ${d.error || "unknown"}`), !d.skipped && d.ok);
    } catch (e) { flash(e.message, false); }
  };

  // Amount in words — Indian numbering (crore/lakh/thousand), rupees + paise.
  const inWords = (num) => {
    const n = Number(num) || 0; const whole = Math.floor(n); const paise = Math.round((n - whole) * 100);
    const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    const two = (x) => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? " " + a[x % 10] : ""));
    const three = (x) => { const h = Math.floor(x / 100); const r = x % 100; return (h ? a[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : ""); };
    let r = whole; let out = "";
    const cr = Math.floor(r / 10000000); r %= 10000000; const la = Math.floor(r / 100000); r %= 100000; const th = Math.floor(r / 1000); r %= 1000;
    if (cr) out += two(cr) + " Crore "; if (la) out += two(la) + " Lakh "; if (th) out += two(th) + " Thousand "; if (r) out += three(r);
    out = out.trim() || "Zero";
    return "Rupees " + out + (paise ? " and " + two(paise) + " Paise" : "") + " Only";
  };

  // docType: 'TAX' (full GST tax invoice, 3 copies) | 'PROFORMA' | 'BILL_OF_SUPPLY' (no tax)
  const printInvoice = async (id, docType = "PROFORMA") => {
    let inv = invs.find(x => x.invoice_id === id);
    if (!inv || !inv.items) { try { inv = await (await fetch(`${API}/api/tax-invoices/${id}`)).json(); } catch { return; } }
    const seller = company || {};
    const isBOS = docType === "BILL_OF_SUPPLY";
    const title = docType === "TAX" ? "TAX INVOICE" : isBOS ? "BILL OF SUPPLY" : "PROFORMA INVOICE";
    const subtitle = docType === "TAX" ? "" : isBOS ? "Not eligible to charge GST (composition / exempt supply)" : "For internal record only — not a GST tax invoice";
    const inter = inv.supply_type === "INTER";

    // UPI payment QR (only if a VPA is configured in settings).
    const vpa = seller.upi_vpa || seller.upi_id || "";
    let qr = "";
    if (vpa && !isBOS) {
      try {
        const QRCode = (await import("qrcode")).default;
        const upi = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(seller.company_name || "DHOWN HOSIERY MILLS")}&am=${Number(inv.grand_total).toFixed(2)}&cu=INR&tn=${encodeURIComponent(inv.invoice_number)}`;
        qr = await QRCode.toDataURL(upi, { width: 120, margin: 1 });
      } catch { qr = ""; }
    }

    const rows = (inv.items || []).map((L, i) => `<tr>
      <td>${i + 1}</td><td>${L.item_name || ""}</td><td>${L.hsn_code || ""}</td>
      <td class="right">${Number(L.quantity)} ${L.uom}</td>
      <td class="right">${Number(L.rate).toFixed(2)}</td>
      <td class="right">${Number(L.taxable_value).toFixed(2)}</td>
      ${isBOS ? "" : `<td class="right">${Number(L.gst_rate)}%</td><td class="right">${Number(L.cgst_amount + L.sgst_amount + L.igst_amount).toFixed(2)}</td>`}
      <td class="right">${Number(L.line_total).toFixed(2)}</td></tr>`).join("");

    const page = (copyLabel) => `<div class="pg">
      <div class="head"><div><h1>${seller.company_name || "DHOWN HOSIERY MILLS"}</h1>
        <div class="muted">${seller.factory_address || ""}</div>
        <div class="muted">GSTIN: ${seller.gst_number || ""}${seller.phone_number ? " · Ph: " + seller.phone_number : ""}</div></div>
        <div class="right"><h2 style="margin:0">${title}</h2>
        ${copyLabel ? `<div class="copy">${copyLabel}</div>` : ""}
        ${subtitle ? `<div class="muted" style="font-size:10px">${subtitle}</div>` : ""}
        <div><b>${inv.invoice_number}</b></div><div class="muted">${fmtDate(inv.invoice_date)}</div></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:12px">
        <div><b>Bill To:</b><br>${inv.customer_name || ""}<br>${inv.customer_address || ""}<br>
          ${inv.customer_gstin ? "GSTIN: " + inv.customer_gstin + "<br>" : ""}${inv.customer_state ? "State: " + inv.customer_state : ""}</div>
        <div class="right">Place of Supply: ${inv.place_of_supply || "-"}${isBOS ? "" : `<br>Supply: ${inter ? "Inter-state (IGST)" : "Intra-state (CGST+SGST)"}`}${inv.so_number ? "<br>Ref SO: " + inv.so_number : ""}</div>
      </div>
      <table><thead><tr><th>#</th><th>Item</th><th>HSN</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Taxable</th>${isBOS ? "" : '<th class="right">GST</th><th class="right">Tax</th>'}<th class="right">Total</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div style="display:flex;justify-content:space-between;margin-top:8px;align-items:flex-start">
        <div style="max-width:55%">
          <div style="font-size:11px"><b>Amount in words:</b> ${inWords(inv.grand_total)}</div>
          ${qr ? `<div style="margin-top:10px"><img src="${qr}" width="110" height="110"/><div class="muted" style="font-size:9px">Scan to pay (UPI) · ${vpa}</div></div>` : ""}
        </div>
        <table class="tot" style="width:300px"><tbody>
          <tr><td>Taxable Value</td><td>${Number(inv.taxable_value).toFixed(2)}</td></tr>
          ${isBOS ? "" : (inter
            ? `<tr><td>IGST</td><td>${Number(inv.igst_amount).toFixed(2)}</td></tr>`
            : `<tr><td>CGST</td><td>${Number(inv.cgst_amount).toFixed(2)}</td></tr><tr><td>SGST</td><td>${Number(inv.sgst_amount).toFixed(2)}</td></tr>`)}
          <tr><td>Round Off</td><td>${Number(inv.round_off).toFixed(2)}</td></tr>
          <tr><td><b>Grand Total</b></td><td><b>₹${Number(inv.grand_total).toFixed(2)}</b></td></tr>
        </tbody></table>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:28px">
        <div class="muted" style="font-size:10px;max-width:60%">${docType === "TAX"
          ? "This is a computer-generated tax invoice."
          : isBOS ? "Computer-generated Bill of Supply." : "Computer-generated proforma for internal record only. The official GST tax invoice, e-invoice (IRN) and e-way bill are issued from Busy."}</div>
        <div style="text-align:right">For ${seller.company_name || "DHOWN HOSIERY MILLS"}<br><br><br>Authorised Signatory</div>
      </div>
    </div>`;

    // Rule 48: a tax invoice prints 3 copies; proforma / bill of supply print one.
    const copies = docType === "TAX"
      ? ["Original for Recipient", "Duplicate for Transporter", "Triplicate for Supplier"].map(page).join('<div class="pb"></div>')
      : page("");

    const w = window.open("", "_blank", "width=820,height=900");
    w.document.write(`<html><head><title>${inv.invoice_number} — ${title}</title><style>
      body{font-family:Arial,sans-serif;color:#111;padding:24px;font-size:12px}
      h1{font-size:18px;margin:0} .muted{color:#555} table{width:100%;border-collapse:collapse;margin-top:12px}
      th,td{border:1px solid #999;padding:5px 7px} th{background:#eee;text-align:left}
      .tot td{border:none;padding:2px 7px;text-align:right} .right{text-align:right}
      .head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:8px}
      .copy{display:inline-block;border:1px solid #111;border-radius:4px;padding:1px 6px;font-size:10px;margin:3px 0}
      .pb{page-break-after:always} @media print{.pg{page-break-inside:avoid}}
    </style></head><body>${copies}
      <script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  };

  return (
    <div style={{ padding: 30, color: "var(--text)", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", fontSize: 40, margin: 0 }}>INVOICES (RECORD)</h1>
          <p style={{ color: "var(--muted)", margin: "4px 0 0" }}>Internal proforma records only — the official GST invoice, e-invoice &amp; e-way bill are issued from Busy</p>
        </div>
        <button onClick={() => setShowNew(s => !s)} style={btn(showNew ? "var(--crit)" : "var(--green)", showNew ? "#fff" : "#000")}>
          {showNew ? "✕ Cancel" : "+ New Invoice"}
        </button>
      </div>

      {msg && <div style={{ marginBottom: 14, color: msg[0] === "✓" ? "var(--green)" : "var(--crit)", fontWeight: "bold" }}>{msg}</div>}

      {showNew && (
        <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <h3 style={{ color: "var(--yellow)", marginTop: 0 }}>New Invoice (record)</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={lbl}>Customer *</label>
              <select style={inp} value={form.partner_id} onChange={e => onPartner(e.target.value)}>
                <option value="">— Select / type —</option>
                {partners.map(p => <option key={p.partner_id} value={p.partner_id}>{p.company_name || p.short_name}</option>)}
              </select>
              <input style={{ ...inp, marginTop: 6 }} placeholder="or type customer" value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} />
            </div>
            <div><label style={lbl}>Customer GSTIN</label><input style={inp} value={form.customer_gstin} onChange={e => setForm(f => ({ ...f, customer_gstin: e.target.value }))} /></div>
            <div><label style={lbl}>Customer WhatsApp</label><input style={inp} placeholder="91XXXXXXXXXX" value={form.customer_mobile} onChange={e => setForm(f => ({ ...f, customer_mobile: e.target.value }))} /></div>
            <div><label style={lbl}>Customer State</label><input style={inp} value={form.customer_state} onChange={e => setForm(f => ({ ...f, customer_state: e.target.value }))} /></div>
            <div><label style={lbl}>Place of Supply</label><input style={inp} value={form.place_of_supply} onChange={e => setForm(f => ({ ...f, place_of_supply: e.target.value }))} /></div>
            <div>
              <label style={lbl}>Supply Type</label>
              <select style={inp} value={form.supply_type} onChange={e => setForm(f => ({ ...f, supply_type: e.target.value }))}>
                <option value="INTRA">Intra-state (CGST + SGST)</option>
                <option value="INTER">Inter-state (IGST)</option>
              </select>
            </div>
            <div><label style={lbl}>Invoice Date</label><input type="date" style={inp} value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} /></div>
            <div>
              <label style={lbl}>Link Sales Order</label>
              <select style={inp} value={form.so_id} onChange={e => onSO(e.target.value)}>
                <option value="">— None —</option>
                {orders.map(so => <option key={so.so_id} value={so.so_id}>{so.so_number} — {so.customer_name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table width="100%" style={{ borderCollapse: "collapse", minWidth: 720 }}>
              <thead><tr>{["Item", "HSN", "Qty", "UOM", "Rate", "GST %", "Taxable", ""].map(x => <th key={x} style={th}>{x}</th>)}</tr></thead>
              <tbody>
                {form.items.map((it, i) => (
                  <tr key={i}>
                    <td style={td}><input list="ti-items" style={inp} placeholder="Item" value={it.item_name} onChange={e => setLine(i, "item_name", e.target.value)} /></td>
                    <td style={{ ...td, width: 90 }}><input style={inp} value={it.hsn_code} onChange={e => setLine(i, "hsn_code", e.target.value)} /></td>
                    <td style={{ ...td, width: 80 }}><input type="number" style={inp} value={it.quantity} onChange={e => setLine(i, "quantity", e.target.value)} /></td>
                    <td style={{ ...td, width: 70 }}><select style={inp} value={it.uom} onChange={e => setLine(i, "uom", e.target.value)}>{["KG", "PCS", "BOX", "MTR"].map(u => <option key={u}>{u}</option>)}</select></td>
                    <td style={{ ...td, width: 90 }}><input type="number" style={inp} value={it.rate} onChange={e => setLine(i, "rate", e.target.value)} /></td>
                    <td style={{ ...td, width: 80 }}><select style={inp} value={it.gst_rate} onChange={e => setLine(i, "gst_rate", e.target.value)}>{[0, 5, 12, 18, 28].map(g => <option key={g} value={g}>{g}%</option>)}</select></td>
                    <td style={{ ...td, width: 100, color: "var(--link)" }}>{rupee((Number(it.quantity) || 0) * (Number(it.rate) || 0))}</td>
                    <td style={{ ...td, width: 34 }}>{form.items.length > 1 && <button onClick={() => rmLine(i)} style={btn("var(--crit-dim)", "#fff")}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="ti-items">{items.map(it => <option key={it.item_id} value={it.item_name} />)}</datalist>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 12, flexWrap: "wrap", gap: 12 }}>
            <button onClick={addLine} style={btn("var(--surface)", "var(--yellow)")}>+ Add Line</button>
            <div style={{ textAlign: "right", fontSize: 13, color: "var(--muted)" }}>
              <div>Taxable: {rupee(pv.taxable)}</div>
              {form.supply_type === "INTER"
                ? <div>IGST: {rupee(pv.igst)}</div>
                : <div>CGST: {rupee(pv.cgst)} &nbsp; SGST: {rupee(pv.sgst)}</div>}
              <div>Round off: {rupee(pv.round_off)}</div>
              <div style={{ fontSize: 18, fontWeight: "bold", color: "var(--yellow)" }}>Grand Total: {rupee(pv.grand)}</div>
            </div>
          </div>
          <div style={{ marginTop: 12 }}><label style={lbl}>Notes</label><textarea style={{ ...inp, minHeight: 44 }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <button onClick={create} disabled={saving} style={{ ...btn(saving ? "#888" : "var(--yellow)"), marginTop: 12, padding: "10px 24px", fontSize: 14 }}>{saving ? "Saving…" : "Create Invoice"}</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        {["", "DRAFT", "ISSUED", "PAID", "CANCELLED"].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{ ...btn(filter === s ? "var(--yellow)" : "var(--surface)", filter === s ? "#000" : "var(--muted)"), border: "1px solid var(--border)" }}>{s || "All"}</button>
        ))}
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflowX: "auto" }}>
        <table width="100%" style={{ borderCollapse: "collapse", minWidth: 900 }}>
          <thead><tr>{["Invoice #", "Date", "Customer", "Taxable", "Tax", "Grand Total", "Status", "Actions"].map(x => <th key={x} style={th}>{x}</th>)}</tr></thead>
          <tbody>
            {invs.length === 0 && <tr><td colSpan="8" style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontStyle: "italic" }}>No invoices{filter ? ` in ${filter}` : ""}.</td></tr>}
            {invs.map(inv => (
              <React.Fragment key={inv.invoice_id}>
                <tr>
                  <td style={{ ...td, fontWeight: "bold", color: "var(--yellow)", cursor: "pointer" }} onClick={() => view(inv.invoice_id)}>{inv.invoice_number} {expanded === inv.invoice_id ? "▾" : "▸"}</td>
                  <td style={td}>{fmtDate(inv.invoice_date)}</td>
                  <td style={td}>{inv.customer_name || "—"}</td>
                  <td style={td}>{rupee(inv.taxable_value)}</td>
                  <td style={td}>{rupee(inv.total_tax)}</td>
                  <td style={{ ...td, color: "var(--green)", fontWeight: "bold" }}>{rupee(inv.grand_total)}</td>
                  <td style={td}><span style={{ background: (STATUS[inv.status] || "#555") + "33", color: STATUS[inv.status] || "#aaa", padding: "3px 10px", borderRadius: 4, fontSize: 12, fontWeight: "bold" }}>{inv.status}</span></td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <select defaultValue="" onChange={(e) => { if (e.target.value) { printInvoice(inv.invoice_id, e.target.value); e.target.value = ""; } }}
                        style={{ ...btn("var(--surface)", "var(--yellow)"), cursor: "pointer" }} title="Print / download as">
                        <option value="">🖨 Print…</option>
                        <option value="TAX">Tax Invoice (3 copies)</option>
                        <option value="PROFORMA">Proforma Invoice</option>
                        <option value="BILL_OF_SUPPLY">Bill of Supply</option>
                      </select>
                      <button onClick={() => notifyCustomer(inv)} style={btn("var(--green)", "#fff")}>📲 WhatsApp</button>
                      {inv.status === "DRAFT" && <button onClick={() => act(inv.invoice_id, "issue", "Issued")} style={btn("var(--link)", "#fff")}>Issue</button>}
                      {inv.status === "ISSUED" && <button onClick={() => act(inv.invoice_id, "pay", "Marked paid")} style={btn("var(--green)")}>Mark Paid</button>}
                      {["DRAFT", "ISSUED"].includes(inv.status) && <button onClick={() => act(inv.invoice_id, "cancel", "Cancelled")} style={btn("var(--crit-dim)", "#fff")}>Cancel</button>}
                      {["DRAFT", "CANCELLED"].includes(inv.status) && <button onClick={() => del(inv.invoice_id)} style={btn("var(--crit-dim)", "var(--crit-edge)")}>Delete</button>}
                    </div>
                  </td>
                </tr>
                {expanded === inv.invoice_id && inv.items && (
                  <tr><td colSpan="8" style={{ padding: 0, background: "var(--surface)" }}>
                    <table width="100%" style={{ borderCollapse: "collapse" }}>
                      <thead><tr>{["Item", "HSN", "Qty", "Rate", "Taxable", "GST%", "CGST", "SGST", "IGST", "Total"].map(x => <th key={x} style={{ ...th, fontSize: 11, color: "var(--muted)" }}>{x}</th>)}</tr></thead>
                      <tbody>
                        {inv.items.map(L => (
                          <tr key={L.line_id}>
                            <td style={td}>{L.item_name}</td><td style={td}>{L.hsn_code || "—"}</td>
                            <td style={td}>{Number(L.quantity)} {L.uom}</td><td style={td}>{rupee(L.rate)}</td>
                            <td style={td}>{rupee(L.taxable_value)}</td><td style={td}>{Number(L.gst_rate)}%</td>
                            <td style={td}>{rupee(L.cgst_amount)}</td><td style={td}>{rupee(L.sgst_amount)}</td>
                            <td style={td}>{rupee(L.igst_amount)}</td><td style={{ ...td, color: "var(--green)" }}>{rupee(L.line_total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ padding: "8px 12px", color: "var(--muted)", fontSize: 13, textAlign: "right" }}>
                      Taxable {rupee(inv.taxable_value)} · {inv.supply_type === "INTER" ? `IGST ${rupee(inv.igst_amount)}` : `CGST ${rupee(inv.cgst_amount)} · SGST ${rupee(inv.sgst_amount)}`} · Round {rupee(inv.round_off)} · <b style={{ color: "var(--yellow)" }}>Grand {rupee(inv.grand_total)}</b>
                    </div>
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
