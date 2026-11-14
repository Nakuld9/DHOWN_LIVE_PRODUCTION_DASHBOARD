// Production Plans service — status lifecycle + plan numbering + progress.
// Lifecycle: PLANNED → IN_PROGRESS → COMPLETED, with ON_HOLD/CANCELLED branches.
// nextInvSeq (PP-YYYY-NNN from production_plans) is injected from server.js.
const ALLOWED = {
  PLANNED:     ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'ON_HOLD', 'CANCELLED'],
  ON_HOLD:     ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED:   [],
  CANCELLED:   [],
};

module.exports = (repo, { nextInvSeq, io }) => ({
  async list(filters) {
    return (await repo.list(filters)).rows;
  },

  async get(id) {
    const r = await repo.findById(id);
    if (!r.rows.length) return { notFound: true };
    return { row: r.rows[0] };
  },

  async create(body) {
    if (!body.item_name && !body.item_id) return { badRequest: 'A fabric/item is required.' };
    if (!(Number(body.target_qty_kg) > 0)) return { badRequest: 'Target quantity must be greater than 0.' };
    const planNumber = await nextInvSeq('PP', 'production_plans', 'plan_number');
    const r = await repo.insert(planNumber, body);
    if (io) io.emit('production:plan_update', { action: 'created', plan_id: r.rows[0].plan_id });
    return { row: r.rows[0] };
  },

  async update(id, body) {
    const s = await repo.findStatus(id);
    if (!s.rows.length) return { notFound: true };
    if (['COMPLETED', 'CANCELLED'].includes(s.rows[0].status)) {
      return { badRequest: `A ${s.rows[0].status} plan cannot be edited.` };
    }
    const r = await repo.update(id, body);
    return { row: r.rows[0] };
  },

  async transition(id, next) {
    const s = await repo.findStatus(id);
    if (!s.rows.length) return { notFound: true };
    const cur = s.rows[0].status;
    if (cur === next) { const r = await repo.findById(id); return { row: r.rows[0] }; }
    if (!ALLOWED[cur] || !ALLOWED[cur].includes(next)) {
      return { badRequest: `Cannot change a ${cur} plan to ${next}.` };
    }
    const r = await repo.setStatus(id, next);
    if (io) io.emit('production:plan_update', { action: next.toLowerCase(), plan_id: id });
    return { row: r.rows[0] };
  },

  async setProgress(id, producedKg) {
    const s = await repo.findStatus(id);
    if (!s.rows.length) return { notFound: true };
    if (Number(producedKg) < 0) return { badRequest: 'Produced quantity cannot be negative.' };
    const r = await repo.setProgress(id, producedKg);
    if (io) io.emit('production:plan_update', { action: 'progress', plan_id: id });
    return { row: r.rows[0] };
  },

  async remove(id) {
    const s = await repo.findStatus(id);
    if (!s.rows.length) return { notFound: true };
    if (s.rows[0].status === 'IN_PROGRESS') return { badRequest: 'Put the plan on hold or cancel it before deleting.' };
    const r = await repo.remove(id);
    if (io) io.emit('production:plan_update', { action: 'deleted', plan_id: id });
    return r;
  },
});
