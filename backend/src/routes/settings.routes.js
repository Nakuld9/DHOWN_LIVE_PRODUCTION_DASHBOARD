// Settings routes — wires repository -> service -> controller. Injected pool +
// verifyToken from server.js reuse the monolith's single pool and auth.
//
// Endpoints (mounted at /api/settings — identical to former inline handlers):
//   GET /api/settings   (no auth)
//   PUT /api/settings   (verifyToken)
const express = require('express');
const makeRepository = require('../repositories/settings.repository');
const makeService = require('../services/settings.service');
const makeController = require('../controllers/settings.controller');

const retention = require('../lib/retention');
const migrate = require('../db/migrate');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();

  // Every route below requires a valid session. Applied at router level so a
  // route added later is guarded by default; individual routes add requireRole
  // on top where a specific role is needed.
  router.use(verifyToken);

  const controller = makeController(makeService(makeRepository(pool)));

  router.get('/', controller.get);
  router.put('/', verifyToken, requireRole('ADMIN'), controller.update);

  // Schema version and fingerprint. Two servers with the same fingerprint have
  // the same structure, whatever route each took to get there — which is the
  // question worth asking when one firm's instance behaves differently.
  router.get('/schema', verifyToken, requireRole('ADMIN'), async (req, res) => {
    try { res.json(await migrate.status()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // What retention would remove, and applying it. The report is read-only; the
  // apply is destructive and defaults to a dry run unless confirm=true is sent,
  // so a mistyped request cannot delete anything.
  router.get('/retention', verifyToken, async (req, res) => {
    try { res.json(await retention.report()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/retention/run', verifyToken, requireRole('ADMIN'), async (req, res) => {
    try { res.json(await retention.run({ dryRun: req.body?.confirm !== true, only: req.body?.table || null })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Approval matrix ──────────────────────────────────────────────────
  // The bands were seeded from code and editable only by SQL, so the rule
  // deciding whether a ten-lakh order needs an admin lived where nobody could
  // see it. Reading is SUPERVISOR; changing who must approve what is itself a
  // senior decision, so writing is ADMIN.
  const matrix = require('../lib/approval-matrix')(pool);
  const mFail = (res, out) => res.status(out.code || 400).json({ error: out.error });

  router.get('/approval-matrix', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try { res.json(await matrix.list()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // What the live lookup WOULD decide for a value — the policy as applied,
  // rather than the policy as written.
  router.get('/approval-matrix/preview', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try { res.json(await matrix.preview(req.query.doc_type, req.query.value)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/approval-matrix', verifyToken, requireRole('ADMIN'), async (req, res) => {
    try {
      const out = await matrix.create(req.body || {}, { by: req.user?.username });
      if (out.error) return mFail(res, out);
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/approval-matrix/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
    try {
      const out = await matrix.update(req.params.id, req.body || {}, { by: req.user?.username });
      if (out.error) return mFail(res, out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/approval-matrix/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
    try {
      const out = await matrix.deactivate(req.params.id, { by: req.user?.username });
      if (out.error) return mFail(res, out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
