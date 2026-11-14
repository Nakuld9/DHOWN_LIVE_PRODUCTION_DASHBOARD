// Spare-parts routes — maintenance spare parts inventory (layered architecture).
// Mounted at /api/spare-parts. Injected pool + auth from server.js.
//   GET    /api/spare-parts               (verifyToken, OPERATOR)   ?category&low=1
//   GET    /api/spare-parts/:id           (verifyToken, OPERATOR)
//   GET    /api/spare-parts/:id/movements (verifyToken, OPERATOR)
//   POST   /api/spare-parts               (verifyToken, SUPERVISOR)
//   PUT    /api/spare-parts/:id            (verifyToken, SUPERVISOR)
//   POST   /api/spare-parts/:id/movements  (verifyToken, SUPERVISOR)  receive/consume/adjust/return
//   DELETE /api/spare-parts/:id            (verifyToken, ADMIN)
const express = require('express');
const makeRepository = require('../repositories/spare-parts.repository');
const makeService = require('../services/spare-parts.service');
const makeController = require('../controllers/spare-parts.controller');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const repo = makeRepository(pool);
  const controller = makeController(makeService(repo));

  router.get('/', verifyToken, requireRole('OPERATOR'), controller.list);

  // Purchase navigator (GRN-style): list / edit / delete RECEIVED movements.
  router.get('/purchases', verifyToken, requireRole('OPERATOR'), async (_req, res) => {
    try { res.json((await repo.listPurchases()).rows); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/purchases/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const r = await repo.updatePurchase(req.params.id, req.body || {});
      if (r.notFound) return res.status(404).json({ error: 'Purchase not found' });
      if (r.badRequest) return res.status(400).json({ error: r.badRequest });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/purchases/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const r = await repo.deletePurchase(req.params.id);
      if (r.notFound) return res.status(404).json({ error: 'Purchase not found' });
      if (r.badRequest) return res.status(400).json({ error: r.badRequest });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Goods-receipt documents (multi-line spare-part receiving).
  router.get('/grn', verifyToken, requireRole('OPERATOR'), async (_req, res) => {
    try { res.json((await repo.listGrn()).rows); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/grn/:id', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try { const g = await repo.getGrn(req.params.id); return g ? res.json(g) : res.status(404).json({ error: 'Receipt not found' }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/grn', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const r = await repo.createGrn({ ...req.body, created_by: req.user?.username });
      if (r.badRequest) return res.status(400).json({ error: r.badRequest });
      res.status(201).json(r.row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/grn/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try { const u = await repo.updateGrnHeader(req.params.id, req.body || {}); return u.rowCount ? res.json(u.rows[0]) : res.status(404).json({ error: 'Receipt not found' }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/grn/:id/line', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const r = await repo.addGrnLine(req.params.id, req.body || {});
      if (r.notFound) return res.status(404).json({ error: 'Receipt not found' });
      res.status(201).json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/grn/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const r = await repo.deleteGrn(req.params.id);
      if (r.notFound) return res.status(404).json({ error: 'Receipt not found' });
      if (r.badRequest) return res.status(400).json({ error: r.badRequest });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Spare-part spend issued to each machine (CONSUMED movements tagged with a machine).
  router.get('/machine-spend', verifyToken, requireRole('OPERATOR'), async (_req, res) => {
    try {
      const rows = (await pool.query(
        `SELECT mv.machine_id, m.machine_name,
                SUM(mv.quantity)::numeric        AS total_qty,
                SUM(mv.total_cost)::numeric      AS total_cost,
                MAX(mv.created_at)               AS last_issued
           FROM spare_part_movements mv
           LEFT JOIN machines m ON m.machine_id = mv.machine_id
          WHERE mv.machine_id IS NOT NULL AND mv.movement_type = 'CONSUMED'
          GROUP BY mv.machine_id, m.machine_name
          ORDER BY total_cost DESC NULLS LAST`)).rows;
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/:id', verifyToken, requireRole('OPERATOR'), controller.get);
  router.get('/:id/movements', verifyToken, requireRole('OPERATOR'), controller.movements);
  router.post('/', verifyToken, requireRole('SUPERVISOR'), controller.create);
  router.put('/:id', verifyToken, requireRole('SUPERVISOR'), controller.update);
  router.post('/:id/movements', verifyToken, requireRole('SUPERVISOR'), controller.move);
  router.delete('/:id', verifyToken, requireRole('ADMIN'), controller.remove);

  return router;
};
