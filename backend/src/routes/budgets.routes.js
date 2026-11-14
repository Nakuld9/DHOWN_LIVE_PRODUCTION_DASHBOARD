// Budget & scenario routes — CFO module §11. Mounted at /api/budgets.
// Reads: SUPERVISOR + ACCOUNTS + AUDITOR. Writes: SUPERVISOR + ACCOUNTS. Delete: ADMIN + ACCOUNTS.
// "Actual" is sourced only from the MES (invoices/receipts/loan schedules); Busy-only
// line items are reported as not sourced, never faked.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const budgets = require('../lib/budgets')(pool);
  const READ = requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] });
  const WRITE = requireRole('SUPERVISOR', { also: ['ACCOUNTS'] });
  const ADMIN = requireRole('ADMIN', { also: ['ACCOUNTS'] });
  const send = (res, out, ok = 200) => {
    if (!out) return res.status(500).json({ error: 'no result' });
    if (out.badRequest) return res.status(400).json({ error: out.badRequest });
    if (out.notFound) return res.status(404).json({ error: 'not found' });
    return res.status(ok).json(out);
  };
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { console.error('[budgets]', e.message); res.status(500).json({ error: e.message }); } };

  router.get('/', verifyToken, READ, wrap(async (req, res) => res.json(await budgets.listVersions())));
  router.get('/line-items', verifyToken, READ, wrap(async (req, res) => res.json({ line_items: budgets.LINE_ITEMS, scenarios: budgets.SCENARIOS })));
  router.get('/:id', verifyToken, READ, wrap(async (req, res) => send(res, await budgets.getVersion(req.params.id))));
  router.get('/:id/variance', verifyToken, READ, wrap(async (req, res) => send(res, await budgets.variance(req.params.id, req.query.scenario || 'BASE'))));
  router.get('/:id/actuals', verifyToken, READ, wrap(async (req, res) => { const v = await budgets.getVersion(req.params.id); if (v.notFound) return send(res, v); res.json(await budgets.actuals(v.row.fy)); }));

  router.post('/', verifyToken, WRITE, wrap(async (req, res) => send(res, await budgets.createVersion(req.body, req.user?.username), 201)));
  router.put('/:id/lines', verifyToken, WRITE, wrap(async (req, res) => send(res, await budgets.upsertLines(req.params.id, req.body, req.user?.username))));
  router.post('/:id/derive', verifyToken, WRITE, wrap(async (req, res) => send(res, await budgets.deriveScenario(req.params.id, req.body, req.user?.username))));
  router.put('/:id/assumptions', verifyToken, WRITE, wrap(async (req, res) => send(res, await budgets.setAssumptions(req.params.id, req.body, req.user?.username))));
  router.put('/:id/status', verifyToken, WRITE, wrap(async (req, res) => send(res, await budgets.setStatus(req.params.id, req.body?.status, req.user?.username))));
  router.delete('/:id', verifyToken, ADMIN, wrap(async (req, res) => send(res, await budgets.remove(req.params.id, req.user?.username))));

  return router;
};
