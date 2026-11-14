// Work-orders service — maintenance work-order business logic.
const STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

module.exports = (repo) => ({
  async list(filters) {
    const r = await repo.findAll(filters);
    return r.rows;
  },

  async get(id) {
    const r = await repo.findById(id);
    if (r.rows.length === 0) return { notFound: true };
    return { row: r.rows[0] };
  },

  async create(body, reportedBy) {
    if (!body.machine_id || !body.title) return { badRequest: 'machine_id and title are required' };
    const r = await repo.insert(body, reportedBy);
    return { row: r.rows[0] };
  },

  async edit(id, body) {
    const existing = await repo.findById(id);
    if (existing.rows.length === 0) return { notFound: true };
    const cur = existing.rows[0];
    const r = await repo.update(id, {
      title: body.title ?? cur.title,
      description: body.description ?? cur.description,
      work_order_type: body.work_order_type ?? cur.work_order_type,
      priority: body.priority ?? cur.priority,
      assigned_to: body.assigned_to ?? cur.assigned_to,
    });
    return { row: r.rows[0] };
  },

  async changeStatus(id, status, extra, completedBy) {
    if (!STATUSES.includes(status)) return { badRequest: `status must be one of ${STATUSES.join(', ')}` };
    const existing = await repo.findById(id);
    if (existing.rows.length === 0) return { notFound: true };
    const extras = { ...extra };
    if (status === 'COMPLETED' && !extras.completed_by) extras.completed_by = completedBy;
    const r = await repo.setStatus(id, status, extras);
    return { row: r.rows[0] };
  },

  async remove(id) {
    const existing = await repo.findById(id);
    if (existing.rows.length === 0) return { notFound: true };
    await repo.remove(id);
    return { ok: true };
  },

  async partsUsed(id) {
    const r = await repo.listPartsUsed(id);
    return r.rows;
  },

  async usePart(id, body, username) {
    if (!body || !body.part_id) return { badRequest: 'part_id is required' };
    const qty = parseFloat(body.quantity);
    if (isNaN(qty) || qty <= 0) return { badRequest: 'quantity must be a positive number' };
    return repo.addPartUsed(id, body, username);
  },
});
