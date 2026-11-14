// Analytics routes — OEE + utilization + shift analytics (layered architecture).
// Mounted at /api (covers /oee, /utilization, /analytics base paths). No auth,
// matching the original inline handlers.
const express = require('express');
const makeRepository = require('../repositories/analytics.repository');
const makeService = require('../services/analytics.service');
const makeController = require('../controllers/analytics.controller');

module.exports = ({ pool, verifyToken, getShiftSettings, detectCurrentShift }) => {
  const router = express.Router();
  const controller = makeController(makeService(makeRepository(pool), { getShiftSettings, detectCurrentShift }));

  router.get('/oee', verifyToken, controller.oee);
  router.get('/oee/:machineId', verifyToken, controller.oeeMachine);
  router.get('/utilization', verifyToken, controller.utilization);
  router.get('/utilization/:machineId', verifyToken, controller.utilizationMachine);
  router.get('/analytics/shifts', verifyToken, controller.analyticsShifts);
  router.get('/analytics/top-downtime', verifyToken, controller.topDowntime);

  return router;
};
