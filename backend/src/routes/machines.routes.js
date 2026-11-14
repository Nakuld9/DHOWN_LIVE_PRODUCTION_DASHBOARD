// Machines routes — list, update, details (live status + shift rollups).
// Handlers moved VERBATIM from server.js; app.<m>('/api/machines...') -> router.<m>('/...').
// Mounted at /api/machines. Auth/middleware preserved exactly.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole, getShiftSettings, detectCurrentShift }) => {
  const router = express.Router();

  // Every route below requires a valid session. Applied at router level so a
  // route added later is guarded by default; individual routes add requireRole
  // on top where a specific role is needed.
  router.use(verifyToken);


  router.get('/', async (req, res) => {
  
    try {
  
      const shiftCfg    = await getShiftSettings();
      const currentShift = detectCurrentShift(shiftCfg);
  
      const result = await pool.query(`
        SELECT
          m.*,
          ft.name AS fabric_name,
          COALESCE(ld.rpm, 0) AS rpm,
          COALESCE(ld.production_counter, 0) AS production_counter,
          (COALESCE(ld.production_counter, 0) * COALESCE(m.kg_per_counter, 0)) AS production_kg,
          COALESCE(ld.session_production_kg, 0) AS session_production_kg,
          COALESCE(ld.operator_name, 'N/A') AS operator_name,
          COALESCE(ld.operator_id, '') AS live_operator_id,
          COALESCE(ld.dc_status, 'offline') AS dc_status,
          COALESCE(ld.shift, '') AS live_shift,
          ld.timestamp AS last_data_at,
          dc.ip_address AS dc_ip,
          COALESCE(dc.status, 'UNREGISTERED') AS dc_network_status,
          dc.last_seen AS dc_last_seen,
          dt.id AS downtime_id,
          dt.reason AS downtime_reason,
          dt.start_time AS downtime_start_time,
          ROUND(EXTRACT(EPOCH FROM(NOW()-dt.start_time))/60, 1) AS downtime_duration_minutes,
          COALESCE(pr_today.today_kg, 0) AS today_production_kg,
          COALESCE(pr_shift.shift_kg, 0) AS shift_production_kg,
          oa.operator_name AS assigned_operator,
          oa.operator_id AS assigned_operator_id,
          oa.assigned_at,
          CASE
            WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
            WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
            WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
            WHEN ld.machine_id IS NULL THEN 'NO_DATA'
            WHEN LOWER(COALESCE(ld.dc_status, 'offline')) <> 'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
            WHEN LOWER(COALESCE(ld.dc_status, 'offline')) <> 'online' THEN 'OFFLINE'
            WHEN COALESCE(ld.rpm, 0) > 0 THEN 'RUNNING'
            ELSE 'STOPPED'
          END AS live_status
        FROM machines m
        LEFT JOIN machine_live_data ld ON m.machine_id = ld.machine_id
        LEFT JOIN data_collectors dc ON m.dc_id = dc.dc_id
        LEFT JOIN fabric_types ft ON m.fabric_code = ft.code
        LEFT JOIN LATERAL (
          SELECT assignment_id, operator_id, operator_name, assigned_at
          FROM operator_assignments
          WHERE machine_id = m.machine_id AND status = 'ACTIVE'
          ORDER BY assigned_at DESC LIMIT 1
        ) oa ON true
        LEFT JOIN LATERAL (
          SELECT id, reason, start_time
          FROM machine_downtime
          WHERE machine_id = m.machine_id AND status = 'OPEN'
          ORDER BY start_time DESC
          LIMIT 1
        ) dt ON true
        LEFT JOIN (
          SELECT machine_id, ROUND(SUM(production_kg)::NUMERIC, 3) AS today_kg
          FROM production_records
          WHERE record_date = CURRENT_DATE
          GROUP BY machine_id
        ) pr_today ON pr_today.machine_id = m.machine_id
        LEFT JOIN (
          SELECT machine_id, ROUND(SUM(production_kg)::NUMERIC, 3) AS shift_kg
          FROM production_records
          WHERE record_date = CURRENT_DATE AND shift = $1
          GROUP BY machine_id
        ) pr_shift ON pr_shift.machine_id = m.machine_id
        ORDER BY CASE SUBSTRING(m.machine_id, 1, 2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END, m.machine_id
      `, [currentShift]);
  
      res.json(result.rows);
  
    } catch (err) {
  
      console.error(err);
      res.status(500).json({ error: err.message });
  
    }
  
  });

  router.put('/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  
    const { id } = req.params;
  
    const {
      machine_name,
      machine_type,
      diameter,
      gauge,
      feeders,
      fabric,
      dc_id,
      rpm_target,
      kg_per_counter,
      machine_status,
      active
    } = req.body;
  
    try {
  
      await pool.query(
        `
        UPDATE machines
        SET
          machine_name = $1,
          machine_type = $2,
          diameter = $3,
          gauge = $4,
          feeders = $5,
          fabric = $6,
          dc_id = $7,
          rpm_target = $8,
          kg_per_counter = $9,
          machine_status = $10,
          active = $11
        WHERE machine_id = $12
        `,
        [
          machine_name,
          machine_type,
          diameter,
          gauge,
          feeders,
          fabric,
          dc_id,
          rpm_target,
          kg_per_counter,
          machine_status,
          active,
          id
        ]
      );
  
      res.json({
        success: true,
        message: "Machine Updated"
      });
  
    } catch (err) {
  
      console.error("UPDATE ERROR:", err);
  
      res.status(500).json({
        error: "Update Failed"
      });
  
    }
  
  });

  router.get('/:machineId/details', async (req, res) => {
  
    try {
  
      const { machineId } = req.params;
  
      const result = await pool.query(
        `
        SELECT
          m.machine_id,
          m.machine_name,
          m.machine_type,
          m.diameter,
          m.gauge,
          m.fabric,
          m.rpm_target,
          m.kg_per_counter,
          m.machine_status,
          m.dc_id,
          m.fabric_code,
          ft.name AS fabric_name,
          COALESCE(ld.rpm, 0) AS rpm,
          COALESCE(ld.production_counter, 0) AS production_counter,
          COALESCE(ld.operator_name, 'N/A') AS operator_name,
          COALESCE(ld.dc_status, 'offline') AS dc_status,
          ld.shift,
          ld.timestamp AS last_data_at,
          dc.ip_address AS dc_ip,
          COALESCE(dc.status, 'UNREGISTERED') AS dc_network_status,
          dc.last_seen AS dc_last_seen,
          dt.reason AS downtime_reason,
          dt.start_time AS downtime_start_time,
          ROUND(EXTRACT(EPOCH FROM(NOW()-dt.start_time))/60, 1) AS downtime_duration_minutes,
          oa.operator_name AS assigned_operator,
          oa.operator_id AS assigned_operator_id,
          oa.assigned_at,
          CASE
            WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
            WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
            WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
            WHEN ld.machine_id IS NULL THEN 'NO_DATA'
            WHEN LOWER(COALESCE(ld.dc_status, 'offline')) <> 'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
            WHEN LOWER(COALESCE(ld.dc_status, 'offline')) <> 'online' THEN 'OFFLINE'
            WHEN COALESCE(ld.rpm, 0) > 0 THEN 'RUNNING'
            ELSE 'STOPPED'
          END AS live_status,
          r.roll_id,
          r.roll_weight_kg,
          r.status AS roll_status
        FROM machines m
        LEFT JOIN machine_live_data ld ON m.machine_id = ld.machine_id
        LEFT JOIN data_collectors dc ON m.dc_id = dc.dc_id
        LEFT JOIN fabric_types ft ON m.fabric_code = ft.code
        LEFT JOIN rolls r ON m.machine_id = r.machine_id AND r.status IN ('OPEN', 'PENDING')
        LEFT JOIN LATERAL (
          SELECT assignment_id, operator_id, operator_name, assigned_at
          FROM operator_assignments
          WHERE machine_id = m.machine_id AND status = 'ACTIVE'
          ORDER BY assigned_at DESC LIMIT 1
        ) oa ON true
        LEFT JOIN LATERAL (
          SELECT id, reason, start_time
          FROM machine_downtime
          WHERE machine_id = m.machine_id AND status = 'OPEN'
          ORDER BY start_time DESC LIMIT 1
        ) dt ON true
        WHERE m.machine_id = $1
        LIMIT 1
        `,
        [machineId]
      );
  
      res.json(result.rows[0]);
  
    } catch (err) {
  
      console.error(err);
  
      res.status(500).json({
        error: err.message
      });
  
    }
  
  });

  return router;
};
