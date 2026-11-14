// Shade approvals — mounted at /api/shade-approvals.
// Read: OPERATOR+. Write (create/decide): SALES + SUPERVISOR.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const sa = require('../lib/shade-approvals')(pool);
  const READ = requireRole('OPERATOR');
  const WRITE = requireRole('SUPERVISOR', { also: ['SALES'] });

  router.get('/', verifyToken, READ, async (req, res) => {
    try { res.json(await sa.list({ status: req.query.status, partner_id: req.query.partner_id })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/summary', verifyToken, READ, async (req, res) => {
    try { res.json(await sa.summary()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/', verifyToken, WRITE, async (req, res) => {
    try { res.json(await sa.create(req.body, req.user)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  router.post('/:id/decide', verifyToken, WRITE, async (req, res) => {
    try { res.json(await sa.decide(Number(req.params.id), req.body, req.user)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  return router;
};
