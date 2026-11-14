// Executive CFO dashboard route — CFO module §4. Mounted at /api/cfo.
// Read-only consolidated snapshot; cost/finance-sensitive, so SUPERVISOR + ACCOUNTS + AUDITOR.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const dash = require('../lib/cfo-dashboard')(pool);
  const READ = requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] });
  router.get('/dashboard', verifyToken, READ, async (req, res) => {
    try { res.json(await dash.snapshot()); }
    catch (e) { console.error('[cfo-dashboard]', e.message); res.status(500).json({ error: e.message }); }
  });
  return router;
};
