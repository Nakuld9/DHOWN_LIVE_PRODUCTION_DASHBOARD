// Sales returns and credit notes.
//
// A return has two consequences that must land together: goods come back into
// stock, and the customer stops owing money for them. That is why a return sits
// in DRAFT until someone approves it — approval is the single moment when stock
// moves and a credit note is raised, and it is an ADMIN decision because it
// reduces a receivable.
//
// The form works from the invoice, showing how much of each line may still come
// back. That ceiling comes from the server, not from arithmetic here, so what is
// on screen cannot drift from what the validator will accept.

import React, { useEffect, useState, useCallback } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });
const auth = () => ({ Authorization: `Bearer ${tok()}` });

const rupee = n => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—";

const inp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 11px", color: "var(--text)", fontSize: 14, boxSizing: "border-box" };
const lbl = { color: "var(--muted)", fontSize: 12, marginBottom: 4, display: "block" };
const th = { padding: "10px 8px", textAlign: "left", color: "var(--yellow)", fontSize: 13, borderBottom: "2px solid var(--surface)", whiteSpace: "nowrap" };
const td = { padding: "10px 8px", borderBottom: "1px solid rgba(22,52,93,0.4)", fontSize: 14 };
const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const thNum = { ...th, textAlign: "right" };
const btn = (bg, fg = "#000") => ({ background: bg, color: fg, border: "none", padding: "6px 12px", borderRadius: 6, fontWeight: "bold", cursor: "pointer", fontSize: 12 });
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 };

const STATUS = { DRAFT: "var(--gold)", APPROVED: "var(--green)", REJECTED: "var(--muted)", CANCELLED: "var(--crit)" };

// What happens to the goods. Only SALEABLE returns to sellable stock — the
// distinction is the whole reason damaged fabric does not get dispatched twice.
const DISPOSITION_HELP = {
  SALEABLE: "Goes back into sellable stock.",
  REWORK: "Credited, but held for mending — NOT returned to sellable stock.",
  SCRAP: "Credited and written off — NOT returned to sellable stock.",
};

