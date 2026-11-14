// Preventive-maintenance auto-scheduler.
//
// Scans maintenance_schedule for tasks whose next_due_date has arrived and raises a
// PREVENTIVE work order for each — once per due cycle (guarded by last_wo_raised), and
// never a duplicate while an open WO for that machine+task already exists. Operators
// then action the WO; completing the schedule (PUT /:id/complete) advances next_due_date,
// which makes it eligible again next cycle.

const obs = require('./observability');

module.exports = ({ pool }) => {
  async function run() {
    let created = 0, due = 0;
    try {
      const rows = (await pool.query(
        `SELECT schedule_id, machine_id, task_name, priority, notes, next_due_date
           FROM maintenance_schedule
          WHERE COALESCE(status,'ACTIVE') NOT IN ('INACTIVE','DISABLED','DONE')
            AND next_due_date IS NOT NULL
            AND next_due_date <= CURRENT_DATE
            AND (last_wo_raised IS NULL OR last_wo_raised < next_due_date)`)).rows;
      due = rows.length;
      for (const s of rows) {
        // Don't stack duplicates if one is already open for this machine + task.
        const openWo = await pool.query(
          `SELECT 1 FROM maintenance_work_orders
            WHERE machine_id = $1 AND title = $2 AND work_order_type = 'PREVENTIVE'
              AND status IN ('OPEN','IN_PROGRESS') LIMIT 1`, [s.machine_id, s.task_name]);
        if (!openWo.rows.length) {
          const dueStr = s.next_due_date ? new Date(s.next_due_date).toISOString().slice(0, 10) : '';
          await pool.query(
            `INSERT INTO maintenance_work_orders (machine_id, title, description, work_order_type, priority, status, reported_by)
             VALUES ($1, $2, $3, 'PREVENTIVE', $4, 'OPEN', 'PM-AUTO')`,
            [s.machine_id, s.task_name,
             `Auto-raised preventive maintenance (due ${dueStr}).${s.notes ? ' ' + s.notes : ''}`,
             s.priority || 'MEDIUM']);
          created++;
        }
        // Mark this due cycle handled either way, so we don't re-scan it every run.
        await pool.query(`UPDATE maintenance_schedule SET last_wo_raised = next_due_date, updated_at = NOW() WHERE schedule_id = $1`, [s.schedule_id]);
      }
      if (created) obs.log('info', 'pm.raised', { created, due });
    } catch (e) { console.error('[pm-scheduler] error:', e.message); }
    return { created, due };
  }
  return { run };
};
