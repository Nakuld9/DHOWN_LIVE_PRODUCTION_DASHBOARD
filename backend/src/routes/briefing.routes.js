// Morning Briefing routes — mounted at /api/briefing.
// Holds cash + shipment + production figures, so gate to SUPERVISOR + ACCOUNTS + AUDITOR.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const brief = require('../lib/morning-briefing')(pool);
  const READ = requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] });
  const WRITE = requireRole('SUPERVISOR', { also: ['ACCOUNTS'] });

  router.get('/today', verifyToken, READ, async (req, res) => {
    try { res.json(await brief.getToday()); }
    catch (e) { console.error('[briefing]', e.message); res.status(500).json({ error: e.message }); }
  });

  router.post('/regenerate', verifyToken, WRITE, async (req, res) => {
    try { res.json(await brief.generateForToday()); }
    catch (e) { console.error('[briefing-regen]', e.message); res.status(500).json({ error: e.message }); }
  });

  return router;
};
