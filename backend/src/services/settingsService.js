const { getSettings: getSettingsRepo, updateSettings: updateSettingsRepo } = require('../repositories/settingsRepository');

/**
 * Retrieves all settings from the database.
 * @returns {Promise<Object>} A promise that resolves to an object with key-value pairs of settings.
 */
async function getSettings() {
  return await getSettingsRepo();
}

/**
 * Updates multiple settings in the database.
 * @param {Object} updates - An object where keys are setting names and values are the new values.
 * @returns {Promise<void>}
 */
async function updateSettings(updates) {
  await updateSettingsRepo(updates);
}

module.exports = { getSettings, updateSettings };