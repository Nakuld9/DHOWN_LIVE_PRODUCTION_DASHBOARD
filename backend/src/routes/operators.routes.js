// Operators routes — wires repository -> service -> controller and mounts the CRUD
// endpoints. Shared infra (pool, verifyToken, requireRole) is injected from server.js
// so the monolith's single connection pool and auth behavior are reused unchanged.
//
// Endpoints (mounted at /api/operators — paths and middleware identical to the
// original inline handlers in server.js):
//   GET    /api/operators        (no auth)
//   POST   /api/operators        (verifyToken, requireRole('SUPERVISOR'))
//   PUT    /api/operators/:id     (verifyToken, requireRole('SUPERVISOR'))
//   DELETE /api/operators/:id     (verifyToken)
const express = require('express');
const makeRepository = require('../repositories/operators.repository');
const makeService = require('../services/operators.service');
const makeController = require('../controllers/operators.controller');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();

  // Every route below requires a valid session. Applied at router level so a
  // route added later is guarded by default; individual routes add requireRole
  // on top where a specific role is needed.
  router.use(verifyToken);

  const controller = makeController(makeService(makeRepository(pool)));

  router.get('/', controller.list);
  router.post('/', verifyToken, requireRole('SUPERVISOR'), controller.create);
  router.put('/:id', verifyToken, requireRole('SUPERVISOR'), controller.update);
  router.delete('/:id', verifyToken, requireRole('ADMIN'), controller.remove);

  return router;
};
