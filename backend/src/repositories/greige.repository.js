// Greige repository — greige-warehouse roll views (approved rolls still in GREIGE).
// SQL verbatim from the original inline /api/greige handlers.
module.exports = (pool) => ({
  list({ fabric_type, machine_id } = {}) {
    const conds = [`r.status = 'APPROVED'`, `(r.warehouse_status IS NULL OR r.warehouse_status = 'GREIGE')`];
    const vals = []; let p = 1;
    if (fabric_type) { conds.push(`r.fabric_type = $${p++}`); vals.push(fabric_type); }
    if (machine_id)  { conds.push(`r.machine_id = $${p++}`);  vals.push(machine_id); }
    return pool.query(`
      SELECT r.*, m.machine_name, m.machine_type
      FROM rolls r
      LEFT JOIN machines m ON r.machine_id = m.machine_id
      WHERE ${conds.join(' AND ')}
      ORDER BY r.created_at DESC
    `, vals);
  },

  summaryByFabric() {
    return pool.query(`
      SELECT
        COALESCE(fabric_type, 'Unknown') AS fabric_type,
        COUNT(*) AS roll_count,
        ROUND(COALESCE(SUM(actual_weight_kg), 0)::NUMERIC, 3) AS total_kg
      FROM rolls
      WHERE status = 'APPROVED' AND (warehouse_status IS NULL OR warehouse_status = 'GREIGE')
      GROUP BY fabric_type
      ORDER BY total_kg DESC
    `);
  },

  summaryTotals() {
    return pool.query(`
      SELECT COUNT(*) AS roll_count,
             ROUND(COALESCE(SUM(actual_weight_kg),0)::NUMERIC,3) AS total_kg
      FROM rolls
      WHERE status='APPROVED' AND (warehouse_status IS NULL OR warehouse_status='GREIGE')`);
  },
});
