// Purchase Orders routes — supplier POs for yarn/other items (layered architecture).
// Mounted at /api/purchase-orders. Reads open to OPERATOR; writes require SUPERVISOR;
// delete requires ADMIN. Injected: pool, verifyToken, requireRole, nextDocNumber, io.
const express = require('express');
const makeRepository = require('../repositories/purchase-orders.repository');
const makeService = require('../services/purchase-orders.service');
const makeController = require('../controllers/purchase-orders.controller');

module.exports = ({ pool, verifyToken, requireRole, nextDocNumber, io }) => {
  const router = express.Router();

  // Every route below requires a valid session. Applied at router level so a
  // route added later is guarded by default; individual routes add requireRole
  // on top where a specific role is needed.
  router.use(verifyToken);

  const controller = makeController(makeService(makeRepository(pool), { nextDocNumber, io }));

  router.get('/', controller.list);
  router.get('/:id', controller.get);
  router.post('/', verifyToken, requireRole('SUPERVISOR'), controller.create);
  router.put('/:id', verifyToken, requireRole('SUPERVISOR'), controller.updateHeader);
  router.put('/:id/send', verifyToken, requireRole('SUPERVISOR'), controller.send);
  router.put('/:id/partial', verifyToken, requireRole('SUPERVISOR'), controller.partial);
  router.put('/:id/receive', verifyToken, requireRole('SUPERVISOR'), controller.receive);
  router.put('/:id/cancel', verifyToken, requireRole('SUPERVISOR'), controller.cancel);
  router.delete('/:id', verifyToken, requireRole('ADMIN'), controller.remove);

  return router;
};
