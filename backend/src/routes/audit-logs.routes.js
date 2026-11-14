// Audit-logs routes — paginated audit log (layered architecture).
// Mounted at /api/audit-logs. verifyToken, matching the original handler.
const express = require('express');
const makeRepository = require('../repositories/audit-logs.repository');
const makeService = require('../services/audit-logs.service');
const makeController = require('../controllers/audit-logs.controller');

module.exports = ({ pool, verifyToken }) => {
  const router = express.Router();
  const controller = makeController(makeService(makeRepository(pool)));
  router.get('/', verifyToken, controller.list);
  return router;
};
