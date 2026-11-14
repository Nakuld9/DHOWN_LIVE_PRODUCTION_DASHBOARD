// Purchase Orders repository — data access for purchase_orders + purchase_order_items.
// A PO is a header (supplier, dates, status) with line items (yarn/other items,
// qty, rate). Insert writes header + items atomically in one transaction.
module.exports = (pool) => ({
  async list({ status, from, to, limit = 100, offset = 0 } = {}) {
    const params = []; const conds = [];
    if (status) { conds.push(`po.status = $${params.length + 1}`); params.push(status); }
    if (from)   { conds.push(`po.order_date >= $${params.length + 1}`); params.push(from); }
    if (to)     { conds.push(`po.order_date <= $${params.length + 1}`); params.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const q = `
      SELECT po.*,
             COUNT(poi.po_item_id)          AS item_count,
             COALESCE(SUM(poi.quantity), 0) AS total_qty,
             COALESCE(SUM(poi.received_qty), 0) AS total_received_qty
      FROM purchase_orders po
      LEFT JOIN purchase_order_items poi ON poi.po_id = po.po_id
      ${where}
      GROUP BY po.po_id
      ORDER BY po.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    const r = await pool.query(q, params);
    const tot = await pool.query(
      `SELECT COUNT(*) FROM purchase_orders po ${where}`,
      params.slice(0, params.length - 2)
    );
    return { data: r.rows, total: parseInt(tot.rows[0].count, 10) };
  },

  async findById(id) {
    const h = await pool.query(`SELECT * FROM purchase_orders WHERE po_id = $1`, [id]);
    if (!h.rows.length) return null;
    const items = await pool.query(
      `SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY po_item_id`, [id]
    );
    return { ...h.rows[0], items: items.rows };
  },

  findStatus(id) {
    return pool.query(`SELECT status FROM purchase_orders WHERE po_id = $1`, [id]);
  },

  // Create PO header + line items atomically. Returns the full PO (with items).
  async insert(poNumber, b) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const items = Array.isArray(b.items) ? b.items : [];
      const total = items.reduce((s, it) =>
        s + (Number(it.quantity) || 0) * (Number(it.rate) || 0), 0);
      const h = await client.query(
        `INSERT INTO purchase_orders
           (po_number, partner_id, supplier_name, order_date, expected_date,
            status, payment_terms, notes, total_amount, created_by, supplier_mobile)
         VALUES ($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8,$9,$10) RETURNING *`,
        [poNumber, b.partner_id || null, b.supplier_name || null,
         b.order_date || new Date().toISOString().slice(0, 10),
         b.expected_date || null, b.payment_terms || null, b.notes || null,
         total.toFixed(2), b.created_by || null, b.supplier_mobile || null]
      );
      const poId = h.rows[0].po_id;
      for (const it of items) {
        const qty = Number(it.quantity) || 0;
        const rate = Number(it.rate) || 0;
        await client.query(
          `INSERT INTO purchase_order_items
             (po_id, item_id, item_name, description, quantity, uom, rate, amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [poId, it.item_id || null, it.item_name || null, it.description || null,
           qty, it.uom || 'KG', rate, (qty * rate).toFixed(2)]
        );
      }
      await client.query('COMMIT');
      return await this.findById(poId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async setStatus(id, status) {
    const r = await pool.query(
      `UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE po_id = $2 RETURNING *`,
      [status, id]
    );
    return r.rows[0];
  },

  async updateHeader(id, b) {
    const r = await pool.query(
      `UPDATE purchase_orders
         SET supplier_name = COALESCE($1, supplier_name),
             partner_id    = COALESCE($2, partner_id),
             order_date    = COALESCE($3, order_date),
             expected_date = COALESCE($4, expected_date),
             payment_terms = COALESCE($5, payment_terms),
             notes         = COALESCE($6, notes),
             updated_at    = NOW()
       WHERE po_id = $7 RETURNING *`,
      [b.supplier_name ?? null, b.partner_id ?? null, b.order_date ?? null,
       b.expected_date ?? null, b.payment_terms ?? null, b.notes ?? null, id]
    );
    return r.rows[0];
  },

  async remove(id) {
    await pool.query(`DELETE FROM purchase_orders WHERE po_id = $1`, [id]);
    return { ok: true };
  },
});
