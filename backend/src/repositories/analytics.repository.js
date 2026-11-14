// Analytics repository — OEE, utilization, and shift/downtime analytics queries.
// SQL kept verbatim from the original inline /api/oee, /api/utilization,
// /api/analytics/* handlers.
module.exports = (pool) => ({
  oeeByDateShift(date, shift) {
    return pool.query(`
      SELECT o.machine_id, m.machine_name, m.machine_type,
             o.record_date, o.shift, o.planned_minutes, o.run_minutes, o.stopped_minutes,
             o.availability, o.performance, o.quality, o.oee,
             o.production_kg, o.rpm_avg, o.sample_count, o.updated_at
      FROM oee_records o
      LEFT JOIN machines m ON o.machine_id = m.machine_id
      WHERE o.record_date = $1 AND o.shift = $2
      ORDER BY o.oee DESC`, [date, shift]);
  },

  oeeMachineToday(machineId, date) {
    return pool.query(`SELECT o.*, m.machine_name, m.rpm_target FROM oee_records o LEFT JOIN machines m ON o.machine_id=m.machine_id WHERE o.machine_id=$1 AND o.record_date=$2 ORDER BY o.updated_at DESC LIMIT 1`, [machineId, date]);
  },
  oeeMachineHistory(machineId) {
    return pool.query(`SELECT record_date, shift, oee, availability, performance, production_kg FROM oee_records WHERE machine_id=$1 ORDER BY record_date DESC, shift LIMIT 30`, [machineId]);
  },

  utilizationByDate(date) {
    return pool.query(`
      SELECT machine_id, status,
             SUM(COALESCE(duration_minutes, EXTRACT(EPOCH FROM(NOW()-start_time))/60)) AS total_minutes
      FROM machine_status_log
      WHERE DATE(start_time) = $1
      GROUP BY machine_id, status`, [date]);
  },

  utilizationMachine(machineId, days) {
    return pool.query(`
      SELECT DATE(start_time) AS date, shift, status,
             SUM(COALESCE(duration_minutes, EXTRACT(EPOCH FROM(NOW()-start_time))/60)) AS minutes
      FROM machine_status_log
      WHERE machine_id=$1 AND start_time >= NOW() - INTERVAL '1 day' * $2
      GROUP BY DATE(start_time), shift, status
      ORDER BY date DESC, shift`, [machineId, days]);
  },

  shiftsProduction(date) {
    return pool.query(`SELECT shift, SUM(production_kg) AS production_kg, COUNT(DISTINCT machine_id) AS machines_active, SUM(sample_count) AS samples FROM production_records WHERE record_date=$1 GROUP BY shift ORDER BY shift`, [date]);
  },
  shiftsOee(date) {
    return pool.query(`SELECT shift, ROUND(AVG(oee),2) AS avg_oee, ROUND(AVG(availability),2) AS avg_availability, ROUND(AVG(performance),2) AS avg_performance FROM oee_records WHERE record_date=$1 GROUP BY shift ORDER BY shift`, [date]);
  },
  shiftsDowntime(date) {
    return pool.query(`SELECT reason, COUNT(*) AS occurrences, ROUND(SUM(COALESCE(duration_minutes, EXTRACT(EPOCH FROM(COALESCE(end_time,NOW())-start_time))/60)),1) AS total_minutes FROM machine_downtime WHERE DATE(start_time)=$1 GROUP BY reason ORDER BY total_minutes DESC LIMIT 10`, [date]);
  },

  topDowntime(days) {
    return pool.query(`
      SELECT reason, COUNT(*) AS occurrences,
             ROUND(SUM(COALESCE(duration_minutes, EXTRACT(EPOCH FROM(COALESCE(end_time,NOW())-start_time))/60)),1) AS total_minutes,
             ROUND(AVG(COALESCE(duration_minutes, EXTRACT(EPOCH FROM(COALESCE(end_time,NOW())-start_time))/60)),1) AS avg_minutes
      FROM machine_downtime
      WHERE start_time >= NOW() - INTERVAL '1 day' * $1
      GROUP BY reason ORDER BY total_minutes DESC LIMIT 10`, [days]);
  },
});
