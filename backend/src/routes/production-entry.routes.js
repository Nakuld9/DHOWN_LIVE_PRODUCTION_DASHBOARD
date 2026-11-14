// Manual shift-production entry. Mounted at /api/production-entry.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const svc = require('../lib/production-entry')(pool);
  const fail = (res, o) => res.status(o.code || 400).json({ error: o.error });

  router.post('/', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try { const o = await svc.create(req.body || {}, req.user?.username); if (o.error) return fail(res, o); res.status(201).json(o); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/recent', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await svc.recent({})); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
