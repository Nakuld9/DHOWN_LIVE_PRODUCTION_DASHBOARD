const pool = require('../config/database');

/**
 * Get all settings from the app_settings table.
 * @returns {Promise<Array<{key: string, value: string}>>} Array of setting objects.
 */
async function getSettings() {
  const result = await pool.query(`SELECT key, value FROM app_settings ORDER BY key`);
  return result.rows;
}

/**
 * Update multiple settings in the app_settings table.
 * Each key-value pair in the updates object will be inserted or updated.
 * @param {Object} updates - Object where keys are setting keys and values are the new values.
 * @returns {Promise<void>}
 */
async function updateSettings(updates) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(updates)) {
      await client.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, String(value)]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getSettings, updateSettings };