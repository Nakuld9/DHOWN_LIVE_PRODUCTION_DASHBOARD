// Sales Orders service — status lifecycle + SO numbering.
// Lifecycle: DRAFT → CONFIRMED → (PARTIALLY_DISPATCHED) → DISPATCHED, or → CANCELLED.
// nextInvSeq (SO-YYYY-NNN from the sales_orders table) is injected from server.js.
const ALLOWED = {
  DRAFT:                ['CONFIRMED', 'CANCELLED'],
  CONFIRMED:            ['PARTIALLY_DISPATCHED', 'DISPATCHED', 'CANCELLED'],
  PARTIALLY_DISPATCHED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED:           [],
  CANCELLED:            [],
};

module.exports = (repo, { nextInvSeq, io }) => ({
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
      return { badRequest: 'A sales order needs at least one line item.' };
    }
    if (!body.customer_name && !body.partner_id) {
      return { badRequest: 'A customer is required.' };
    }
    const soNumber = await nextInvSeq('SO', 'sales_orders', 'so_number');
    const row = await repo.insert(soNumber, body);
    if (io) io.emit('sales:so_update', { action: 'created', so_id: row.so_id });
    return { row };
  },

  async transition(id, next) {
    const s = await repo.findStatus(id);
    if (!s.rows.length) return { notFound: true };
    const cur = s.rows[0].status;
    if (cur === next) return { row: await repo.findById(id) };
    if (!ALLOWED[cur] || !ALLOWED[cur].includes(next)) {
      return { badRequest: `Cannot change a ${cur} sales order to ${next}.` };
    }
    await repo.setStatus(id, next);
    if (io) io.emit('sales:so_update', { action: next.toLowerCase(), so_id: id });
    return { row: await repo.findById(id) };
  },

  async updateHeader(id, body) {
    const s = await repo.findStatus(id);
    if (!s.rows.length) return { notFound: true };
    if (s.rows[0].status !== 'DRAFT') return { badRequest: 'Only DRAFT sales orders can be edited.' };
    await repo.updateHeader(id, body);
    return { row: await repo.findById(id) };
  },

  async remove(id) {
    const s = await repo.findStatus(id);
    if (!s.rows.length) return { notFound: true };
    if (!['DRAFT', 'CANCELLED'].includes(s.rows[0].status)) {
      return { badRequest: 'Only DRAFT or CANCELLED sales orders can be deleted.' };
    }
    const r = await repo.remove(id);
    if (io) io.emit('sales:so_update', { action: 'deleted', so_id: id });
    return r;
  },
});
