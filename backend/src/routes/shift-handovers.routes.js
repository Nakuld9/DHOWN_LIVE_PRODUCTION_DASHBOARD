// Shift-handovers routes — shift handover notes (layered architecture).
// Mounted at /api/shift-handovers. GET verifyToken; POST SUPERVISOR (verbatim).
const express = require('express');
const makeRepository = require('../repositories/shift-handovers.repository');
const makeService = require('../services/shift-handovers.service');
const makeController = require('../controllers/shift-handovers.controller');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const controller = makeController(makeService(makeRepository(pool)));

  router.get('/', verifyToken, controller.list);
  router.post('/', verifyToken, requireRole('SUPERVISOR'), controller.create);

  return router;
};
