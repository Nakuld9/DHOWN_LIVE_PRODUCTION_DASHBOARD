// Operators service — business logic. Behavior preserved verbatim from server.js.
// Returns { notFound: true } for missing rows so the controller can map to 404,
// exactly as the original inline handlers did.
module.exports = (repo) => ({
  async list(includeInactive) {
    const result = await repo.findAll(includeInactive);
    return result.rows;
  },

  async create(body) {
    const result = await repo.insert(body);
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
