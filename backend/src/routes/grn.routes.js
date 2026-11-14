// GRN routes — goods receipt notes (layered architecture).
// Mounted at /api/grn. Auth preserved verbatim from the inline handlers
// (several endpoints were public in the original — kept as-is):
//   GET    /api/grn                (public)
//   POST   /api/grn                (public — as in original)
//   GET    /api/grn/:id            (public)
//   POST   /api/grn/:id/lots       (public — as in original)
//   DELETE /api/grn/:id/lots/:lotId (public — DRAFT only, as in original)
//   PUT    /api/grn/:id/approve    (public — as in original)
//   DELETE /api/grn/:id            (verifyToken, ADMIN)  DRAFT only
//   PUT    /api/grn/:id/cancel     (verifyToken, ADMIN)  APPROVED only
//   PUT    /api/grn/:id            (verifyToken, SUPERVISOR)  DRAFT header edit
// Injected: nextInvSeq, addCostEntry, postToLedger, io (shared server.js objects).
const express = require('express');
const makeRepository = require('../repositories/grn.repository');
const makeService = require('../services/grn.service');
const makeController = require('../controllers/grn.controller');

module.exports = ({ pool, verifyToken, requireRole, nextInvSeq, addCostEntry, postToLedger, io }) => {
  const router = express.Router();

  // Every route below requires a session. Applied at router level so a route
  // added later is guarded by default.
  router.use(verifyToken);

  const controller = makeController(
    makeService(makeRepository(pool, { addCostEntry, postToLedger }), { nextInvSeq, io })
  );

  router.get('/', controller.list);
  router.post('/', verifyToken, requireRole('SUPERVISOR'), controller.create);
  router.get('/:id', controller.get);
  router.post('/:id/lots', verifyToken, requireRole('SUPERVISOR'), controller.addLot);
  // These two were carried over as public "as in original". Approving a goods
  // receipt posts stock and triggers the costing chain, and removing a lot
  // changes what was received — neither is a public action.
  router.delete('/:id/lots/:lotId', verifyToken, requireRole('SUPERVISOR'), controller.removeLot);
  router.put('/:id/approve', verifyToken, requireRole('SUPERVISOR'), controller.approve);
  router.delete('/:id', verifyToken, requireRole('ADMIN'), controller.remove);
  router.put('/:id/cancel', verifyToken, requireRole('ADMIN'), controller.cancel);
  router.put('/:id', verifyToken, requireRole('SUPERVISOR'), controller.updateHeader);

  return router;
};
