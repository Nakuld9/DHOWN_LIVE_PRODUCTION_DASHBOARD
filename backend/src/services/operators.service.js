// Operators service — business logic. Behavior preserved verbatim from server.js.
// Returns { notFound: true } for missing rows so the controller can map to 404,
// exactly as the original inline handlers did.
// Worker type -> code prefix. Employee ID is company-wide (EMP) for everyone.
const TYPE_PREFIX = {
  OPERATOR: 'OP',
  HELPER: 'HP',
  SUPERVISOR: 'SV',
  MASTER: 'MS',
  DRIVER: 'DR',
};

module.exports = (repo) => ({
  async list(includeInactive) {
    const result = await repo.findAll(includeInactive);
    return result.rows;
  },

  async create(body) {
    // Auto-generate the role-specific code (OP/HP/SV/MS/DR + per-type sequence)
    // and a company-wide Employee ID (EMP + global sequence). Client-sent codes
    // are ignored. Worker type comes from a fixed allow-list.
    const workerType = TYPE_PREFIX[body.worker_type] ? body.worker_type : 'OPERATOR';
    const prefix = TYPE_PREFIX[workerType];
    const seq = (await repo.nextSequences(prefix)).rows[0];
    const codeNo = (Number(seq.max_code) || 0) + 1;
    const empNo  = (Number(seq.max_emp)  || 0) + 1;
    const result = await repo.insert({
      ...body,
      worker_type: workerType,
      operator_code: `${prefix}${String(codeNo).padStart(3, '0')}`,
      employee_id: `EMP${String(empNo).padStart(3, '0')}`,
    });
    return result.rows[0];
  },

  async edit(id, body) {
    const existing = await repo.findById(id);
    if (existing.rows.length === 0) return { notFound: true };
    const cur = existing.rows[0];
    const r = await repo.update(id, cur, body);
    return { row: r.rows[0] };
  },

  async deactivate(id) {
    const existing = await repo.findById(id);
    if (existing.rows.length === 0) return { notFound: true };
    await repo.deactivate(id);
    return { ok: true };
  },
});
