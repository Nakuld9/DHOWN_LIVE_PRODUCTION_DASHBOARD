// Payroll repository — payroll_runs (header) + payroll_items (per worker).
// A run auto-generates one item per active worker, pulling attendance days
// from operator_attendance for the period. Gross = DAILY: days×rate, or flat
// MONTHLY rate. Net = gross + overtime + bonus − deductions − advance.
const { computePay } = require('../lib/payroll-calc');

module.exports = (pool) => ({
  listRuns() {
    return pool.query(
      `SELECT r.*, COUNT(i.item_id) AS worker_count
       FROM payroll_runs r LEFT JOIN payroll_items i ON i.run_id = r.run_id
       GROUP BY r.run_id ORDER BY r.created_at DESC`
    );
  },

  async findRun(id) {
    const r = await pool.query(`SELECT * FROM payroll_runs WHERE run_id = $1`, [id]);
    if (!r.rows.length) return null;
    const items = await pool.query(
      `SELECT * FROM payroll_items WHERE run_id = $1
       ORDER BY CASE worker_type WHEN 'SUPERVISOR' THEN 0 WHEN 'MASTER' THEN 1
                WHEN 'OPERATOR' THEN 2 WHEN 'HELPER' THEN 3 ELSE 4 END, operator_name`, [id]
    );
    return { ...r.rows[0], items: items.rows };
  },

  findStatus(id) { return pool.query(`SELECT status FROM payroll_runs WHERE run_id = $1`, [id]); },

  // Create the run header + one item per active worker (attendance-driven).
  async createRun(runNumber, { period_from, period_to, notes, created_by }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hd = await client.query(
        `INSERT INTO payroll_runs (run_number, period_from, period_to, notes, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [runNumber, period_from, period_to, notes || null, created_by || null]
      );
      const runId = hd.rows[0].run_id;
      await client.query(
        `INSERT INTO payroll_items
           (run_id, operator_id, operator_code, operator_name, worker_type,
            wage_type, wage_rate, days_present, gross_amount, net_amount)
         SELECT $1, o.operator_id, o.operator_code, o.operator_name, o.worker_type,
                COALESCE(o.wage_type,'DAILY'), COALESCE(o.wage_rate,0),
                COALESCE(a.days,0),
                CASE WHEN COALESCE(o.wage_type,'DAILY')='MONTHLY' THEN COALESCE(o.wage_rate,0)
                     ELSE COALESCE(a.days,0) * COALESCE(o.wage_rate,0) END,
                CASE WHEN COALESCE(o.wage_type,'DAILY')='MONTHLY' THEN COALESCE(o.wage_rate,0)
                     ELSE COALESCE(a.days,0) * COALESCE(o.wage_rate,0) END
         FROM operators o
         LEFT JOIN (
           SELECT operator_id, COUNT(DISTINCT work_date) AS days
           FROM operator_attendance
           WHERE work_date BETWEEN $2 AND $3
           GROUP BY operator_id
         ) a ON a.operator_id = o.operator_id::text
         WHERE COALESCE(o.status,'ACTIVE') <> 'INACTIVE'`,
        [runId, period_from, period_to]
      );
      await this._recalcTotal(client, runId);
      await client.query('COMMIT');
      return await this.findRun(runId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // Update one worker's line; gross/net recomputed from the edited fields.
  async updateItem(itemId, b) {
    const cur = (await pool.query(`SELECT * FROM payroll_items WHERE item_id = $1`, [itemId])).rows[0];
    if (!cur) return null;
    const wageType   = b.wage_type   ?? cur.wage_type;
    const wageRate   = b.wage_rate   !== undefined ? Number(b.wage_rate)   : Number(cur.wage_rate);
    const days       = b.days_present !== undefined ? Number(b.days_present) : Number(cur.days_present);
    const overtime   = b.overtime    !== undefined ? Number(b.overtime)    : Number(cur.overtime);
    const bonus      = b.bonus       !== undefined ? Number(b.bonus)       : Number(cur.bonus);
    const deductions = b.deductions  !== undefined ? Number(b.deductions)  : Number(cur.deductions);
    const advance    = b.advance     !== undefined ? Number(b.advance)     : Number(cur.advance);
    const { gross, net } = computePay({ wage_type: wageType, wage_rate: wageRate, days_present: days, overtime, bonus, deductions, advance });
    const r = await pool.query(
      `UPDATE payroll_items
         SET wage_type=$1, wage_rate=$2, days_present=$3, gross_amount=$4,
             overtime=$5, bonus=$6, deductions=$7, advance=$8, net_amount=$9, notes=COALESCE($10, notes)
       WHERE item_id=$11 RETURNING *`,
      [wageType, wageRate, days, gross.toFixed(2), overtime, bonus, deductions, advance, net.toFixed(2), b.notes ?? null, itemId]
    );
    await this._recalcTotal(pool, cur.run_id);
    return r.rows[0];
  },

  async _recalcTotal(exec, runId) {
    await exec.query(
      `UPDATE payroll_runs SET total_net = COALESCE((SELECT SUM(net_amount) FROM payroll_items WHERE run_id=$1),0),
              updated_at = NOW() WHERE run_id=$1`, [runId]
    );
  },

  setStatus(id, status) {
    return pool.query(`UPDATE payroll_runs SET status=$1, updated_at=NOW() WHERE run_id=$2 RETURNING *`, [status, id]);
  },

  async removeRun(id) {
    await pool.query(`DELETE FROM payroll_runs WHERE run_id=$1`, [id]);
    return { ok: true };
  },
});
