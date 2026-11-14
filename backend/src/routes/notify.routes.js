// WhatsApp notification actions (on-demand). Mounted at /api/notify.
// POST /shift-summary — send the production summary now (supervisor+).
const express = require('express');

module.exports = ({ verifyToken, requireRole, sendShiftSummary, buildSummary, notifyInvoice, notifyDispatch, notifyPO }) => {
  const router = express.Router();

  // Send a supplier their purchase order on WhatsApp. Optional { to } override.
  router.post('/po/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const out = await notifyPO(req.params.id, req.body && req.body.to);
      if (out.notFound) return res.status(404).json({ error: 'Purchase order not found' });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Notify a customer of their tax invoice on WhatsApp. Optional { to } override.
  router.post('/invoice/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const out = await notifyInvoice(req.params.id, req.body && req.body.to);
      if (out.notFound) return res.status(404).json({ error: 'Invoice not found' });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Notify a customer of a dispatch. Body: { to, customer_name, challan_number, quantity, date }.
  router.post('/dispatch', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try { res.json(await notifyDispatch(req.body && req.body.to, req.body || {})); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Preview the summary data without sending (handy for the UI / testing).
  router.get('/shift-summary/preview', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try { res.json(await buildSummary()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Send the summary now. Optional body { to: ["91...", ...] } to override recipients.
  router.post('/shift-summary', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const to = Array.isArray(req.body && req.body.to) ? req.body.to : null;
      const out = await sendShiftSummary(to);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
