// Fabric 4-point inspection & grading routes. Mounted at /api/fabric-inspection.
//
// Viewing is OPERATOR+ (the floor needs to see grades); recording/voiding is
// SUPERVISOR with QC opted in — the same authority that owns the existing quality
// gate. Grading itself is done in the service via the pure 4-point library.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const svc = require('../lib/fabric-inspection')(pool);
  const QC = { also: ['QC'] };
  const fail = (res, o) => res.status(o.code || 400).json({ error: o.error });

  // Current A/B thresholds (points per 100 sq yd) for the entry screen.
  router.get('/thresholds', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await svc.getThresholds()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Live grade preview as defects are entered — no row is written.
  router.post('/preview', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await svc.preview(req.body || {})); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Rolls awaiting inspection (worklist): ?stage=GREIGE|FINISHED.
  router.get('/pending', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await svc.pending({ stage: req.query.stage })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Grade distribution + defect Pareto for the quality dashboard.
  router.get('/report', verifyToken, requireRole('SUPERVISOR', QC), async (req, res) => {
    try { res.json(await svc.report({ stage: req.query.stage, from: req.query.from, to: req.query.to })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try {
      res.json(await svc.list({
        stage: req.query.stage, grade: req.query.grade, roll_id: req.query.roll_id,
        from: req.query.from, to: req.query.to,
      }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/:id', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try {
      const one = await svc.get(req.params.id);
      if (!one) return res.status(404).json({ error: 'Inspection not found' });
      res.json(one);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Record an inspection: compute grade, store header + defect lines, quarantine
  // the roll on REJECT.
  router.post('/', verifyToken, requireRole('SUPERVISOR', QC), async (req, res) => {
    try {
      const out = await svc.create(req.body || {}, req.user?.username);
      if (out.error) return fail(res, out);
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/:id/void', verifyToken, requireRole('SUPERVISOR', QC), async (req, res) => {
    try {
      const out = await svc.voidInspection(req.params.id, req.user?.username);
      if (out.error) return fail(res, out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
