// Payroll routes — attendance-driven wage runs (layered architecture).
// Mounted at /api/payroll. Reads require SUPERVISOR (pay data is sensitive);
// writes require SUPERVISOR; delete requires ADMIN.
// Injected: pool, verifyToken, requireRole, nextInvSeq, io.
const express = require('express');
const makeRepository = require('../repositories/payroll.repository');
const makeService = require('../services/payroll.service');
const makeController = require('../controllers/payroll.controller');

module.exports = ({ pool, verifyToken, requireRole, nextInvSeq, io }) => {
  const router = express.Router();
  const controller = makeController(makeService(makeRepository(pool), { nextInvSeq, io }));

  router.get('/', verifyToken, requireRole('SUPERVISOR'), controller.list);
  router.get('/:id', verifyToken, requireRole('SUPERVISOR'), controller.get);
  router.post('/', verifyToken, requireRole('SUPERVISOR'), controller.create);
  router.put('/:id/items/:itemId', verifyToken, requireRole('SUPERVISOR'), controller.updateItem);
  router.put('/:id/finalize', verifyToken, requireRole('SUPERVISOR'), controller.finalize);
  router.put('/:id/pay', verifyToken, requireRole('ADMIN'), controller.pay);
  router.put('/:id/reopen', verifyToken, requireRole('SUPERVISOR'), controller.reopen);
  router.put('/:id/cancel', verifyToken, requireRole('SUPERVISOR'), controller.cancel);
  router.delete('/:id', verifyToken, requireRole('ADMIN'), controller.remove);

  return router;
};
