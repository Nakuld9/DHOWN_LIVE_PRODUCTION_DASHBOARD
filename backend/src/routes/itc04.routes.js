// ITC-04 job-work return — mounted at /api/itc04. SUPERVISOR + ACCOUNTS + AUDITOR.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const itc = require('../lib/itc04')(pool);
  const READ = requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] });

  router.get('/', verifyToken, READ, async (req, res) => {
    try {
      res.json(await itc.report({
        from: req.query.from, to: req.query.to,
        hsn: req.query.hsn, goods_rate_per_kg: req.query.goods_rate_per_kg,
      }));
    } catch (e) { console.error('[itc04]', e.message); res.status(500).json({ error: e.message }); }
  });

  return router;
};
