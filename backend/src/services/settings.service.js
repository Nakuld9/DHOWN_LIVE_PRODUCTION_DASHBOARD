// Settings service — business logic preserved verbatim from server.js.
// getAll flattens rows into a { key: value } object; saveAll upserts each entry.
const { invalidate } = require('../lib/company');
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
    // Company identity is cached for report letterheads and AI prompts. Drop it
    // so an edit here shows on the next printed document rather than after a
    // restart or a minute's wait.
    invalidate();
    return { success: true, message: 'Settings saved' };
  },
});
