// Import ↔ GRN integration. The existing GRN + yarn_lots + stock_ledger remain
// the authoritative record of what was received and what entered inventory. This
// module only LINKS a GRN to an import and READS the received quantity back — it
// never creates a GRN, never writes stock, never duplicates inventory.
//
// Received qty for an import = sum of net_weight_kg across the yarn_lots of its
// linked, APPROVED GRNs. GRN status for the import: PENDING (none received) /
// PARTIAL (some) / COMPLETED (>= ordered).

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = (pool) => {
  const audit = async (username, action, newVal) => {
    try { await pool.query(`INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,$2,'IMPORTS',$3)`,
      [username || null, action, newVal ? JSON.stringify(newVal).slice(0, 4000) : null]); } catch {}
  };

  // Received quantity for an import, straight from the linked GRNs' yarn lots.
  async function receivedQty(importId) {
    const r = await pool.query(
      `SELECT COALESCE(SUM(yl.net_weight_kg),0)::numeric AS kg
         FROM import_grn_links k
         JOIN grn g ON g.grn_id = k.grn_id
         JOIN yarn_lots yl ON yl.grn_id = g.grn_id
        WHERE k.import_id = $1 AND UPPER(COALESCE(g.status,'')) = 'APPROVED'`, [importId]);
    return r2(r.rows[0].kg);
  }

  async function linkedGrns(importId) {
    const r = await pool.query(
      `SELECT k.grn_id, k.shipment_id, g.grn_number, g.status, g.receipt_date, g.supplier_invoice,
              COALESCE((SELECT SUM(yl.net_weight_kg) FROM yarn_lots yl WHERE yl.grn_id=g.grn_id),0)::numeric AS received_kg,
              k.linked_by, k.created_at
         FROM import_grn_links k JOIN grn g ON g.grn_id = k.grn_id
        WHERE k.import_id = $1 ORDER BY g.receipt_date NULLS LAST, k.grn_id`, [importId]);
    return r.rows.map(x => ({ ...x, received_kg: r2(x.received_kg) }));
  }

  // GRNs from the import's supplier not yet linked to it — the pick list.
  async function availableGrns(importId) {
    const imp = (await pool.query(`SELECT supplier_id FROM imports WHERE import_id=$1 AND deleted_at IS NULL`, [importId])).rows[0];
    if (!imp) return [];
    const r = await pool.query(
      `SELECT g.grn_id, g.grn_number, g.status, g.receipt_date, g.supplier_invoice, g.supplier_name,
              COALESCE((SELECT SUM(yl.net_weight_kg) FROM yarn_lots yl WHERE yl.grn_id=g.grn_id),0)::numeric AS received_kg
         FROM grn g
        WHERE (g.partner_id = $1 OR $1 IS NULL)
          AND COALESCE(g.status,'') <> 'CANCELLED'
          AND NOT EXISTS (SELECT 1 FROM import_grn_links k WHERE k.grn_id = g.grn_id AND k.import_id = $2)
        ORDER BY g.receipt_date DESC NULLS LAST LIMIT 50`, [imp.supplier_id, importId]);
    return r.rows.map(x => ({ ...x, received_kg: r2(x.received_kg) }));
  }

  async function status(importId, orderedQty) {
    const rec = await receivedQty(importId);
    const ordered = Number(orderedQty) || 0;
    let grn_status = 'PENDING';
    if (rec > 0 && (ordered === 0 || rec < ordered - 0.01)) grn_status = 'PARTIAL';
    else if (rec > 0 && ordered > 0 && rec >= ordered - 0.01) grn_status = 'COMPLETED';
    return { received: rec, grn_status };
  }

  async function link(importId, body, user) {
    const imp = (await pool.query(`SELECT import_id, import_no, quantity, status FROM imports WHERE import_id=$1 AND deleted_at IS NULL`, [importId])).rows[0];
    if (!imp) return { error: 'Import not found', code: 404 };
    if (!body?.grn_id) return { error: 'grn_id is required', code: 400 };
    const g = (await pool.query(`SELECT grn_id, grn_number FROM grn WHERE grn_id=$1`, [body.grn_id])).rows[0];
    if (!g) return { error: 'GRN not found', code: 404 };
    try {
      await pool.query(
        `INSERT INTO import_grn_links (import_id, shipment_id, grn_id, linked_by) VALUES ($1,$2,$3,$4)`,
        [importId, body.shipment_id || null, body.grn_id, user?.username || null]);
    } catch (e) {
      if (/import_grn_links_import_id_grn_id_key|duplicate key/.test(e.message)) return { error: `GRN ${g.grn_number} is already linked to this import`, code: 409 };
      return { error: e.message, code: 500 };
    }
    await audit(user?.username, 'LINK_IMPORT_GRN', { import_no: imp.import_no, grn_number: g.grn_number });
    // Auto-advance status when fully received (never backward, only forward to a
    // received state; recorded in status history via the imports service if desired).
    const st = await status(importId, imp.quantity);
    let finalized = null;
    if (st.grn_status === 'COMPLETED' && !['GRN_COMPLETED', 'CLOSED'].includes(imp.status)) {
      await pool.query(`UPDATE imports SET status='GRN_COMPLETED', updated_at=NOW() WHERE import_id=$1`, [importId]);
      await pool.query(`INSERT INTO import_status_history (import_id, from_status, to_status, changed_by, remarks)
                        VALUES ($1,$2,'GRN_COMPLETED',$3,'Auto: GRN fully received')`, [importId, imp.status, user?.username || null]);
      // Finalise the landed cost on the actual received quantity (best-effort).
      try { finalized = await require('./import-costing')(pool).finalizeOnGrn(importId, user); } catch { /* costing finalise is non-blocking */ }
    }
    return { ok: true, ...st, costing_finalized: finalized };
  }

  async function unlink(importId, grnId, user) {
    const r = await pool.query(`DELETE FROM import_grn_links WHERE import_id=$1 AND grn_id=$2 RETURNING id`, [importId, grnId]);
    if (!r.rows.length) return { error: 'Link not found', code: 404 };
    await audit(user?.username, 'UNLINK_IMPORT_GRN', { import_id: importId, grn_id: grnId });
    return { ok: true };
  }

  return { receivedQty, linkedGrns, availableGrns, status, link, unlink };
};
