// Production Plans routes — plan fabric targets per machine/date (layered).
// Mounted at /api/production-plans. Reads open; writes require SUPERVISOR;
// delete requires ADMIN. Injected: pool, verifyToken, requireRole, nextInvSeq, io.
const express = require('express');
const makeRepository = require('../repositories/production-plans.repository');
const makeService = require('../services/production-plans.service');
const makeController = require('../controllers/production-plans.controller');

module.exports = ({ pool, verifyToken, requireRole, nextInvSeq, io }) => {
  const router = express.Router();
  const controller = makeController(makeService(makeRepository(pool), { nextInvSeq, io }));

  router.get('/', controller.list);
  router.get('/:id', controller.get);
  router.post('/', verifyToken, requireRole('SUPERVISOR'), controller.create);
  router.put('/:id', verifyToken, requireRole('SUPERVISOR'), controller.update);
  router.put('/:id/start', verifyToken, requireRole('SUPERVISOR'), controller.start);
  router.put('/:id/complete', verifyToken, requireRole('SUPERVISOR'), controller.complete);
  router.put('/:id/hold', verifyToken, requireRole('SUPERVISOR'), controller.hold);
  router.put('/:id/cancel', verifyToken, requireRole('SUPERVISOR'), controller.cancel);
  router.put('/:id/progress', verifyToken, requireRole('SUPERVISOR'), controller.progress);
  router.delete('/:id', verifyToken, requireRole('ADMIN'), controller.remove);

  return router;
};
