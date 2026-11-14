// Dispatch repository — data access for dispatch_challans + dispatch_items.
// SQL migrated verbatim from the inline /api/dispatch handlers in server.js,
// including the FOR UPDATE stock guards added 2026-07-10.
// postToLedger is injected from server.js (shared stock-ledger writer).
module.exports = (pool, { postToLedger }) => ({
  list({ from, to, dispatch_type } = {}) {
    const conds = []; const params = [];
    if (from)          { conds.push(`d.dispatch_date >= $${params.length + 1}`); params.push(from); }
    if (to)            { conds.push(`d.dispatch_date <= $${params.length + 1}`); params.push(to); }
    if (dispatch_type) { conds.push(`d.dispatch_type = $${params.length + 1}`); params.push(dispatch_type); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return pool.query(`
      SELECT d.*,
        COUNT(di.item_id) AS item_count,
        ROUND(COALESCE(SUM(di.weight_kg),0)::NUMERIC,3) AS total_kg
      FROM dispatch_challans d
      LEFT JOIN dispatch_items di ON di.dispatch_id=d.dispatch_id
      ${where}
      GROUP BY d.dispatch_id
      ORDER BY d.created_at DESC
    `, params);
  },

  async findById(id) {
    const disp = await pool.query(`SELECT * FROM dispatch_challans WHERE dispatch_id=$1`, [id]);
    if (!disp.rows.length) return null;
    const dc = disp.rows[0];

    let items;
    if (dc.dispatch_type === 'GREIGE') {
      items = await pool.query(`
        SELECT di.*, r.actual_weight_kg AS stock_kg, r.fabric_type AS roll_fabric, r.shift, m.machine_name
        FROM dispatch_items di
        LEFT JOIN rolls r ON r.roll_id = di.roll_id
        LEFT JOIN machines m ON m.machine_id = r.machine_id
        WHERE di.dispatch_id=$1
      `, [id]);
    } else if (dc.dispatch_type === 'YARN') {
      items = await pool.query(`
        SELECT di.*, yl.yarn_type AS yl_yarn_type, yl.color AS yl_color, yl.supplier_lot_no, yl.count
        FROM dispatch_items di
        LEFT JOIN yarn_lots yl ON yl.lot_id = di.lot_id
        WHERE di.dispatch_id=$1
      `, [id]);
    } else {
      items = await pool.query(`
        SELECT di.*, fg.fabric_type AS fg_fabric, fg.color_name AS fg_color, fg.weight_kg AS stock_kg,
               fg.roll_id AS fg_roll_id, fg.lot_no AS fg_lot_no, b.batch_number
        FROM dispatch_items di
        LEFT JOIN finished_goods fg ON fg.fg_id = di.fg_id
        LEFT JOIN batches b ON fg.batch_id = b.batch_id
        WHERE di.dispatch_id=$1
      `, [id]);
    }
    return { ...dc, items: items.rows };
  },

  // Whole challan-creation transaction. `priced[i]` is the pricing line for items[i]
  // (computed in the service). Returns { row } on success or { badRequest } on a
  // stock conflict (transaction rolled back).
  async createDispatch({ dispatch_number, customer_name, customer_contact, vehicle_number, dispatch_date,
                         notes, dispatch_type, items, priced, total_kg, hasPricing, totTaxable, totGst, username,
                         qc_override_reason, consignee_gstin, ship_to_address, place_of_supply, jobwork_expected_return }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const isJobwork = dispatch_type === 'JOBWORK';
      const d = await client.query(
        `INSERT INTO dispatch_challans
           (dispatch_number, customer_name, customer_contact, vehicle_number, dispatch_date, total_weight_kg, notes, dispatch_type, created_by,
            total_taxable_value, total_gst, grand_total, consignee_gstin, ship_to_address, place_of_supply,
            jobwork_return_status, jobwork_expected_return)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [dispatch_number, customer_name, customer_contact || null, vehicle_number || null, dispatch_date,
         total_kg.toFixed(3), notes || null, dispatch_type, username,
         hasPricing ? totTaxable.toFixed(2) : null,
         hasPricing ? totGst.toFixed(2) : null,
         hasPricing ? (totTaxable + totGst).toFixed(2) : null,
         consignee_gstin || null, ship_to_address || null, place_of_supply || null,
         isJobwork ? 'PENDING' : null, isJobwork ? (jobwork_expected_return || null) : null]
      );
      const dispatch_id = d.rows[0].dispatch_id;

      const PRICE_COLS = `, rate_per_kg, gst_rate, taxable_value, gst_amount, line_total, hsn_code`;
      if (dispatch_type === 'JOBWORK') {
        // Job-work OUT: a Rule-55 movement document. Free-text lines (material sent
        // for processing); value is the declared value, no sale, no stock coupling.
        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx]; const p = priced[idx];
          await client.query(
            `INSERT INTO dispatch_items (dispatch_id, item_type, weight_kg, fabric_type, item_description${PRICE_COLS})
             VALUES ($1,'JOBWORK',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [dispatch_id, parseFloat(item.weight_kg || 0), item.fabric_type || item.material || null, item.item_description || item.description || 'Material for job work',
             p.rate, p.gst, p.taxable, p.gstAmt, p.total, item.hsn_code || null]
          );
        }
      } else if (dispatch_type === 'FG') {
        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx]; const p = priced[idx];
          // FOR UPDATE + status check: two concurrent dispatches can't ship the same FG lot
          const fg = await client.query(`SELECT * FROM finished_goods WHERE fg_id=$1 FOR UPDATE`, [item.fg_id]);
          if (!fg.rows.length) continue;
          const f = fg.rows[0];
          if (f.status !== 'IN_STOCK') {
            await client.query('ROLLBACK');
            return { badRequest: `FG-${item.fg_id} (${f.fabric_type || ''}) is no longer in stock — already ${f.status}` };
          }
          await client.query(
            `INSERT INTO dispatch_items (dispatch_id, fg_id, item_type, weight_kg, fabric_type, color_name, item_description${PRICE_COLS})
             VALUES ($1,$2,'FG',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [dispatch_id, item.fg_id, item.weight_kg, f.fabric_type, f.color_name, item.item_description || null,
             p.rate, p.gst, p.taxable, p.gstAmt, p.total, item.hsn_code || null]
          );
          await client.query(`UPDATE finished_goods SET status='DISPATCHED', updated_at=NOW() WHERE fg_id=$1`, [item.fg_id]);
        }
      } else if (dispatch_type === 'GREIGE') {
        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx]; const p = priced[idx];
          // FOR UPDATE OF r + status check: two concurrent dispatches can't ship the same roll
          const roll = await client.query(`SELECT r.*, m.machine_name FROM rolls r LEFT JOIN machines m ON r.machine_id=m.machine_id WHERE r.roll_id=$1 FOR UPDATE OF r`, [item.roll_id]);
          if (!roll.rows.length) continue;
          const r = roll.rows[0];
          if (r.warehouse_status === 'DISPATCHED') {
            await client.query('ROLLBACK');
            return { badRequest: `Roll ${item.roll_id} has already been dispatched` };
          }

          // Quality gate. Grade was recorded per roll and quarantine blocked
          // allocation, but nothing stopped a roll that FAILED inspection from
          // being dispatched if nobody had quarantined it — QC and dispatch were
          // linked by convention rather than by a check.
          //
          // Refusing outright would strand legitimate dispatches (a customer who
          // has accepted a B-grade lot at a discount is normal here), so this is
          // a block with an explicit, reasoned override that lands in the audit
          // log. What it removes is the silent case.
          const qc = await client.query(
            `SELECT passed, grade, defect_type, defect_severity, inspection_date
               FROM quality_inspections
              WHERE roll_id = $1
              ORDER BY inspection_date DESC NULLS LAST, inspection_id DESC
              LIMIT 1`, [item.roll_id]);

          if (qc.rows.length && qc.rows[0].passed === false) {
            const q = qc.rows[0];
            const why = [q.grade && `grade ${q.grade}`, q.defect_type, q.defect_severity]
              .filter(Boolean).join(', ');
            if (!qc_override_reason) {
              await client.query('ROLLBACK');
              return {
                badRequest: `Roll ${item.roll_id} failed inspection${why ? ` (${why})` : ''}. ` +
                  `Dispatch it only with a written reason — send qc_override_reason.`,
              };
            }
            await client.query(
              `INSERT INTO audit_logs (username, action, module, new_value)
               VALUES ($1, $2, 'DISPATCH', $3)`,
              [username || 'unknown',
               `QC OVERRIDE dispatching failed roll ${item.roll_id}`,
               JSON.stringify({ roll_id: item.roll_id, dispatch_id, reason: qc_override_reason, inspection: q })])
              .catch(() => { /* the override must not fail for want of a log row */ });
          }
          await client.query(
            `INSERT INTO dispatch_items (dispatch_id, roll_id, item_type, weight_kg, fabric_type, color_name, item_description${PRICE_COLS})
             VALUES ($1,$2,'GREIGE',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [dispatch_id, item.roll_id, item.weight_kg || r.actual_weight_kg, r.fabric_type, r.color || null, `Roll #${item.roll_id} · ${r.machine_name || ''}`,
             p.rate, p.gst, p.taxable, p.gstAmt, p.total, item.hsn_code || null]
          );
          await client.query(`UPDATE rolls SET warehouse_status='DISPATCHED', updated_at=NOW() WHERE roll_id=$1`, [item.roll_id]);
        }
      } else if (dispatch_type === 'YARN') {
        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx]; const p = priced[idx];
          // FOR UPDATE + stock check: concurrent dispatches can't oversell the same lot
          const lot = await client.query(`SELECT * FROM yarn_lots WHERE lot_id=$1 FOR UPDATE`, [item.lot_id]);
          if (!lot.rows.length) continue;
          const l = lot.rows[0];
          const wantKg = parseFloat(item.weight_kg || l.current_stock_kg);
          if (wantKg > parseFloat(l.current_stock_kg)) {
            await client.query('ROLLBACK');
            return { badRequest: `Lot ${l.lot_number}: only ${l.current_stock_kg} kg in stock (requested ${wantKg})` };
          }
          await client.query(
            `INSERT INTO dispatch_items (dispatch_id, lot_id, item_type, weight_kg, lot_number, yarn_type, color, item_description${PRICE_COLS})
             VALUES ($1,$2,'YARN',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [dispatch_id, item.lot_id, item.weight_kg || l.current_stock_kg, l.lot_number, l.yarn_type, l.color || null, `${l.lot_number} · ${l.yarn_type}`,
             p.rate, p.gst, p.taxable, p.gstAmt, p.total, item.hsn_code || null]
          );
          const dispKg = parseFloat(item.weight_kg || l.current_stock_kg);
          const beforeKg = parseFloat(l.current_stock_kg);
          await client.query(
            `UPDATE yarn_lots SET current_stock_kg = current_stock_kg - $1, status = CASE WHEN current_stock_kg - $1 <= 0 THEN 'DISPATCHED' ELSE status END, updated_at=NOW() WHERE lot_id=$2`,
            [dispKg, item.lot_id]
          );
          await client.query(
            `INSERT INTO yarn_lot_movements (lot_id, movement_type, quantity_kg, before_kg, after_kg, reference_type, reference_id, notes)
             VALUES ($1,'DISPATCH',$2,$3,$4,'DISPATCH',$5,$6)`,
            [item.lot_id, dispKg, beforeKg, beforeKg - dispKg, dispatch_id, `Dispatch ${dispatch_number} → ${customer_name}`]
          );
        }
      }
      await client.query('COMMIT');
      return { row: d.rows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  insertAudit(username, detail) {
    return pool.query(`INSERT INTO audit_logs (username,action,module,new_value) VALUES ($1,'CREATE_DISPATCH','WAREHOUSE',$2)`,
      [username, detail]);
  },

  // Post-commit cost snapshot per FG lot dispatched (verbatim; caller wraps in try/catch)
  async costSnapshot(items, dispatch_date) {
    for (const item of items) {
      const fgRow = await pool.query(`SELECT fg.*, b.batch_number FROM finished_goods fg LEFT JOIN batches b ON b.batch_id=fg.batch_id WHERE fg.fg_id=$1`, [item.fg_id]);
      if (!fgRow.rows.length) continue;
      const f = fgRow.rows[0];
      if (!f.batch_id) continue;
      const costRes = await pool.query(`SELECT COALESCE(SUM(amount_rs),0) AS total FROM cost_entries WHERE (reference_type='BATCH' AND reference_id=$1) OR (reference_type='ROLL' AND reference_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)) OR (reference_type='CHALLAN' AND reference_id IN (SELECT challan_id::text FROM subcontract_challans WHERE batch_id=$1))`, [f.batch_id]);
      const total_cost_rs = parseFloat(costRes.rows[0].total);
      const weight = parseFloat(item.weight_kg || f.weight_kg || 0);
      const cost_per_kg = weight > 0 ? (total_cost_rs / weight) : 0;
      await pool.query(`INSERT INTO cost_snapshots (snapshot_date, fabric_type, color_name, total_cost_rs, total_kg, cost_per_kg) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (snapshot_date,fabric_type,color_name) DO UPDATE SET total_cost_rs=cost_snapshots.total_cost_rs+$4, total_kg=cost_snapshots.total_kg+$5, cost_per_kg=ROUND((cost_snapshots.total_cost_rs+$4)/NULLIF(cost_snapshots.total_kg+$5,0),2)`,
        [dispatch_date, f.fabric_type, f.color_name, total_cost_rs.toFixed(2), weight.toFixed(3), cost_per_kg.toFixed(2)]);
    }
  },

  // Post-commit stock_ledger FG OUT (verbatim; caller wraps in try/catch)
  async ledgerOut({ dispatch_number, customer_name, total_kg, username }) {
    const fgWh = await pool.query(`SELECT warehouse_id FROM warehouses WHERE code='FG-STORE' LIMIT 1`);
    const slClient = await pool.connect();
    try {
      await postToLedger(slClient, {
        doc_type: 'DISPATCH', doc_id: dispatch_number,
        item_desc: `Dispatch to ${customer_name}`,
        warehouse_id: fgWh.rows[0]?.warehouse_id || null,
        movement_type: 'OUT',
        quantity: parseFloat(total_kg.toFixed(3)),
        uom_code: 'KG',
        notes: `Customer: ${customer_name}`,
        created_by: username || 'system',
      });
    } finally { slClient.release(); }
  },

  // Delete challan + restore stock for its items (verbatim)
  async removeDispatch(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const dc = await client.query('SELECT * FROM dispatch_challans WHERE dispatch_id=$1', [id]);
      if (!dc.rows.length) { await client.query('ROLLBACK'); return { notFound: true }; }
      // Restore stock for dispatched items
      const items = await client.query('SELECT * FROM dispatch_items WHERE dispatch_id=$1', [id]);
      for (const item of items.rows) {
        if (item.roll_id) await client.query("UPDATE rolls SET warehouse_status='GREIGE', updated_at=NOW() WHERE roll_id=$1", [item.roll_id]);
        if (item.fg_id) await client.query("UPDATE finished_goods SET status='IN_STOCK', updated_at=NOW() WHERE fg_id=$1", [item.fg_id]);
        if (item.lot_id) {
          await client.query('UPDATE yarn_lots SET current_stock_kg = current_stock_kg + COALESCE($1,0), updated_at=NOW() WHERE lot_id=$2', [item.quantity_kg, item.lot_id]);
        }
      }
      await client.query('DELETE FROM dispatch_items WHERE dispatch_id=$1', [id]);
      await client.query('DELETE FROM dispatch_challans WHERE dispatch_id=$1', [id]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // Record the job-work material coming back (RECEIVED / PARTIAL).
  async recordJobworkReturn(id, { status, returned_date, notes }) {
    const dc = await pool.query(`SELECT dispatch_id, dispatch_type FROM dispatch_challans WHERE dispatch_id=$1`, [id]);
    if (!dc.rows.length) return { notFound: true };
    if (dc.rows[0].dispatch_type !== 'JOBWORK') return { badRequest: 'Not a job-work challan.' };
    const st = ['PENDING', 'PARTIAL', 'RECEIVED'].includes(status) ? status : 'RECEIVED';
    const r = await pool.query(
      `UPDATE dispatch_challans SET jobwork_return_status=$2, jobwork_returned_date=$3, jobwork_return_notes=$4, updated_at=NOW()
       WHERE dispatch_id=$1 RETURNING *`, [id, st, returned_date || (st === 'RECEIVED' ? new Date().toISOString().slice(0, 10) : null), notes || null]);
    return { row: r.rows[0] };
  },
});
