// Fabric-types service — business logic preserved verbatim from server.js.
// Duplicate-code (23505) errors are left to propagate so the controller maps them,
// exactly as the original inline handler did.
module.exports = (repo) => ({
  async list() {
    const r = await repo.getAll();
    return r.rows;
  },

  async create({ code, name, description }) {
    if (!code || !name) return { badRequest: true };
    const normalized = code.toUpperCase().replace(/\s+/g, '');
    const r = await repo.insert(normalized, name, description);
    return { row: r.rows[0] };
  },

  async edit(code, { name, description }) {
    const r = await repo.update(code, name, description);
    if (r.rows.length === 0) return { notFound: true };
    return { row: r.rows[0] };
  },

  async remove(code) {
    const inUse = await repo.countMachinesUsing(code);
    if (parseInt(inUse.rows[0].count) > 0) return { inUse: true };
    await repo.remove(code);
    return { ok: true };
  },
});
