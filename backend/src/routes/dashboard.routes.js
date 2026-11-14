// Dashboard routes — kpis, oee, production-trend, live, oee/live.
// Handlers moved VERBATIM from server.js; app.<m>('/api/dashboard...') -> router.<m>('/...').
// Mounted at /api/dashboard. Auth/middleware preserved exactly.
const express = require('express');

module.exports = ({ pool, verifyToken, getShiftSettings, detectCurrentShift }) => {
  const router = express.Router();
  router.use(verifyToken); // require login for all routes in this router

  // Cross-domain operations snapshot (Phase 4): production, machines, quality,
  // inventory, orders, purchase, MRP shortfall — one call for the ops dashboard.
  router.get("/operations", async (req, res) => {
    try { res.json(await require('../lib/dashboard-kpi')(pool).operations()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get("/kpis", async (req, res) => {
    try {
  
      const shiftCfg    = await getShiftSettings();
      const currentShift = detectCurrentShift(shiftCfg);
      const today        = new Date().toISOString().slice(0, 10);
  
      // Total machine count from machines master table
      const totalResult = await pool.query(
        `SELECT COUNT(*) FROM machines`
      );
      const totalMachines = Number(totalResult.rows[0].count);
  
      // Full status breakdown + live counter sum
      const statusResult = await pool.query(`
        SELECT
          m.machine_id,
          ld.machine_id AS ld_machine_id,
          ld.rpm,
          ld.dc_status,
          COALESCE(ld.production_counter, 0) AS production_counter,
          m.kg_per_counter
        FROM machines m
        LEFT JOIN machine_live_data ld ON m.machine_id = ld.machine_id
      `);
  
      const rows = statusResult.rows;
  
      const running  = rows.filter(r => r.ld_machine_id !== null && (r.dc_status || "").toLowerCase() === "online" && Number(r.rpm || 0) > 0).length;
      const stopped  = rows.filter(r => r.ld_machine_id !== null && (r.dc_status || "").toLowerCase() === "online" && Number(r.rpm || 0) === 0).length;
      const offline  = rows.filter(r => r.ld_machine_id !== null && (r.dc_status || "").toLowerCase() !== "online").length;
      const noData   = rows.filter(r => r.ld_machine_id === null).length;
  
      const production = rows.reduce(
        (sum, r) => sum + Number(r.production_counter || 0) * Number(r.kg_per_counter || 0), 0
      );
  
      const totalLiveCounter = rows.reduce((sum, r) => sum + Number(r.production_counter || 0), 0);
  
      const liveRows = rows.filter(r => r.ld_machine_id !== null);
      const avgRpm = liveRows.length > 0
        ? Math.round(liveRows.reduce((sum, r) => sum + Number(r.rpm || 0), 0) / liveRows.length)
        : 0;
  
      // Today & shift production from production_records
      const [todayProd, shiftProd] = await Promise.all([
        pool.query(
          `SELECT ROUND(COALESCE(SUM(production_kg),0)::NUMERIC, 3) AS kg
           FROM production_records WHERE record_date = $1`, [today]
        ),
        pool.query(
          `SELECT ROUND(COALESCE(SUM(production_kg),0)::NUMERIC, 3) AS kg
           FROM production_records WHERE record_date = $1 AND shift = $2`, [today, currentShift]
        )
      ]);
  
      res.json({
        totalMachines,
        running,
        stopped,
        offline,
        noData,
        production:           Math.round(production * 1000) / 1000,
        efficiency:           avgRpm,
        total_live_counter:   totalLiveCounter,
        today_production_kg:  parseFloat(todayProd.rows[0].kg  || 0),
        shift_production_kg:  parseFloat(shiftProd.rows[0].kg  || 0),
        current_shift:        currentShift
      });
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/oee", async (req, res) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const shiftSettings = await getShiftSettings();
      const shift = detectCurrentShift(shiftSettings);
      const r = await pool.query(
        `SELECT ROUND(AVG(oee),2) AS oee, ROUND(AVG(availability),2) AS availability,
                ROUND(AVG(performance),2) AS performance, ROUND(AVG(quality),2) AS quality
         FROM oee_records WHERE record_date=$1 AND shift=$2`,
        [today, shift]
      );
      const row = r.rows[0] || {};
      res.json({
        oee: row.oee || 0,
        availability: row.availability || 0,
        performance: row.performance || 0,
        quality: row.quality ?? 0,
        shift,
        date: today
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/production-trend", async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT ld.machine_id,
               COALESCE(ld.session_production_kg, 0) AS production_kg
        FROM machine_live_data ld
        ORDER BY production_kg DESC
      `);
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/live", async (req, res) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const shiftSettings = await getShiftSettings();
      const currentShift = detectCurrentShift(shiftSettings);
      const [machR, prodR, shiftProdR, oeeR, dtR] = await Promise.all([
        pool.query(`SELECT m.machine_id, m.machine_name, m.machine_type,
            COALESCE(ld.rpm,0) AS rpm, m.rpm_target,
            COALESCE(ld.production_counter,0) AS production_counter,
            COALESCE(ld.session_production_kg,0) AS session_production_kg,
            COALESCE(ld.dc_status,'offline') AS dc_status, ld.shift, ld.timestamp AS last_update,
            dt.reason AS downtime_reason, dt.start_time AS downtime_start_time,
            ROUND(EXTRACT(EPOCH FROM(NOW()-dt.start_time))/60,1) AS downtime_duration_minutes,
            oa.operator_name AS assigned_operator,
            CASE WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
                 WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
                 WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
            WHEN ld.machine_id IS NULL THEN 'NO_DATA'
                 WHEN LOWER(COALESCE(ld.dc_status,'offline'))<>'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
                 WHEN LOWER(COALESCE(ld.dc_status,'offline'))<>'online' THEN 'OFFLINE'
                 WHEN COALESCE(ld.rpm,0)>0 THEN 'RUNNING' ELSE 'STOPPED' END AS live_status
          FROM machines m
          LEFT JOIN machine_live_data ld ON m.machine_id=ld.machine_id
          LEFT JOIN LATERAL (
            SELECT assignment_id, operator_name FROM operator_assignments
            WHERE machine_id=m.machine_id AND status='ACTIVE'
            ORDER BY assigned_at DESC LIMIT 1
          ) oa ON true
          LEFT JOIN LATERAL (
            SELECT id, reason, start_time FROM machine_downtime
            WHERE machine_id=m.machine_id AND status='OPEN'
            ORDER BY start_time DESC LIMIT 1
          ) dt ON true
          ORDER BY CASE SUBSTRING(m.machine_id, 1, 2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END, m.machine_id`),
        pool.query(`SELECT COALESCE(SUM(production_kg),0) AS total_kg FROM production_records WHERE record_date=$1`, [today]),
        pool.query(`SELECT COALESCE(SUM(production_kg),0) AS shift_kg FROM production_records WHERE record_date=$1 AND shift=$2`, [today, currentShift]),
        pool.query(`SELECT ROUND(AVG(oee),2) AS avg_oee, ROUND(AVG(availability),2) AS avg_avail, ROUND(AVG(performance),2) AS avg_perf, ROUND(AVG(quality),2) AS avg_quality FROM oee_records WHERE record_date=$1 AND shift=$2`, [today, currentShift]),
        pool.query(`SELECT reason, COUNT(*) AS occurrences FROM machine_downtime WHERE start_time>=NOW()-INTERVAL '7 days' GROUP BY reason ORDER BY occurrences DESC LIMIT 5`)
      ]);
      const machines = machR.rows;
      const running   = machines.filter(m => m.live_status === 'RUNNING').length;
      const stopped   = machines.filter(m => m.live_status === 'STOPPED').length;
      const offline   = machines.filter(m => m.live_status === 'OFFLINE').length;
      const noData    = machines.filter(m => m.live_status === 'NO_DATA').length;
      const inDowntime = machines.filter(m => m.live_status === 'DOWNTIME').length;
      const oee = oeeR.rows[0] || {};

      // Utilization = running / machines that were actually AVAILABLE to run.
      // Excluded from the denominator:
      //   NO_DATA  — no collector reporting; we never heard from it, so we can't
      //              claim it was idle.
      //   DOWNTIME — a machine under an open downtime record was not available
      //              to produce, so it must not count against utilization
      //              (business rule: downtime is tracked separately, via the
      //              downtime reports and OEE availability, not here).
      const available = machines.length - noData - inDowntime;
      const utilizationPct = available > 0 ? Math.round(running / available * 100) : 0;
      res.json({
        timestamp: new Date().toISOString(),
        current_shift: currentShift,
        kpis: { total_machines: machines.length, running, stopped, offline, no_data: noData, in_downtime: inDowntime, utilization_pct: utilizationPct, available_machines: available, daily_production_kg: Math.round(parseFloat(prodR.rows[0]?.total_kg || 0) * 1000) / 1000, shift_production_kg: Math.round(parseFloat(shiftProdR.rows[0]?.shift_kg || 0) * 1000) / 1000 },
        oee_summary: { avg_oee: oee.avg_oee || 0, avg_availability: oee.avg_avail || 0, avg_performance: oee.avg_perf || 0, avg_quality: oee.avg_quality ?? 0 },
        machines, top_downtime: dtR.rows
      });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  router.get("/oee/live", async (req, res) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const shiftSettings = await getShiftSettings();
      const shift = detectCurrentShift(shiftSettings);
      const r = await pool.query(`SELECT ROUND(AVG(oee),2) AS oee, ROUND(AVG(availability),2) AS availability, ROUND(AVG(performance),2) AS performance, ROUND(AVG(quality),2) AS quality FROM oee_records WHERE record_date=$1 AND shift=$2`, [today, shift]);
      const row = r.rows[0] || {};
      res.json({ oee: row.oee || 0, availability: row.availability || 0, performance: row.performance || 0, quality: row.quality || 100, shift, date: today });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  return router;
};
