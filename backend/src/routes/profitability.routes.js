// Manufacturing profitability routes — CFO module §7. Mounted at /api/profitability.
// Cost-sensitive: reads SUPERVISOR + ACCOUNTS + AUDITOR; config writes SUPERVISOR + ACCOUNTS.
// Contribution is computed from real production + costing + dispatch pricing; nothing invented.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const prof = require('../lib/profitability')(pool);
  const READ = requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] });
  const WRITE = requireRole('SUPERVISOR', { also: ['ACCOUNTS'] });
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { console.error('[profitability]', e.message); res.status(500).json({ error: e.message }); } };

  router.get('/', verifyToken, READ, wrap(async (req, res) => res.json(await prof.byDimension(req.query.dimension || 'fabric', { from: req.query.from, to: req.query.to }))));
  router.get('/config', verifyToken, READ, wrap(async (req, res) => res.json(await prof.getConfig())));
  router.put('/config', verifyToken, WRITE, wrap(async (req, res) => res.json(await prof.setConfig(req.body, req.user?.username))));
  router.get('/dimensions', verifyToken, READ, wrap(async (req, res) => res.json({ dimensions: prof.DIMENSIONS, allocation_bases: prof.ALLOC_BASES })));

  return router;
};
