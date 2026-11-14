// ERP masters routes — stock statement/ledger, financial years, departments,
// cost centres, tax rates, process routes + steps (layered extraction, ERP chunks c+d
// — completes the ERP migration; no inline /api/erp handlers remain in server.js).
// 20 handlers migrated VERBATIM (2026-07-10). Mounted at /api/erp alongside
// erp-items.routes.js and erp-partners.routes.js.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();

router.get('/stock-statement', requireRole('OPERATOR'), async (req, res) => {
  try {
    const { as_of, warehouse_id, doc_type } = req.query;
    const dateFilter = as_of ? `AND txn_date <= '${as_of}'` : '';
    const whFilter = warehouse_id ? `AND warehouse_id = ${parseInt(warehouse_id)}` : '';
    const dtFilter = doc_type ? `AND doc_type = '${doc_type}'` : '';

    const r = await pool.query(`
      SELECT
        sl.item_id,
        COALESCE(i.item_name, sl.item_desc, 'Unknown') AS item_name,
        COALESCE(i.item_code, 'â€"') AS item_code,
        COALESCE(ic.name, 'â€"') AS category,
        sl.warehouse_id,
        COALESCE(w.name, 'Unknown') AS warehouse_name,
        sl.uom_code,
        SUM(CASE WHEN sl.movement_type='IN' THEN sl.quantity ELSE 0 END) AS total_in,
        SUM(CASE WHEN sl.movement_type='OUT' THEN sl.quantity ELSE 0 END) AS total_out,
        SUM(CASE WHEN sl.movement_type='IN' THEN sl.quantity ELSE -sl.quantity END) AS balance,
        SUM(CASE WHEN sl.movement_type='IN' THEN COALESCE(sl.total_cost,0) ELSE -COALESCE(sl.total_cost,0) END) AS balance_value,
        MAX(sl.txn_date) AS last_txn_date,
        COUNT(*) AS txn_count
      FROM stock_ledger sl
      LEFT JOIN items i ON sl.item_id = i.item_id
      LEFT JOIN item_categories ic ON i.category_id = ic.category_id
      LEFT JOIN warehouses w ON sl.warehouse_id = w.warehouse_id
      WHERE 1=1 ${dateFilter} ${whFilter} ${dtFilter}
      GROUP BY sl.item_id, sl.item_desc, i.item_name, i.item_code, ic.name, sl.warehouse_id, w.name, sl.uom_code
      HAVING SUM(CASE WHEN sl.movement_type='IN' THEN sl.quantity ELSE -sl.quantity END) != 0
         OR SUM(CASE WHEN sl.movement_type='IN' THEN sl.quantity ELSE 0 END) > 0
      ORDER BY w.name, item_name
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/stock-ledger', requireRole('OPERATOR'), async (req, res) => {
  try {
    const { item_id, doc_type, warehouse_id, from_date, to_date, page = 1, limit = 100 } = req.query;
    const conds = []; const params = []; let pi = 1;
    if (item_id)     { conds.push(`sl.item_id=$${pi++}`); params.push(item_id); }
    if (doc_type)    { conds.push(`sl.doc_type=$${pi++}`); params.push(doc_type); }
    if (warehouse_id){ conds.push(`sl.warehouse_id=$${pi++}`); params.push(warehouse_id); }
    if (from_date)   { conds.push(`sl.txn_date>=$${pi++}`); params.push(from_date); }
    if (to_date)     { conds.push(`sl.txn_date<=$${pi++}`); params.push(to_date); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const offset = (parseInt(page)-1)*parseInt(limit);

    const total = await pool.query(`SELECT COUNT(*) FROM stock_ledger sl ${where}`, params);
    const rows = await pool.query(
      `SELECT sl.*, i.item_code, i.item_name, w.name AS warehouse_name
       FROM stock_ledger sl
       LEFT JOIN items i ON sl.item_id=i.item_id
       LEFT JOIN warehouses w ON sl.warehouse_id=w.warehouse_id
       ${where}
       ORDER BY sl.txn_time DESC
       LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, parseInt(limit), offset]
    );
    res.json({ data: rows.rows, total: parseInt(total.rows[0].count), page: parseInt(page) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/financial-years', requireRole('OPERATOR'), async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM financial_years ORDER BY start_date DESC')).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/financial-years', requireRole('ADMIN'), async (req, res) => {
  const { label, start_date, end_date } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO financial_years (label,start_date,end_date) VALUES ($1,$2,$3) RETURNING *`,
      [label, start_date, end_date]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/financial-years/:id', requireRole('ADMIN'), async (req, res) => {
  const { is_active, is_closed } = req.body;
  try {
    if (is_active) await pool.query('UPDATE financial_years SET is_active=FALSE');
    await pool.query(
      `UPDATE financial_years SET is_active=$1,is_closed=$2 WHERE fy_id=$3`,
      [is_active||false, is_closed||false, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/departments', requireRole('OPERATOR'), async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM departments ORDER BY code')).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/departments', requireRole('ADMIN'), async (req, res) => {
  const { code, name, head_user } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO departments (code,name,head_user) VALUES ($1,$2,$3) RETURNING *`,
      [code, name, head_user||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/departments/:id', requireRole('ADMIN'), async (req, res) => {
  const { name, head_user, is_active } = req.body;
  try {
    await pool.query(`UPDATE departments SET name=$1,head_user=$2,is_active=$3 WHERE dept_id=$4`,
      [name, head_user||null, is_active!==false, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/cost-centres', requireRole('OPERATOR'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT cc.*, d.name AS dept_name FROM cost_centres cc
       LEFT JOIN departments d ON cc.dept_id=d.dept_id ORDER BY cc.code`
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/cost-centres', requireRole('ADMIN'), async (req, res) => {
  const { code, name, dept_id } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO cost_centres (code,name,dept_id) VALUES ($1,$2,$3) RETURNING *`,
      [code, name, dept_id||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/tax-rates', requireRole('OPERATOR'), async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM tax_rates ORDER BY igst')).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/tax-rates', requireRole('ADMIN'), async (req, res) => {
  const { code, name, cgst, sgst, igst } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO tax_rates (code,name,cgst,sgst,igst) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [code, name, cgst||0, sgst||0, igst||0]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/tax-rates/:id', requireRole('ADMIN'), async (req, res) => {
  const { name, cgst, sgst, igst, is_active } = req.body;
  try {
    await pool.query(`UPDATE tax_rates SET name=$1,cgst=$2,sgst=$3,igst=$4,is_active=$5 WHERE tax_id=$6`,
      [name, cgst, sgst, igst, is_active!==false, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/process-routes', requireRole('OPERATOR'), async (req, res) => {
  try {
    const routes = await pool.query('SELECT * FROM process_routes ORDER BY code');
    const steps = await pool.query(
      `SELECT s.*, d.name AS dept_name FROM process_route_steps s
       LEFT JOIN departments d ON s.dept_id=d.dept_id ORDER BY s.route_id, s.step_order`
    );
    const result = routes.rows.map(r => ({
      ...r,
      steps: steps.rows.filter(s => s.route_id === r.route_id),
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/process-routes', requireRole('ADMIN'), async (req, res) => {
  const { code, name, description, item_category } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO process_routes (code,name,description,item_category,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [code, name, description||null, item_category||null, req.user?.username||'system']
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/process-routes/:id', requireRole('ADMIN'), async (req, res) => {
  const { name, description, is_active } = req.body;
  try {
    await pool.query(`UPDATE process_routes SET name=$1,description=$2,is_active=$3 WHERE route_id=$4`,
      [name, description||null, is_active!==false, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/process-routes/:id/steps', requireRole('ADMIN'), async (req, res) => {
  const { step_order, step_code, step_name, location_type, dept_id, generates_document, is_optional } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO process_route_steps (route_id,step_order,step_code,step_name,location_type,dept_id,generates_document,is_optional)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, step_order, step_code, step_name, location_type||'INTERNAL',
       dept_id||null, generates_document||null, is_optional||false]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/process-routes/:id/steps/:sid', requireRole('ADMIN'), async (req, res) => {
  const { step_name, step_order, location_type, dept_id, generates_document, is_optional } = req.body;
  try {
    await pool.query(
      `UPDATE process_route_steps SET step_name=$1,step_order=$2,location_type=$3,dept_id=$4,generates_document=$5,is_optional=$6
       WHERE step_id=$7 AND route_id=$8`,
      [step_name, step_order, location_type, dept_id||null, generates_document||null, is_optional||false,
       req.params.sid, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/process-routes/:id/steps/:sid', requireRole('ADMIN'), async (req, res) => {
  try {
    await pool.query('DELETE FROM process_route_steps WHERE step_id=$1 AND route_id=$2', [req.params.sid, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/process-routes/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    await pool.query('DELETE FROM process_route_steps WHERE route_id=$1', [req.params.id]);
    await pool.query('DELETE FROM process_routes WHERE route_id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

  return router;
};
