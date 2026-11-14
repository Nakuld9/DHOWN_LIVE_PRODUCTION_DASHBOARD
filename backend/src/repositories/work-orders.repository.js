// Work-orders repository — data access for maintenance_work_orders.
// Table (created by ensureMaintenanceSchema in server.js): id, machine_id, title,
// description, work_order_type, priority, status, assigned_to, reported_by,
// completed_by, opened_at, started_at, completed_at, downtime_hours, total_cost,
// resolution_notes, created_at, updated_at.
module.exports = (pool) => ({
  findAll({ machine_id, status } = {}) {
    const conds = []; const vals = []; let p = 1;
    if (machine_id) { conds.push(`wo.machine_id = $${p++}`); vals.push(machine_id); }
    if (status)     { conds.push(`wo.status = $${p++}`); vals.push(status); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return pool.query(
      `SELECT wo.*, m.machine_name
       FROM maintenance_work_orders wo
       LEFT JOIN machines m ON wo.machine_id = m.machine_id
       ${where}
       ORDER BY wo.opened_at DESC`,
      vals
    );
  },

  findById(id) {
    return pool.query(
      `SELECT wo.*, m.machine_name
       FROM maintenance_work_orders wo
       LEFT JOIN machines m ON wo.machine_id = m.machine_id
       WHERE wo.id = $1`,
      [id]
    );
  },

  insert(b, reportedBy) {
    return pool.query(
      `INSERT INTO maintenance_work_orders
         (machine_id, title, description, work_order_type, priority, assigned_to, reported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.machine_id, b.title, b.description || null, b.work_order_type || 'BREAKDOWN',
       b.priority || 'MEDIUM', b.assigned_to || null, reportedBy || null]
    );
  },

  update(id, b) {
    return pool.query(
      `UPDATE maintenance_work_orders
       SET title=$1, description=$2, work_order_type=$3, priority=$4, assigned_to=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [b.title, b.description || null, b.work_order_type, b.priority, b.assigned_to || null, id]
    );
  },

  // Lifecycle transition. started_at/completed_at set automatically from the target status.
  setStatus(id, status, extra = {}) {
    return pool.query(
      `UPDATE maintenance_work_orders
       SET status = $1::text,
           started_at   = COALESCE(started_at, CASE WHEN $1::text IN ('IN_PROGRESS','COMPLETED') THEN NOW() ELSE started_at END),
           completed_at = CASE WHEN $1::text IN ('COMPLETED','CANCELLED') THEN NOW() ELSE completed_at END,
           completed_by = COALESCE($2::text, completed_by),
           downtime_hours = COALESCE($3::numeric, downtime_hours),
           total_cost = COALESCE($4::numeric, total_cost),
           resolution_notes = COALESCE($5::text, resolution_notes),
           updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [status, extra.completed_by || null, extra.downtime_hours ?? null,
       extra.total_cost ?? null, extra.resolution_notes || null, id]
    );
  },

  remove(id) {
    return pool.query(`DELETE FROM maintenance_work_orders WHERE id = $1`, [id]);
  },

  listPartsUsed(woId) {
    return pool.query(
      `SELECT pu.*, sp.part_name, sp.sku, sp.unit
       FROM wo_parts_used pu JOIN spare_parts sp ON sp.id = pu.part_id
       WHERE pu.wo_id = $1 ORDER BY pu.created_at ASC`,
      [woId]
    );
  },

  // Consume a spare part against a work order, atomically:
  // lock part → check stock → CONSUMED movement → decrement stock →
  // insert wo_parts_used → add the line cost to the WO's total_cost.
  async addPartUsed(woId, { part_id, quantity, unit_cost, notes }, username) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const wo = await client.query(`SELECT id, status FROM maintenance_work_orders WHERE id=$1 FOR UPDATE`, [woId]);
      if (wo.rowCount === 0) { await client.query('ROLLBACK'); return { notFound: true }; }
      if (['COMPLETED', 'CANCELLED'].includes(wo.rows[0].status)) {
        await client.query('ROLLBACK'); return { badRequest: 'Work order is already closed' };
      }
      const part = await client.query(`SELECT * FROM spare_parts WHERE id=$1 FOR UPDATE`, [part_id]);
      if (part.rowCount === 0) { await client.query('ROLLBACK'); return { badRequest: 'Spare part not found' }; }
      const stock = parseFloat(part.rows[0].current_stock);
      const qty = parseFloat(quantity);
      if (qty > stock) { await client.query('ROLLBACK'); return { badRequest: `Only ${stock} ${part.rows[0].unit} in stock` }; }

      await client.query(
        `INSERT INTO spare_part_movements (part_id, movement_type, quantity, reference, notes, created_by)
         VALUES ($1,'CONSUMED',$2,$3,$4,$5)`,
        [part_id, qty, `WO-${woId}`, notes || null, username || null]
      );
      await client.query(`UPDATE spare_parts SET current_stock = current_stock - $1, updated_at = NOW() WHERE id = $2`, [qty, part_id]);
      const pu = await client.query(
        `INSERT INTO wo_parts_used (wo_id, part_id, quantity, unit_cost, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [woId, part_id, qty, parseFloat(unit_cost) || 0, notes || null]
      );
      await client.query(
        `UPDATE maintenance_work_orders SET total_cost = COALESCE(total_cost,0) + $1, updated_at=NOW() WHERE id=$2`,
        [pu.rows[0].total_cost || 0, woId]
      );
      await client.query('COMMIT');
      return { row: { ...pu.rows[0], part_name: part.rows[0].part_name, unit: part.rows[0].unit } };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
});
