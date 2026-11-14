// Busy-21 CSV sync routes — GRN + dispatch CSV exports (layered architecture).
// Mounted at /api/busy-sync. Both ADMIN-only, matching the original handlers.
const express = require('express');
const makeRepository = require('../repositories/busy-sync.repository');
const makeService = require('../services/busy-sync.service');
const makeController = require('../controllers/busy-sync.controller');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const controller = makeController(makeService(makeRepository(pool)));

  router.get('/grn-csv', verifyToken, requireRole('ADMIN'), controller.grnCsv);
  router.get('/dispatch-csv', verifyToken, requireRole('ADMIN'), controller.dispatchCsv);

  // ── Production → Busy, shift by shift ────────────────────────────────
  // Reading and generating is ACCOUNTS/ADMIN work; voiding a batch is ADMIN
  // because it releases production to be re-sent and must not be casual.
  const prod = require('../lib/busy-production')(pool);
  const A = { also: ['ACCOUNTS'] };
  const fail = (res, o) => res.status(o.code || 400).json({ error: o.error });

  // What would be pushed — the un-sent produced shifts. Read-only.
  router.get('/production/preview', verifyToken, requireRole('ADMIN', A), async (req, res) => {
    try { res.json(await prod.preview({ from: req.query.from || null, to: req.query.to || null })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Commit an export — claims the rolls so they can never be sent twice — and
  // return the batch. The CSV is fetched separately so a claim is not tied to a
  // download succeeding.
  router.post('/production/export', verifyToken, requireRole('ADMIN', A), async (req, res) => {
    try {
      const out = await prod.generate({ from: req.body?.from || null, to: req.body?.to || null, by: req.user?.username });
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/production/history', verifyToken, requireRole('ADMIN', A), async (req, res) => {
    try { res.json(await prod.history({})); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Download a batch as the Busy CSV.
  router.get('/production/:id/csv', verifyToken, requireRole('ADMIN', A), async (req, res) => {
    try {
      const b = await prod.getBatch(req.params.id);
      if (!b) return res.status(404).json({ error: 'Batch not found' });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="busy_production_${req.params.id}.csv"`);
      res.send(prod.toCsv(b.lines, req.params.id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/production/:id/confirm', verifyToken, requireRole('ADMIN', A), async (req, res) => {
    try {
      const out = await prod.confirm(req.params.id, { by: req.user?.username, busy_ref: req.body?.busy_ref });
      if (out.error) return fail(res, out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/production/:id/void', verifyToken, requireRole('ADMIN'), async (req, res) => {
    try {
      const out = await prod.voidBatch(req.params.id, { by: req.user?.username, reason: req.body?.reason });
      if (out.error) return fail(res, out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
