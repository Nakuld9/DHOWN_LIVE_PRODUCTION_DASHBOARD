// Yarn routes — store + issues + returns (layered architecture).
// Mounted at /api (one line in server.js); covers three resources:
//   yarn-store    GET /  /summary  /low-stock  /:id/movements ; PUT /:id/location   (no auth)
//   yarn-issues   GET /  /:id ; POST /  /:id/return            (no auth)
//                 DELETE /:id (ADMIN) ; PUT /:id/cancel (ADMIN) ; PUT /:id (SUPERVISOR)
//   yarn-returns  GET /  /:id (no auth) ; POST / (verifyToken)
// Auth levels preserved verbatim from the original inline handlers.
const express = require('express');
const makeRepository = require('../repositories/yarn.repository');
const makeService = require('../services/yarn.service');
const makeController = require('../controllers/yarn.controller');

module.exports = ({ pool, verifyToken, requireRole, nextInvSeq, addCostEntry, postToLedger, io }) => {
  const router = express.Router();
  const repo = makeRepository(pool, { nextInvSeq, addCostEntry, postToLedger });
  const controller = makeController(makeService(repo, { io }));

  // ── STORE ──
  router.get('/yarn-store', controller.storeList);
  router.get('/yarn-store/summary', controller.storeSummary);
  router.get('/yarn-store/low-stock', controller.storeLowStock);
  router.get('/yarn-store/:id/movements', controller.storeMovements);
  router.put('/yarn-store/:id/location', verifyToken, requireRole('OPERATOR'), controller.storeSetLocation);

  // ── ISSUES ──
  router.get('/yarn-issues', controller.issuesList);
  router.post('/yarn-issues', verifyToken, requireRole('SUPERVISOR'), controller.createIssue);
  router.get('/yarn-issues/:id', controller.issueById);
  router.post('/yarn-issues/:id/return', verifyToken, requireRole('SUPERVISOR'), controller.returnAgainstIssue);
  router.delete('/yarn-issues/:id', verifyToken, requireRole('ADMIN'), controller.deleteIssue);
  router.put('/yarn-issues/:id/cancel', verifyToken, requireRole('ADMIN'), controller.cancelIssue);
  router.put('/yarn-issues/:id', verifyToken, requireRole('SUPERVISOR'), controller.editIssue);

  // ── RETURNS ──
  router.get('/yarn-returns', controller.returnsList);
  router.get('/yarn-returns/:id', controller.returnById);
  router.post('/yarn-returns', verifyToken, requireRole('SUPERVISOR'), controller.createReturn);

  return router;
};
