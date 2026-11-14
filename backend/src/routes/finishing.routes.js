// Finishing routes — received-challan finishing/QC (layered architecture).
// Mounted at /api/finishing. Auth verbatim: GET no auth; POST SUPERVISOR.
const express = require('express');
const makeRepository = require('../repositories/finishing.repository');
const makeService = require('../services/finishing.service');
const makeController = require('../controllers/finishing.controller');

module.exports = ({ pool, verifyToken, requireRole, io }) => {
  const router = express.Router();
  const controller = makeController(makeService(makeRepository(pool), { io }));

  router.get('/', controller.list);
  router.post('/:receipt_id', verifyToken, requireRole('SUPERVISOR'), controller.saveQC);

  return router;
};
