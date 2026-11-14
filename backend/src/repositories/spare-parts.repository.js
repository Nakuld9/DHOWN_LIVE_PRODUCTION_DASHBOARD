// Spare-parts repository — data access for spare_parts + spare_part_movements.
// Tables created by ensureMaintenanceSchema in server.js.
//   spare_parts: id, part_name, sku, category, unit, min_stock, current_stock, location, notes
//   spare_part_movements: id, part_id, movement_type(RECEIVED|CONSUMED|ADJUSTMENT|RETURNED),
//                         quantity, reference, notes, created_by, created_at
module.exports = (pool) => ({
  findAll({ category, low } = {}) {
    // Trashed parts never appear, whatever else is being filtered.
    const conds = ['deleted_at IS NULL']; const vals = []; let p = 1;
    if (category) { conds.push(`category = $${p++}`); vals.push(category); }
    if (low)      { conds.push(`current_stock <= min_stock`); }
    const where = `WHERE ${conds.join(' AND ')}`;
    return pool.query(
      `SELECT *, (current_stock <= min_stock) AS is_low
       FROM spare_parts ${where}
       ORDER BY part_name ASC`,
      vals
    );
  },

  findById(id) {
    return pool.query(
      `SELECT *, (current_stock <= min_stock) AS is_low FROM spare_parts WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
  },

  insert(b) {
    return pool.query(
      `INSERT INTO spare_parts (part_name, sku, category, unit, min_stock, current_stock, location, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [b.part_name, b.sku || null, b.category || 'GENERAL', b.unit || 'pcs',
       b.min_stock ?? 0, b.current_stock ?? 0, b.location || null, b.notes || null]
    );
  },

  update(id, b) {
    return pool.query(
      `UPDATE spare_parts
       SET part_name=$1, sku=$2, category=$3, unit=$4, min_stock=$5, location=$6, notes=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [b.part_name, b.sku || null, b.category || 'GENERAL', b.unit || 'pcs',
       b.min_stock ?? 0, b.location || null, b.notes || null, id]
    );
  },

  remove(id) {
    return pool.query(
      `UPDATE spare_parts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  },

  listMovements(partId) {
    return pool.query(
      `SELECT * FROM spare_part_movements WHERE part_id = $1 ORDER BY created_at DESC`,
      [partId]
    );
  },

  // All purchases (RECEIVED) across parts — the purchase navigator (GRN-style).
  listPurchases() {
    return pool.query(
      `SELECT mv.id, mv.part_id, sp.part_name, sp.sku, sp.unit, sp.category,
              mv.quantity, mv.unit_cost, mv.total_cost, mv.supplier, mv.reference,
              mv.created_at, mv.created_by
         FROM spare_part_movements mv
         JOIN spare_parts sp ON sp.id = mv.part_id
        WHERE mv.movement_type = 'RECEIVED'
        ORDER BY mv.created_at DESC
        LIMIT 500`
    );
  },

  // Recompute a part's last buy price + weighted-average cost from its RECEIVED
  // history. Called after a purchase is edited or deleted so cost never drifts.
  async _recost(client, partId) {
    await client.query(
      `UPDATE spare_parts sp SET
         last_unit_cost = (SELECT unit_cost FROM spare_part_movements
                            WHERE part_id = $1 AND movement_type = 'RECEIVED' AND unit_cost IS NOT NULL
                            ORDER BY created_at DESC LIMIT 1),
         avg_cost = (SELECT CASE WHEN SUM(quantity) > 0
                            THEN ROUND(SUM(quantity * unit_cost) / SUM(quantity), 2) END
                       FROM spare_part_movements
                      WHERE part_id = $1 AND movement_type = 'RECEIVED' AND unit_cost IS NOT NULL),
         updated_at = NOW()
       WHERE sp.id = $1`, [partId]);
  },

  // Receive one line into stock inside an open transaction: RECEIVED movement
  // (tagged with grn_id + cost + supplier) + stock bump + re-cost the part.
  async _receiveLine(client, { partId, quantity, unit_cost, gst_rate, supplier, grnId, reference, created_by }) {
    const qty = Math.max(0, parseFloat(quantity) || 0);
    if (!partId || qty <= 0) return 0;
    const cost = unit_cost == null || unit_cost === '' ? null : Math.max(0, parseFloat(unit_cost));
    const gst = gst_rate == null || gst_rate === '' ? 18 : Math.max(0, parseFloat(gst_rate));
    const cur = (await client.query(`SELECT current_stock FROM spare_parts WHERE id = $1 FOR UPDATE`, [partId])).rows[0];
    if (!cur) return 0;
    await client.query(
      `INSERT INTO spare_part_movements (part_id, movement_type, quantity, unit_cost, gst_rate, supplier, grn_id, reference, created_by)
       VALUES ($1,'RECEIVED',$2,$3,$4,$5,$6,$7,$8)`,
      [partId, qty, cost, gst, supplier || null, grnId, reference || null, created_by || null]);
    await client.query(`UPDATE spare_parts SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2`, [qty, partId]);
    await this._recost(client, partId);
    return qty * (cost || 0);
  },

  // Create a goods-receipt document with multiple part lines.
  async createGrn({ grn_date, supplier, reference, notes, created_by, lines }) {
    const valid = (lines || []).filter((l) => l && l.part_id && parseFloat(l.quantity) > 0);
    if (!valid.length) return { badRequest: 'Add at least one line with a part and quantity' };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hdr = (await client.query(
        `INSERT INTO spare_grn (grn_date, supplier, reference, notes, created_by)
         VALUES (COALESCE($1, CURRENT_DATE), $2, $3, $4, $5) RETURNING *`,
        [grn_date || null, supplier || null, reference || null, notes || null, created_by || null])).rows[0];
      const grnNo = 'SGRN-' + String(hdr.id).padStart(5, '0');
      await client.query(`UPDATE spare_grn SET grn_no = $1 WHERE id = $2`, [grnNo, hdr.id]);
      for (const l of valid) {
        await this._receiveLine(client, {
          partId: l.part_id, quantity: l.quantity, unit_cost: l.unit_cost, gst_rate: l.gst_rate,
          supplier, grnId: hdr.id, reference, created_by,
        });
      }
      await client.query('COMMIT');
      return { row: { ...hdr, grn_no: grnNo } };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  },

  // List receipt documents with line count + total value.
  listGrn() {
    return pool.query(
      `SELECT g.*,
              COUNT(mv.id)::int                                              AS line_count,
              COALESCE(SUM(mv.total_cost),0)                                 AS subtotal,
              COALESCE(SUM(mv.total_cost * COALESCE(mv.gst_rate,0)/100),0)   AS gst_amount,
              COALESCE(SUM(mv.total_cost * (1 + COALESCE(mv.gst_rate,0)/100)),0) AS total_amount
         FROM spare_grn g
         LEFT JOIN spare_part_movements mv ON mv.grn_id = g.id
        GROUP BY g.id
        ORDER BY g.grn_date DESC, g.id DESC
        LIMIT 500`);
  },

  async getGrn(id) {
    const hdr = (await pool.query(`SELECT * FROM spare_grn WHERE id = $1`, [id])).rows[0];
    if (!hdr) return null;
    const lines = (await pool.query(
      `SELECT mv.id, mv.part_id, sp.part_name, sp.sku, sp.unit,
              mv.quantity, mv.unit_cost, mv.gst_rate, mv.total_cost
         FROM spare_part_movements mv
         JOIN spare_parts sp ON sp.id = mv.part_id
        WHERE mv.grn_id = $1 ORDER BY mv.id`, [id])).rows;
    return { ...hdr, lines };
  },

  updateGrnHeader(id, { grn_date, supplier, reference, notes }) {
    return pool.query(
      `UPDATE spare_grn SET grn_date = COALESCE($2, grn_date), supplier = $3,
              reference = $4, notes = $5, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, grn_date || null, supplier || null, reference || null, notes || null]);
  },

  // Add a line to an existing receipt.
  async addGrnLine(id, { part_id, quantity, unit_cost, gst_rate }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const g = (await client.query(`SELECT supplier, reference, created_by FROM spare_grn WHERE id = $1`, [id])).rows[0];
      if (!g) { await client.query('ROLLBACK'); return { notFound: true }; }
      await this._receiveLine(client, { partId: part_id, quantity, unit_cost, gst_rate, supplier: g.supplier, grnId: id, reference: g.reference, created_by: g.created_by });
      await client.query('COMMIT');
      return { ok: true };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  },

  // Delete a whole receipt: reverse every line's stock, then remove.
  async deleteGrn(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lines = (await client.query(`SELECT id, part_id, quantity FROM spare_part_movements WHERE grn_id = $1 FOR UPDATE`, [id])).rows;
      for (const l of lines) {
        const part = (await client.query(`SELECT current_stock FROM spare_parts WHERE id = $1 FOR UPDATE`, [l.part_id])).rows[0];
        if (parseFloat(part.current_stock) - parseFloat(l.quantity) < 0) { await client.query('ROLLBACK'); return { badRequest: 'Cannot delete: some of this stock has already been issued.' }; }
      }
      for (const l of lines) {
        await client.query(`UPDATE spare_parts SET current_stock = current_stock - $1, updated_at = NOW() WHERE id = $2`, [l.quantity, l.part_id]);
        await client.query(`DELETE FROM spare_part_movements WHERE id = $1`, [l.id]);
        await this._recost(client, l.part_id);
      }
      await client.query(`DELETE FROM spare_grn WHERE id = $1`, [id]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  },

  // Edit a purchase. Adjusts stock by the quantity delta and re-costs the part.
  async updatePurchase(movId, { quantity, unit_cost, gst_rate, supplier, reference, created_at }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const mv = (await client.query(`SELECT * FROM spare_part_movements WHERE id = $1 FOR UPDATE`, [movId])).rows[0];
      if (!mv) { await client.query('ROLLBACK'); return { notFound: true }; }
      if (mv.movement_type !== 'RECEIVED') { await client.query('ROLLBACK'); return { badRequest: 'Only purchases (received stock) can be edited here' }; }
      const newQty = quantity == null || quantity === '' ? parseFloat(mv.quantity) : Math.max(0, parseFloat(quantity));
      const delta = newQty - parseFloat(mv.quantity);
      const part = (await client.query(`SELECT current_stock FROM spare_parts WHERE id = $1 FOR UPDATE`, [mv.part_id])).rows[0];
      const newStock = parseFloat(part.current_stock) + delta;
      if (newStock < 0) { await client.query('ROLLBACK'); return { badRequest: 'That change would drive stock negative (stock already issued).' }; }
      const cost = unit_cost == null || unit_cost === '' ? null : Math.max(0, parseFloat(unit_cost));
      const gst = gst_rate == null || gst_rate === '' ? undefined : Math.max(0, parseFloat(gst_rate));
      await client.query(
        `UPDATE spare_part_movements
            SET quantity = $2, unit_cost = $3, supplier = $4, reference = $5,
                created_at = COALESCE($6, created_at),
                gst_rate = COALESCE($7, gst_rate)
          WHERE id = $1`,
        [movId, newQty, cost, supplier || null, reference || null, created_at || null, gst == null ? null : gst]);
      await client.query(`UPDATE spare_parts SET current_stock = $1, updated_at = NOW() WHERE id = $2`, [newStock, mv.part_id]);
      await this._recost(client, mv.part_id);
      await client.query('COMMIT');
      return { ok: true };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  },

  // Delete a purchase. Reverses its stock and re-costs the part.
  async deletePurchase(movId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const mv = (await client.query(`SELECT * FROM spare_part_movements WHERE id = $1 FOR UPDATE`, [movId])).rows[0];
      if (!mv) { await client.query('ROLLBACK'); return { notFound: true }; }
      if (mv.movement_type !== 'RECEIVED') { await client.query('ROLLBACK'); return { badRequest: 'Only purchases can be deleted here' }; }
      const part = (await client.query(`SELECT current_stock FROM spare_parts WHERE id = $1 FOR UPDATE`, [mv.part_id])).rows[0];
      const newStock = parseFloat(part.current_stock) - parseFloat(mv.quantity);
      if (newStock < 0) { await client.query('ROLLBACK'); return { badRequest: 'Cannot delete: that stock has already been issued.' }; }
      await client.query(`DELETE FROM spare_part_movements WHERE id = $1`, [movId]);
      await client.query(`UPDATE spare_parts SET current_stock = $1, updated_at = NOW() WHERE id = $2`, [newStock, mv.part_id]);
      await this._recost(client, mv.part_id);
      await client.query('COMMIT');
      return { ok: true };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  },

  // Record a movement and adjust current_stock atomically. Returns the updated part row.
  // RECEIVED/RETURNED add qty; CONSUMED subtracts; ADJUSTMENT sets stock to an absolute value.
  async recordMovement(partId, { movement_type, quantity, reference, notes, created_by, unit_cost, supplier, machine_id }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query(`SELECT current_stock, avg_cost FROM spare_parts WHERE id = $1 FOR UPDATE`, [partId]);
      if (cur.rowCount === 0) { await client.query('ROLLBACK'); return { notFound: true }; }
      const stock = parseFloat(cur.rows[0].current_stock);
      const prevAvg = cur.rows[0].avg_cost == null ? null : parseFloat(cur.rows[0].avg_cost);
      const qty = parseFloat(quantity);
      const cost = unit_cost == null || unit_cost === '' ? null : Math.max(0, parseFloat(unit_cost));
      let newStock;
      if (movement_type === 'RECEIVED' || movement_type === 'RETURNED') newStock = stock + qty;
      else if (movement_type === 'CONSUMED') newStock = stock - qty;
      else /* ADJUSTMENT */ newStock = qty; // absolute set-to value
      if (newStock < 0) { await client.query('ROLLBACK'); return { badRequest: 'Insufficient stock' }; }

      await client.query(
        `INSERT INTO spare_part_movements (part_id, movement_type, quantity, reference, notes, created_by, unit_cost, supplier, machine_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [partId, movement_type, qty, reference || null, notes || null, created_by || null,
         cost, supplier || null, machine_id || null]
      );

      // On a purchase with a price, update last buy price and the moving-average cost.
      let setCost = '';
      const params = [newStock, partId];
      if (movement_type === 'RECEIVED' && cost != null) {
        const newAvg = stock > 0 && prevAvg != null
          ? ((stock * prevAvg) + (qty * cost)) / (stock + qty)
          : cost;
        params.push(cost, Number(newAvg.toFixed(2)));
        setCost = `, last_unit_cost = $${params.length - 1}, avg_cost = $${params.length}`;
      }
      const upd = await client.query(
        `UPDATE spare_parts SET current_stock = $1, updated_at = NOW()${setCost} WHERE id = $2
         RETURNING *, (current_stock <= min_stock) AS is_low`,
        params
      );
      await client.query('COMMIT');
      return { row: upd.rows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
});
