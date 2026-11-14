// Planning routes — MRP-lite. Mounted at /api/planning.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const mrp = require('../lib/mrp')(pool);

  // Yarn requirement across the open order book, netted against stock + on-order.
  router.get('/yarn-requirement', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await mrp.yarnRequirement()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
