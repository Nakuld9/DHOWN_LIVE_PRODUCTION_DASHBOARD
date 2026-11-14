// Tax Invoices routes — GST invoices for customer sales (layered architecture).
// Mounted at /api/tax-invoices. Reads open to OPERATOR; writes require SUPERVISOR;
// pay/delete require ADMIN. Injected: pool, verifyToken, requireRole, nextInvSeq, io.
const express = require('express');
const makeRepository = require('../repositories/tax-invoices.repository');
const makeService = require('../services/tax-invoices.service');
const makeController = require('../controllers/tax-invoices.controller');

module.exports = ({ pool, verifyToken, requireRole, nextInvSeq, io }) => {
  const router = express.Router();

  // Every route below requires a valid session. Applied at router level so a
  // route added later is guarded by default; individual routes add requireRole
  // on top where a specific role is needed.
  router.use(verifyToken);

  const controller = makeController(makeService(makeRepository(pool), { nextInvSeq, io }));

  // Tax invoices carry customer + GST + amount data — SUPERVISOR+/ACCOUNTS/SALES
  // only (audit authz-matrix P2: these reads were previously any-authenticated).
  router.get('/', requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'SALES'] }), controller.list);
  router.get('/:id', requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'SALES'] }), controller.get);
  router.post('/', verifyToken, requireRole('SUPERVISOR'), controller.create);
  router.put('/:id/issue', verifyToken, requireRole('SUPERVISOR'), controller.issue);
  router.put('/:id/pay', verifyToken, requireRole('ADMIN'), controller.pay);
  router.put('/:id/cancel', verifyToken, requireRole('SUPERVISOR'), controller.cancel);
  router.delete('/:id', verifyToken, requireRole('ADMIN'), controller.remove);

  return router;
};
