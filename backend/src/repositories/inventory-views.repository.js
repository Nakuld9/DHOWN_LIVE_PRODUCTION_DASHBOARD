// Inventory-views repository — warehouse overview, live inventory dashboard,
// QR lookup, and work-center stock. SQL verbatim from the original inline handlers.
module.exports = (pool) => ({
  warehouseOverview() {
    return Promise.all([
      pool.query(`SELECT COUNT(*) AS lots, ROUND(COALESCE(SUM(current_stock_kg),0)::NUMERIC,3) AS kg
                  FROM yarn_lots WHERE status='IN_STORE'`),
      pool.query(`SELECT COUNT(*) AS rolls, ROUND(COALESCE(SUM(actual_weight_kg),0)::NUMERIC,3) AS kg
                  FROM rolls WHERE status='APPROVED' AND (warehouse_status IS NULL OR warehouse_status='GREIGE')`),
      pool.query(`SELECT COUNT(*) AS rolls FROM rolls WHERE warehouse_status='IN_BATCH'`),
      pool.query(`SELECT COUNT(*) AS challans, ROUND(COALESCE(SUM(sent_weight_kg),0)::NUMERIC,3) AS kg
                  FROM subcontract_challans WHERE status='SENT'`),
      pool.query(`SELECT COUNT(*) AS lots, ROUND(COALESCE(SUM(weight_kg),0)::NUMERIC,3) AS kg
                  FROM finished_goods WHERE status='IN_STOCK'`),
      pool.query(`SELECT COUNT(*) AS orders, ROUND(COALESCE(SUM(total_weight_kg),0)::NUMERIC,3) AS kg
                  FROM dispatch_challans WHERE status='DISPATCHED'`),
      pool.query(`SELECT COUNT(*) AS count FROM subcontract_challans
                  WHERE status='SENT' AND expected_return_date < CURRENT_DATE`),
    ]);
  },

  inventoryDashboard() {
    return Promise.all([
      pool.query(`SELECT COUNT(*) AS lots, COALESCE(SUM(current_stock_kg),0) AS kg FROM yarn_lots WHERE status='IN_STORE'`),
      pool.query(`SELECT COUNT(*) FROM grn WHERE status='DRAFT'`),
      pool.query(`SELECT COUNT(*) FROM yarn_issues WHERE status='ISSUED'`),
      pool.query(`SELECT COUNT(*) AS rolls, COALESCE(SUM(weight_kg),0) AS kg FROM rolls WHERE warehouse_status='GREIGE'`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE status='OPEN') AS open, COUNT(*) FILTER (WHERE status='SEALED') AS sealed FROM batches`),
      pool.query(`SELECT COUNT(*) AS lots, COALESCE(SUM(weight_kg),0) AS kg FROM finished_goods WHERE status='IN_STOCK'`),
      pool.query(`SELECT COUNT(*) FROM dispatch_challans WHERE dispatch_date >= CURRENT_DATE - INTERVAL '30 days'`),
    ]);
  },

  grnByNumber(num) {
    return pool.query(`SELECT * FROM grn WHERE grn_number=$1`, [num]);
  },
  yarnLotByNumber(num) {
    return pool.query(`SELECT yl.*, g.supplier_name FROM yarn_lots yl JOIN grn g ON g.grn_id=yl.grn_id WHERE yl.lot_number=$1`, [num]);
  },

  workCenterStock() {
    return pool.query(`
      SELECT
        m.machine_id,
        m.machine_name,
        m.fabric AS fabric_type,
        CASE
          WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
          WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
          WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
          WHEN LOWER(COALESCE(ld.dc_status, 'offline')) <> 'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
          WHEN LOWER(COALESCE(ld.dc_status, 'offline')) <> 'online' THEN 'OFFLINE'
          WHEN COALESCE(ld.rpm, 0) > 0 THEN 'RUNNING'
          ELSE 'STOPPED'
        END AS machine_status,
        COALESCE(iss.issued_kg, 0)   AS issued_kg,
        COALESCE(iss.returned_kg, 0) AS returned_kg,
        COALESCE(iss.active_issues, 0) AS active_issues,
        COALESCE(rol.produced_kg, 0) AS produced_kg,
        COALESCE(rol.total_rolls, 0) AS total_rolls,
        ROUND(
          GREATEST(
            COALESCE(iss.issued_kg, 0) - COALESCE(iss.returned_kg, 0) - COALESCE(rol.produced_kg, 0),
            0
          )::NUMERIC, 3
        ) AS gap_kg
      FROM machines m
      LEFT JOIN (
        SELECT yi.machine_id::text,
          ROUND(SUM(ii.issued_kg)::NUMERIC, 3)   AS issued_kg,
          ROUND(SUM(COALESCE(ii.returned_kg,0))::NUMERIC, 3) AS returned_kg,
          COUNT(DISTINCT CASE WHEN yi.status = 'ISSUED' THEN yi.issue_id END) AS active_issues
        FROM yarn_issues yi
        JOIN yarn_issue_items ii ON ii.issue_id = yi.issue_id
        GROUP BY yi.machine_id
      ) iss ON iss.machine_id = m.machine_id::text
      LEFT JOIN (
        SELECT machine_id::text,
          ROUND(SUM(COALESCE(actual_weight_kg, weight_kg, 0))::NUMERIC, 3) AS produced_kg,
          COUNT(*) AS total_rolls
        FROM rolls
        WHERE status IN ('APPROVED','PENDING','OPEN')
        GROUP BY machine_id
      ) rol ON rol.machine_id = m.machine_id::text
      LEFT JOIN machine_live_data ld ON m.machine_id = ld.machine_id
      LEFT JOIN LATERAL (
        SELECT assignment_id FROM operator_assignments
        WHERE machine_id = m.machine_id AND status = 'ACTIVE'
        ORDER BY assigned_at DESC LIMIT 1
      ) oa ON true
      LEFT JOIN LATERAL (
        SELECT id FROM machine_downtime
        WHERE machine_id = m.machine_id AND status = 'OPEN'
        ORDER BY start_time DESC LIMIT 1
      ) dt ON true
      ORDER BY
        CASE SUBSTRING(m.machine_id,1,2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END,
        m.machine_id
    `);
  },
});
