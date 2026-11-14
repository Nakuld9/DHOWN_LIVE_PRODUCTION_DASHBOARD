// Maintenance read tools — what is broken/open now, what preventive maintenance is
// due, and which spares are low. Read-only; grounded in the maintenance tables so
// the agent reports only what was logged.

module.exports = function registerMaintenanceTools(registry, { pool }) {
  // Open work orders + machines currently down (an ongoing downtime with no end).
  registry.register({
    name: 'get_open_maintenance',
    description: 'Open maintenance work orders (count + list, by priority) and machines currently down. No arguments.',
    minRole: 'OPERATOR',
    handler: async () => {
      const wos = (await pool.query(
        `SELECT id, machine_id, title, COALESCE(priority,'—') AS priority, status, opened_at
           FROM maintenance_work_orders
          WHERE COALESCE(status,'') NOT IN ('COMPLETED','CLOSED','CANCELLED')
          ORDER BY opened_at DESC NULLS LAST LIMIT 50`)).rows;
      const down = (await pool.query(
        `SELECT machine_id, reason, start_time,
                ROUND(EXTRACT(EPOCH FROM (NOW() - start_time))/60) AS minutes_down
           FROM machine_downtime
          WHERE end_time IS NULL
          ORDER BY start_time ASC LIMIT 50`)).rows;
      return {
        open_work_orders: wos.length,
        by_priority: wos.reduce((m, w) => { m[w.priority] = (m[w.priority] || 0) + 1; return m; }, {}),
        work_orders: wos.slice(0, 15).map(w => ({ id: w.id, machine: w.machine_id, title: w.title, priority: w.priority, status: w.status })),
        machines_down_now: down.length,
        down: down.map(d => ({ machine: d.machine_id, reason: d.reason, minutes_down: Number(d.minutes_down) })),
        note: (wos.length + down.length) === 0 ? 'No open work orders and no machine is currently down.' : undefined,
      };
    },
  });

  // Preventive maintenance due (or overdue) within a window (default 7 days).
  registry.register({
    name: 'get_pm_due',
    description: 'Preventive maintenance tasks due or overdue within a window. Args: {days?: number (default 7)}',
    minRole: 'OPERATOR',
    handler: async ({ days } = {}) => {
      const d = Number(days) >= 0 ? Number(days) : 7;
      const rows = (await pool.query(
        `SELECT machine_id, task_name, COALESCE(priority,'—') AS priority, next_due_date,
                (CURRENT_DATE - next_due_date) AS days_overdue
           FROM maintenance_schedule
          WHERE COALESCE(status,'') NOT IN ('INACTIVE','DONE','CANCELLED')
            AND next_due_date IS NOT NULL
            AND next_due_date <= (CURRENT_DATE + $1::int)
          ORDER BY next_due_date ASC LIMIT 50`, [d])).rows;
      return {
        window_days: d,
        count: rows.length,
        overdue: rows.filter(r => Number(r.days_overdue) > 0).length,
        tasks: rows.map(r => ({
          machine: r.machine_id, task: r.task_name, priority: r.priority,
          due: r.next_due_date, days_overdue: Number(r.days_overdue) > 0 ? Number(r.days_overdue) : 0,
        })),
        note: rows.length === 0 ? 'No preventive maintenance is due in this window.' : undefined,
      };
    },
  });

  // Spare parts at or below their minimum stock.
  registry.register({
    name: 'get_low_spares',
    description: 'Spare parts at or below their minimum stock level. No arguments.',
    minRole: 'OPERATOR',
    handler: async () => {
      const rows = (await pool.query(
        `SELECT part_name, sku, category, current_stock, min_stock, location
           FROM spare_parts
          WHERE deleted_at IS NULL
            AND COALESCE(current_stock,0) <= COALESCE(min_stock,0)
            AND COALESCE(min_stock,0) > 0
          ORDER BY (COALESCE(current_stock,0) - COALESCE(min_stock,0)) ASC LIMIT 50`)).rows;
      return {
        count: rows.length,
        parts: rows.map(r => ({
          part: r.part_name, sku: r.sku, current: Number(r.current_stock || 0),
          min: Number(r.min_stock || 0), location: r.location,
        })),
        note: rows.length === 0 ? 'No spare part is below its minimum stock.' : undefined,
      };
    },
  });

  // ── WRITE tool — the first agent action behind the approvals queue ──────────
  // Raise a maintenance work order. It does NOT create anything when the agent
  // calls it: propose() validates and returns a summary; the row is created only
  // when a SUPERVISOR approves and execute() runs.
  registry.register({
    name: 'raise_maintenance_wo',
    description: 'Raise a maintenance work order for a machine. Proposes the WO for approval; a SUPERVISOR must approve before it is created. Args: {machine_id, issue, priority?}',
    safe: false,
    minRole: 'OPERATOR',       // maintenance staff may propose
    approveRole: 'SUPERVISOR', // a supervisor must approve
    propose: async ({ machine_id, issue, title, priority } = {}) => {
      const m = String(machine_id || '').trim();
      const t = String(issue || title || '').trim();
      if (!m) return { error: 'machine_id is required' };
      if (!t) return { error: 'an issue / title is required' };
      const exists = await pool.query(`SELECT 1 FROM machines WHERE machine_id=$1`, [m]);
      if (exists.rowCount === 0) return { error: `unknown machine: ${m}` };
      const pr = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(priority || '').toUpperCase())
        ? String(priority).toUpperCase() : 'MEDIUM';
      return {
        summary: `Raise a ${pr} maintenance work order for ${m}: "${t}"`,
        payload: { machine_id: m, title: t, priority: pr },
      };
    },
    execute: async ({ machine_id, title, priority }, { user } = {}) => {
      const row = (await pool.query(
        `INSERT INTO maintenance_work_orders (machine_id, title, priority, status, reported_by, opened_at, created_at)
         VALUES ($1,$2,$3,'OPEN',$4,NOW(),NOW()) RETURNING id`,
        [machine_id, title, priority, user?.username || 'ai-approval'])).rows[0];
      return { ok: true, work_order_id: row.id, machine_id, status: 'OPEN' };
    },
  });
};
