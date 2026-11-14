// Greige routes — greige-warehouse roll views (layered architecture).
// Mounted at /api/greige. No auth, matching the original inline handlers.
const express = require('express');
const makeRepository = require('../repositories/greige.repository');
const makeService = require('../services/greige.service');
const makeController = require('../controllers/greige.controller');

module.exports = ({ pool, verifyToken }) => {
  const router = express.Router();
  router.use(verifyToken); // require login for all routes in this router
  const controller = makeController(makeService(makeRepository(pool)));

  router.get('/', controller.list);
  router.get('/summary', controller.summary);

  return router;
};
