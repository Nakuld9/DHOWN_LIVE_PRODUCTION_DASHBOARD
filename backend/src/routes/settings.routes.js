// Settings routes — wires repository -> service -> controller. Injected pool +
// verifyToken from server.js reuse the monolith's single pool and auth.
//
// Endpoints (mounted at /api/settings — identical to former inline handlers):
//   GET /api/settings   (no auth)
//   PUT /api/settings   (verifyToken)
const express = require('express');
const makeRepository = require('../repositories/settings.repository');
const makeService = require('../services/settings.service');
const makeController = require('../controllers/settings.controller');

module.exports = ({ pool, verifyToken }) => {
  const router = express.Router();
  const controller = makeController(makeService(makeRepository(pool)));

  router.get('/', controller.get);
  router.put('/', verifyToken, controller.update);

  return router;
};
