// Settings repository — data access only. SQL preserved verbatim from server.js.
// Table: app_settings (key, value, updated_at). Injected pool = monolith's own pool.
module.exports = (pool) => ({
  getAll() {
    return pool.query(`SELECT key, value FROM app_settings ORDER BY key`);
  },

  upsert(key, value) {
    return pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, String(value)]
    );
  },
});
