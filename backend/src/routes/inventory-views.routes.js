// Inventory-views routes — warehouse overview, live inventory dashboard, QR
// lookup, work-center stock (layered architecture). Mounted at /api. No auth.
const express = require('express');
const makeRepository = require('../repositories/inventory-views.repository');
const makeService = require('../services/inventory-views.service');
const makeController = require('../controllers/inventory-views.controller');

module.exports = ({ pool, verifyToken }) => {
  const router = express.Router();
  const controller = makeController(makeService(makeRepository(pool)));

  router.get('/warehouse/overview', verifyToken, controller.warehouseOverview);
  router.get('/inventory/dashboard', verifyToken, controller.inventoryDashboard);
  router.get('/inventory/qr/:code', verifyToken, controller.qrLookup);
  router.get('/work-center/stock', verifyToken, controller.workCenterStock);

  return router;
};
