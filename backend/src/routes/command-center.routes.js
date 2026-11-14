// Command-center routes — aggregate factory dashboard (layered architecture).
// Mounted at /api/command-center. No auth, matching the original handler.
const express = require('express');
const makeRepository = require('../repositories/command-center.repository');
const makeService = require('../services/command-center.service');
const makeController = require('../controllers/command-center.controller');

module.exports = ({ pool, verifyToken, getShiftSettings, detectCurrentShift }) => {
  const router = express.Router();
  router.use(verifyToken); // require login for all routes in this router
  const controller = makeController(makeService(makeRepository(pool), { getShiftSettings, detectCurrentShift }));
  router.get('/', controller.get);
  return router;
};
