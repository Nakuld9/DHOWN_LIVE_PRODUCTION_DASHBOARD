// Spare-parts service — validation + business rules for spare parts inventory.
const MOVEMENTS = ['RECEIVED', 'CONSUMED', 'ADJUSTMENT', 'RETURNED'];

module.exports = (repo) => ({
  async list(filters) {
    const { rows } = await repo.findAll(filters);
    return rows;
  },

  async get(id) {
    const { rows } = await repo.findById(id);
    if (rows.length === 0) return { notFound: true };
    return { row: rows[0] };
  },

  async create(b) {
    if (!b || !b.part_name) return { badRequest: 'part_name is required' };
    const { rows } = await repo.insert(b);
    return { row: rows[0] };
  },

  async edit(id, b) {
    if (!b || !b.part_name) return { badRequest: 'part_name is required' };
    const { rows } = await repo.update(id, b);
    if (rows.length === 0) return { notFound: true };
    return { row: rows[0] };
  },

  async remove(id) {
    try {
      const { rowCount } = await repo.remove(id);
      if (rowCount === 0) return { notFound: true };
      return { ok: true };
    } catch (err) {
      // FK violation: part has movement history — block deletion, keep the audit trail.
      if (err.code === '23503')
        return { badRequest: 'Cannot delete: this part has stock movement history' };
      throw err;
    }
  },

  async movements(partId) {
    const { rows } = await repo.listMovements(partId);
    return rows;
  },

  async move(partId, body, username) {
    if (!body || !MOVEMENTS.includes(body.movement_type))
      return { badRequest: `movement_type must be one of ${MOVEMENTS.join(', ')}` };
    const qty = parseFloat(body.quantity);
    if (isNaN(qty) || qty < 0) return { badRequest: 'quantity must be a non-negative number' };
    return repo.recordMovement(partId, {
      movement_type: body.movement_type,
      quantity: qty,
      reference: body.reference,
      notes: body.notes,
      created_by: username || body.created_by,
      unit_cost: body.unit_cost,
      supplier: body.supplier,
      machine_id: body.machine_id,
    });
  },
});
