// Defect-type master management. Mounted at /api/defect-types.
// Viewing is OPERATOR+; editing is SUPERVISOR with QC opted in — the same
// authority that records inspections. (The active-only list the inspection screen
// uses stays at /api/quality-defect-types.)
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const svc = require('../lib/defect-types')(pool);
  const QC = { also: ['QC'] };
  const fail = (res, o) => res.status(o.code || 400).json({ error: o.error });

  router.get('/', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await svc.listAll()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/', verifyToken, requireRole('SUPERVISOR', QC), async (req, res) => {
    try { const o = await svc.create(req.body || {}); if (o.error) return fail(res, o); res.status(201).json(o); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/:id', verifyToken, requireRole('SUPERVISOR', QC), async (req, res) => {
    try { const o = await svc.update(req.params.id, req.body || {}); if (o.error) return fail(res, o); res.json(o); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/:id/active', verifyToken, requireRole('SUPERVISOR', QC), async (req, res) => {
    try { const o = await svc.setActive(req.params.id, req.body?.active); if (o.error) return fail(res, o); res.json(o); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
