// Charts repository — hourly machine trend + production charts from
// production_history. SQL verbatim from the original inline /api/charts handlers.
module.exports = (pool) => ({
  trends(machineId, hours) {
    return pool.query(
      `SELECT
         TO_CHAR(period_start AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS label,
         ROUND(rpm_avg::NUMERIC, 1)                                    AS rpm_avg,
         (counter_end - counter_start)                                 AS counter_delta,
         ROUND(production_kg::NUMERIC, 3)                              AS production_kg
       FROM production_history
       WHERE machine_id  = $1
         AND period_type = 'HOURLY'
         AND period_start >= NOW() - ($2 || ' hours')::INTERVAL
       ORDER BY period_start ASC`,
      [machineId, hours]
    );
  },

  productionHourly({ date, machineId }) {
    const params = [date];
    let where = `period_type = 'HOURLY' AND record_date = $1`;
    if (machineId) { where += ` AND machine_id = $2`; params.push(machineId); }
    return pool.query(
      `SELECT machine_id,
              hour_bucket,
              TO_CHAR(period_start AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS label,
              ROUND(production_kg::NUMERIC, 3) AS production_kg,
              ROUND(rpm_avg::NUMERIC, 1)        AS rpm_avg,
              (counter_end - counter_start)     AS counter_delta
       FROM production_history
       WHERE ${where}
       ORDER BY machine_id,
         CASE SUBSTRING(machine_id,1,2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END,
         hour_bucket ASC`,
      params
    );
  },
});
