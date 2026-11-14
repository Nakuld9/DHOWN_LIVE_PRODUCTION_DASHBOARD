// Customer-facing WhatsApp notifications (invoices, dispatch) via approved templates.
// Templates (create + approve in Meta):
//   invoice_notify  — 4 params: {{1}} customer, {{2}} invoice no, {{3}} amount, {{4}} date
//   dispatch_notify — 4 params: {{1}} customer, {{2}} challan no, {{3}} qty/rolls, {{4}} date
const pool = require('../../config/database');
const { WHATSAPP_ENABLED, sendTemplate } = require('./alerts');

const INVOICE_TEMPLATE  = process.env.WHATSAPP_INVOICE_TEMPLATE  || 'invoice_notify';
const DISPATCH_TEMPLATE = process.env.WHATSAPP_DISPATCH_TEMPLATE || 'dispatch_notify';
const PO_TEMPLATE       = process.env.WHATSAPP_PO_TEMPLATE       || 'po_notify';
const NOTIFY_LANG       = process.env.WHATSAPP_NOTIFY_LANG || process.env.WHATSAPP_LANG || 'en';

const inr = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d) => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : '';

async function notifyInvoice(invoiceId, mobileOverride) {
  if (!WHATSAPP_ENABLED) return { skipped: 'whatsapp disabled' };
  const r = await pool.query(`SELECT * FROM tax_invoices WHERE invoice_id=$1`, [invoiceId]);
  if (!r.rows.length) return { notFound: true };
  const inv = r.rows[0];
  const to = mobileOverride || inv.customer_mobile;
  if (!to) return { skipped: 'no customer mobile on file' };
  const params = [inv.customer_name || 'Customer', inv.invoice_number, inr(inv.grand_total), dmy(inv.invoice_date)];
  const json = await sendTemplate(to, INVOICE_TEMPLATE, NOTIFY_LANG, params);
  return { ok: !!(json && json.messages), to, error: json && json.error ? json.error.message : null };
}

// Dispatch notify — pass the challan fields + a mobile (dispatch has no stored mobile).
async function notifyDispatch(mobile, { customer_name, challan_number, quantity, date }) {
  if (!WHATSAPP_ENABLED) return { skipped: 'whatsapp disabled' };
  if (!mobile) return { skipped: 'no mobile' };
  const params = [customer_name || 'Customer', challan_number || '', String(quantity || ''), dmy(date || new Date())];
  const json = await sendTemplate(mobile, DISPATCH_TEMPLATE, NOTIFY_LANG, params);
  return { ok: !!(json && json.messages), to: mobile, error: json && json.error ? json.error.message : null };
}

// Send a supplier their purchase order. Uses the PO's stored mobile or an override.
async function notifyPO(poId, mobileOverride) {
  if (!WHATSAPP_ENABLED) return { skipped: 'whatsapp disabled' };
  const r = await pool.query(`SELECT po.*, COUNT(i.po_item_id) AS item_count
                              FROM purchase_orders po LEFT JOIN purchase_order_items i ON i.po_id=po.po_id
                              WHERE po.po_id=$1 GROUP BY po.po_id`, [poId]);
  if (!r.rows.length) return { notFound: true };
  const po = r.rows[0];
  const to = mobileOverride || po.supplier_mobile;
  if (!to) return { skipped: 'no supplier mobile on file' };
  const params = [
    po.supplier_name || 'Supplier',
    po.po_number,
    `${po.item_count} item(s), Rs ${inr(po.total_amount)}`,
    dmy(po.expected_date || po.order_date),
  ];
  const json = await sendTemplate(to, PO_TEMPLATE, NOTIFY_LANG, params);
  return { ok: !!(json && json.messages), to, error: json && json.error ? json.error.message : null };
}

module.exports = { notifyInvoice, notifyDispatch, notifyPO };
