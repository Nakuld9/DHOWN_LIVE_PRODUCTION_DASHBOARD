// Settings service — business logic preserved verbatim from server.js.
// getAll flattens rows into a { key: value } object; saveAll upserts each entry.
module.exports = (repo) => ({
  async getAll() {
    const result = await repo.getAll();
    const settings = {};
    result.rows.forEach(row => { settings[row.key] = row.value; });
    return settings;
  },

  async saveAll(updates) {
    for (const [key, value] of Object.entries(updates)) {
      await repo.upsert(key, value);
    }
    return { success: true, message: 'Settings saved' };
  },
});
