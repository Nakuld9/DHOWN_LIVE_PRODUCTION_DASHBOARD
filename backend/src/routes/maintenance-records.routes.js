// Maintenance-records routes — machine maintenance log (layered architecture).
// Mounted at /api/maintenance. Auth/roles preserved verbatim from the inline handlers:
//   GET    /api/maintenance         (public — no verifyToken, as in original)
//   POST   /api/maintenance         (verifyToken, OPERATOR)
//   PUT    /api/maintenance/:id      (verifyToken, OPERATOR)
//   DELETE /api/maintenance/:id      (verifyToken, SUPERVISOR)
const express = require('express');
const makeRepository = require('../repositories/maintenance-records.repository');
const makeService = require('../services/maintenance-records.service');
const makeController = require('../controllers/maintenance-records.controller');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const controller = makeController(makeService(makeRepository(pool)));

  router.get('/', controller.list);
  router.post('/', verifyToken, requireRole('OPERATOR'), controller.create);
  router.put('/:id', verifyToken, requireRole('OPERATOR'), controller.update);
  router.delete('/:id', verifyToken, requireRole('SUPERVISOR'), controller.remove);

  return router;
};
