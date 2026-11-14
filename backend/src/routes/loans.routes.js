// Loans / debt routes — CFO module §10. Mounted at /api/loans.
// Reads: SUPERVISOR + ACCOUNTS + AUDITOR. Writes: SUPERVISOR + ACCOUNTS. Delete: ADMIN + ACCOUNTS.
// The module computes schedules from stored terms; it never reads or writes Busy.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole, nextSeq }) => {
  const router = express.Router();
  const loans = require('../lib/loans')(pool, { nextSeq });
  const READ = requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] });
  const WRITE = requireRole('SUPERVISOR', { also: ['ACCOUNTS'] });
  const ADMIN = requireRole('ADMIN', { also: ['ACCOUNTS'] });
  const send = (res, out, okStatus = 200) => {
    if (!out) return res.status(500).json({ error: 'no result' });
    if (out.badRequest) return res.status(400).json({ error: out.badRequest });
    if (out.notFound) return res.status(404).json({ error: 'not found' });
    return res.status(okStatus).json(out.row !== undefined || out.ok !== undefined ? out : out);
  };
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { console.error('[loans]', e.message); res.status(500).json({ error: e.message }); } };

  router.get('/', verifyToken, READ, wrap(async (req, res) => res.json(await loans.list())));
  router.get('/summary', verifyToken, READ, wrap(async (req, res) => res.json(await loans.summary())));
  router.get('/calendar', verifyToken, READ, wrap(async (req, res) => res.json(await loans.calendar({ from: req.query.from, to: req.query.to }))));
  router.get('/:id', verifyToken, READ, wrap(async (req, res) => send(res, await loans.get(req.params.id))));
  router.post('/', verifyToken, WRITE, wrap(async (req, res) => send(res, await loans.create(req.body, req.user?.username), 201)));
  router.put('/:id', verifyToken, WRITE, wrap(async (req, res) => send(res, await loans.update(req.params.id, req.body, req.user?.username))));
  router.post('/:id/payments', verifyToken, WRITE, wrap(async (req, res) => send(res, await loans.recordPayment(req.params.id, req.body, req.user?.username), 201)));
  router.delete('/:id', verifyToken, ADMIN, wrap(async (req, res) => send(res, await loans.remove(req.params.id, req.user?.username))));

  return router;
};
