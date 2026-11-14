// Work-orders routes — maintenance work orders (layered architecture).
// Mounted at /api/work-orders. Injected pool + auth from server.js.
//   GET    /api/work-orders            (verifyToken, OPERATOR)   ?machine_id&status
//   GET    /api/work-orders/:id        (verifyToken, OPERATOR)
//   POST   /api/work-orders            (verifyToken, SUPERVISOR)
//   PUT    /api/work-orders/:id         (verifyToken, SUPERVISOR)
//   PUT    /api/work-orders/:id/status  (verifyToken, SUPERVISOR)  start/complete/cancel
//   DELETE /api/work-orders/:id         (verifyToken, ADMIN)
const express = require('express');
const makeRepository = require('../repositories/work-orders.repository');
const makeService = require('../services/work-orders.service');
const makeController = require('../controllers/work-orders.controller');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const controller = makeController(makeService(makeRepository(pool)));

  router.get('/', verifyToken, requireRole('OPERATOR'), controller.list);
  router.get('/:id', verifyToken, requireRole('OPERATOR'), controller.get);
  router.get('/:id/parts', verifyToken, requireRole('OPERATOR'), controller.partsUsed);
  router.post('/', verifyToken, requireRole('SUPERVISOR'), controller.create);
  router.put('/:id', verifyToken, requireRole('SUPERVISOR'), controller.update);
  router.put('/:id/status', verifyToken, requireRole('SUPERVISOR'), controller.status);
  router.post('/:id/parts', verifyToken, requireRole('SUPERVISOR'), controller.usePart);
  router.delete('/:id', verifyToken, requireRole('ADMIN'), controller.remove);

  return router;
};
