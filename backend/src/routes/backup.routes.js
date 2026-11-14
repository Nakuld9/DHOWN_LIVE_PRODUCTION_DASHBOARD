// Backup routes — on-demand dump + daily-backup trigger/list (layered arch).
// Mounted at /api (covers /backup and /admin/backup(s)). All verifyToken.
// runDailyBackup + PG_BIN injected from server.js.
const express = require('express');
const makeRepository = require('../repositories/backup.repository');
const makeService = require('../services/backup.service');
const makeController = require('../controllers/backup.controller');

module.exports = ({ verifyToken, runDailyBackup, PG_BIN, requireRole}) => {
  const router = express.Router();
  const controller = makeController(makeService(makeRepository({ PG_BIN }), { runDailyBackup }));

  router.post('/backup', verifyToken, requireRole('ADMIN'), controller.create);
  router.post('/admin/backup', verifyToken, requireRole('ADMIN'), controller.triggerDaily);
  router.get('/admin/backups', verifyToken, requireRole('ADMIN'), controller.listBackups);

  return router;
};
