// Maintenance-schedule service — recurring PM task scheduling.
// next_due_date computation preserved verbatim from the inline handlers.
const addDays = (dateStr, days) =>
  new Date(new Date(dateStr).getTime() + days * 86400000).toISOString().slice(0, 10);

module.exports = (repo) => ({
  async list() {
    const { rows } = await repo.findActive();
    return rows;
  },

  async create(b) {
    if (!b.machine_id || !b.task_name) return { badRequest: 'machine_id and task_name are required' };
    const next_due_date = (b.last_done_date && b.frequency_days)
      ? addDays(b.last_done_date, b.frequency_days) : null;
    const { rows } = await repo.insert(b, next_due_date);
    return { row: rows[0] };
  },

  async complete(id, body, username) {
    const completedDate = body.done_date || new Date().toISOString().slice(0, 10);
    const existing = await repo.findById(id);
    if (existing.rows.length === 0) return { notFound: true };
    const sch = existing.rows[0];
    const next_due_date = sch.frequency_days ? addDays(completedDate, sch.frequency_days) : null;
    const { rows } = await repo.markDone(id, completedDate, next_due_date, body.notes || sch.notes);
    await repo.logCompletion(username, `schedule_id=${id} task=${sch.task_name} machine=${sch.machine_id}`);
    return { row: rows[0] };
  },

  async remove(id) {
    await repo.softDelete(id);
    return { ok: true };
  },
});
