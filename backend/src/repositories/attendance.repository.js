// Attendance repository — operator_attendance views. SQL verbatim from the
// original inline /api/attendance handlers.
module.exports = (pool) => ({
  list({ date, shift }) {
    let q = `
      SELECT a.*, o.department, o.rfid_tag
      FROM operator_attendance a
      LEFT JOIN operators o ON a.operator_id = o.operator_id::text
      WHERE a.work_date = $1`;
    const params = [date];
    if (shift) { q += ` AND a.shift = $2`; params.push(shift); }
    q += ` ORDER BY a.clock_in`;
    return pool.query(q, params);
  },

  findOperator(operatorId) {
    return pool.query(
      `SELECT operator_name FROM operators WHERE operator_id::text = $1`,
      [String(operatorId)]
    );
  },

  // Manual "mark present" — upsert on the (operator_id, work_date, shift) key so
  // re-marking or a later RFID scan just refreshes the same row.
  markPresent({ operator_id, operator_name, work_date, shift }) {
    return pool.query(
      `INSERT INTO operator_attendance
         (operator_id, operator_name, work_date, shift, clock_in, last_seen, scan_count, status)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), 1, 'PRESENT')
       ON CONFLICT (operator_id, work_date, shift)
       DO UPDATE SET status = 'PRESENT', last_seen = NOW(),
                     operator_name = COALESCE(EXCLUDED.operator_name, operator_attendance.operator_name)
       RETURNING *`,
      [String(operator_id), operator_name, work_date, shift]
    );
  },

  remove(id) {
    return pool.query(`DELETE FROM operator_attendance WHERE attendance_id = $1`, [id]);
  },

  summary({ from, to }) {
    return pool.query(`
      SELECT
        a.operator_id, a.operator_name,
        COUNT(*)                                          AS days_present,
        COUNT(CASE WHEN a.shift='D' THEN 1 END)          AS day_shifts,
        COUNT(CASE WHEN a.shift='N' THEN 1 END)          AS night_shifts,
        ROUND(AVG(a.scan_count),1)                       AS avg_scans_per_shift,
        MIN(a.clock_in)                                  AS first_seen,
        MAX(a.last_seen)                                 AS last_seen
      FROM operator_attendance a
      WHERE a.work_date BETWEEN $1 AND $2
      GROUP BY a.operator_id, a.operator_name
      ORDER BY days_present DESC, a.operator_name
    `, [from, to]);
  },
});
