const express = require('express');
const router = express.Router();
console.log('Settings route loaded');
const { verifyToken } = require('../middleware/auth');
const { getSettings, updateSettings } = require('../services/settingsService');

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings
router.put('/', verifyToken, async (req, res) => {
  try {
    const updates = req.body;
    await updateSettings(updates);
    res.json({ success: true, message: 'Settings saved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;