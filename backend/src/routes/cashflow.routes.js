// Cash-flow forecast routes — CFO module §5. Mounted at /api/cashflow.
// Reads: SUPERVISOR + ACCOUNTS + AUDITOR. Writes/overrides: SUPERVISOR + ACCOUNTS. Delete: ADMIN + ACCOUNTS.
// Opening cash is the real bank feed; collections/supplier payments are modelled
// forecasts (never actual bank balances). Overrides keep the original + a reason.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const cf = require('../lib/cashflow')(pool);
  const READ = requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] });
  const WRITE = requireRole('SUPERVISOR', { also: ['ACCOUNTS'] });
  const ADMIN = requireRole('ADMIN', { also: ['ACCOUNTS'] });
  const send = (res, out, ok = 200) => {
    if (!out) return res.status(500).json({ error: 'no result' });
    if (out.badRequest) return res.status(400).json({ error: out.badRequest });
    if (out.notFound) return res.status(404).json({ error: 'not found' });
    return res.status(ok).json(out);
  };
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { console.error('[cashflow]', e.message); res.status(500).json({ error: e.message }); } };

  router.get('/', verifyToken, READ, wrap(async (req, res) => res.json(await cf.list())));
  router.get('/:id/forecast', verifyToken, READ, wrap(async (req, res) => send(res, await cf.compute(req.params.id, { scenario: req.query.scenario || 'BASE' }))));
  router.post('/', verifyToken, WRITE, wrap(async (req, res) => send(res, await cf.create(req.body, req.user?.username), 201)));
  router.put('/:id', verifyToken, WRITE, wrap(async (req, res) => send(res, await cf.update(req.params.id, req.body, req.user?.username))));
  router.post('/:id/override', verifyToken, WRITE, wrap(async (req, res) => send(res, await cf.setOverride(req.params.id, req.body, req.user?.username), 201)));
  router.post('/:id/override/clear', verifyToken, WRITE, wrap(async (req, res) => send(res, await cf.clearOverride(req.params.id, req.body, req.user?.username))));
  router.delete('/:id', verifyToken, ADMIN, wrap(async (req, res) => send(res, await cf.remove(req.params.id, req.user?.username))));

  return router;
};
