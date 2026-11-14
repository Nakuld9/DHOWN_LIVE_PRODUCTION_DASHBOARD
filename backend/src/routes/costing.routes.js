// Costing routes — variance, rates, roll/batch/fg cost, factory summary, AI ask.
// Mounted at /api/costing (one line in server.js). Auth preserved verbatim:
//   GET  knitting-variance / bom-variance / rates / roll/:id / batch/:id /
//        summary / fg/:id                                   (no auth)
//   POST rates   (verifyToken, SUPERVISOR)
//   POST ask     (verifyToken)
const express = require('express');
const makeRepository = require('../repositories/costing.repository');
const makeService = require('../services/costing.service');
const makeController = require('../controllers/costing.controller');

module.exports = ({ pool, verifyToken, requireRole, callOllama }) => {
  const router = express.Router();

  // Every route below requires a valid session. Applied at router level so a
  // route added later is guarded by default; individual routes add requireRole
  // on top where a specific role is needed.
  router.use(verifyToken);

  const controller = makeController(makeService(makeRepository(pool), { callOllama }));

  // Costing/margin reads are commercially sensitive — restricted to SUPERVISOR+
  // (and ACCOUNTS), matching the write side and the AI layer's gating. (Audit
  // authz-matrix P2: these GETs were previously any-authenticated.)
  router.get('/knitting-variance', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), controller.knittingVariance);
  router.get('/bom-variance', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), controller.bomVariance);
  router.get('/rates', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), controller.rates);
  router.post('/rates', verifyToken, requireRole('SUPERVISOR'), controller.upsertRate);
  router.get('/roll/:id', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), controller.rollCost);
  router.get('/batch/:id', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), controller.batchCost);
  router.get('/summary', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), controller.summary);
  router.get('/fg/:id', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), controller.fgCost);
  router.post('/ask', verifyToken, requireRole('SUPERVISOR'), controller.ask);

  return router;
};
