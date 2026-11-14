// Maintenance-records service — business rules for machine maintenance log.
module.exports = (repo) => ({
  async list() {
    const { rows } = await repo.findAll();
    return rows;
  },

  async create(b) {
    const { rows } = await repo.insert(b);
    return { row: rows[0] };
  },

  async edit(id, b) {
    const { rows } = await repo.update(id, b);
    if (rows.length === 0) return { notFound: true };
    return { row: rows[0] };
  },

  async remove(id) {
    const { rows } = await repo.remove(id);
    if (rows.length === 0) return { notFound: true };
    return { ok: true };
  },
});
