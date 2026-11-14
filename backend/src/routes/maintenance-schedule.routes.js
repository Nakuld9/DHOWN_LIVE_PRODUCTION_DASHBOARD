// Maintenance-schedule routes — recurring PM tasks (layered architecture).
// Mounted at /api/maintenance-schedule. Auth/roles preserved verbatim:
//   GET    /api/maintenance-schedule           (verifyToken)
//   POST   /api/maintenance-schedule           (verifyToken, SUPERVISOR)
//   PUT    /api/maintenance-schedule/:id/complete (verifyToken, OPERATOR)
//   DELETE /api/maintenance-schedule/:id         (verifyToken, ADMIN)  soft-delete
const express = require('express');
const makeRepository = require('../repositories/maintenance-schedule.repository');
const makeService = require('../services/maintenance-schedule.service');
const makeController = require('../controllers/maintenance-schedule.controller');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const controller = makeController(makeService(makeRepository(pool)));

  router.get('/', verifyToken, controller.list);
  router.post('/', verifyToken, requireRole('SUPERVISOR'), controller.create);
  router.put('/:id/complete', verifyToken, requireRole('OPERATOR'), controller.complete);
  router.delete('/:id', verifyToken, requireRole('ADMIN'), controller.remove);

  return router;
};
