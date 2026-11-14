// GRN repository — data access for grn + yarn_lots (+ movements, cost entries, ledger).
// SQL migrated verbatim from the inline /api/grn handlers in server.js.
// addCostEntry / postToLedger are injected shared writers from server.js.
module.exports = (pool, { addCostEntry, postToLedger }) => ({
  async list({ status, limit = 50, offset = 0, from, to } = {}) {
    let q = `SELECT g.*, COUNT(yl.lot_id) AS lot_count,
               SUM(yl.net_weight_kg) AS total_kg
             FROM grn g LEFT JOIN yarn_lots yl ON yl.grn_id = g.grn_id`;
    const params = []; const conds = [];
    if (status) { conds.push(`g.status = $${params.length + 1}`); params.push(status); }
    if (from)   { conds.push(`g.receipt_date >= $${params.length + 1}`); params.push(from); }
    if (to)     { conds.push(`g.receipt_date <= $${params.length + 1}`); params.push(to); }
    if (conds.length) q += ` WHERE ${conds.join(' AND ')}`;
    q += ` GROUP BY g.grn_id ORDER BY g.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    const r = await pool.query(q, params);
    const countConds = conds.map(c => c.replace(/g\./g, ''));
    const tot = await pool.query(`SELECT COUNT(*) FROM grn${countConds.length ? ' WHERE ' + countConds.join(' AND ') : ''}`, params.slice(0, params.length - 2));
    return { data: r.rows, total: parseInt(tot.rows[0].count) };
  },

  insert(grn_number, b) {
    return pool.query(
      `INSERT INTO grn (grn_number, supplier_name, supplier_invoice, receipt_date, vehicle_number, received_by, notes, warehouse_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [grn_number, b.supplier_name, b.supplier_invoice || null, b.receipt_date, b.vehicle_number || null, b.received_by || null, b.notes || null, b.warehouse_id || null]
    );
  },

  async findById(id) {
    const g = await pool.query(`SELECT * FROM grn WHERE grn_id = $1`, [id]);
    if (!g.rows.length) return null;
    const lots = await pool.query(`
      SELECT yl.*,
        COALESCE(h.hsn_code, '') AS hsn_code,
        COALESCE(i.item_name, yl.yarn_type) AS item_name
      FROM yarn_lots yl
      LEFT JOIN items i ON UPPER(i.item_code) = UPPER(yl.yarn_type) OR UPPER(i.item_name) = UPPER(yl.yarn_type)
      LEFT JOIN hsn_codes h ON h.hsn_id = i.hsn_id
      WHERE yl.grn_id = $1 ORDER BY yl.lot_id
    `, [id]);
    return { ...g.rows[0], lots: lots.rows };
  },

  findStatus(id) {
    return pool.query(`SELECT status FROM grn WHERE grn_id=$1`, [id]);
  },

  // Add a yarn lot to a GRN: lot row + GRN_RECEIPT movement + optional YARN_COST entry
  async addLot(grnId, lot_number, b) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { yarn_type, count, color, supplier_lot_no, net_weight_kg, cones, rate_per_kg, brand, location } = b;
      const r = await client.query(
        `INSERT INTO yarn_lots (lot_number, grn_id, yarn_type, count, color, supplier_lot_no, net_weight_kg, current_stock_kg, cones, rate_per_kg, brand, location)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11) RETURNING *`,
        [lot_number, grnId, yarn_type, count || null, color || 'Grey', supplier_lot_no || null, net_weight_kg, cones || 0, rate_per_kg || null, brand || null, location || null]
      );
      await client.query(
        `INSERT INTO yarn_lot_movements (lot_id, movement_type, quantity_kg, before_kg, after_kg, notes, reference_type, reference_id)
         VALUES ($1, 'GRN_RECEIPT', $2, 0, $2, 'Initial receipt', 'GRN', $3)`,
        [r.rows[0].lot_id, net_weight_kg, grnId]
      );
      if (rate_per_kg && parseFloat(rate_per_kg) > 0) {
        await addCostEntry(client, {
          reference_type: 'LOT', reference_id: r.rows[0].lot_id,
          cost_component: 'YARN_COST',
          amount_rs: (parseFloat(net_weight_kg) * parseFloat(rate_per_kg)).toFixed(2),
          quantity_kg: parseFloat(net_weight_kg), rate_used: parseFloat(rate_per_kg),
          notes: `Yarn purchase: ${yarn_type || ''} ${color || ''} — GRN #${grnId}`.trim(),
        });
      }
      await client.query('COMMIT');
      return { row: r.rows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // Remove a lot from a DRAFT GRN (cost entries + movements + lot)
  async removeLot(grnId, lotId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM cost_entries WHERE reference_type='LOT' AND reference_id=$1`, [lotId]);
      await client.query(`DELETE FROM yarn_lot_movements WHERE lot_id=$1`, [lotId]);
      await client.query(`DELETE FROM yarn_lots WHERE lot_id=$1 AND grn_id=$2`, [lotId, grnId]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // Approve: status → APPROVED + one stock_ledger IN line per lot
  async approve(id, username) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(`UPDATE grn SET status='APPROVED', updated_at=NOW() WHERE grn_id=$1 RETURNING *`, [id]);
      const grn = r.rows[0];

      // Post yarn lots to stock_ledger (one line per lot)
      const lots = await client.query(
        `SELECT yl.*, g.warehouse_id, g.partner_id FROM yarn_lots yl
         JOIN grn g ON g.grn_id=yl.grn_id WHERE yl.grn_id=$1`, [id]
      );
      for (const lot of lots.rows) {
        await postToLedger(client, {
          doc_type: 'GRN', doc_id: grn.grn_number || id,
          item_id: lot.item_id || null,
          item_desc: `${lot.yarn_type || ''} ${lot.color || ''}`.trim() || lot.lot_number,
          warehouse_id: lot.warehouse_id || null,
          movement_type: 'IN',
          quantity: parseFloat(lot.net_weight_kg || 0),
          uom_code: 'KG',
          partner_id: lot.partner_id || null,
          notes: `GRN lot ${lot.lot_number}`,
          created_by: username || 'system',
        });
      }

      await client.query('COMMIT');
      return { row: grn };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // Delete DRAFT GRN — removes lots, movements, cost entries
  async removeGrn(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const g = await client.query(`SELECT * FROM grn WHERE grn_id=$1`, [id]);
      if (!g.rows.length) { await client.query('ROLLBACK'); return { notFound: true }; }
      if (g.rows[0].status !== 'DRAFT') { await client.query('ROLLBACK'); return { badRequest: 'Only DRAFT GRNs can be deleted' }; }
      const lots = await client.query(`SELECT lot_id FROM yarn_lots WHERE grn_id=$1`, [id]);
      const lotIds = lots.rows.map(r => r.lot_id);
      if (lotIds.length) {
        await client.query(`DELETE FROM yarn_lot_movements WHERE lot_id = ANY($1)`, [lotIds]);
        await client.query(`DELETE FROM cost_entries WHERE reference_type='LOT' AND reference_id = ANY($1)`, [lotIds]);
        await client.query(`DELETE FROM yarn_lots WHERE grn_id=$1`, [id]);
      }
      await client.query(`DELETE FROM grn WHERE grn_id=$1`, [id]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // Cancel APPROVED GRN — zeros lot stock with CANCEL movements (blocked if yarn issued)
  async cancelGrn(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const g = await client.query(`SELECT * FROM grn WHERE grn_id=$1`, [id]);
      if (!g.rows.length) { await client.query('ROLLBACK'); return { notFound: true }; }
      if (g.rows[0].status !== 'APPROVED') { await client.query('ROLLBACK'); return { badRequest: 'Only APPROVED GRNs can be cancelled' }; }
      // Check no yarn has been issued from these lots
      const issued = await client.query(`
        SELECT SUM(ii.issued_kg - ii.returned_kg) AS net_issued
        FROM yarn_issue_items ii
        JOIN yarn_lots yl ON yl.lot_id = ii.lot_id
        WHERE yl.grn_id = $1
      `, [id]);
      if (parseFloat(issued.rows[0]?.net_issued || 0) > 0) {
        await client.query('ROLLBACK');
        return { badRequest: 'Cannot cancel — yarn from this GRN has been issued' };
      }
      const lots = await client.query(`SELECT lot_id, current_stock_kg FROM yarn_lots WHERE grn_id=$1`, [id]);
      for (const lot of lots.rows) {
        const before = parseFloat(lot.current_stock_kg);
        await client.query(`UPDATE yarn_lots SET current_stock_kg=0, status='CANCELLED', updated_at=NOW() WHERE lot_id=$1`, [lot.lot_id]);
        await client.query(
          `INSERT INTO yarn_lot_movements (lot_id, movement_type, quantity_kg, before_kg, after_kg, reference_type, reference_id, notes)
           VALUES ($1,'CANCEL',$2,$3,0,'GRN',$4,'GRN cancelled')`,
          [lot.lot_id, before, before, id]
        );
      }
      await client.query(`UPDATE grn SET status='CANCELLED', updated_at=NOW() WHERE grn_id=$1`, [id]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  updateHeader(id, b) {
    return pool.query(
      `UPDATE grn SET supplier_name=$1, supplier_invoice=$2, receipt_date=$3, vehicle_number=$4, received_by=$5, notes=$6, warehouse_id=$7, updated_at=NOW()
       WHERE grn_id=$8 RETURNING *`,
      [b.supplier_name, b.supplier_invoice || null, b.receipt_date, b.vehicle_number || null, b.received_by || null, b.notes || null, b.warehouse_id || null, id]
    );
  },
});
