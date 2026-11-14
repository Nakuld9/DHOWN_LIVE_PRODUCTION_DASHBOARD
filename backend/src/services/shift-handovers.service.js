// Shift-handovers service — list + create with validation (verbatim).
module.exports = (repo) => ({
  async list(limit) {
    return (await repo.list(limit ?? 30)).rows;
  },

  async create(body, username) {
    if (!body.shift_date || !body.shift) return { badRequest: 'shift_date and shift are required' };
    const { rows } = await repo.insert(body, username);
    return { row: rows[0] };
  },
});
