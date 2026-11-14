// Finished-goods routes — FG stock list, summary, location, edit, delete.
// Handlers moved VERBATIM; app.<m>('/api/finished-goods...') -> router.<m>('/...').
// Mounted at /api/finished-goods. list/summary no auth; location+edit SUPERVISOR; delete ADMIN.
// Route order preserved (/:id/location before /:id).
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { status } = req.query;
      const conds = []; const vals = []; let p = 1;
      if (status) { conds.push(`fg.status = $${p++}`); vals.push(status); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const r = await pool.query(`
        SELECT fg.*, b.batch_number, b.color_name AS batch_color,
               c.vendor_name, c.job_type,
               ROUND(COALESCE(batch_cost.total_cost, 0)::NUMERIC, 2) AS total_cost_rs,
               CASE WHEN fg.weight_kg > 0
                 THEN ROUND((COALESCE(batch_cost.total_cost, 0) / fg.weight_kg)::NUMERIC, 2)
                 ELSE 0 END AS cost_per_kg
        FROM finished_goods fg
        LEFT JOIN batches b ON fg.batch_id = b.batch_id
        LEFT JOIN subcontract_receipts sr ON fg.receipt_id = sr.receipt_id
        LEFT JOIN subcontract_challans c ON sr.challan_id = c.challan_id
        LEFT JOIN (
          SELECT batch_id, SUM(amount_rs) AS total_cost FROM (
            -- Batch-level costs (WASTAGE, JOBWORK_DYEING, JOBWORK_FINISHING)
            SELECT reference_id::int AS batch_id, SUM(amount_rs) AS amount_rs
            FROM cost_entries WHERE reference_type = 'BATCH'
            GROUP BY reference_id
            UNION ALL
            -- Roll-level costs (YARN_COST, KNITTING_COST) via batch_rolls
            SELECT br.batch_id, SUM(ce.amount_rs) AS amount_rs
            FROM cost_entries ce
            JOIN batch_rolls br ON br.roll_id = ce.reference_id
            WHERE ce.reference_type = 'ROLL'
            GROUP BY br.batch_id
          ) sub GROUP BY batch_id
        ) batch_cost ON batch_cost.batch_id = fg.batch_id
        ${where}
        ORDER BY fg.created_at DESC
      `, vals);
      res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/summary', async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT
          COALESCE(fabric_type,'Unknown') AS fabric_type,
          COALESCE(color_name,'Undyed') AS color_name,
          COUNT(*) AS lot_count,
          ROUND(COALESCE(SUM(weight_kg),0)::NUMERIC,3) AS total_kg,
          status
        FROM finished_goods
        GROUP BY fabric_type, color_name, status
        ORDER BY total_kg DESC
      `);
      const tot = await pool.query(`
        SELECT COUNT(*) AS lot_count,
               ROUND(COALESCE(SUM(fg.weight_kg),0)::NUMERIC,3) AS total_kg,
               ROUND(COALESCE(SUM(batch_cost.total_cost),0)::NUMERIC,2) AS total_cost_rs,
               CASE WHEN SUM(fg.weight_kg) > 0
                 THEN ROUND((COALESCE(SUM(batch_cost.total_cost),0) / SUM(fg.weight_kg))::NUMERIC, 2)
                 ELSE 0 END AS avg_cost_per_kg
        FROM finished_goods fg
        LEFT JOIN (
          SELECT batch_id, SUM(amount_rs) AS total_cost FROM (
            SELECT reference_id::int AS batch_id, SUM(amount_rs) AS amount_rs
            FROM cost_entries WHERE reference_type = 'BATCH' GROUP BY reference_id
            UNION ALL
            SELECT br.batch_id, SUM(ce.amount_rs) AS amount_rs
            FROM cost_entries ce JOIN batch_rolls br ON br.roll_id = ce.reference_id
            WHERE ce.reference_type = 'ROLL' GROUP BY br.batch_id
          ) sub GROUP BY batch_id
        ) batch_cost ON batch_cost.batch_id = fg.batch_id
        WHERE fg.status='IN_STOCK'
      `);
      res.json({ by_type: r.rows, in_stock_totals: tot.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.put('/:id/location', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const { id } = req.params;
      const { location } = req.body;
      const r = await pool.query(
        `UPDATE finished_goods SET location=$1, updated_at=NOW() WHERE fg_id=$2 RETURNING *`,
        [location, id]
      );
      res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.delete('/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
    try {
      const fg = await pool.query(`SELECT * FROM finished_goods WHERE fg_id=$1`, [req.params.id]);
      if (!fg.rows.length) return res.status(404).json({ error: 'Not found' });
      if (fg.rows[0].status === 'DISPATCHED') return res.status(400).json({ error: 'Cannot delete dispatched goods' });
      await pool.query(`DELETE FROM finished_goods WHERE fg_id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const fg = await pool.query(`SELECT * FROM finished_goods WHERE fg_id=$1`, [req.params.id]);
      if (!fg.rows.length) return res.status(404).json({ error: 'Not found' });
      if (fg.rows[0].status === 'DISPATCHED') return res.status(400).json({ error: 'Cannot edit dispatched goods' });
      const { weight_kg, fabric_type, color_name, location, notes } = req.body;
      const r = await pool.query(
        `UPDATE finished_goods SET weight_kg=COALESCE($1,weight_kg), fabric_type=COALESCE($2,fabric_type),
         color_name=COALESCE($3,color_name), location=$4, notes=$5, updated_at=NOW()
         WHERE fg_id=$6 RETURNING *`,
        [weight_kg||null, fabric_type||null, color_name||null, location||null, notes||null, req.params.id]
      );
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
