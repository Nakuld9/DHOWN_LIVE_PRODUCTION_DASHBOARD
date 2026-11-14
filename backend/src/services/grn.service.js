// GRN service — status rules + socket notifications.
// nextInvSeq and the socket.io server (io) are injected from server.js.
// Socket event names/payloads preserved verbatim from the inline handlers.
module.exports = (repo, { nextInvSeq, io }) => ({
  async list(filters) {
    return repo.list(filters); // { data, total }
  },

  async create(body) {
    const grn_number = await nextInvSeq('GRN', 'grn', 'grn_number');
    const r = await repo.insert(grn_number, body);
    io.emit('inventory:grn_update', { action: 'created', grn: r.rows[0] });
    return { row: r.rows[0] };
  },

  async get(id) {
    const row = await repo.findById(id);
    if (!row) return { notFound: true };
    return { row };
  },

  async addLot(grnId, body) {
    const lot_number = await nextInvSeq('LOT', 'yarn_lots', 'lot_number');
    const result = await repo.addLot(grnId, lot_number, body);
    io.emit('inventory:yarn_stock_update', { action: 'lot_added', lot: result.row });
    return result;
  },

  async removeLot(grnId, lotId) {
    const g = await repo.findStatus(grnId);
    if (!g.rows.length) return { notFound: true };
    if (g.rows[0].status !== 'DRAFT') return { badRequest: 'Can only edit lots on a DRAFT GRN' };
    return repo.removeLot(grnId, lotId);
  },

  async approve(id, username) {
    const result = await repo.approve(id, username);
    io.emit('inventory:grn_update', { action: 'approved', grn_id: id });
    return result;
  },

  async remove(id) {
    const result = await repo.removeGrn(id);
    if (result.ok) io.emit('inventory:grn_update', { action: 'deleted', grn_id: id });
    return result;
  },

  async cancel(id) {
    const result = await repo.cancelGrn(id);
    if (result.ok) io.emit('inventory:grn_update', { action: 'cancelled', grn_id: id });
    return result;
  },

  async updateHeader(id, body) {
    const g = await repo.findStatus(id);
    if (!g.rows.length) return { notFound: true };
    if (g.rows[0].status !== 'DRAFT') return { badRequest: 'Only DRAFT GRNs can be edited' };
    const r = await repo.updateHeader(id, body);
    return { row: r.rows[0] };
  },
});
