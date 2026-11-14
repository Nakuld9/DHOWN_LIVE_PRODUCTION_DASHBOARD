// Active-operators routes — currently-assigned operators (layered architecture).
// Mounted at /api/active-operators. No auth, matching the original handler.
const express = require('express');
const makeRepository = require('../repositories/active-operators.repository');
const makeService = require('../services/active-operators.service');
const makeController = require('../controllers/active-operators.controller');

module.exports = ({ pool, verifyToken }) => {
  const router = express.Router();
  router.use(verifyToken); // require login for all routes in this router
  const controller = makeController(makeService(makeRepository(pool)));
  router.get('/', controller.get);
  return router;
};
