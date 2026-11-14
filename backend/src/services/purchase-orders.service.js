// Purchase Orders service — status lifecycle + PO numbering.
// Lifecycle: DRAFT → SENT → (PARTIALLY_RECEIVED) → RECEIVED, or → CANCELLED.
// nextDocNumber (doc_series 'PO') is injected from server.js.
const ALLOWED = {
  DRAFT:              ['SENT', 'CANCELLED'],
  SENT:               ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['RECEIVED', 'CANCELLED'],
  RECEIVED:           [],
  CANCELLED:          [],
};

module.exports = (repo, { nextDocNumber, io }) => ({
  async list(filters) {
    return repo.list(filters); // { data, total }
  },

  async get(id) {
    const row = await repo.findById(id);
    if (!row) return { notFound: true };
    return { row };
  },

  async create(body) {
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return { badRequest: 'A purchase order needs at least one line item.' };
    }
    if (!body.supplier_name && !body.partner_id) {
      return { badRequest: 'A supplier is required.' };
    }
    const poNumber = await nextDocNumber('PO');
    const row = await repo.insert(poNumber, body);
    if (io) io.emit('purchase:po_update', { action: 'created', po_id: row.po_id });
    return { row };
  },

  // Generic status transition guarded by the lifecycle table.
  async transition(id, next) {
    const s = await repo.findStatus(id);
    if (!s.rows.length) return { notFound: true };
    const cur = s.rows[0].status;
    if (cur === next) return { row: await repo.findById(id) };
    if (!ALLOWED[cur] || !ALLOWED[cur].includes(next)) {
      return { badRequest: `Cannot change a ${cur} purchase order to ${next}.` };
    }
    await repo.setStatus(id, next);
    if (io) io.emit('purchase:po_update', { action: next.toLowerCase(), po_id: id });
    return { row: await repo.findById(id) };
  },

  async updateHeader(id, body) {
    const s = await repo.findStatus(id);
    if (!s.rows.length) return { notFound: true };
    if (s.rows[0].status !== 'DRAFT') return { badRequest: 'Only DRAFT purchase orders can be edited.' };
    await repo.updateHeader(id, body);
    return { row: await repo.findById(id) };
  },

  async remove(id) {
    const s = await repo.findStatus(id);
    if (!s.rows.length) return { notFound: true };
    if (!['DRAFT', 'CANCELLED'].includes(s.rows[0].status)) {
      return { badRequest: 'Only DRAFT or CANCELLED purchase orders can be deleted.' };
    }
    const r = await repo.remove(id);
    if (io) io.emit('purchase:po_update', { action: 'deleted', po_id: id });
    return r;
  },
});
