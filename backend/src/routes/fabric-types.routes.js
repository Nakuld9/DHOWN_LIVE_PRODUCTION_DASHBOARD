// Fabric-types routes — wires repository -> service -> controller. Injected pool +
// verifyToken from server.js reuse the monolith's single pool and auth.
//
// Endpoints (mounted at /api/fabric-types — identical to former inline handlers):
//   GET    /api/fabric-types          (no auth)
//   POST   /api/fabric-types          (verifyToken)
//   PUT    /api/fabric-types/:code    (verifyToken)
//   DELETE /api/fabric-types/:code    (verifyToken)
const express = require('express');
const makeRepository = require('../repositories/fabric-types.repository');
const makeService = require('../services/fabric-types.service');
const makeController = require('../controllers/fabric-types.controller');

module.exports = ({ pool, verifyToken }) => {
  const router = express.Router();
  const controller = makeController(makeService(makeRepository(pool)));

  router.get('/', controller.list);
  router.post('/', verifyToken, controller.create);
  router.put('/:code', verifyToken, controller.update);
  router.delete('/:code', verifyToken, controller.remove);

  return router;
};
