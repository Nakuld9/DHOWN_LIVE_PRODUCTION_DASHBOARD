// Production Plans repository — data access for production_plans (single table).
// A plan = a fabric target (qty) on an optional machine over a date window,
// optionally linked to a sales order, with a produced-vs-target progress.
module.exports = (pool) => ({
  list({ status, machine_id, plan_type, from, to, limit = 200, offset = 0 } = {}) {
    const params = []; const conds = [];
    if (status)     { conds.push(`status = $${params.length + 1}`); params.push(status); }
    if (machine_id) { conds.push(`machine_id = $${params.length + 1}`); params.push(machine_id); }
    if (plan_type)  { conds.push(`plan_type = $${params.length + 1}`); params.push(plan_type); }
    if (from)       { conds.push(`planned_start >= $${params.length + 1}`); params.push(from); }
    if (to)         { conds.push(`planned_end <= $${params.length + 1}`); params.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);
    return pool.query(
      `SELECT * FROM production_plans ${where}
       ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
                planned_start NULLS LAST, created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
  },

  findById(id)   { return pool.query(`SELECT * FROM production_plans WHERE plan_id = $1`, [id]); },
  findStatus(id) { return pool.query(`SELECT status FROM production_plans WHERE plan_id = $1`, [id]); },

  insert(planNumber, b) {
    // A plan linked to a sales order is make-to-order; otherwise make-to-stock.
    const planType = b.plan_type === 'MTO' || b.so_id ? 'MTO' : 'MTS';
    return pool.query(
      `INSERT INTO production_plans
         (plan_number, item_id, item_name, target_qty_kg, machine_id, so_id, so_number,
          priority, planned_start, planned_end, notes, created_by, plan_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [planNumber, b.item_id || null, b.item_name || null, Number(b.target_qty_kg) || 0,
       b.machine_id || null, b.so_id || null, b.so_number || null,
       b.priority || 'MEDIUM', b.planned_start || null, b.planned_end || null,
       b.notes || null, b.created_by || null, planType]
    );
  },

  update(id, b) {
    return pool.query(
      `UPDATE production_plans
         SET item_name     = COALESCE($1, item_name),
             item_id       = COALESCE($2, item_id),
             target_qty_kg = COALESCE($3, target_qty_kg),
             machine_id    = COALESCE($4, machine_id),
             priority      = COALESCE($5, priority),
             planned_start = COALESCE($6, planned_start),
             planned_end   = COALESCE($7, planned_end),
             so_id         = COALESCE($8, so_id),
             so_number     = COALESCE($9, so_number),
             notes         = COALESCE($10, notes),
             plan_type     = COALESCE($11, plan_type),
             updated_at    = NOW()
       WHERE plan_id = $12 RETURNING *`,
      [b.item_name ?? null, b.item_id ?? null,
       (b.target_qty_kg !== undefined ? Number(b.target_qty_kg) : null),
       b.machine_id ?? null, b.priority ?? null, b.planned_start ?? null,
       b.planned_end ?? null, b.so_id ?? null, b.so_number ?? null, b.notes ?? null,
       b.plan_type ?? null, id]
    );
  },

  setStatus(id, status) {
    return pool.query(
      `UPDATE production_plans SET status = $1, updated_at = NOW() WHERE plan_id = $2 RETURNING *`,
      [status, id]
    );
  },

  setProgress(id, producedKg) {
    return pool.query(
      `UPDATE production_plans SET produced_qty_kg = $1, updated_at = NOW() WHERE plan_id = $2 RETURNING *`,
      [Number(producedKg) || 0, id]
    );
  },

  async remove(id) {
    await pool.query(`DELETE FROM production_plans WHERE plan_id = $1`, [id]);
    return { ok: true };
  },
});
