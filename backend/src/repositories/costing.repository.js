// Costing repository — data access for cost_entries / cost_rates / cost_snapshots
// and the variance source queries (yarn issues vs rolls produced, BOM). SQL kept
// verbatim from the original inline /api/costing/* handlers.
module.exports = (pool) => ({
  // ── Knitting variance ──
  knittingIssued({ from, to }) {
    const conds = []; const params = [];
    if (from) { conds.push(`yi.created_at::date >= $${params.length + 1}`); params.push(from); }
    if (to)   { conds.push(`yi.created_at::date <= $${params.length + 1}`); params.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return pool.query(`
      SELECT yi.machine_id, yi.machine_name,
             yi.created_at::date AS issue_date,
             SUM(ii.issued_kg) AS yarn_issued_kg
      FROM yarn_issues yi
      JOIN yarn_issue_items ii ON ii.issue_id = yi.issue_id
      ${where}
      GROUP BY yi.machine_id, yi.machine_name, yi.created_at::date
      ORDER BY issue_date DESC, yi.machine_id
    `, params);
  },

  knittingProduced({ from, to }) {
    const rollConds = []; const rollParams = [];
    if (from) { rollConds.push(`r.approved_at::date >= $${rollParams.length + 1}`); rollParams.push(from); }
    if (to)   { rollConds.push(`r.approved_at::date <= $${rollParams.length + 1}`); rollParams.push(to); }
    const rollWhere = rollConds.length ? `WHERE r.status='APPROVED' AND ${rollConds.join(' AND ')}` : `WHERE r.status='APPROVED'`;
    return pool.query(`
      SELECT r.machine_id,
             r.approved_at::date AS prod_date,
             SUM(r.actual_weight_kg) AS fabric_produced_kg,
             COUNT(*) AS roll_count,
             COALESCE(i.standard_loss_pct, 1.00) AS std_loss_pct
      FROM rolls r
      LEFT JOIN items i ON i.item_id = r.fabric_item_id
      ${rollWhere}
      GROUP BY r.machine_id, r.approved_at::date, i.standard_loss_pct
      ORDER BY prod_date DESC, r.machine_id
    `, rollParams);
  },

  // ── BOM variance ──
  bomProduced({ from, to }) {
    const prodConds = ["r.status='APPROVED'"]; const prodParams = [];
    if (from) { prodConds.push(`r.approved_at::date >= $${prodParams.length + 1}`); prodParams.push(from); }
    if (to)   { prodConds.push(`r.approved_at::date <= $${prodParams.length + 1}`); prodParams.push(to); }
    return pool.query(`
      SELECT r.machine_id, m.machine_name,
             r.fabric_item_id, fi.item_code AS fabric_code, fi.item_name AS fabric_name,
             COALESCE(fi.standard_loss_pct, 1.00) AS std_loss_pct,
             SUM(r.actual_weight_kg) AS fabric_kg, COUNT(*) AS roll_count
      FROM rolls r
      JOIN machines m ON m.machine_id = r.machine_id
      LEFT JOIN items fi ON fi.item_id = r.fabric_item_id
      WHERE ${prodConds.join(' AND ')} AND r.fabric_item_id IS NOT NULL
      GROUP BY r.machine_id, m.machine_name, r.fabric_item_id, fi.item_code, fi.item_name, fi.standard_loss_pct
    `, prodParams);
  },

  bomLines(fabricIds) {
    return pool.query(`
      SELECT bl.fabric_item_id, bl.yarn_item_id, bl.percentage,
             yi.item_code AS yarn_code, yi.item_name AS yarn_name
      FROM bom_lines bl JOIN items yi ON yi.item_id = bl.yarn_item_id
      WHERE bl.fabric_item_id = ANY($1)
    `, [fabricIds]);
  },

  bomActual({ from, to }) {
    const issConds = []; const issParams = [];
    if (from) { issConds.push(`yi.created_at::date >= $${issParams.length + 1}`); issParams.push(from); }
    if (to)   { issConds.push(`yi.created_at::date <= $${issParams.length + 1}`); issParams.push(to); }
    const issWhere = issConds.length ? `WHERE ${issConds.join(' AND ')}` : '';
    return pool.query(`
      SELECT yi.machine_id, yl.item_id AS yarn_item_id,
             yit.item_code AS yarn_code, yit.item_name AS yarn_name,
             SUM(ii.issued_kg - COALESCE(ii.returned_kg,0)) AS net_consumed_kg
      FROM yarn_issues yi
      JOIN yarn_issue_items ii ON ii.issue_id = yi.issue_id
      JOIN yarn_lots yl ON yl.lot_id = ii.lot_id
      LEFT JOIN items yit ON yit.item_id = yl.item_id
      ${issWhere}
      GROUP BY yi.machine_id, yl.item_id, yit.item_code, yit.item_name
    `, issParams);
  },

  // ── Rates ──
  ratesList() { return pool.query(`SELECT * FROM cost_rates ORDER BY yarn_type`); },

  upsertRate(b, username) {
    return pool.query(
      `INSERT INTO cost_rates (yarn_type, price_per_kg, labour_per_shift, machine_depreciation_per_hour, notes, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (yarn_type) DO UPDATE
         SET price_per_kg=$2, labour_per_shift=$3, machine_depreciation_per_hour=$4,
             notes=$5, updated_by=$6, updated_at=NOW()
       RETURNING *`,
      [b.yarn_type, b.price_per_kg, b.labour_per_shift || 0, b.machine_depreciation_per_hour || 0, b.notes || null, username]
    );
  },

  // ── Roll cost ──
  rollWithMachine(id) {
    return pool.query(`SELECT r.*, m.machine_name FROM rolls r LEFT JOIN machines m ON m.machine_id=r.machine_id WHERE r.roll_id=$1`, [id]);
  },
  rollEntries(id) {
    return pool.query(`SELECT * FROM cost_entries WHERE reference_type='ROLL' AND reference_id=$1 ORDER BY created_at`, [id]);
  },

  // ── Batch cost P&L ──
  batchById(id) { return pool.query(`SELECT * FROM batches WHERE batch_id=$1`, [id]); },
  batchRolls(id) { return pool.query(`SELECT r.roll_id FROM batch_rolls br JOIN rolls r ON r.roll_id=br.roll_id WHERE br.batch_id=$1`, [id]); },
  rollEntriesAgg(rollIds) {
    return pool.query(`SELECT cost_component, SUM(amount_rs) AS total, SUM(quantity_kg) AS kg FROM cost_entries WHERE reference_type='ROLL' AND reference_id=ANY($1) GROUP BY cost_component`, [rollIds]);
  },
  batchEntriesAgg(id) {
    return pool.query(`SELECT cost_component, SUM(amount_rs) AS total, SUM(quantity_kg) AS kg FROM cost_entries WHERE reference_type='BATCH' AND reference_id=$1 GROUP BY cost_component`, [id]);
  },
  challanEntriesAgg(id) {
    return pool.query(`SELECT cost_component, SUM(amount_rs) AS total, SUM(quantity_kg) AS kg FROM cost_entries WHERE reference_type='CHALLAN' AND reference_id IN (SELECT challan_id::text FROM subcontract_challans WHERE batch_id=$1) GROUP BY cost_component`, [id]);
  },

  // ── Factory summary ── (dateClause interpolated exactly as the original)
  summary({ from, to }) {
    const dateClause = from && to ? `AND created_at::date BETWEEN '${from}' AND '${to}'` : `AND created_at >= NOW() - INTERVAL '30 days'`;
    return Promise.all([
      pool.query(`SELECT cost_component, SUM(amount_rs) AS total_rs, SUM(quantity_kg) AS total_kg FROM cost_entries WHERE 1=1 ${dateClause} GROUP BY cost_component ORDER BY total_rs DESC`),
      pool.query(`SELECT fabric_type, SUM(amount_rs) AS total_rs, SUM(quantity_kg) AS total_kg, ROUND(SUM(amount_rs)/NULLIF(SUM(quantity_kg),0),2) AS cost_per_kg FROM cost_entries WHERE fabric_type IS NOT NULL ${dateClause} GROUP BY fabric_type ORDER BY cost_per_kg DESC`),
      pool.query(`SELECT COALESCE(SUM(amount_rs),0) AS wastage_rs FROM cost_entries WHERE cost_component='WASTAGE' ${dateClause}`),
      pool.query(`SELECT COALESCE(SUM(amount_rs),0) AS jobwork_rs FROM cost_entries WHERE cost_component IN ('JOBWORK_DYEING','JOBWORK_FINISHING','JOBWORK_DYEING_FINISHING') ${dateClause}`),
      pool.query(`SELECT * FROM cost_snapshots WHERE snapshot_date >= NOW() - INTERVAL '30 days' ORDER BY snapshot_date DESC LIMIT 90`),
    ]);
  },

  // ── FG lot cost ──
  fgWithBatch(id) {
    return pool.query(`SELECT fg.*, b.batch_number FROM finished_goods fg LEFT JOIN batches b ON b.batch_id=fg.batch_id WHERE fg.fg_id=$1`, [id]);
  },
  fgBatchCost(batchId) {
    return pool.query(`SELECT SUM(amount_rs) AS total FROM cost_entries WHERE (reference_type='BATCH' AND reference_id=$1) OR (reference_type='ROLL' AND reference_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)) OR (reference_type='CHALLAN' AND reference_id IN (SELECT challan_id::text FROM subcontract_challans WHERE batch_id=$1))`, [batchId]);
  },

  // ── AI ask context ──
  askContext() {
    return Promise.all([
      pool.query(`SELECT yarn_type, price_per_kg FROM cost_rates ORDER BY yarn_type`),
      pool.query(`SELECT cost_component, ROUND(SUM(amount_rs),2) AS total_rs, ROUND(SUM(quantity_kg),2) AS total_kg FROM cost_entries WHERE created_at >= NOW() - INTERVAL '30 days' GROUP BY cost_component`),
      pool.query(`SELECT fabric_type, ROUND(SUM(amount_rs)/NULLIF(SUM(quantity_kg),0),2) AS cost_per_kg, ROUND(SUM(quantity_kg),2) AS kg FROM cost_entries WHERE created_at >= NOW() - INTERVAL '30 days' AND fabric_type IS NOT NULL GROUP BY fabric_type ORDER BY cost_per_kg DESC`),
      pool.query(`SELECT item_code, item_name, knitting_rate_per_kg, standard_loss_pct FROM items WHERE knitting_rate_per_kg IS NOT NULL ORDER BY item_code`),
      pool.query(`
        SELECT yi.machine_id, m.machine_name,
               ROUND(SUM(yii.issued_kg)::NUMERIC,2) AS yarn_issued_kg,
               ROUND(COALESCE(fab.fabric_kg,0)::NUMERIC,2) AS fabric_out_kg,
               ROUND((SUM(yii.issued_kg) - COALESCE(fab.fabric_kg,0))::NUMERIC,2) AS actual_loss_kg
        FROM yarn_issues yi
        JOIN yarn_issue_items yii ON yii.issue_id = yi.issue_id
        LEFT JOIN machines m ON m.machine_id = yi.machine_id
        LEFT JOIN (
          SELECT machine_id, SUM(actual_weight_kg) AS fabric_kg FROM rolls
          WHERE status='APPROVED' AND approved_at >= NOW() - INTERVAL '30 days'
          GROUP BY machine_id
        ) fab ON fab.machine_id = yi.machine_id
        WHERE yi.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY yi.machine_id, m.machine_name, fab.fabric_kg
        ORDER BY actual_loss_kg DESC
      `).catch(() => ({ rows: [] })),
    ]);
  },
});
