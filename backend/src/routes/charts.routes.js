// Charts routes — machine trends + hourly production (layered architecture).
// Mounted at /api/charts. No auth, matching the original inline handlers.
const express = require('express');
const makeRepository = require('../repositories/charts.repository');
const makeService = require('../services/charts.service');
const makeController = require('../controllers/charts.controller');

module.exports = ({ pool, verifyToken }) => {
  const router = express.Router();
  router.use(verifyToken); // require login for all routes in this router
  const controller = makeController(makeService(makeRepository(pool)));

  router.get('/trends', controller.trends);
  router.get('/production-hourly', controller.productionHourly);

  return router;
};
