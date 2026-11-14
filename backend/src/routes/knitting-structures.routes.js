// Knitting-structures routes — knitting recipe library (layered architecture).
// Mounted at /api/knitting-structures.
//   GET    /                (verifyToken, OPERATOR)  ?machine_type&fabric_code&favourite
//   GET    /:id             (verifyToken, OPERATOR)
//   POST   /                (verifyToken, SUPERVISOR)
//   PUT    /:id              (verifyToken, SUPERVISOR)
//   PATCH  /:id/favourite    (verifyToken, OPERATOR)
//   DELETE /:id              (verifyToken, SUPERVISOR)
const express = require('express');
const makeRepository = require('../repositories/knitting-structures.repository');
const makeService = require('../services/knitting-structures.service');
const makeController = require('../controllers/knitting-structures.controller');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const controller = makeController(makeService(makeRepository(pool)));

  router.get('/', verifyToken, requireRole('OPERATOR'), controller.list);
  router.get('/:id', verifyToken, requireRole('OPERATOR'), controller.get);
  router.post('/', verifyToken, requireRole('SUPERVISOR'), controller.create);
  router.put('/:id', verifyToken, requireRole('SUPERVISOR'), controller.update);
  router.patch('/:id/favourite', verifyToken, requireRole('OPERATOR'), controller.favourite);
  router.delete('/:id', verifyToken, requireRole('SUPERVISOR'), controller.remove);

  return router;
};
