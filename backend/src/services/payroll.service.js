// Payroll service — run lifecycle + numbering.
// Lifecycle: DRAFT (editable) → FINALIZED (locked) → PAID.
// nextInvSeq (PR-YYYY-NNN from payroll_runs) is injected from server.js.
const ALLOWED = {
  DRAFT:     ['FINALIZED', 'CANCELLED'],
  FINALIZED: ['PAID', 'DRAFT', 'CANCELLED'],
  PAID:      [],
  CANCELLED: [],
};

module.exports = (repo, { nextInvSeq, io }) => ({
  async listRuns() {
    return (await repo.listRuns()).rows;
  },

  async getRun(id) {
    const row = await repo.findRun(id);
    if (!row) return { notFound: true };
    return { row };
  },

  async createRun(body) {
    if (!body.period_from || !body.period_to) return { badRequest: 'Period start and end are required.' };
    if (body.period_to < body.period_from) return { badRequest: 'Period end must be on or after the start.' };
    const runNumber = await nextInvSeq('PR', 'payroll_runs', 'run_number');
    const row = await repo.createRun(runNumber, body);
    if (io) io.emit('payroll:run_update', { action: 'created', run_id: row.run_id });
    return { row };
  },

  async updateItem(runId, itemId, body) {
    const s = await repo.findStatus(runId);
    if (!s.rows.length) return { notFound: true };
    if (s.rows[0].status !== 'DRAFT') return { badRequest: 'Only DRAFT payroll runs can be edited.' };
    const row = await repo.updateItem(itemId, body);
    if (!row) return { notFound: true };
    return { row };
  },

  async transition(id, next) {
    const s = await repo.findStatus(id);
    if (!s.rows.length) return { notFound: true };
    const cur = s.rows[0].status;
    if (cur === next) return { row: await repo.findRun(id) };
    if (!ALLOWED[cur] || !ALLOWED[cur].includes(next)) {
      return { badRequest: `Cannot change a ${cur} payroll run to ${next}.` };
    }
    await repo.setStatus(id, next);
    if (io) io.emit('payroll:run_update', { action: next.toLowerCase(), run_id: id });
    return { row: await repo.findRun(id) };
  },

  async removeRun(id) {
    const s = await repo.findStatus(id);
    if (!s.rows.length) return { notFound: true };
    if (s.rows[0].status === 'PAID') return { badRequest: 'A PAID payroll run cannot be deleted.' };
    const r = await repo.removeRun(id);
    if (io) io.emit('payroll:run_update', { action: 'deleted', run_id: id });
    return r;
  },
});
