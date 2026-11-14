// Maintenance-schedule repository — data access for maintenance_schedule.
// Extracted verbatim from the inline /api/maintenance-schedule handlers in server.js.
module.exports = (pool) => ({
  findActive() {
    return pool.query(`
      SELECT ms.*, m.machine_name,
        CASE
          WHEN ms.next_due_date < CURRENT_DATE THEN 'OVERDUE'
          WHEN ms.next_due_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'DUE_SOON'
          ELSE 'OK'
        END AS due_status
      FROM maintenance_schedule ms
      JOIN machines m ON ms.machine_id = m.machine_id
      WHERE ms.status = 'ACTIVE'
      ORDER BY ms.next_due_date ASC NULLS LAST
    `);
  },

  insert(b, nextDueDate) {
    return pool.query(
      `INSERT INTO maintenance_schedule (machine_id, task_name, task_type, frequency_days, last_done_date, next_due_date, assigned_to, priority, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [b.machine_id, b.task_name, b.task_type || 'PERIODIC', b.frequency_days || null,
       b.last_done_date || null, nextDueDate, b.assigned_to || null, b.priority || 'MEDIUM', b.notes || null]
    );
  },

  findById(id) {
    return pool.query(`SELECT * FROM maintenance_schedule WHERE schedule_id=$1`, [id]);
  },

  markDone(id, completedDate, nextDueDate, notes) {
    return pool.query(
      `UPDATE maintenance_schedule SET last_done_date=$1, next_due_date=$2, notes=$3, updated_at=NOW() WHERE schedule_id=$4 RETURNING *`,
      [completedDate, nextDueDate, notes, id]
    );
  },

  logCompletion(username, detail) {
    return pool.query(
      `INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,'COMPLETE_MAINTENANCE_TASK','MAINTENANCE_SCHEDULE',$2)`,
      [username, detail]
    );
  },

  softDelete(id) {
    return pool.query(`UPDATE maintenance_schedule SET status='COMPLETED' WHERE schedule_id=$1`, [id]);
  },
});
