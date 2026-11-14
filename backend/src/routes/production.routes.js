// Production routes — current snapshot, daily, shift.
// Handlers moved VERBATIM from server.js; app.<m>('/api/production...') -> router.<m>('/...').
// Mounted at /api/production. Auth/middleware preserved exactly.
const express = require('express');

module.exports = ({ pool, verifyToken, getShiftSettings, detectCurrentShift }) => {
  const router = express.Router();
  router.use(verifyToken); // require login for all routes in this router

  router.get("/current", async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT m.machine_id, m.machine_name, m.machine_type,
               COALESCE(ld.rpm, 0) AS rpm,
               m.rpm_target,
               COALESCE(ld.production_counter, 0) AS production_counter,
               COALESCE(ld.session_production_kg, 0) AS session_production_kg,
               COALESCE(m.kg_per_counter, 0) AS kg_per_counter,
               COALESCE(ld.dc_status, 'offline') AS dc_status,
               ld.shift, ld.timestamp AS last_update,
               dt.reason AS downtime_reason,
               dt.start_time AS downtime_start_time,
               oa.operator_name AS assigned_operator,
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
          SELECT assignment_id, operator_name FROM operator_assignments
          WHERE machine_id = m.machine_id AND status = 'ACTIVE'
          ORDER BY assigned_at DESC LIMIT 1
        ) oa ON true
        LEFT JOIN LATERAL (
          SELECT id, reason, start_time
          FROM machine_downtime
          WHERE machine_id = m.machine_id AND status = 'OPEN'
          ORDER BY start_time DESC LIMIT 1
        ) dt ON true
        ORDER BY CASE SUBSTRING(m.machine_id, 1, 2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END, m.machine_id`);
      res.json(r.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  router.get("/daily", async (req, res) => {
    try {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const r = await pool.query(`
        SELECT pr.machine_id, m.machine_name, m.machine_type, pr.record_date,
               SUM(pr.production_kg) AS production_kg,
               SUM(pr.sample_count) AS sample_count,
               ROUND(SUM(pr.rpm_sum) / NULLIF(SUM(pr.sample_count),0), 2) AS avg_rpm,
               MAX(pr.counter_end) AS last_counter
        FROM production_records pr
        LEFT JOIN machines m ON pr.machine_id = m.machine_id
        WHERE pr.record_date = $1
        GROUP BY pr.machine_id, m.machine_name, m.machine_type, pr.record_date
        ORDER BY production_kg DESC`, [date]);
      res.json({ date, records: r.rows, total_kg: r.rows.reduce((s, x) => s + parseFloat(x.production_kg || 0), 0) });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  router.get("/shift", async (req, res) => {
    try {
      const shiftSettings = await getShiftSettings();
      const shift = req.query.shift || detectCurrentShift(shiftSettings);
      const today = new Date().toISOString().slice(0, 10);
      const r = await pool.query(`
        SELECT pr.machine_id, m.machine_name, pr.shift,
               pr.production_kg, pr.counter_start, pr.counter_end, pr.sample_count,
               ROUND(pr.rpm_sum / NULLIF(pr.sample_count,0), 2) AS avg_rpm, pr.updated_at
        FROM production_records pr
        LEFT JOIN machines m ON pr.machine_id = m.machine_id
        WHERE pr.record_date = $1 AND pr.shift = $2
        ORDER BY pr.production_kg DESC`, [today, shift]);
      res.json({ date: today, shift, records: r.rows, total_kg: r.rows.reduce((s, x) => s + parseFloat(x.production_kg || 0), 0) });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  return router;
};
