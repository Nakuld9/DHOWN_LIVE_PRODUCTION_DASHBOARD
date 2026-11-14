// Tax Invoices service — GST computation + lifecycle + numbering.
// GST: INTRA-state → CGST + SGST (gst_rate split in half each);
//      INTER-state → IGST (full gst_rate). Lifecycle DRAFT→ISSUED→PAID/CANCELLED.
// nextInvSeq (INV-YYYY-NNN from tax_invoices) is injected from server.js.
const ALLOWED = {
  DRAFT:     ['ISSUED', 'CANCELLED'],
  ISSUED:    ['PAID', 'CANCELLED'],
  PAID:      [],
  CANCELLED: [],
};

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Compute per-line tax + invoice totals. Pure function — easy to reason about.
function computeTax(items, supplyType) {
  const inter = supplyType === 'INTER';
  const lines = items.map(it => {
    const qty = Number(it.quantity) || 0;
    const rate = Number(it.rate) || 0;
    const gst = Number(it.gst_rate) || 0;
    const taxable = r2(qty * rate);
    const igst = inter ? r2(taxable * gst / 100) : 0;
    const cgst = inter ? 0 : r2(taxable * gst / 200);
    const sgst = inter ? 0 : r2(taxable * gst / 200);
    return {
      item_id: it.item_id || null, item_name: it.item_name || null, hsn_code: it.hsn_code || null,
      quantity: qty, uom: it.uom || 'KG', rate, gst_rate: gst,
      taxable_value: taxable, cgst_amount: cgst, sgst_amount: sgst, igst_amount: igst,
      line_total: r2(taxable + cgst + sgst + igst),
    };
  });
  const sum = k => r2(lines.reduce((s, L) => s + L[k], 0));
  const taxable = sum('taxable_value');
  const cgst = sum('cgst_amount'), sgst = sum('sgst_amount'), igst = sum('igst_amount');
  const tax = r2(cgst + sgst + igst);
  const raw = r2(taxable + tax);
  const grand = Math.round(raw);
  return { lines, totals: { taxable, cgst, sgst, igst, tax, round_off: r2(grand - raw), grand } };
}

module.exports = (repo, { nextInvSeq, io }) => ({
  async list(filters) {
    return (await repo.list(filters)).rows;
  },

  async get(id) {
    const row = await repo.findById(id);
    if (!row) return { notFound: true };
    return { row };
  },

  async create(body) {
    if (!Array.isArray(body.items) || body.items.length === 0) return { badRequest: 'An invoice needs at least one line item.' };
    if (!body.customer_name && !body.partner_id) return { badRequest: 'A customer is required.' };
    const valid = body.items.filter(it => (it.item_name || it.item_id) && Number(it.quantity) > 0);
    if (valid.length === 0) return { badRequest: 'Add at least one line item with a name and quantity.' };
    const { lines, totals } = computeTax(valid, body.supply_type === 'INTER' ? 'INTER' : 'INTRA');
    const invoiceNumber = await nextInvSeq('INV', 'tax_invoices', 'invoice_number');
    const row = await repo.insert(invoiceNumber, body, lines, totals);
    if (io) io.emit('invoice:update', { action: 'created', invoice_id: row.invoice_id });
    return { row };
  },

  async transition(id, next) {
    const s = await repo.findStatus(id);
    if (!s.rows.length) return { notFound: true };
    const cur = s.rows[0].status;
    if (cur === next) return { row: await repo.findById(id) };
    if (!ALLOWED[cur] || !ALLOWED[cur].includes(next)) {
      return { badRequest: `Cannot change a ${cur} invoice to ${next}.` };
    }
    await repo.setStatus(id, next);
    if (io) io.emit('invoice:update', { action: next.toLowerCase(), invoice_id: id });
    return { row: await repo.findById(id) };
  },

  async remove(id) {
    const s = await repo.findStatus(id);
    if (!s.rows.length) return { notFound: true };
    if (!['DRAFT', 'CANCELLED'].includes(s.rows[0].status)) {
      return { badRequest: 'Only DRAFT or CANCELLED invoices can be deleted (issued invoices must be cancelled first).' };
    }
    const r = await repo.remove(id);
    if (io) io.emit('invoice:update', { action: 'deleted', invoice_id: id });
    return r;
  },
});

// Exposed for unit tests (pure functions, no side effects).
module.exports.computeTax = computeTax;
module.exports.r2 = r2;
