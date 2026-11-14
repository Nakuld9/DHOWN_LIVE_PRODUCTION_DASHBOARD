// Traceability routes — roll chain, lot chain, lot-search, list.
// Handlers moved VERBATIM; app.get('/api/traceability...') -> router.get('/...').
// Mounted at /api/traceability.
// FIX: '/:roll_id' is registered LAST — it was previously first and shadowed
// '/lot-search' (making that endpoint unreachable).
const express = require('express');

module.exports = ({ pool, verifyToken }) => {
  const router = express.Router();
  router.use(verifyToken); // require login for all routes in this router

  router.get('/lot/:lot_number', async (req, res) => {
    try {
      const { lot_number } = req.params;
      const lotRes = await pool.query(`
        SELECT yl.*, g.grn_number, g.supplier_name, g.receipt_date
        FROM yarn_lots yl LEFT JOIN grn g ON g.grn_id = yl.grn_id
        WHERE yl.lot_number ILIKE $1
      `, [lot_number]);
      if (!lotRes.rows.length) return res.status(404).json({ error: 'Lot not found' });
      const lot = lotRes.rows[0];
      const grn = lot.grn_id ? { grn_number: lot.grn_number, supplier_name: lot.supplier_name, receipt_date: lot.receipt_date } : null;
  
      // Yarn issues that used this lot
      const issuesRes = await pool.query(`
        SELECT yi.*, yii.issued_kg,
               m.machine_name
        FROM yarn_issue_items yii
        JOIN yarn_issues yi ON yi.issue_id = yii.issue_id
        LEFT JOIN machines m ON m.machine_id = yi.machine_id
        WHERE yii.lot_id = $1
        ORDER BY yi.issue_date DESC
      `, [lot.lot_id]);
  
      // Rolls produced on machines that received this lot (via issue)
      const issueIds = issuesRes.rows.map(r => r.issue_id);
      let rolls = [];
      if (issueIds.length) {
        const rollRes = await pool.query(`
          SELECT r.roll_id, r.status, r.warehouse_status,
                 COALESCE(r.actual_weight_kg, r.weight_kg) AS weight_kg,
                 r.shift, COALESCE(r.closed_at, r.created_at) AS produced_at,
                 m.machine_name, o.operator_name
          FROM rolls r
          LEFT JOIN machines m ON m.machine_id = r.machine_id
          LEFT JOIN operators o ON o.operator_id::text = r.operator_id
          WHERE r.issue_id = ANY($1)
          ORDER BY r.created_at DESC
        `, [issueIds]);
        rolls = rollRes.rows;
      }
  
      // For each roll, get batch → challan → receipt → FG → dispatch
      const downstream = [];
      for (const roll of rolls) {
        const batchRes = await pool.query(`SELECT b.* FROM batch_rolls br JOIN batches b ON b.batch_id=br.batch_id WHERE br.roll_id=$1`, [roll.roll_id]);
        const batch = batchRes.rows[0] || null;
        let challan = null, receipt = null, fg = null, dispatch = null;
        if (batch) {
          const cRes = await pool.query(`SELECT * FROM subcontract_challans WHERE batch_id=$1 ORDER BY created_at DESC LIMIT 1`, [batch.batch_id]);
          challan = cRes.rows[0] || null;
          if (challan) {
            const rRes = await pool.query(`SELECT * FROM subcontract_receipts WHERE challan_id=$1 ORDER BY created_at DESC LIMIT 1`, [challan.challan_id]);
            receipt = rRes.rows[0] || null;
            if (receipt) {
              const fgRes = await pool.query(`SELECT * FROM finished_goods WHERE receipt_id=$1 LIMIT 1`, [receipt.receipt_id]);
              fg = fgRes.rows[0] || null;
              if (fg) {
                const dRes = await pool.query(`
                  SELECT di.weight_kg, dc.dispatch_number, dc.customer_name, dc.dispatch_date
                  FROM dispatch_items di JOIN dispatch_challans dc ON dc.dispatch_id=di.dispatch_id
                  WHERE di.fg_id=$1 LIMIT 1
                `, [fg.fg_id]);
                dispatch = dRes.rows[0] || null;
              }
            }
          }
        }
        downstream.push({ roll, batch, challan, receipt, fg, dispatch });
      }
  
      res.json({ lot, grn, issues: issuesRes.rows, downstream, totalRolls: rolls.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/lot-search', async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.json([]);
      const r = await pool.query(`
        SELECT yl.lot_number, yl.yarn_type, yl.brand, yl.net_weight_kg, yl.current_stock_kg,
               g.grn_number, g.supplier_name
        FROM yarn_lots yl LEFT JOIN grn g ON g.grn_id = yl.grn_id
        WHERE yl.lot_number ILIKE $1 OR yl.yarn_type ILIKE $1 OR yl.brand ILIKE $1
        ORDER BY yl.created_at DESC LIMIT 20
      `, [`%${q}%`]);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/', async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.json([]);
      const r = await pool.query(`
        SELECT r.roll_id, r.status, r.warehouse_status, r.actual_weight_kg, r.created_at,
               m.machine_name
        FROM rolls r LEFT JOIN machines m ON m.machine_id=r.machine_id
        WHERE r.roll_id ILIKE $1
        ORDER BY r.created_at DESC LIMIT 20
      `, [`%${q}%`]);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/:roll_id', async (req, res) => {
    try {
      const { roll_id } = req.params;
  
      // 1. Roll core
      const rollRes = await pool.query(`
        SELECT r.*, m.machine_name, m.machine_type, o.operator_name
        FROM rolls r
        LEFT JOIN machines m ON m.machine_id = r.machine_id
        LEFT JOIN operators o ON o.operator_id::text = r.operator_id
        WHERE r.roll_id = $1
      `, [roll_id]);
      if (!rollRes.rows.length) return res.status(404).json({ error: 'Roll not found' });
      const roll = rollRes.rows[0];
  
      // 2. Yarn lot + GRN (if linked)
      let yarnLot = null, grn = null;
      if (roll.lot_id) {
        const lotRes = await pool.query(`SELECT yl.*, g.grn_number, g.supplier_name, g.receipt_date FROM yarn_lots yl JOIN grn g ON g.grn_id=yl.grn_id WHERE yl.lot_id=$1`, [roll.lot_id]);
        if (lotRes.rows.length) { yarnLot = lotRes.rows[0]; grn = { grn_number: yarnLot.grn_number, supplier_name: yarnLot.supplier_name, receipt_date: yarnLot.receipt_date }; }
      }
  
      // 3. Yarn issue (if linked)
      let yarnIssue = null;
      if (roll.issue_id) {
        const issRes = await pool.query(`SELECT * FROM yarn_issues WHERE issue_id=$1`, [roll.issue_id]);
        if (issRes.rows.length) yarnIssue = issRes.rows[0];
      }
  
      // 4. Batch
      const batchRes = await pool.query(`
        SELECT b.* FROM batch_rolls br JOIN batches b ON b.batch_id=br.batch_id WHERE br.roll_id=$1
      `, [roll_id]);
      const batch = batchRes.rows[0] || null;
  
      // 5. Subcontract challan + receipt + finishing
      let challan = null, receipt = null, finishing = null;
      if (batch) {
        const challanRes = await pool.query(`SELECT * FROM subcontract_challans WHERE batch_id=$1 ORDER BY created_at DESC LIMIT 1`, [batch.batch_id]);
        if (challanRes.rows.length) {
          challan = challanRes.rows[0];
          const recRes = await pool.query(`SELECT * FROM subcontract_receipts WHERE challan_id=$1 ORDER BY created_at DESC LIMIT 1`, [challan.challan_id]);
          if (recRes.rows.length) {
            receipt = recRes.rows[0];
            const frRes = await pool.query(`SELECT * FROM finishing_records WHERE receipt_id=$1 LIMIT 1`, [receipt.receipt_id]);
            if (frRes.rows.length) finishing = frRes.rows[0];
          }
        }
      }
  
      // 6. Finished goods + dispatch
      let finishedGoods = null, dispatch = null;
      if (receipt) {
        const fgRes = await pool.query(`SELECT * FROM finished_goods WHERE receipt_id=$1 LIMIT 1`, [receipt.receipt_id]);
        if (fgRes.rows.length) {
          finishedGoods = fgRes.rows[0];
          const diRes = await pool.query(`
            SELECT di.*, dc.dispatch_number, dc.customer_name, dc.dispatch_date, dc.vehicle_number, dc.invoice_number
            FROM dispatch_items di JOIN dispatch_challans dc ON dc.dispatch_id=di.dispatch_id
            WHERE di.fg_id=$1 LIMIT 1
          `, [finishedGoods.fg_id]);
          if (diRes.rows.length) dispatch = diRes.rows[0];
        }
      }
  
      res.json({ roll, grn, yarnLot, yarnIssue, batch, challan, receipt, finishing, finishedGoods, dispatch });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
