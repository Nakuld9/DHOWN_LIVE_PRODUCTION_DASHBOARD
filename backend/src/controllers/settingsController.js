const { getSettings, updateSettings } = require('../services/settingsService');
const { verifyToken } = require('../middleware/auth');

/**
 * GET /api/settings
 * Returns all settings as key-value pairs.
 * No authentication required.
 */
async function getSettingsHandler(req, res) {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

/**
 * PUT /api/settings
 * Updates multiple settings.
 * Requires authentication (verifyToken).
 * Expects a JSON body with key-value pairs to update.
 */
async function updateSettingsHandler(req, res) {
  try {
    const updates = req.body;
    await updateSettings(updates);
    res.json({ success: true, message: 'Settings saved' });
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

module.exports = { getSettingsHandler, updateSettingsHandler };