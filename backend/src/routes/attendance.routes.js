// Attendance routes — operator attendance views (layered architecture).
// Mounted at /api/attendance. No auth, matching the original inline handlers.
const express = require('express');
const makeRepository = require('../repositories/attendance.repository');
const makeService = require('../services/attendance.service');
const makeController = require('../controllers/attendance.controller');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();

  // Every route below requires a valid session. Applied at router level so a
  // route added later is guarded by default; individual routes add requireRole
  // on top where a specific role is needed.
  router.use(verifyToken);

  const controller = makeController(makeService(makeRepository(pool)));

  router.get('/', controller.list);
  router.get('/summary', controller.summary);
  // Manual marking for non-RFID staff — protected like the operators writes.
  router.post('/', verifyToken, requireRole('SUPERVISOR'), controller.markPresent);
  router.delete('/:id', verifyToken, requireRole('SUPERVISOR'), controller.remove);

  return router;
};
