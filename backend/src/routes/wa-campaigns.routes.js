// WhatsApp marketing campaigns — mounted at /api/wa/campaigns.
// Marketing outreach is a commercial + compliance action, so create/send are
// SUPERVISOR (SALES too); listing/preview is OPERATOR.
const express = require('express');

module.exports = ({ verifyToken, requireRole, campaigns }) => {
  const router = express.Router();
  router.use(verifyToken);
  const SALES = { also: ['SALES'] };
  const send = (res, out, ok = 200) => (out && out.error) ? res.status(out.code || 400).json({ error: out.error }) : res.status(ok).json(out);
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(500).json({ error: e.message }); } };

  router.get('/', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await campaigns.list())));
  router.post('/preview', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await campaigns.preview(req.body?.audience))));
  router.post('/', requireRole('SUPERVISOR', SALES), wrap(async (req, res) => send(res, await campaigns.create(req.body, req.user), 201)));
  router.get('/:id', requireRole('OPERATOR'), wrap(async (req, res) => { const c = await campaigns.get(req.params.id); return c ? res.json(c) : res.status(404).json({ error: 'Not found' }); }));
  router.post('/:id/enqueue', requireRole('SUPERVISOR', SALES), wrap(async (req, res) => send(res, await campaigns.enqueue(req.params.id, req.user))));
  router.post('/:id/send', requireRole('SUPERVISOR', SALES), wrap(async (req, res) => send(res, await campaigns.send(req.params.id, { limit: Number(req.body?.limit) || 200 }))));
  router.post('/:id/cancel', requireRole('SUPERVISOR', SALES), wrap(async (req, res) => send(res, await campaigns.cancel(req.params.id))));

  return router;
};
