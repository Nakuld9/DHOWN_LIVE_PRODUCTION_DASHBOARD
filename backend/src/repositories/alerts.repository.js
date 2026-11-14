// Alerts repository — stopped/down machines, open downtime, active assignments,
// low-stock spare parts. SQL verbatim from the original inline /api/alerts.
module.exports = (pool) => ({
  stoppedMachines() {
    return pool.query(`
      SELECT m.*,
        CASE
          WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
          WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
          WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
          WHEN LOWER(COALESCE(ld.dc_status,'offline')) <> 'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
          WHEN LOWER(COALESCE(ld.dc_status,'offline')) <> 'online' THEN 'OFFLINE'
          WHEN COALESCE(ld.rpm,0) > 0 THEN 'RUNNING'
          ELSE 'STOPPED'
        END AS live_status
      FROM machines m
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
      WHERE (
        CASE
          WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
          WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
          WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
          WHEN LOWER(COALESCE(ld.dc_status,'offline')) <> 'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
          WHEN LOWER(COALESCE(ld.dc_status,'offline')) <> 'online' THEN 'OFFLINE'
          WHEN COALESCE(ld.rpm,0) > 0 THEN 'RUNNING'
          ELSE 'STOPPED'
        END
      ) IN ('STOPPED', 'DOWNTIME')
    `);
  },

  openDowntime() {
    return pool.query(`
      SELECT md.*, m.machine_name,
        ROUND(EXTRACT(EPOCH FROM(NOW()-md.start_time))/60, 1) AS current_minutes
      FROM machine_downtime md
      LEFT JOIN machines m ON md.machine_id = m.machine_id
      WHERE md.status = 'OPEN'
      ORDER BY md.start_time ASC
    `);
  },

  activeAssignments() {
    return pool.query(`
      SELECT machine_id
      FROM operator_assignments
      WHERE status='ACTIVE'
    `);
  },

  lowStockParts() {
    return pool.query(`
      SELECT id, part_name, sku, category, unit, current_stock, min_stock, location
      FROM spare_parts WHERE deleted_at IS NULL AND current_stock <= min_stock AND min_stock > 0
      ORDER BY (min_stock - current_stock) DESC
    `);
  },
});
