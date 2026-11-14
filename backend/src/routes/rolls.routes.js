// Rolls routes — production roll lifecycle: create, close, approve (with QR + cost/ledger),
// cancel, edit, delete (layered extraction, 2026-07-10). Mounted at /api/rolls.
// 9 handlers migrated VERBATIM. Injected shared server.js objects/helpers:
// pool, verifyToken, requireRole, io, generateQR, rollQRContent, addCostEntry, postToLedger.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole, io, generateQR, rollQRContent, addCostEntry, postToLedger, getShiftSettings, detectCurrentShift }) => {
  const router = express.Router();

  // Every route below requires a valid session. Applied at router level so a
  // route added later is guarded by default; individual routes add requireRole
  // on top where a specific role is needed.
  router.use(verifyToken);


router.put('/approve/:rollId', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {

  // Roll approval and ALL its side-effects (greige stock-ledger IN, knitting &
  // needle cost entries, production record, audit log) commit as ONE transaction,
  // so a failure in any step rolls the whole thing back instead of leaving an
  // APPROVED roll with no ledger or cost footprint. Socket notifications fire only
  // after the commit succeeds. (Fixes audit P1-1: previously each side-effect ran
  // on its own connection with a swallowed error, so the API could report success
  // while the ledger/costing silently drifted.)
  const { rollId } = req.params;
  const { actual_weight_kg, supervisor_name } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE rolls
          SET actual_weight_kg = $1, supervisor_name = $2, approved_at = NOW(), status = 'APPROVED'
        WHERE roll_id = $3
      RETURNING *`,
      [actual_weight_kg, supervisor_name, rollId]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Roll not found' });
    }
    const roll = result.rows[0];
    const weightKg = parseFloat(roll.actual_weight_kg || 0);

    await client.query(
      `INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1, 'APPROVE_ROLL', 'ROLLS', $2)`,
      [req.user.username, `roll_id=${rollId} weight=${actual_weight_kg}kg`]
    );

    // QR generation is a pure computation (no DB); a failure must not abort the
    // approval, so it degrades to no label rather than rolling back.
    let qr = null;
    try { qr = await generateQR(rollQRContent(rollId)); }
    catch (qrErr) { console.error('QR gen error (roll still approved):', qrErr.message); }

    // Move to greige store + greige stock-ledger IN.
    await client.query(`UPDATE rolls SET qr_image=$1, warehouse_status='GREIGE' WHERE roll_id=$2`, [qr, rollId]);
    const greigeWh = await client.query(`SELECT warehouse_id FROM warehouses WHERE code='GREIGE-STORE' LIMIT 1`);
    await postToLedger(client, {
      doc_type: 'ROLL', doc_id: rollId,
      item_desc: `${roll.fabric_type || ''} Roll ${rollId}`.trim(),
      warehouse_id: greigeWh.rows[0]?.warehouse_id || null,
      movement_type: 'IN',
      quantity: weightKg,
      uom_code: 'KG',
      notes: `Roll approved by ${supervisor_name || req.user?.username}`,
      created_by: req.user?.username || 'system',
    });

    // KNITTING_COST from the item master's knitting_rate_per_kg.
    if (weightKg > 0 && roll.fabric_item_id) {
      const item = (await client.query(
        `SELECT knitting_rate_per_kg, item_name FROM items WHERE item_id=$1`, [roll.fabric_item_id])).rows[0];
      const kRate = parseFloat(item?.knitting_rate_per_kg || 0);
      if (kRate > 0) {
        await addCostEntry(client, {
          reference_type: 'ROLL', reference_id: rollId, cost_component: 'KNITTING_COST',
          amount_rs: (weightKg * kRate).toFixed(2), quantity_kg: weightKg, rate_used: kRate,
          fabric_type: roll.fabric_type, notes: `In-house knitting: ${item.item_name} @ ₹${kRate}/kg`,
        });
      }
    }

    // NEEDLE_COST from this machine's most recently COMPLETED needle-life cycle.
    if (weightKg > 0 && roll.machine_id) {
      const nRate = parseFloat((await client.query(
        `SELECT cost_per_kg FROM needle_life_cycle
          WHERE machine_id=$1 AND ended_on IS NOT NULL AND cost_per_kg IS NOT NULL
          ORDER BY ended_on DESC LIMIT 1`, [roll.machine_id])).rows[0]?.cost_per_kg || 0);
      if (nRate > 0) {
        await addCostEntry(client, {
          reference_type: 'ROLL', reference_id: rollId, cost_component: 'NEEDLE_COST',
          amount_rs: (weightKg * nRate).toFixed(2), quantity_kg: weightKg, rate_used: nRate,
          fabric_type: roll.fabric_type, notes: `Needle cost @ ₹${nRate}/kg (${roll.machine_id})`,
        });
      }
    }

    // production_records so the dashboard reflects this manual production.
    if (weightKg > 0 && roll.machine_id) {
      const shift = roll.shift || detectCurrentShift(await getShiftSettings());
      const today = new Date().toISOString().slice(0, 10);
      await client.query(`
        INSERT INTO production_records (machine_id, record_date, shift, production_kg, sample_count)
        VALUES ($1, $2, $3, $4, 1)
        ON CONFLICT (machine_id, record_date, shift) DO UPDATE SET
          production_kg = production_records.production_kg + $4,
          sample_count  = production_records.sample_count + 1,
          updated_at    = NOW()`,
        [roll.machine_id, today, shift, weightKg]);
    }

    await client.query('COMMIT');

    // Notify only after the transaction is durably committed.
    io.emit('inventory:greige_update', { action: 'roll_approved', roll_id: rollId });
    io.emit('inventory:dashboard_update', { type: 'roll_approved' });

    res.json(roll);

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Roll approval failed (rolled back):', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }

});

router.delete('/:rollId', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT status FROM rolls WHERE roll_id=$1`, [req.params.rollId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Roll not found' });
    if (r.rows[0].status !== 'OPEN') return res.status(400).json({ error: 'Only OPEN rolls can be deleted' });
    await pool.query(`DELETE FROM rolls WHERE roll_id=$1`, [req.params.rollId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:rollId/cancel', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT status, warehouse_status FROM rolls WHERE roll_id=$1`, [req.params.rollId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Roll not found' });
    if (r.rows[0].status === 'CANCELLED') return res.status(400).json({ error: 'Already cancelled' });
    if (r.rows[0].warehouse_status === 'SENT_OUT' || r.rows[0].warehouse_status === 'DISPATCHED') {
      return res.status(400).json({ error: 'Cannot cancel — roll is in subcontracting or dispatched' });
    }
    await pool.query(`UPDATE rolls SET status='CANCELLED', warehouse_status='CANCELLED' WHERE roll_id=$1`, [req.params.rollId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const { machine_id, fabric_type, shift, start_counter, operator_id, roll_id } = req.body;
    if (!machine_id) return res.status(400).json({ error: "machine_id is required" });
    if (!shift) return res.status(400).json({ error: "shift is required (A or B)" });

    // Auto-generate roll_id using prefix + fabric_code from machine master
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
    const [prefixRow, machineRow, seqRow] = await Promise.all([
      pool.query(`SELECT value FROM app_settings WHERE key='roll_prefix'`),
      pool.query(`SELECT fabric_code, fabric, gauge FROM machines WHERE machine_id=$1`, [machine_id]),
      pool.query(`SELECT COUNT(*) AS cnt FROM rolls WHERE machine_id=$1 AND DATE(created_at)=CURRENT_DATE`, [machine_id])
    ]);

    // Auto-resolve fabric_item_id from machine's fabric_code → items.item_code
    const fabricCode = machineRow.rows[0]?.fabric_code || null;
    let fabric_item_id = null;
    if (fabricCode) {
      const itemRow = await pool.query(`SELECT item_id FROM items WHERE item_code=$1 LIMIT 1`, [fabricCode]);
      if (itemRow.rows.length) fabric_item_id = itemRow.rows[0].item_id;
    }
    const prefix = (prefixRow.rows[0]?.value || 'DHM-').replace(/[-\s]+$/, '');
    const resolvedFabricType = fabric_type || machineRow.rows[0]?.fabric || null;
    const gaugeVal = machineRow.rows[0]?.gauge ? `G${machineRow.rows[0].gauge}` : null;
    const seq = String(parseInt(seqRow.rows[0].cnt) + 1).padStart(3, '0');
    const fabricPart = fabricCode ? `-${fabricCode}` : '';
    const gaugePart = gaugeVal ? `-${gaugeVal}` : '';
    const shiftLabel = shift === 'D' ? 'D' : shift === 'N' ? 'N' : shift;
    const generatedId = roll_id || `${prefix}-${machine_id}${fabricPart}${gaugePart}-${datePart}-${shiftLabel}-${seq}`;

    // Check for existing open roll on this machine
    const existing = await pool.query(
      `SELECT roll_id FROM rolls WHERE machine_id = $1 AND status = 'OPEN' LIMIT 1`,
      [machine_id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `Machine ${machine_id} already has an open roll: ${existing.rows[0].roll_id}` });
    }

    const result = await pool.query(
      `INSERT INTO rolls (roll_id, machine_id, fabric_type, shift, start_counter, current_counter, status, created_at, operator_id, fabric_item_id)
       VALUES ($1, $2, $3, $4, $5, $5, 'OPEN', NOW(), $6, $7)
       RETURNING *`,
      [generatedId, machine_id, resolvedFabricType, shift, start_counter || 0, operator_id || null, fabric_item_id || null]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:rollId/close', verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const { rollId } = req.params;
    const { actual_weight_kg, current_counter } = req.body;

    const result = await pool.query(
      `UPDATE rolls
       SET status = 'CLOSED',
           actual_weight_kg = $1,
           current_counter = COALESCE($2, current_counter),
           closed_at = NOW()
       WHERE roll_id = $3
       RETURNING *`,
      [actual_weight_kg || null, current_counter || null, rollId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Roll not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { status, machine_id } = req.query;
    const page  = req.query.page ? (parseInt(req.query.page) || 1) : null;
    const limit = Math.min(parseInt(req.query.limit || '50') || 50, 200);
    const conds = []; const vals = []; let p = 1;
    if (status)     { conds.push(`r.status = $${p++}`);     vals.push(status); }
    if (machine_id) { conds.push(`r.machine_id = $${p++}`); vals.push(machine_id); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const baseQuery = `
      SELECT r.*, m.machine_name, m.machine_type,
             COALESCE(ld.session_production_kg, 0) AS live_kg
      FROM rolls r
      LEFT JOIN machines m ON r.machine_id = m.machine_id
      LEFT JOIN machine_live_data ld ON r.machine_id = ld.machine_id
      ${where}
      ORDER BY r.created_at DESC`;
    if (!page) {
      const r = await pool.query(baseQuery, vals);
      return res.json(r.rows);
    }
    const offset = (page - 1) * limit;
    const countVals = [...vals];
    const [rows, cnt] = await Promise.all([
      pool.query(`${baseQuery} LIMIT $${p} OFFSET $${p + 1}`, [...vals, limit, offset]),
      pool.query(`SELECT COUNT(*) FROM rolls r ${where}`, countVals),
    ]);
    const total = parseInt(cnt.rows[0].count);
    res.json({ data: rows.rows, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.get('/:rollId', verifyToken, async (req, res) => {
  try {
    const { rollId } = req.params;
    const r = await pool.query(`
      SELECT r.*, m.machine_name, m.machine_type,
             b.batch_number, b.status AS batch_status,
             yl.lot_number AS yarn_lot_number, yl.yarn_type,
             qi.grade AS inspection_grade, qi.inspection_date
      FROM rolls r
      LEFT JOIN machines m ON r.machine_id = m.machine_id
      LEFT JOIN batch_rolls br ON br.roll_id = r.roll_id
      LEFT JOIN batches b ON b.batch_id = br.batch_id
      LEFT JOIN yarn_lots yl ON yl.lot_id = r.lot_id
      LEFT JOIN quality_inspections qi ON qi.inspection_id = r.latest_inspection_id
      WHERE r.roll_id = $1
    `, [rollId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Roll not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:rollId', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT status, warehouse_status FROM rolls WHERE roll_id=$1`, [req.params.rollId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Roll not found' });
    if (['SENT_OUT','DISPATCHED'].includes(r.rows[0].warehouse_status))
      return res.status(400).json({ error: 'Cannot edit — roll is in subcontracting or dispatched' });
    if (r.rows[0].status === 'CANCELLED')
      return res.status(400).json({ error: 'Cannot edit a cancelled roll' });
    const { fabric_type, shift, operator_id, actual_weight_kg } = req.body;
    const result = await pool.query(
      `UPDATE rolls SET fabric_type=COALESCE($1,fabric_type), shift=COALESCE($2,shift),
       operator_id=COALESCE($3,operator_id), actual_weight_kg=COALESCE($4,actual_weight_kg)
       WHERE roll_id=$5 RETURNING *`,
      [fabric_type||null, shift||null, operator_id||null, actual_weight_kg||null, req.params.rollId]
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:rollId/permanent', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT status FROM rolls WHERE roll_id=$1`, [req.params.rollId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Roll not found' });
    if (r.rows[0].status !== 'CANCELLED') return res.status(400).json({ error: 'Only CANCELLED rolls can be permanently deleted' });
    await pool.query(`DELETE FROM rolls WHERE roll_id=$1`, [req.params.rollId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

  return router;
};
