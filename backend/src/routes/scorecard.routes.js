// Partner scorecards — mounted at /api/scorecard. Holds spend + receivables, so
// gate to SUPERVISOR + ACCOUNTS + AUDITOR.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const sc = require('../lib/partner-scorecard')(pool);
  const READ = requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] });

  router.get('/suppliers', verifyToken, READ, async (req, res) => {
    try { res.json(await sc.suppliers()); }
    catch (e) { console.error('[scorecard-suppliers]', e.message); res.status(500).json({ error: e.message }); }
  });
  router.get('/customers', verifyToken, READ, async (req, res) => {
    try { res.json(await sc.customers()); }
    catch (e) { console.error('[scorecard-customers]', e.message); res.status(500).json({ error: e.message }); }
  });

  return router;
};
