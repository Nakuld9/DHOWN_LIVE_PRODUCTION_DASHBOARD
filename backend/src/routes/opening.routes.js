// Opening-balance routes — one-time opening stock entry (yarn, yarn-at-machine,
// greige, subcontract, finished-goods). Handlers moved VERBATIM;
// app.post('/api/opening/x') -> router.post('/x', verifyToken, requireRole('ADMIN')). Mounted at /api/opening.
// All SUPERVISOR. generateQR/rollQRContent injected (greige rolls get a QR).
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole, generateQR, rollQRContent }) => {
  const router = express.Router();

  // Every route below requires a session. Applied at router level so a route
  // added later is guarded by default.
  router.use(verifyToken);


  // --- Opening Balances ---
  // Yarn Store opening
  router.post('/yarn', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const { yarn_type, supplier_lot_no, brand, cones, weight_kg, rate_per_kg, value, item_id } = req.body;
      if (!yarn_type || !weight_kg) return res.status(400).json({ error: 'yarn_type and weight_kg required' });
      const lot_number = 'OB-' + Date.now();
      const finalRate = rate_per_kg || (value && weight_kg ? (parseFloat(value) / parseFloat(weight_kg)).toFixed(2) : null);
      const r = await pool.query(
        `INSERT INTO yarn_lots (lot_number, yarn_type, supplier_lot_no, brand, cones, net_weight_kg, current_stock_kg, rate_per_kg, item_id, status, source)
         VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,'IN_STORE','OPENING') RETURNING *`,
        [lot_number, yarn_type, supplier_lot_no || null, brand || null, cones || null, weight_kg, finalRate, item_id || null]);
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Yarn at work center opening
  router.post('/yarn-at-machine', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { machine_id, yarn_type, supplier_lot_no, brand, cones, weight_kg, rate_per_kg, value, item_id } = req.body;
      if (!machine_id || !yarn_type || !weight_kg) return res.status(400).json({ error: 'machine_id, yarn_type, weight_kg required' });
      const lot_number = 'OB-WC-' + Date.now();
      const finalRate = rate_per_kg || (value && weight_kg ? (parseFloat(value) / parseFloat(weight_kg)).toFixed(2) : null);
      const lot = await client.query(
        `INSERT INTO yarn_lots (lot_number, yarn_type, supplier_lot_no, brand, cones, net_weight_kg, current_stock_kg, rate_per_kg, item_id, status, source)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,'ISSUED','OPENING') RETURNING *`,
        [lot_number, yarn_type, supplier_lot_no || null, brand || null, cones || null, weight_kg, finalRate, item_id || null]);
      // Create yarn issue
      const issue_number = 'OB-ISS-' + Date.now();
      const machine = await client.query('SELECT machine_name FROM machines WHERE machine_id=$1', [machine_id]);
      const iss = await client.query(
        `INSERT INTO yarn_issues (issue_number, machine_id, machine_name, issued_by, notes, status)
         VALUES ($1,$2,$3,'Opening Balance','Opening balance entry','ISSUED') RETURNING *`,
        [issue_number, machine_id, machine.rows[0]?.machine_name || machine_id]);
      await client.query(
        'INSERT INTO yarn_issue_items (issue_id, lot_id, issued_kg) VALUES ($1,$2,$3)',
        [iss.rows[0].issue_id, lot.rows[0].lot_id, weight_kg]);
      await client.query('COMMIT');
      res.json({ lot: lot.rows[0], issue: iss.rows[0] });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
    finally { client.release(); }
  });

  // Greige stock opening — generic roll_id, no machine dependency
  router.post('/greige', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const { fabric_type, weight_kg, value } = req.body;
      if (!fabric_type || !weight_kg) return res.status(400).json({ error: 'fabric_type and weight_kg required' });
      const seq = Date.now().toString().slice(-6);
      const roll_id = `OB-GR-${seq}`;
      const qr_image = await generateQR(rollQRContent(roll_id));
      const r = await pool.query(
        `INSERT INTO rolls (roll_id, fabric_type, actual_weight_kg, status, warehouse_status, source, approved_at, qr_image)
         VALUES ($1,$2,$3,'APPROVED','GREIGE','OPENING',NOW(),$4) RETURNING *`,
        [roll_id, fabric_type, weight_kg, qr_image]);
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Subcontracting (sent) opening
  router.post('/subcontract', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const { vendor_name, fabric_type, weight_kg, sent_date, process_type, rate_per_kg, value } = req.body;
      if (!weight_kg || !process_type) return res.status(400).json({ error: 'weight_kg and process_type required' });
      const challan_number = 'OB-SC-' + Date.now();
      const r = await pool.query(
        `INSERT INTO subcontract_challans (challan_number, vendor_name, job_type, fabric_type, sent_weight_kg, sent_date, rate_per_kg, status, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'SENT','OPENING') RETURNING *`,
        [challan_number, vendor_name || 'Opening', process_type, fabric_type || null, weight_kg, sent_date || new Date().toISOString().slice(0,10), rate_per_kg || null]);
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Finished Goods opening
  router.post('/finished-goods', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const { fabric_type, color_name, lot_no, weight_kg, value } = req.body;
      if (!weight_kg) return res.status(400).json({ error: 'weight_kg required' });
      const r = await pool.query(
        `INSERT INTO finished_goods (fabric_type, color_name, lot_no, weight_kg, status, source)
         VALUES ($1,$2,$3,$4,'IN_STOCK','OPENING') RETURNING *`,
        [fabric_type || null, color_name || null, lot_no || null, weight_kg]);
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
