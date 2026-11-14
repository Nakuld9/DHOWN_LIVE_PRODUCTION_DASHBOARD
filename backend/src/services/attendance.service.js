// Attendance service — date/shift defaults, verbatim from the original handlers.
module.exports = (repo) => ({
  async list({ date, shift }) {
    const day = date || new Date().toISOString().slice(0, 10);
    return (await repo.list({ date: day, shift: shift || null })).rows;
  },

  async summary({ from, to }) {
    const f = from || new Date().toISOString().slice(0, 10);
    const t = to || f;
    return (await repo.summary({ from: f, to: t })).rows;
  },

  // Manually mark a worker present (for staff without RFID cards —
  // supervisors, helpers, drivers, masters).
  async markPresent({ operator_id, work_date, shift }) {
    if (!operator_id) return { error: 'operator_id is required' };
    const day = work_date || new Date().toISOString().slice(0, 10);
    const sh = shift || 'D';
    const op = (await repo.findOperator(operator_id)).rows[0];
    const r = await repo.markPresent({
      operator_id,
      operator_name: op ? op.operator_name : null,
      work_date: day,
      shift: sh,
    });
    return { row: r.rows[0] };
  },

  async remove(id) {
    await repo.remove(id);
    return { ok: true };
  },
});
