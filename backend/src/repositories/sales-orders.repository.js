// Sales Orders repository — data access for sales_orders + sales_order_items.
// A SO is a header (customer, dates, status) with line items (finished goods,
// qty, rate). Insert writes header + items atomically in one transaction.
module.exports = (pool) => {
  const weigh = require('../lib/line-weights')(pool);
  return {
  async list({ status, from, to, limit = 100, offset = 0 } = {}) {
    const params = []; const conds = [];
    if (status) { conds.push(`so.status = $${params.length + 1}`); params.push(status); }
    if (from)   { conds.push(`so.order_date >= $${params.length + 1}`); params.push(from); }
    if (to)     { conds.push(`so.order_date <= $${params.length + 1}`); params.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const q = `
      SELECT so.*,
             COUNT(soi.so_item_id)          AS item_count,
             COALESCE(SUM(soi.quantity), 0) AS total_qty,
             COALESCE(SUM(soi.dispatched_qty), 0) AS total_dispatched_qty
      FROM sales_orders so
      LEFT JOIN sales_order_items soi ON soi.so_id = so.so_id
      ${where}
      GROUP BY so.so_id
      ORDER BY so.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    const r = await pool.query(q, params);
    const tot = await pool.query(
      `SELECT COUNT(*) FROM sales_orders so ${where}`,
      params.slice(0, params.length - 2)
    );
    return { data: r.rows, total: parseInt(tot.rows[0].count, 10) };
  },

  async findById(id) {
    const hd = await pool.query(`SELECT * FROM sales_orders WHERE so_id = $1`, [id]);
    if (!hd.rows.length) return null;
    const items = await pool.query(
      `SELECT * FROM sales_order_items WHERE so_id = $1 ORDER BY so_item_id`, [id]
    );
    return { ...hd.rows[0], items: items.rows };
  },

  findStatus(id) {
    return pool.query(`SELECT status FROM sales_orders WHERE so_id = $1`, [id]);
  },

  async insert(soNumber, b) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const items = Array.isArray(b.items) ? b.items : [];
      const total = items.reduce((s, it) =>
        s + (Number(it.quantity) || 0) * (Number(it.rate) || 0), 0);
      const hd = await client.query(
        `INSERT INTO sales_orders
           (so_number, partner_id, customer_name, order_date, delivery_date,
            status, payment_terms, notes, total_amount, created_by)
         VALUES ($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8,$9) RETURNING *`,
        [soNumber, b.partner_id || null, b.customer_name || null,
         b.order_date || new Date().toISOString().slice(0, 10),
         b.delivery_date || null, b.payment_terms || null, b.notes || null,
         total.toFixed(2), b.created_by || null]
      );
      const soId = hd.rows[0].so_id;

      // Resolve each line to kilograms before writing it. Everything
      // downstream — stock, allocation, dispatch, costing — is in kg, and a
      // line ordered in metres was previously bridged by someone doing the
      // sum in their head. A line that cannot be converted is stored with a
      // null weight and reported rather than blocking the order: refusing an
      // order because a fabric has no GSM recorded pushes it back into a
      // WhatsApp thread, which is worse.
      const weights = await weigh.resolveAll(items);

      for (const [i, it] of items.entries()) {
        const qty = Number(it.quantity) || 0;
        const rate = Number(it.rate) || 0;
        const w = weights.lines[i] || { quantity_kg: null, uom_basis: null };
        await client.query(
          `INSERT INTO sales_order_items
             (so_id, item_id, item_name, description, quantity, uom, rate, amount,
              quantity_kg, uom_basis)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [soId, it.item_id || null, it.item_name || null, it.description || null,
           qty, it.uom || 'KG', rate, (qty * rate).toFixed(2),
           w.quantity_kg, w.uom_basis]
        );
      }
      await client.query('COMMIT');
      const row = await this.findById(soId);
      // Carried on the result rather than logged: an unconvertible line is
      // something the person taking the order needs to see now.
      return { ...row, uom_warnings: weights.warnings, total_kg: weights.total_kg,
               unresolved_lines: weights.unresolved };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async setStatus(id, status) {
    const r = await pool.query(
      `UPDATE sales_orders SET status = $1, updated_at = NOW() WHERE so_id = $2 RETURNING *`,
      [status, id]
    );
    return r.rows[0];
  },

  async updateHeader(id, b) {
    const r = await pool.query(
      `UPDATE sales_orders
         SET customer_name = COALESCE($1, customer_name),
             partner_id    = COALESCE($2, partner_id),
             order_date    = COALESCE($3, order_date),
             delivery_date = COALESCE($4, delivery_date),
             payment_terms = COALESCE($5, payment_terms),
             notes         = COALESCE($6, notes),
             updated_at    = NOW()
       WHERE so_id = $7 RETURNING *`,
      [b.customer_name ?? null, b.partner_id ?? null, b.order_date ?? null,
       b.delivery_date ?? null, b.payment_terms ?? null, b.notes ?? null, id]
    );
    return r.rows[0];
  },

  async remove(id) {
    await pool.query(`DELETE FROM sales_orders WHERE so_id = $1`, [id]);
    return { ok: true };
  },
  };
};
