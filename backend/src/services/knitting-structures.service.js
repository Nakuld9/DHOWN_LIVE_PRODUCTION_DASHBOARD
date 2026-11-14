// Knitting-structures service — validation + id generation.
const { randomUUID } = require('crypto');

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
    if (!b || !b.structure_name) return { badRequest: 'structure_name is required' };
    if (!['SJ', 'DJ'].includes(b.machine_type)) return { badRequest: "machine_type must be 'SJ' or 'DJ'" };
    const { rows } = await repo.insert(randomUUID(), b);
    return { row: rows[0] };
  },

  async edit(id, b) {
    if (!b || !b.structure_name) return { badRequest: 'structure_name is required' };
    if (!['SJ', 'DJ'].includes(b.machine_type)) return { badRequest: "machine_type must be 'SJ' or 'DJ'" };
    const { rows } = await repo.update(id, b);
    if (rows.length === 0) return { notFound: true };
    return { row: rows[0] };
  },

  async favourite(id, fav) {
    const { rows } = await repo.setFavourite(id, fav);
    if (rows.length === 0) return { notFound: true };
    return { row: rows[0] };
  },

  async remove(id) {
    const { rowCount } = await repo.remove(id);
    if (rowCount === 0) return { notFound: true };
    return { ok: true };
  },
});
