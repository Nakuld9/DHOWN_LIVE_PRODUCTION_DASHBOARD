// Complaints API. Mounted at /api/complaints.
//
// Logging one is OPERATOR: whoever takes the call should be able to record it
// without finding a supervisor, because the alternative is that it does not get
// recorded at all. Resolving and rejecting are SUPERVISOR — deciding that a
// customer's complaint is closed is a judgement with money attached, and SALES
// and ACCOUNTS both need it because both field these calls.

const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  router.use(verifyToken);

  const complaints = require('../lib/complaints')(pool);
  const CS = { also: ['SALES', 'ACCOUNTS'] };
  const fail = (res, out) => res.status(out.code || 400).json({ error: out.error });

  // The vocabulary, so the form never invents a category the API will reject.
  router.get('/meta', requireRole('OPERATOR'), (req, res) => {
    res.json({
      categories: complaints.CATEGORIES,
      severities: complaints.SEVERITIES,
      sources: complaints.SOURCES,
      resolutions: complaints.RESOLUTIONS,
      transitions: complaints.TRANSITIONS,
      sla_days: complaints.SLA_DAYS,
    });
  });

  router.get('/stats', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await complaints.stats({ from: req.query.from || null, to: req.query.to || null })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/', requireRole('OPERATOR'), async (req, res) => {
    try {
      res.json(await complaints.list({
        status: req.query.status || null,
        partner_id: req.query.partner_id ? parseInt(req.query.partner_id, 10) : null,
        category: req.query.category || null,
        overdue: req.query.overdue === 'true',
      }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/:id', requireRole('OPERATOR'), async (req, res) => {
    try {
      const out = await complaints.get(req.params.id);
      if (out.error) return fail(res, out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/', requireRole('OPERATOR'), async (req, res) => {
    try {
      const out = await complaints.create(req.body || {}, { by: req.user?.username });
      if (out.error) return fail(res, out);
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/:id/notes', requireRole('OPERATOR'), async (req, res) => {
    try {
      const out = await complaints.addNote(req.params.id, { note: req.body?.note, by: req.user?.username });
      if (out.error) return fail(res, out);
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/:id/assign', requireRole('OPERATOR'), async (req, res) => {
    try {
      const out = await complaints.assign(req.params.id, req.body?.assigned_to, { by: req.user?.username });
      if (out.error) return fail(res, out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Closing a customer's complaint is a judgement with money attached.
  router.put('/:id/status', requireRole('SUPERVISOR', CS), async (req, res) => {
    try {
      const out = await complaints.transition(req.params.id, req.body?.status, {
        by: req.user?.username,
        note: req.body?.note,
        resolution: req.body?.resolution,
        resolution_type: req.body?.resolution_type,
        root_cause: req.body?.root_cause,
      });
      if (out.error) return fail(res, out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