export default function SalesReturns() {
  const [tab, setTab] = useState("returns");
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState([]);
  const [meta, setMeta] = useState({ reasons: [], dispositions: [] });
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [invoice, setInvoice] = useState(null);   // returnable lines
  const [lookup, setLookup] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const flash = (m, ok = true) => { setMsg((ok ? "✓ " : "✗ ") + m); setTimeout(() => setMsg(""), 6000); };

  const load = useCallback(async () => {
    try {
      const [r, n, m] = await Promise.all([
        fetch(`${API}/api/logistics/returns`, { headers: auth() }).then(x => x.json()),
        fetch(`${API}/api/logistics/credit-notes`, { headers: auth() }).then(x => x.json()),
        fetch(`${API}/api/logistics/returns/reasons`, { headers: auth() }).then(x => x.json()),
      ]);
      setRows(Array.isArray(r) ? r : []);
      setNotes(Array.isArray(n) ? n : []);
      setMeta(m && m.reasons ? m : { reasons: [], dispositions: [] });
    } catch { flash("Could not load returns", false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startNew = () => {
    setForm({ invoice_id: "", dispatch_id: "", reason: "QUALITY", disposition: "SALEABLE", detail: "", items: [] });
    setInvoice(null); setLookup("");
  };

  // Pull the invoice and its returnable ceilings.
  const findInvoice = async () => {
    if (!lookup.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/logistics/returns/returnable/${lookup.trim()}`, { headers: auth() });
      const d = await r.json();
      if (!r.ok) { flash(d.error || "Invoice not found", false); setInvoice(null); }
      else {
        setInvoice(d);
        setForm(f => ({ ...f, invoice_id: d.invoice_id, items: [] }));
        if (!d.lines.some(l => l.returnable > 0)) {
          flash(`Everything on ${d.invoice_number} has already been returned`, false);
        }
      }
    } catch (e) { flash(e.message, false); }
    setBusy(false);
  };

  const toggleLine = (line) => {
    setForm(f => {
      const has = f.items.find(i => i.item_name === line.item_name);
      if (has) return { ...f, items: f.items.filter(i => i.item_name !== line.item_name) };
      return { ...f, items: [...f.items, {
        item_id: line.item_id, item_name: line.item_name, hsn_code: line.hsn_code,
        uom: line.uom, rate: line.rate, gst_rate: line.gst_rate,
        quantity: line.returnable, _max: line.returnable,
      }] };
    });
  };

  const setQty = (name, v) => setForm(f => ({
    ...f, items: f.items.map(i => i.item_name === name ? { ...i, quantity: v } : i),
  }));

  const totals = () => {
    const items = form?.items || [];
    const taxable = items.reduce((s, i) => s + (Number(i.quantity) || 0) * Number(i.rate), 0);
    const tax = items.reduce((s, i) => s + (Number(i.quantity) || 0) * Number(i.rate) * Number(i.gst_rate) / 100, 0);
    return { taxable, tax, total: taxable + tax };
  };

  const overLimit = (form?.items || []).filter(i => Number(i.quantity) > i._max + 0.0005);

  const save = async () => {
    if (!form.items.length) return flash("Select at least one line", false);
    if (overLimit.length) return flash("Some quantities exceed what may still be returned", false);
    setBusy(true);
    try {
      const body = { ...form, items: form.items.map(({ _max, ...i }) => ({ ...i, quantity: Number(i.quantity) })) };
      const r = await fetch(`${API}/api/logistics/returns`, { method: "POST", headers: h(), body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) flash(d.error || "Could not create the return", false);
      else {
        flash(`${d.return_number} created as DRAFT — nothing has moved yet. Approve it to restore stock and raise the credit note.`);
        setForm(null); setInvoice(null); await load();
      }
    } catch (e) { flash(e.message, false); }
    setBusy(false);
  };

  const act = async (row, action) => {
    let body = {};
    if (action === "approve") {
      const disp = row.disposition;
      if (!window.confirm(
        `Approve ${row.return_number}?\n\n` +
        `This raises a credit note for ${rupee(row.total_value)} against the customer's account` +
        (disp === "SALEABLE" ? " and returns the goods to sellable stock." : `, but does NOT return the goods to sellable stock (${disp}).`) +
        `\n\nBoth happen together and can be reversed only by cancelling the return.`
      )) return;
    } else {
      const reason = window.prompt(`${action === "reject" ? "Reject" : "Cancel"} ${row.return_number}?\n\nReason:`);
      if (reason === null) return;
      body = { reason };
    }
    try {
      const r = await fetch(`${API}/api/logistics/returns/${row.return_id}/${action}`, {
        method: "POST", headers: h(), body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) return flash(d.error || `Could not ${action}`, false);
      if (action === "approve") {
        flash(`${row.return_number} approved — credit note ${d.credit_note.note_number} for ${rupee(d.credit_note.amount)}` +
              (d.stock_restored ? ", stock restored" : ", stock NOT restored") +
              (d.unallocated > 0 ? `, ${rupee(d.unallocated)} left as unapplied credit` : ""));
      } else flash(`${row.return_number} ${action === "reject" ? "rejected" : "cancelled"}`);
      setDetail(null); await load();
    } catch (e) { flash(e.message, false); }
  };

  const openDetail = async (row) => {
    try {
      const r = await fetch(`${API}/api/logistics/returns/${row.return_id}`, { headers: auth() });
      setDetail(await r.json());
    } catch { flash("Could not load the return", false); }
  };

  const t = totals();

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: 0 }}>↩️ Sales Returns</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btn(tab === "returns" ? "var(--yellow)" : "var(--surface)", tab === "returns" ? "#000" : "var(--text)")}
                  onClick={() => setTab("returns")}>Returns</button>
          <button style={btn(tab === "notes" ? "var(--yellow)" : "var(--surface)", tab === "notes" ? "#000" : "var(--text)")}
                  onClick={() => setTab("notes")}>Credit notes</button>
          <button style={btn("var(--green)", "#000")} onClick={startNew}>+ New return</button>
          <button style={btn("var(--surface)", "var(--text)")} onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {msg && <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 6, background: msg.startsWith("✓") ? "var(--green-dim)" : "var(--crit-dim)", border: `1px solid ${msg.startsWith("✓") ? "var(--green-deep)" : "var(--crit-dim)"}` }}>{msg}</div>}

      {tab === "returns" && (
        <div style={{ ...card, marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Return</th><th style={th}>Date</th><th style={th}>Customer</th>
              <th style={th}>Invoice</th><th style={th}>Reason</th><th style={th}>Disposition</th>
              <th style={thNum}>Qty</th><th style={thNum}>Value</th>
              <th style={th}>Status</th><th style={th}>Credit note</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {!rows.length && <tr><td style={{ ...td, color: "var(--muted)" }} colSpan={11}>No returns raised yet.</td></tr>}
              {rows.map(r => (
                <tr key={r.return_id} style={{ cursor: "pointer", opacity: ["REJECTED", "CANCELLED"].includes(r.status) ? 0.5 : 1 }}
                    onClick={() => openDetail(r)}>
                  <td style={td}>{r.return_number}</td>
                  <td style={td}>{fmtDate(r.return_date)}</td>
                  <td style={td}>{r.company_name || "—"}</td>
                  <td style={td}>{r.invoice_number || "—"}</td>
                  <td style={td}>{r.reason}</td>
                  <td style={{ ...td, color: r.disposition === "SALEABLE" ? "var(--green)" : "var(--gold)" }}>{r.disposition}</td>
                  <td style={tdNum}>{Number(r.total_qty)}</td>
                  <td style={tdNum}>{rupee(r.total_value)}</td>
                  <td style={{ ...td, color: STATUS[r.status] }}>{r.status}</td>
                  <td style={td}>{r.note_number || "—"}</td>
                  <td style={td} onClick={e => e.stopPropagation()}>
                    {r.status === "DRAFT" && (
                      <span style={{ display: "flex", gap: 6 }}>
                        <button style={btn("var(--green)")} onClick={() => act(r, "approve")}>Approve</button>
                        <button style={btn("var(--surface)", "var(--text)")} onClick={() => act(r, "reject")}>Reject</button>
                      </span>
                    )}
                    {r.status === "APPROVED" && (
                      <button style={btn("var(--crit-dim)", "#fff")} onClick={() => act(r, "cancel")}>Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "notes" && (
        <div style={{ ...card, marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Note</th><th style={th}>Date</th><th style={th}>Customer</th>
              <th style={th}>Against return</th><th style={thNum}>Amount</th>
              <th style={thNum}>Applied</th><th style={thNum}>Unapplied</th><th style={th}>Status</th>
            </tr></thead>
            <tbody>
              {!notes.length && <tr><td style={{ ...td, color: "var(--muted)" }} colSpan={8}>No credit notes yet.</td></tr>}
              {notes.map(n => (
                <tr key={n.note_id} style={{ opacity: n.status === "CANCELLED" ? 0.5 : 1 }}>
                  <td style={td}>{n.note_number}</td>
                  <td style={td}>{fmtDate(n.note_date)}</td>
                  <td style={td}>{n.company_name || "—"}</td>
                  <td style={td}>{n.return_number || "—"}</td>
                  <td style={tdNum}>{rupee(n.amount)}</td>
                  <td style={tdNum}>{n.status === "CANCELLED" ? "—" : rupee(n.allocated)}</td>
                  <td style={{ ...tdNum, color: n.status === "ACTIVE" && Number(n.unallocated) > 0 ? "var(--gold)" : undefined }}>
                    {n.status === "ACTIVE" && Number(n.unallocated) > 0 ? rupee(n.unallocated) : "—"}
                  </td>
                  <td style={{ ...td, color: n.status === "ACTIVE" ? "var(--green)" : "var(--crit)" }}>{n.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal title="New sales return" onClose={() => { setForm(null); setInvoice(null); }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Invoice ID *</label>
              <input style={inp} autoFocus value={lookup} placeholder="The invoice the goods were sold on"
                     onChange={e => setLookup(e.target.value)}
                     onKeyDown={e => e.key === "Enter" && findInvoice()} />
            </div>
            <button style={{ ...btn("var(--yellow)", "#000"), padding: "10px 14px" }} disabled={busy} onClick={findInvoice}>
              Load lines
            </button>
          </div>

          {invoice && (
            <>
              <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 10 }}>
                {invoice.invoice_number} · {invoice.company_name} · {fmtDate(invoice.invoice_date)}
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
                <thead><tr>
                  <th style={th}></th><th style={th}>Item</th>
                  <th style={thNum}>Invoiced</th><th style={thNum}>Already back</th>
                  <th style={thNum}>Can return</th><th style={thNum}>Returning</th><th style={thNum}>Value</th>
                </tr></thead>
                <tbody>
                  {invoice.lines.map(l => {
                    const picked = form.items.find(i => i.item_name === l.item_name);
                    const over = picked && Number(picked.quantity) > l.returnable + 0.0005;
                    return (
                      <tr key={l.item_name} style={{ opacity: l.returnable > 0 ? 1 : 0.45 }}>
                        <td style={td}>
                          <input type="checkbox" disabled={l.returnable <= 0}
                                 checked={!!picked} onChange={() => toggleLine(l)} />
                        </td>
                        <td style={td}>
                          {l.item_name}
                          <div style={{ color: "var(--muted)", fontSize: 11 }}>{rupee(l.rate)}/{l.uom} · {l.gst_rate}% GST</div>
                        </td>
                        <td style={tdNum}>{l.invoiced}</td>
                        <td style={tdNum}>{l.already_returned || "—"}</td>
                        <td style={{ ...tdNum, color: l.returnable > 0 ? "var(--green)" : "var(--muted)", fontWeight: "bold" }}>
                          {l.returnable}
                        </td>
                        <td style={tdNum}>
                          {picked ? (
                            <input style={{ ...inp, width: 90, padding: "5px 7px", textAlign: "right",
                                            borderColor: over ? "var(--crit)" : "var(--border)" }}
                                   type="number" value={picked.quantity}
                                   onChange={e => setQty(l.item_name, e.target.value)} />
                          ) : "—"}
                        </td>
                        <td style={tdNum}>
                          {picked ? rupee((Number(picked.quantity) || 0) * Number(l.rate) * (1 + l.gst_rate / 100)) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {!!overLimit.length && (
                <div style={{ padding: 9, borderRadius: 6, marginBottom: 12, background: "var(--crit-dim)", border: "1px solid var(--crit-dim)", fontSize: 13 }}>
                  {overLimit.map(i => i.item_name).join(", ")} — more than may still be returned on this invoice.
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={lbl}>Reason</label>
                  <select style={inp} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}>
                    {meta.reasons.map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>What happens to the goods</label>
                  <select style={inp} value={form.disposition} onChange={e => setForm(f => ({ ...f, disposition: e.target.value }))}>
                    {meta.dispositions.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <div style={{ color: form.disposition === "SALEABLE" ? "var(--muted)" : "var(--gold)", fontSize: 11, marginTop: 4 }}>
                    {DISPOSITION_HELP[form.disposition]}
                  </div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={lbl}>Detail</label>
                  <input style={inp} value={form.detail} onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} />
                </div>
              </div>

              <div style={{ marginTop: 14, textAlign: "right", fontSize: 14 }}>
                <div style={{ color: "var(--muted)" }}>Taxable {rupee(t.taxable)} · GST {rupee(t.tax)}</div>
                <div style={{ fontSize: 19, fontWeight: "bold", marginTop: 3 }}>
                  Credit note will be {rupee(t.total)}
                </div>
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
            <button style={btn("var(--surface)", "var(--text)")} onClick={() => { setForm(null); setInvoice(null); }}>Cancel</button>
            <button style={btn("var(--green)", "#000")} disabled={busy || !form.items.length} onClick={save}>
              {busy ? "Saving…" : "Create as DRAFT"}
            </button>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={`${detail.return_number} · ${detail.status}`} onClose={() => setDetail(null)}>
          <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
            {detail.company_name} · {detail.invoice_number || "no invoice"} · {detail.reason.replace(/_/g, " ")} ·{" "}
            <span style={{ color: detail.disposition === "SALEABLE" ? "var(--green)" : "var(--gold)" }}>{detail.disposition}</span>
          </div>
          {detail.detail && <div style={{ fontSize: 13, marginBottom: 12 }}>{detail.detail}</div>}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Item</th><th style={thNum}>Qty</th><th style={thNum}>Rate</th>
              <th style={thNum}>Taxable</th><th style={thNum}>Tax</th><th style={thNum}>Total</th>
            </tr></thead>
            <tbody>
              {(detail.items || []).map(i => (
                <tr key={i.line_id}>
                  <td style={td}>{i.item_name}</td>
                  <td style={tdNum}>{Number(i.quantity)} {i.uom}</td>
                  <td style={tdNum}>{rupee(i.rate)}</td>
                  <td style={tdNum}>{rupee(i.taxable_value)}</td>
                  <td style={tdNum}>{rupee(i.tax_amount)}</td>
                  <td style={tdNum}>{rupee(i.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12, textAlign: "right", fontSize: 17, fontWeight: "bold" }}>
            {rupee(detail.total_value)}
          </div>
          {detail.note_number && (
            <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "rgba(34,197,94,0.10)", border: "1px solid var(--green-deep)", fontSize: 13 }}>
              Credit note <b>{detail.note_number}</b> for {rupee(detail.credit_amount)} ({detail.credit_status}) —
              netted off this customer's outstanding.
            </div>
          )}
          {detail.status === "DRAFT" && (
            <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: "rgba(234,179,8,0.10)", border: "1px solid var(--gold-deep)", fontSize: 13 }}>
              Still a draft. No stock has moved and no credit has been given.
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div onClick={onClose}
         style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex",
                  alignItems: "flex-start", justifyContent: "center", padding: 24, zIndex: 1000, overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: "min(900px,100%)", marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ color: "var(--yellow)", margin: 0 }}>{title}</h3>
          <button style={btn("var(--surface)", "var(--text)")} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
