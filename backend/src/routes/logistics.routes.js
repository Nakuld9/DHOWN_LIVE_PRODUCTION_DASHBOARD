// Transporters, e-way bills, proof of delivery, sales returns and credit notes.
//
// Roles: reading is OPERATOR. Recording a movement or a POD is SUPERVISOR.
// Anything that moves money — approving a return, cancelling a credit note — is
// ADMIN, matching how payments are gated.

const express = require('express');

module.exports = ({ verifyToken, requireRole, logistics, returns }) => {
  const router = express.Router();
  router.use(verifyToken);

  const send = (res, out, okStatus = 200) => {
    if (out && out.error) return res.status(out.code || 400).json({ error: out.error });
    return res.status(okStatus).json(out);
  };
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { res.status(500).json({ error: e.message }); }
  };

  // ── Transporters ──────────────────────────────────────────────────────────
  router.get('/transporters', requireRole('OPERATOR'), wrap(async (req, res) => {
    res.json(await logistics.listTransporters({ activeOnly: req.query.all !== 'true' }));
  }));

  router.post('/transporters', requireRole('SUPERVISOR'), wrap(async (req, res) => {
    send(res, await logistics.saveTransporter({ ...req.body, by: req.user?.username }), 201);
  }));

  router.put('/transporters/:id', requireRole('SUPERVISOR'), wrap(async (req, res) => {
    send(res, await logistics.saveTransporter({ ...req.body, transporter_id: req.params.id, by: req.user?.username }));
  }));

  // ── E-way bills ───────────────────────────────────────────────────────────
  // Asked before the vehicle leaves, so a missing bill can still be fixed.
  router.get('/eway/requirement', requireRole('OPERATOR'), wrap(async (req, res) => {
    const { dispatch_id, invoice_id, value, interstate } = req.query;
    res.json(await logistics.requirement({
      dispatch_id: dispatch_id || null,
      invoice_id: invoice_id || null,
      value: value || 0,
      interstate: interstate === undefined ? undefined : interstate === 'true',
    }));
  }));

  router.get('/eway', requireRole('OPERATOR'), wrap(async (req, res) => {
    res.json(await logistics.listEway(req.query));
  }));

  // Expired bills on goods still in transit, and dispatches over the threshold
  // with no bill at all. This is the compliance worklist.
  router.get('/eway/alerts', requireRole('OPERATOR'), wrap(async (req, res) => {
    res.json(await logistics.complianceAlerts());
  }));

  router.post('/eway', requireRole('SUPERVISOR'), wrap(async (req, res) => {
    send(res, await logistics.recordEway({ ...req.body, by: req.user?.username }), 201);
  }));

  router.post('/eway/:id/vehicle', requireRole('SUPERVISOR'), wrap(async (req, res) => {
    send(res, await logistics.updateVehicle(req.params.id, { ...req.body, by: req.user?.username }));
  }));

  router.post('/eway/:id/cancel', requireRole('SUPERVISOR'), wrap(async (req, res) => {
    send(res, await logistics.cancelEway(req.params.id, { ...req.body, by: req.user?.username }));
  }));

  // ── Proof of delivery ─────────────────────────────────────────────────────
  router.get('/pod/pending', requireRole('OPERATOR'), wrap(async (req, res) => {
    res.json(await logistics.pendingDeliveries({ olderThanDays: req.query.older_than_days }));
  }));

  // Refused, short or damaged deliveries with no return raised yet. These are
  // invisible on the pending list by design, so they need their own queue.
  router.get('/pod/unresolved', requireRole('OPERATOR'), wrap(async (req, res) => {
    res.json(await logistics.unresolvedDeliveries());
  }));

  router.get('/pod/:dispatchId', requireRole('OPERATOR'), wrap(async (req, res) => {
    const pod = await logistics.getPod(req.params.dispatchId);
    if (!pod) return res.status(404).json({ error: 'No proof of delivery recorded' });
    res.json(pod);
  }));

  router.post('/pod/:dispatchId', requireRole('SUPERVISOR'), wrap(async (req, res) => {
    send(res, await logistics.recordPod(req.params.dispatchId, { ...req.body, by: req.user?.username }), 201);
  }));

  // ── Sales returns ─────────────────────────────────────────────────────────
  router.get('/returns', requireRole('OPERATOR'), wrap(async (req, res) => {
    res.json(await returns.list(req.query));
  }));

  router.get('/returns/reasons', requireRole('OPERATOR'), wrap(async (req, res) => {
    res.json({ reasons: returns.REASONS, dispositions: returns.DISPOSITIONS });
  }));

  // Invoice lines with how much of each may still come back. Declared before
  // /returns/:id so the parameterised route does not capture it.
  router.get('/returns/returnable/:invoiceId', requireRole('OPERATOR'), wrap(async (req, res) => {
    send(res, await returns.returnable(req.params.invoiceId));
  }));

  router.get('/returns/:id', requireRole('OPERATOR'), wrap(async (req, res) => {
    const r = await returns.get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Return not found' });
    res.json(r);
  }));

  router.post('/returns', requireRole('SUPERVISOR'), wrap(async (req, res) => {
    send(res, await returns.create({ ...req.body, created_by: req.user?.username }), 201);
  }));

  // Approval is where stock moves and a credit note is raised, so it is ADMIN.
  router.post('/returns/:id/approve', requireRole('ADMIN', { also: ['ACCOUNTS'] }), wrap(async (req, res) => {
    send(res, await returns.approve(req.params.id, { by: req.user?.username }));
  }));

  router.post('/returns/:id/reject', requireRole('SUPERVISOR'), wrap(async (req, res) => {
    send(res, await returns.reject(req.params.id, { ...req.body, by: req.user?.username }));
  }));

  router.post('/returns/:id/cancel', requireRole('ADMIN', { also: ['ACCOUNTS'] }), wrap(async (req, res) => {
    send(res, await returns.cancel(req.params.id, { ...req.body, by: req.user?.username }));
  }));

  router.get('/credit-notes', requireRole('OPERATOR'), wrap(async (req, res) => {
    res.json(await returns.listCreditNotes(req.query));
  }));

  return router;
};
