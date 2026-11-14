// Public routes — no-auth roll lookup for QR scanning (safe display fields only).
// Handlers moved VERBATIM from server.js; app.<m>('/api/public...') -> router.<m>('/...').
// Mounted at /api/public. Auth/middleware preserved exactly.
const express = require('express');

const { company } = require('../lib/company');

module.exports = ({ pool }) => {
  const router = express.Router();

  router.get('/roll/:rollId', async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT r.roll_id, r.status, r.warehouse_status, r.fabric_type, r.quality_grade,
               r.actual_weight_kg, r.weight_kg, r.shift, r.source, r.created_at, r.approved_at,
               r.machine_id, m.machine_name,
               b.batch_number, b.status AS batch_status,
               yl.lot_number AS yarn_lot_number, yl.yarn_type,
               qi.grade AS inspection_grade, qi.inspection_date
        FROM rolls r
        LEFT JOIN machines m ON r.machine_id = m.machine_id
        LEFT JOIN batch_rolls br ON br.roll_id = r.roll_id
        LEFT JOIN batches b ON b.batch_id = br.batch_id
        LEFT JOIN yarn_lots yl ON yl.lot_id = r.lot_id
        LEFT JOIN quality_inspections qi ON qi.inspection_id = r.latest_inspection_id
        WHERE r.roll_id = $1
      `, [req.params.rollId]);
      if (!r.rows.length) return res.status(404).json({ error: 'Roll not found' });
      res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Who this instance belongs to. Public by necessity — the login screen shows it


  // before a token exists — and safe: name and address appear on every invoice.


  router.get('/tenant', async (req, res) => {


    try {


      const c = await company();


      res.json({ name: c.name, address: c.address, website: c.website });


    } catch (e) { res.status(500).json({ error: e.message }); }


  });



  return router;
};
