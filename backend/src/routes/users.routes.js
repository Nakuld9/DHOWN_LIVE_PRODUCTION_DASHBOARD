// Users routes — user management + supervisor PIN (layered architecture).
// Mounted at /api/users. All endpoints require a valid token (verifyToken),
// matching the original inline handlers (no per-role guard beyond auth).
const express = require('express');
const makeRepository = require('../repositories/users.repository');
const makeService = require('../services/users.service');
const makeController = require('../controllers/users.controller');

module.exports = ({ pool, verifyToken, requireRole}) => {
  const router = express.Router();

  // Every route below requires a session. Applied at router level so a route
  // added later is guarded by default.
  router.use(verifyToken);

  const controller = makeController(makeService(makeRepository(pool)));

  // The staff list exposes usernames, roles and mobiles — SUPERVISOR+ only
  // (closure-audit finding N-1: previously any authenticated user could enumerate
  // it). No password/PIN hashes are ever returned by the list query.
  router.get('/', verifyToken, requireRole('SUPERVISOR'), controller.list);
  router.post('/', verifyToken, requireRole('ADMIN'), controller.create);
  router.put('/:id', verifyToken, requireRole('ADMIN'), controller.update);
  router.delete('/:id', verifyToken, requireRole('ADMIN'), controller.remove);
  router.put('/:id/pin', verifyToken, requireRole('ADMIN'), controller.setPin);
  router.delete('/:id/pin', verifyToken, requireRole('ADMIN'), controller.clearPin);

  return router;
};
