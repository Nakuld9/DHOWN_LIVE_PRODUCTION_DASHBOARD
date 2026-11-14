// Subcontract routes — challans, multi-fabric receive, knitting jobwork, vendor
// invoices, forward, cancel (layered extraction). Mounted at /api/subcontract.
// 17 handlers migrated VERBATIM from server.js (2026-07-10) — this module contains
// the most complex transactional logic in the app (dyeing/finishing receive flow,
// new finished-roll generation with QR labels, wastage costing), so handlers are
// kept whole to guarantee behaviour; split into service/repository in a later pass
// only if a handler needs to change.
// Injected shared server.js helpers: nextSeq, addCostEntry, postToLedger,
// generateQR, rollQRContent, getYarnRate.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole, nextSeq, addCostEntry, postToLedger, generateQR, rollQRContent, getYarnRate }) => {
  const router = express.Router();

router.get('/challans', async (req, res) => {
  try {
    const { status, from, to } = req.query;
    const conds = []; const vals = []; let p = 1;
    if (status) { conds.push(`c.status = $${p++}`); vals.push(status); }
    if (from)   { conds.push(`c.sent_date >= $${p++}`); vals.push(from); }
    if (to)     { conds.push(`c.sent_date <= $${p++}`); vals.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(`
      SELECT c.*, b.batch_number, b.fabric_type, b.color_name,
        CASE WHEN c.expected_return_date < CURRENT_DATE AND c.status = 'SENT'
             THEN true ELSE false END AS is_overdue
      FROM subcontract_challans c
      LEFT JOIN batches b ON c.batch_id = b.batch_id
      ${where}
      ORDER BY c.created_at DESC
    `, vals);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/challans', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { batch_id, vendor_name, vendor_contact, job_type, sent_date, expected_return_date, rate_per_kg, notes, items } = req.body;
    if (!vendor_name || !job_type || !sent_date)
      return res.status(400).json({ error: 'vendor_name, job_type, sent_date are required' });

    // New style: items = [{batch_id, fabric_type, color, roll_count, weight_kg}]
    // Old style: single batch_id (kept for compatibility)
    const rows = Array.isArray(items) && items.length
      ? items.filter(it => it.batch_id && it.fabric_type)
      : (batch_id ? [{ batch_id }] : []);
    if (!rows.length) return res.status(400).json({ error: 'Select at least one lot / fabric line' });

    const batchIds = [...new Set(rows.map(it => parseInt(it.batch_id)))];
    for (const bid of batchIds) {
      const b = await client.query(`SELECT * FROM batches WHERE batch_id=$1`, [bid]);
      if (!b.rows.length) return res.status(404).json({ error: `Lot ${bid} not found` });
      if (!['OPEN','SEALED','DYED'].includes(b.rows[0].status))
        return res.status(400).json({ error: `Lot ${b.rows[0].batch_number} already sent or closed` });
      if (b.rows[0].status === 'DYED' && job_type !== 'FINISHING')
        return res.status(400).json({ error: 'Dyed lots can only be sent for FINISHING' });
    }
    const batch = await client.query(`SELECT * FROM batches WHERE batch_id=$1`, [batchIds[0]]);

    // Per-line stats: DYED lots use dyeing-received weights; greige lots use roll weights
    const lineStats = [];
    for (const it of rows) {
      const bRow = await client.query(`SELECT status FROM batches WHERE batch_id=$1`, [it.batch_id]);
      let st;
      if (bRow.rows[0]?.status === 'DYED') {
        st = await client.query(`
          SELECT COALESCE(SUM(ri.roll_count),0) AS roll_count,
                 ROUND(SUM(ri.weight_kg)::NUMERIC,3) AS total_kg
          FROM subcontract_receipt_items ri
          JOIN subcontract_receipts sr ON sr.receipt_id=ri.receipt_id
          JOIN subcontract_challans sc ON sc.challan_id=sr.challan_id
          WHERE sc.batch_id=$1 AND sc.job_type='DYEING' ${it.fabric_type ? 'AND ri.fabric_type = $2' : ''}
        `, it.fabric_type ? [it.batch_id, it.fabric_type] : [it.batch_id]);
      }
      if (!st || !parseFloat(st.rows[0]?.total_kg)) {
        st = await client.query(`
          SELECT COUNT(*) AS roll_count,
                 ROUND(SUM(COALESCE(r.actual_weight_kg, r.weight_kg, 0))::NUMERIC,3) AS total_kg
          FROM batch_rolls br JOIN rolls r ON br.roll_id=r.roll_id
          WHERE br.batch_id=$1 ${it.fabric_type ? 'AND COALESCE(r.fabric_type, \'Unknown\') = $2' : ''}
        `, it.fabric_type ? [it.batch_id, it.fabric_type] : [it.batch_id]);
      }
      lineStats.push({
        ...it,
        roll_count: parseInt(st.rows[0].roll_count) || 0,
        weight_kg: parseFloat(st.rows[0].total_kg) || 0,
      });
    }
    const roll_count = lineStats.reduce((s, l) => s + l.roll_count, 0);
    const total_kg   = lineStats.reduce((s, l) => s + l.weight_kg, 0).toFixed(3);
    const colorJoin  = [...new Set(lineStats.map(l => l.color).filter(Boolean))].join(', ') || null;

    const challan_number = await nextSeq('SC', 'subcontract_challans', 'challan_number');

    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO subcontract_challans
         (challan_number, batch_id, vendor_name, vendor_contact, job_type, sent_date,
          expected_return_date, sent_weight_kg, roll_count, rate_per_kg, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [challan_number, batchIds[0], vendor_name, vendor_contact||null, job_type, sent_date,
       expected_return_date||null, total_kg, roll_count, rate_per_kg||null, notes||null, req.user.username]
    );
    const challanId = r.rows[0].challan_id;
    for (const l of lineStats) {
      await client.query(
        `INSERT INTO subcontract_challan_items (challan_id, batch_id, fabric_type, color, roll_count, weight_kg)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [challanId, l.batch_id, l.fabric_type || null, l.color || null, l.roll_count, l.weight_kg]
      );
    }
    if (colorJoin) await client.query(`UPDATE subcontract_challans SET color_name=$1 WHERE challan_id=$2`, [colorJoin, challanId]);
    // Update all involved lots + their rolls
    for (const bid of batchIds) {
      await client.query(`UPDATE batches SET status='SENT', updated_at=NOW() WHERE batch_id=$1`, [bid]);
      await client.query(`
        UPDATE rolls SET warehouse_status='SENT_OUT'
        WHERE roll_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)
      `, [bid]);
    }
    await client.query('COMMIT');
    await pool.query(`INSERT INTO audit_logs (username,action,module,new_value) VALUES ($1,'SEND_SUBCONTRACT','WAREHOUSE',$2)`,
      [req.user.username, `challan=${challan_number} vendor=${vendor_name} kg=${total_kg}`]);

    // Auto: JOBWORK cost entry
    try {
      const challanRow = r.rows[0];
      if (rate_per_kg && parseFloat(rate_per_kg) > 0 && parseFloat(total_kg) > 0) {
        const component = job_type === 'DYEING' ? 'JOBWORK_DYEING' : job_type === 'FINISHING' ? 'JOBWORK_FINISHING' : 'JOBWORK_DYEING_FINISHING';
        const b = batch.rows[0];
        const client3 = await pool.connect();
        try {
          await addCostEntry(client3, { reference_type: 'CHALLAN', reference_id: challanRow.challan_id, cost_component: component, amount_rs: (parseFloat(total_kg) * parseFloat(rate_per_kg)).toFixed(2), quantity_kg: parseFloat(total_kg), rate_used: parseFloat(rate_per_kg), fabric_type: b.fabric_type, color_name: b.color_name, notes: `${vendor_name} â€" ${job_type}` });
        } finally { client3.release(); }
      }
    } catch (costErr) { console.error('Jobwork cost error:', costErr.message); }

    // stock_ledger: fabric OUT to dye house / finishing
    try {
      const challanRow = r.rows[0];
      const transitWh = await pool.query(`SELECT warehouse_id FROM warehouses WHERE code='TRANSIT' LIMIT 1`);
      const slClient = await pool.connect();
      try {
        const partnerIdRow = challanRow.partner_id || null;
        await postToLedger(slClient, {
          doc_type: 'SC_CHALLAN', doc_id: challanRow.challan_number,
          item_desc: `Fabric batch ${batch_id} â€" ${job_type}`,
          warehouse_id: transitWh.rows[0]?.warehouse_id || null,
          movement_type: 'OUT',
          quantity: parseFloat(total_kg),
          uom_code: 'KG',
          partner_id: partnerIdRow,
          notes: `Sent to ${vendor_name} for ${job_type}`,
          created_by: req.user?.username || 'system',
        });
      } finally { slClient.release(); }
    } catch (slErr) { console.error('Ledger challan error:', slErr.message); }

    res.json(r.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

router.post('/knitting-challans', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { vendor_name, vendor_contact, job_type, sent_date, expected_return_date,
            rate_per_kg, notes, is_job_work, customer_name, yarn_items } = req.body;
    if (!vendor_name || !sent_date || !yarn_items?.length)
      return res.status(400).json({ error: 'vendor_name, sent_date, and yarn_items are required' });

    const total_kg = yarn_items.reduce((s, i) => s + parseFloat(i.sent_kg || 0), 0);
    const challan_number = await nextSeq('SC', 'subcontract_challans', 'challan_number');

    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO subcontract_challans
         (challan_number, batch_id, vendor_name, vendor_contact, job_type, sent_date,
          expected_return_date, sent_weight_kg, roll_count, rate_per_kg, notes,
          challan_type, is_job_work, customer_name, created_by)
       VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,0,$8,$9,'YARN_BASED',$10,$11,$12) RETURNING *`,
      [challan_number, vendor_name, vendor_contact||null, job_type||'KNITTING', sent_date,
       expected_return_date||null, total_kg.toFixed(3), rate_per_kg||null, notes||null,
       is_job_work||false, customer_name||null, req.user.username]
    );
    const challan_id = r.rows[0].challan_id;

    // Insert yarn items + deduct from yarn store
    for (const item of yarn_items) {
      await client.query(
        `INSERT INTO sc_challan_yarn_items (challan_id, lot_id, lot_number, yarn_type, color, sent_kg)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [challan_id, item.lot_id||null, item.lot_number||null, item.yarn_type||null, item.color||null, item.sent_kg]
      );
      if (item.lot_id) {
        await client.query(
          `UPDATE yarn_lots SET current_stock_kg = current_stock_kg - $1 WHERE lot_id = $2`,
          [item.sent_kg, item.lot_id]
        );
      }
    }
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

router.post('/knitting-challans/:id/receive', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { received_date, received_weight_kg, rolls_received_count, balance_yarn_kg,
            quality_status, rejected_weight_kg, notes, vendor_invoice_no, vendor_bill_amount } = req.body;
    if (!received_date || !received_weight_kg)
      return res.status(400).json({ error: 'received_date and received_weight_kg are required' });

    const challan = await client.query(`SELECT * FROM subcontract_challans WHERE challan_id=$1`, [id]);
    if (!challan.rows.length) return res.status(404).json({ error: 'Challan not found' });
    if (challan.rows[0].status === 'RECEIVED') return res.status(400).json({ error: 'Already fully received' });

    await client.query('BEGIN');

    // Sum previously received weight for partial receipt support
    const prevReceived = await client.query(
      `SELECT COALESCE(SUM(received_weight_kg), 0) AS total FROM subcontract_receipts WHERE challan_id=$1`, [id]
    );
    const totalReceivedSoFar = parseFloat(prevReceived.rows[0].total) + parseFloat(received_weight_kg);
    const sentKg = parseFloat(challan.rows[0].sent_weight_kg || 0);
    const isFullyReceived = totalReceivedSoFar >= sentKg;

    const r = await client.query(
      `INSERT INTO subcontract_receipts
         (challan_id, received_date, received_weight_kg, quality_status, rejected_weight_kg, notes,
          rolls_received_count, balance_yarn_kg, created_by, vendor_invoice_no, vendor_bill_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [id, received_date, received_weight_kg, quality_status||'PASS',
       rejected_weight_kg||0, notes||null,
       rolls_received_count||0, balance_yarn_kg||0, req.user.username,
       vendor_invoice_no||null, vendor_bill_amount||null]
    );

    // Update challan status: PARTIALLY_RECEIVED or RECEIVED
    const newStatus = isFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    await client.query(
      `UPDATE subcontract_challans SET status=$1, updated_at=NOW() WHERE challan_id=$2`, [newStatus, id]
    );

    // Return balance yarn to yarn store on every receipt (partial or final)
    if (parseFloat(balance_yarn_kg||0) > 0) {
      const items = await client.query(
        `SELECT lot_id, sent_kg FROM sc_challan_yarn_items WHERE challan_id=$1 AND lot_id IS NOT NULL`, [id]
      );
      for (const item of items.rows) {
        const share = parseFloat(item.sent_kg) / parseFloat(challan.rows[0].sent_weight_kg || 1);
        const returnKg = (parseFloat(balance_yarn_kg) * share).toFixed(3);
        await client.query(
          `UPDATE yarn_lots SET current_stock_kg = current_stock_kg + $1 WHERE lot_id=$2`,
          [returnKg, item.lot_id]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ ...r.rows[0], challan_status: newStatus, total_received_kg: totalReceivedSoFar });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

router.get('/challans/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [challan, rolls, receipts] = await Promise.all([
      pool.query(`
        SELECT c.*, b.batch_number, b.fabric_type,
          COALESCE(c.color_name, b.color_name) AS color_name
        FROM subcontract_challans c
        LEFT JOIN batches b ON c.batch_id=b.batch_id
        WHERE c.challan_id=$1
      `, [id]),
      pool.query(`
        SELECT DISTINCT r.roll_id,
          'ROLL-' || LPAD(r.roll_id::text, 4, '0') AS roll_display,
          r.machine_id, m.machine_name,
          r.fabric_type, r.shift, r.status,
          COALESCE(r.actual_weight_kg, r.weight_kg, 0) AS actual_weight_kg,
          COALESCE(h.hsn_code, '') AS hsn_code
        FROM batch_rolls br
        JOIN rolls r ON br.roll_id=r.roll_id
        LEFT JOIN machines m ON r.machine_id=m.machine_id
        LEFT JOIN items i ON UPPER(i.item_code) = UPPER(r.fabric_type) OR UPPER(i.item_name) = UPPER(r.fabric_type)
        LEFT JOIN hsn_codes h ON h.hsn_id = i.hsn_id
        WHERE br.batch_id IN (
          SELECT batch_id FROM subcontract_challans WHERE challan_id=$1
          UNION
          SELECT batch_id FROM subcontract_challan_items WHERE challan_id=$1 AND batch_id IS NOT NULL
        )
        ORDER BY r.roll_id
      `, [id]),
      pool.query(`SELECT * FROM subcontract_receipts WHERE challan_id=$1 ORDER BY created_at DESC`, [id]),
    ]);
    if (!challan.rows.length) return res.status(404).json({ error: 'Challan not found' });
    // For yarn-based (knitting) challans, fetch yarn items instead of rolls
    let yarnItems = [];
    if (challan.rows[0].challan_type === 'YARN_BASED') {
      const yi = await pool.query(`SELECT y.*, COALESCE(i.item_name, y.yarn_type) AS item_name FROM sc_challan_yarn_items y LEFT JOIN items i ON UPPER(i.item_code) = UPPER(y.yarn_type) WHERE y.challan_id=$1 ORDER BY y.item_id`, [id]);
      yarnItems = yi.rows;
    }
    const fabricItems = await pool.query(`
      SELECT ci.*, b.batch_number
      FROM subcontract_challan_items ci LEFT JOIN batches b ON b.batch_id = ci.batch_id
      WHERE ci.challan_id=$1 ORDER BY ci.item_id
    `, [id]);
    res.json({ ...challan.rows[0], rolls: rolls.rows, receipts: receipts.rows, yarn_items: yarnItems, fabric_items: fabricItems.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/challans/:id/receive', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { received_date, received_weight_kg, quality_status, rejected_weight_kg, notes,
            vendor_invoice_no, vendor_bill_amount } = req.body;
    if (!received_date || !received_weight_kg)
      return res.status(400).json({ error: 'received_date and received_weight_kg required' });

    const challan = await client.query(`SELECT * FROM subcontract_challans WHERE challan_id=$1`, [id]);
    if (!challan.rows.length) return res.status(404).json({ error: 'Challan not found' });
    if (challan.rows[0].status === 'RECEIVED') return res.status(400).json({ error: 'Already fully received' });

    const c = challan.rows[0];
    await client.query('BEGIN');

    // Sum previously received weight for partial receipt support
    const prevReceived = await client.query(
      `SELECT COALESCE(SUM(received_weight_kg), 0) AS total FROM subcontract_receipts WHERE challan_id=$1`, [id]
    );
    const totalReceivedSoFar = parseFloat(prevReceived.rows[0].total) + parseFloat(received_weight_kg);
    const sentKg = parseFloat(c.sent_weight_kg || 0);
    // Receipts are FINAL by default — process loss means received < sent is normal.
    // Only stays open if the operator explicitly marks it a partial receipt.
    const isFullyReceived = !req.body.is_partial;

    // Insert receipt
    const receipt = await client.query(
      `INSERT INTO subcontract_receipts
         (challan_id, received_date, received_weight_kg, quality_status, rejected_weight_kg, notes, received_by,
          vendor_invoice_no, vendor_bill_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, received_date, received_weight_kg, quality_status||'PASS', rejected_weight_kg||0, notes||null, req.user.username,
       vendor_invoice_no||null, vendor_bill_amount||null]
    );

    const batch = await client.query(`SELECT * FROM batches WHERE batch_id=$1`, [c.batch_id]);
    const b = batch.rows[0];
    const isDyeingOnly = c.job_type === 'DYEING';

    // New: received_items = [{fabric_type, batch_id, color, weight_kg}]
    // Old roll IDs are lost in the wet process — generate NEW roll IDs for the fabric coming back.
    const receivedItems = Array.isArray(req.body.received_items)
      ? req.body.received_items.filter(it => it.fabric_type && parseFloat(it.weight_kg) > 0)
      : [];
    const newRolls = [];
    let fg = null;

    if (receivedItems.length) {
      let seq = 0;
      for (const it of receivedItems) {
        // Dyed-only fabric goes straight back out for finishing — no per-roll IDs needed.
        // New roll IDs + labels are generated only for FINISHED fabric.
        let newRollId = null;
        if (!isDyeingOnly) {
          seq += 1;
          newRollId = `${c.challan_number}-R${String(seq).padStart(3, '0')}`;
          const newRollQr = await generateQR(rollQRContent(newRollId));
          await client.query(
            `INSERT INTO rolls (roll_id, fabric_type, weight_kg, actual_weight_kg, status, warehouse_status, source, closed_at, approved_at, qr_image)
             VALUES ($1,$2,$3,$3,'APPROVED','FINISHED','SC_RECEIPT',NOW(),NOW(),$4)
             ON CONFLICT (roll_id) DO NOTHING`,
            [newRollId, it.fabric_type, parseFloat(it.weight_kg), newRollQr]
          );
        }
        await client.query(
          `INSERT INTO subcontract_receipt_items (receipt_id, fabric_type, batch_id, color, weight_kg, new_roll_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [receipt.rows[0].receipt_id, it.fabric_type, it.batch_id || c.batch_id, it.color || null, parseFloat(it.weight_kg), newRollId]
        );
        if (newRollId) newRolls.push({ roll_id: newRollId, fabric_type: it.fabric_type, color: it.color, weight_kg: it.weight_kg });
        // One FG entry per received fabric line (finishing / dyeing+finishing)
        if (!isDyeingOnly) {
          fg = await client.query(
            `INSERT INTO finished_goods
               (receipt_id, batch_id, fabric_type, color_code, color_name, weight_kg, roll_count, roll_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [receipt.rows[0].receipt_id, it.batch_id || c.batch_id, it.fabric_type, b.color_code, it.color || b.color_name,
             parseFloat(it.weight_kg), 1, newRollId]
          );
        }
      }
    } else if (!isDyeingOnly) {
      // Old style: single FG entry from challan totals
      fg = await client.query(
        `INSERT INTO finished_goods
           (receipt_id, batch_id, fabric_type, color_code, color_name, weight_kg, roll_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [receipt.rows[0].receipt_id, c.batch_id, b.fabric_type, b.color_code, b.color_name,
         parseFloat(received_weight_kg) - parseFloat(rejected_weight_kg||0),
         0]
      );
    }

    // Update challan status: PARTIALLY_RECEIVED or RECEIVED
    const newStatus = isFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    await client.query(`UPDATE subcontract_challans SET status=$1, updated_at=NOW() WHERE challan_id=$2`, [newStatus, id]);

    // On full receipt: update batch and roll statuses
    if (isFullyReceived) {
      if (isDyeingOnly) {
        // Dyeing only: batch goes to DYED, rolls to DYED — ready for finishing
        await client.query(`UPDATE batches SET status='DYED', updated_at=NOW() WHERE batch_id=$1`, [c.batch_id]);
        await client.query(`
          UPDATE rolls SET warehouse_status='DYED'
          WHERE roll_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)
        `, [c.batch_id]);
      } else {
        // Finishing or Dyeing+Finishing: batch complete
        await client.query(`UPDATE batches SET status='RECEIVED', updated_at=NOW() WHERE batch_id=$1`, [c.batch_id]);
        await client.query(`
          UPDATE rolls SET warehouse_status='FINISHED'
          WHERE roll_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)
        `, [c.batch_id]);
      }
    }

    await client.query('COMMIT');
    await pool.query(`INSERT INTO audit_logs (username,action,module,new_value) VALUES ($1,'RECEIVE_SUBCONTRACT','WAREHOUSE',$2)`,
      [req.user.username, `challan=${c.challan_number} received_kg=${received_weight_kg} status=${newStatus} (${totalReceivedSoFar.toFixed(3)}/${sentKg} kg)`]);

    // Auto: WASTAGE cost entry - only on final receipt
    if (isFullyReceived) {
      try {
        const lossKg = sentKg - totalReceivedSoFar;
        if (lossKg > 0) {
          const rate = await getYarnRate(b.fabric_type);
          const c4 = await pool.connect();
          try { await addCostEntry(c4, { reference_type: 'BATCH', reference_id: c.batch_id, cost_component: 'WASTAGE', amount_rs: (lossKg * rate).toFixed(2), quantity_kg: lossKg, rate_used: rate, fabric_type: b.fabric_type, color_name: b.color_name, notes: `Processing loss: sent ${sentKg}kg total received ${totalReceivedSoFar.toFixed(3)}kg` }); }
          finally { c4.release(); }
        }
      } catch (costErr) { console.error('Wastage cost error:', costErr.message); }
    }

    // stock_ledger: fabric IN from dye house to FG store (per receipt)
    try {
      const fgWh = await pool.query(`SELECT warehouse_id FROM warehouses WHERE code='FG-STORE' LIMIT 1`);
      const slClient = await pool.connect();
      try {
        await postToLedger(slClient, {
          doc_type: 'SC_RECEIPT', doc_id: receipt.rows[0].receipt_id,
          item_desc: `${b.fabric_type || ''} ${b.color_name || ''} - Batch ${c.batch_id}`.trim(),
          warehouse_id: fgWh.rows[0]?.warehouse_id || null,
          movement_type: 'IN',
          quantity: parseFloat(received_weight_kg) - parseFloat(rejected_weight_kg || 0),
          uom_code: 'KG',
          notes: `Received from ${c.vendor_name} (${newStatus})`,
          created_by: req.user?.username || 'system',
        });
      } finally { slClient.release(); }
    } catch (slErr) { console.error('Ledger receipt error:', slErr.message); }

    res.json({ receipt: receipt.rows[0], finished_good: fg ? fg.rows[0] : null, challan_status: newStatus, total_received_kg: totalReceivedSoFar, new_rolls: newRolls });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

router.put('/receipts/:id/invoice', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { vendor_invoice_no, vendor_bill_amount, payment_status } = req.body;
    const r = await pool.query(
      `UPDATE subcontract_receipts SET vendor_invoice_no=$1, vendor_bill_amount=$2, payment_status=$3, updated_at=NOW()
       WHERE receipt_id=$4 RETURNING *`,
      [vendor_invoice_no||null, vendor_bill_amount||null, payment_status||'PENDING', req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Receipt not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/party-report', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.challan_id, c.challan_number, c.vendor_name, c.vendor_contact,
        c.job_type, c.challan_type, c.status, c.sent_date, c.expected_return_date,
        c.sent_weight_kg, c.is_job_work, c.customer_name,
        b.batch_number, b.fabric_type, b.color_name,
        CASE WHEN c.expected_return_date < CURRENT_DATE AND c.status IN ('SENT','PARTIALLY_RECEIVED')
             THEN true ELSE false END AS is_overdue,
        c.rate_per_kg,
        (CURRENT_DATE - c.sent_date::date) AS days_out,
        COALESCE((SELECT SUM(sr.received_weight_kg) FROM subcontract_receipts sr WHERE sr.challan_id = c.challan_id), 0) AS total_received_kg,
        COALESCE((SELECT SUM(sr.rejected_weight_kg) FROM subcontract_receipts sr WHERE sr.challan_id = c.challan_id), 0) AS total_rejected_kg,
        (SELECT COUNT(*) FROM subcontract_receipts sr WHERE sr.challan_id = c.challan_id) AS receipt_count
      FROM subcontract_challans c
      LEFT JOIN batches b ON c.batch_id = b.batch_id
      WHERE c.status != 'CANCELLED'
      ORDER BY c.vendor_name, c.sent_date DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/invoices-pending', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), async (req, res) => {
  try {
    const { status } = req.query; // 'pending' (default) | 'paid' | 'all'
    const statusClause = status === 'paid' ? `WHERE sr.payment_status = 'PAID'`
                       : status === 'all'  ? ''
                       : `WHERE sr.payment_status IS DISTINCT FROM 'PAID'`;
    const r = await pool.query(`
      SELECT sr.receipt_id, sr.received_date, sr.received_weight_kg, sr.vendor_invoice_no,
             sr.vendor_bill_amount, sr.payment_status,
             sc.challan_number, sc.vendor_name, sc.rate_per_kg,
             ROUND((sr.received_weight_kg * sc.rate_per_kg)::NUMERIC, 2) AS expected_amount
      FROM subcontract_receipts sr
      JOIN subcontract_challans sc ON sc.challan_id = sr.challan_id
      ${statusClause}
      ORDER BY sr.received_date DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/challans/:id/cancel', verifyToken, requireRole('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sc = await client.query(`SELECT * FROM subcontract_challans WHERE challan_id=$1`, [req.params.id]);
    if (!sc.rows.length) return res.status(404).json({ error: 'Challan not found' });
    if (sc.rows[0].status !== 'SENT') return res.status(400).json({ error: 'Only SENT challans can be cancelled' });
    // Reverse batch + roll status
    if (sc.rows[0].batch_id) {
      await client.query(`UPDATE batches SET status='SEALED', updated_at=NOW() WHERE batch_id=$1`, [sc.rows[0].batch_id]);
      await client.query(`
        UPDATE rolls SET warehouse_status='GREIGE'
        WHERE roll_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)
      `, [sc.rows[0].batch_id]);
    }
    // If yarn-based challan, return yarn to lots
    if (sc.rows[0].challan_type === 'YARN_BASED') {
      const yarnItems = await client.query(`SELECT * FROM sc_challan_yarn_items WHERE challan_id=$1`, [req.params.id]);
      for (const item of yarnItems.rows) {
        if (item.lot_id) {
          await client.query(`UPDATE yarn_lots SET current_stock_kg = current_stock_kg + $1 WHERE lot_id=$2`, [item.sent_kg, item.lot_id]);
        }
      }
    }
    await client.query(`UPDATE subcontract_challans SET status='CANCELLED', updated_at=NOW() WHERE challan_id=$1`, [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

router.delete('/challans/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sc = await client.query(`SELECT * FROM subcontract_challans WHERE challan_id=$1`, [req.params.id]);
    if (!sc.rows.length) return res.status(404).json({ error: 'Challan not found' });
    if (sc.rows[0].status === 'RECEIVED') return res.status(400).json({ error: 'Cannot delete received challan' });
    // Reverse batch/roll/yarn stock same as cancel
    if (sc.rows[0].batch_id) {
      await client.query(`UPDATE batches SET status='SEALED', updated_at=NOW() WHERE batch_id=$1`, [sc.rows[0].batch_id]);
      await client.query(`UPDATE rolls SET warehouse_status='GREIGE' WHERE roll_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)`, [sc.rows[0].batch_id]);
    }
    if (sc.rows[0].challan_type === 'YARN_BASED') {
      const yarnItems = await client.query(`SELECT * FROM sc_challan_yarn_items WHERE challan_id=$1`, [req.params.id]);
      for (const item of yarnItems.rows) {
        if (item.lot_id) await client.query(`UPDATE yarn_lots SET current_stock_kg = current_stock_kg + $1 WHERE lot_id=$2`, [item.sent_kg, item.lot_id]);
      }
    }
    await client.query(`DELETE FROM cost_entries WHERE reference_type='CHALLAN' AND reference_id=$1`, [req.params.id]);
    await client.query(`DELETE FROM sc_challan_yarn_items WHERE challan_id=$1`, [req.params.id]);
    await client.query(`DELETE FROM subcontract_challans WHERE challan_id=$1`, [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

router.put('/challans/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const sc = await pool.query(`SELECT status FROM subcontract_challans WHERE challan_id=$1`, [req.params.id]);
    if (!sc.rows.length) return res.status(404).json({ error: 'Not found' });
    if (sc.rows[0].status !== 'SENT') return res.status(400).json({ error: 'Only SENT challans can be edited' });
    const { vendor_name, vendor_contact, rate_per_kg, expected_return_date, notes } = req.body;
    const r = await pool.query(
      `UPDATE subcontract_challans SET vendor_name=COALESCE($1,vendor_name), vendor_contact=$2, rate_per_kg=$3, expected_return_date=$4, notes=$5, updated_at=NOW()
       WHERE challan_id=$6 RETURNING *`,
      [vendor_name, vendor_contact||null, rate_per_kg||null, expected_return_date||null, notes||null, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/last-rate', async (req, res) => {
  try {
    const { vendor_name, job_type } = req.query;
    if (!vendor_name) return res.json({ rate_per_kg: null });
    const conds = [`vendor_name = $1`, `rate_per_kg IS NOT NULL`, `rate_per_kg > 0`];
    const vals = [vendor_name];
    let p = 2;
    if (job_type) { conds.push(`job_type = $${p++}`); vals.push(job_type); }
    const r = await pool.query(`
      SELECT rate_per_kg, job_type, sent_date, challan_number
      FROM subcontract_challans WHERE ${conds.join(' AND ')}
      ORDER BY sent_date DESC, challan_id DESC LIMIT 1
    `, vals);
    res.json(r.rows[0] || { rate_per_kg: null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/wastage-summary', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.challan_id, c.challan_number, c.vendor_name, c.job_type,
        c.sent_weight_kg,
        COALESCE(SUM(sr.received_weight_kg), 0) AS total_received_kg,
        COALESCE(SUM(sr.rejected_weight_kg), 0) AS total_rejected_kg,
        ROUND(((c.sent_weight_kg - COALESCE(SUM(sr.received_weight_kg),0)) / NULLIF(c.sent_weight_kg,0) * 100)::NUMERIC, 2) AS wastage_pct
      FROM subcontract_challans c
      JOIN subcontract_receipts sr ON sr.challan_id = c.challan_id
      WHERE c.status = 'RECEIVED'
      GROUP BY c.challan_id
      HAVING c.sent_weight_kg - COALESCE(SUM(sr.received_weight_kg),0) > 0
      ORDER BY wastage_pct DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/overdue-alerts', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.challan_id, c.challan_number, c.vendor_name, c.job_type,
        c.sent_date, c.expected_return_date, c.sent_weight_kg, c.status,
        (CURRENT_DATE - c.expected_return_date::DATE) AS days_overdue,
        b.batch_number, b.fabric_type, b.color_name
      FROM subcontract_challans c
      LEFT JOIN batches b ON c.batch_id = b.batch_id
      WHERE c.status IN ('SENT', 'PARTIALLY_RECEIVED')
        AND c.expected_return_date IS NOT NULL
        AND c.expected_return_date < CURRENT_DATE
      ORDER BY days_overdue DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/analytics', async (req, res) => {
  try {
    const [vendorStats, monthlyTrend, wastageByVendor] = await Promise.all([
      pool.query(`
        SELECT c.vendor_name, c.job_type,
          COUNT(*) AS total_challans,
          COUNT(*) FILTER (WHERE c.status = 'RECEIVED') AS completed,
          COUNT(*) FILTER (WHERE c.status IN ('SENT','PARTIALLY_RECEIVED')) AS pending,
          ROUND(AVG(CASE WHEN c.status = 'RECEIVED' AND sr_agg.first_recv IS NOT NULL
            THEN (sr_agg.first_recv::DATE - c.sent_date::DATE) END)::NUMERIC, 1) AS avg_turnaround_days,
          ROUND(SUM(c.sent_weight_kg)::NUMERIC, 2) AS total_sent_kg,
          ROUND(COALESCE(SUM(sr_agg.total_recv), 0)::NUMERIC, 2) AS total_received_kg,
          ROUND(COALESCE(SUM(c.sent_weight_kg * COALESCE(c.rate_per_kg, 0)), 0)::NUMERIC, 2) AS total_cost
        FROM subcontract_challans c
        LEFT JOIN (
          SELECT challan_id, SUM(received_weight_kg) AS total_recv, MIN(received_date) AS first_recv
          FROM subcontract_receipts GROUP BY challan_id
        ) sr_agg ON sr_agg.challan_id = c.challan_id
        WHERE c.status != 'CANCELLED'
        GROUP BY c.vendor_name, c.job_type
        ORDER BY total_challans DESC
      `),
      pool.query(`
        SELECT TO_CHAR(c.sent_date, 'YYYY-MM') AS month,
          COUNT(*) AS challans,
          ROUND(SUM(c.sent_weight_kg)::NUMERIC, 2) AS sent_kg,
          ROUND(COALESCE(SUM(sr_agg.total_recv), 0)::NUMERIC, 2) AS received_kg,
          ROUND(COALESCE(SUM(c.sent_weight_kg * COALESCE(c.rate_per_kg, 0)), 0)::NUMERIC, 2) AS cost
        FROM subcontract_challans c
        LEFT JOIN (
          SELECT challan_id, SUM(received_weight_kg) AS total_recv
          FROM subcontract_receipts GROUP BY challan_id
        ) sr_agg ON sr_agg.challan_id = c.challan_id
        WHERE c.status != 'CANCELLED'
        GROUP BY month ORDER BY month DESC LIMIT 12
      `),
      pool.query(`
        SELECT c.vendor_name,
          ROUND(SUM(c.sent_weight_kg)::NUMERIC, 2) AS total_sent,
          ROUND(COALESCE(SUM(sr_agg.total_recv), 0)::NUMERIC, 2) AS total_received,
          ROUND(((SUM(c.sent_weight_kg) - COALESCE(SUM(sr_agg.total_recv),0)) / NULLIF(SUM(c.sent_weight_kg),0) * 100)::NUMERIC, 2) AS wastage_pct
        FROM subcontract_challans c
        LEFT JOIN (
          SELECT challan_id, SUM(received_weight_kg) AS total_recv
          FROM subcontract_receipts GROUP BY challan_id
        ) sr_agg ON sr_agg.challan_id = c.challan_id
        WHERE c.status = 'RECEIVED'
        GROUP BY c.vendor_name
        HAVING SUM(c.sent_weight_kg) > 0
        ORDER BY wastage_pct DESC
      `)
    ]);
    res.json({
      vendor_stats: vendorStats.rows,
      monthly_trend: monthlyTrend.rows.reverse(),
      wastage_by_vendor: wastageByVendor.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/challans/:id/forward', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { vendor_name, vendor_contact, rate_per_kg, expected_return_date, notes } = req.body;

    const challan = await client.query(`SELECT * FROM subcontract_challans WHERE challan_id=$1`, [id]);
    if (!challan.rows.length) return res.status(404).json({ error: 'Challan not found' });
    const orig = challan.rows[0];
    if (orig.status !== 'RECEIVED') return res.status(400).json({ error: 'Original challan must be fully received first' });
    if (orig.job_type !== 'DYEING') return res.status(400).json({ error: 'Only dyeing challans can be forwarded to finishing' });

    const batch = await client.query(`SELECT * FROM batches WHERE batch_id=$1`, [orig.batch_id]);
    if (!batch.rows.length) return res.status(404).json({ error: 'Batch not found' });
    if (batch.rows[0].status !== 'DYED') return res.status(400).json({ error: 'Batch is not in DYED status' });

    if (!vendor_name) return res.status(400).json({ error: 'vendor_name is required for forwarding' });

    // Get received weight from original challan receipts
    const recvStats = await client.query(
      `SELECT SUM(received_weight_kg) AS total, COUNT(*) AS roll_count FROM subcontract_receipts WHERE challan_id=$1`, [id]
    );
    const total_kg = parseFloat(recvStats.rows[0].total || orig.sent_weight_kg);
    const roll_count = parseInt(recvStats.rows[0].roll_count || orig.roll_count || 0);

    const challan_number = await nextSeq('SC', 'subcontract_challans', 'challan_number');
    const today = new Date().toISOString().slice(0, 10);

    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO subcontract_challans
         (challan_number, batch_id, vendor_name, vendor_contact, job_type, sent_date,
          expected_return_date, sent_weight_kg, roll_count, rate_per_kg, notes, created_by, forwarded_from_challan_id)
       VALUES ($1,$2,$3,$4,'FINISHING',$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [challan_number, orig.batch_id, vendor_name, vendor_contact||null, today,
       expected_return_date||null, total_kg.toFixed(3), roll_count, rate_per_kg||null,
       notes || `Forwarded from ${orig.challan_number} (${orig.vendor_name} dyeing)`,
       req.user.username, orig.challan_id]
    );

    await client.query(`UPDATE batches SET status='SENT', updated_at=NOW() WHERE batch_id=$1`, [orig.batch_id]);
    await client.query(`
      UPDATE rolls SET warehouse_status='SENT_OUT'
      WHERE roll_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)
    `, [orig.batch_id]);

    await client.query('COMMIT');

    // Jobwork cost entry for finishing
    if (rate_per_kg && parseFloat(rate_per_kg) > 0) {
      try {
        const c2 = await pool.connect();
        try {
          await addCostEntry(c2, { reference_type: 'CHALLAN', reference_id: r.rows[0].challan_id, cost_component: 'JOBWORK_FINISHING', amount_rs: (total_kg * parseFloat(rate_per_kg)).toFixed(2), quantity_kg: total_kg, rate_used: parseFloat(rate_per_kg), fabric_type: batch.rows[0].fabric_type, color_name: batch.rows[0].color_name, notes: `${vendor_name} — FINISHING (forwarded from ${orig.challan_number})` });
        } finally { c2.release(); }
      } catch (costErr) { console.error('Forward jobwork cost error:', costErr.message); }
    }

    await pool.query(`INSERT INTO audit_logs (username,action,module,new_value) VALUES ($1,'FORWARD_SUBCONTRACT','WAREHOUSE',$2)`,
      [req.user.username, `${orig.challan_number} → ${challan_number} vendor=${vendor_name} kg=${total_kg.toFixed(3)}`]);

    res.json(r.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

  return router;
};
