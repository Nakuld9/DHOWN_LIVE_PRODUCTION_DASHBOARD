// Dispatch routes — dispatch challans (layered architecture).
// Mounted at /api/dispatch. Auth/roles preserved verbatim from the inline handlers:
//   GET    /api/dispatch        (public — no verifyToken, as in original)
//   POST   /api/dispatch        (verifyToken, SUPERVISOR)
//   GET    /api/dispatch/:id    (public — no verifyToken, as in original)
//   DELETE /api/dispatch/:id    (verifyToken, ADMIN)  restores stock
// Injected helpers: nextSeq, numOrNull, postToLedger (shared server.js functions).
const express = require('express');
const makeRepository = require('../repositories/dispatch.repository');
const makeService = require('../services/dispatch.service');
const makeController = require('../controllers/dispatch.controller');

module.exports = ({ pool, verifyToken, requireRole, nextSeq, numOrNull, postToLedger, autoInvoice }) => {
  const router = express.Router();
  const controller = makeController(
    makeService(makeRepository(pool, { postToLedger }), { nextSeq, numOrNull, autoInvoice })
  );

  router.get('/', controller.list);
  router.post('/', verifyToken, requireRole('SUPERVISOR'), controller.create);
  router.get('/:id', controller.get);
  router.post('/:id/jobwork-return', verifyToken, requireRole('SUPERVISOR'), controller.jobworkReturn);
  router.delete('/:id', verifyToken, requireRole('ADMIN'), controller.remove);

  return router;
};
