// Batches (lots) routes — greige lot lifecycle: create from rolls, add/remove rolls,
// seal, delete (layered extraction, 2026-07-10). Mounted at /api/batches.
// 7 handlers migrated VERBATIM. refreshBatchFabric (multi-fabric label helper) moved
// in from server.js — used only here. Injected: pool, verifyToken, requireRole.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole, nextDocNumber }) => {
  const router = express.Router();

  // Every route below requires a valid session. Applied at router level so a
  // route added later is guarded by default; individual routes add requireRole
  // on top where a specific role is needed.
  router.use(verifyToken);


  async function refreshBatchFabric(client, batch_id) {
    const fb = await client.query(`
      SELECT DISTINCT COALESCE(r.fabric_type, 'Unknown') AS ft
      FROM batch_rolls br JOIN rolls r ON r.roll_id = br.roll_id
      WHERE br.batch_id = $1 ORDER BY 1
    `, [batch_id]);
    const label = fb.rows.map(x => x.ft).join(' + ') || null;
    if (label) await client.query(`UPDATE batches SET fabric_type=$1, updated_at=NOW() WHERE batch_id=$2`, [label, batch_id]);
    return label;
  }

router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const conds = []; const vals = []; let p = 1;
    if (status) { conds.push(`b.status = $${p++}`); vals.push(status); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(`
      SELECT b.*,
        COALESCE(br.roll_count, 0) AS roll_count,
        COALESCE(br.total_kg, 0)   AS total_weight_kg,
        fb.fabric_breakdown,
        dfb.dyed_breakdown
      FROM batches b
      LEFT JOIN (
        SELECT br.batch_id, COUNT(*) AS roll_count,
               ROUND(SUM(r.actual_weight_kg)::NUMERIC, 3) AS total_kg
        FROM batch_rolls br
        JOIN rolls r ON br.roll_id = r.roll_id
        GROUP BY br.batch_id
      ) br ON br.batch_id = b.batch_id
      LEFT JOIN LATERAL (
        SELECT json_agg(x) AS fabric_breakdown FROM (
          SELECT COALESCE(r.fabric_type, 'Unknown') AS fabric_type,
                 ROUND(SUM(COALESCE(r.actual_weight_kg, r.weight_kg, 0))::NUMERIC, 3) AS kg,
                 COUNT(*) AS rolls
          FROM batch_rolls br2 JOIN rolls r ON r.roll_id = br2.roll_id
          WHERE br2.batch_id = b.batch_id
          GROUP BY COALESCE(r.fabric_type, 'Unknown')
          ORDER BY 2 DESC
        ) x
      ) fb ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(x) AS dyed_breakdown FROM (
          SELECT ri.fabric_type,
                 ROUND(SUM(ri.weight_kg)::NUMERIC, 3) AS kg,
                 COALESCE(SUM(ri.roll_count), 0) AS rolls
          FROM subcontract_receipt_items ri
          JOIN subcontract_receipts sr ON sr.receipt_id = ri.receipt_id
          JOIN subcontract_challans sc ON sc.challan_id = sr.challan_id
          WHERE sc.batch_id = b.batch_id AND sc.job_type = 'DYEING'
          GROUP BY ri.fabric_type
          ORDER BY 2 DESC
        ) x
      ) dfb ON true
      ${where}
      ORDER BY b.created_at DESC
    `, vals);
    // DYED lots: show weights as received from dyeing, not the original greige weights
    r.rows.forEach(row => {
      if (row.status === 'DYED' && row.dyed_breakdown) {
        row.fabric_breakdown = row.dyed_breakdown;
        row.total_weight_kg = row.dyed_breakdown.reduce((s, f) => s + parseFloat(f.kg || 0), 0).toFixed(3);
      }
      delete row.dyed_breakdown;
    });
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { fabric_type, color_code, color_name, notes, roll_ids } = req.body;
    await client.query('BEGIN');
    const batch_number = await nextDocNumber('LOT');
    const r = await client.query(
      `INSERT INTO batches (batch_number, fabric_type, color_code, color_name, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [batch_number, fabric_type || null, color_code || null, color_name || null, notes || null, req.user.username]
    );
    const batch_id = r.rows[0].batch_id;
    if (Array.isArray(roll_ids) && roll_ids.length) {
      for (const roll_id of roll_ids) {
        await client.query(
          `INSERT INTO batch_rolls (batch_id, roll_id, added_by) VALUES ($1,$2,$3) ON CONFLICT (roll_id) DO NOTHING`,
          [batch_id, roll_id, req.user.username]
        );
        await client.query(`UPDATE rolls SET warehouse_status='IN_BATCH' WHERE roll_id=$1`, [roll_id]);
      }
    }
    const label = await refreshBatchFabric(client, batch_id);
    await client.query(`INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,'CREATE_LOT','WAREHOUSE',$2)`,
      [req.user.username, `lot=${batch_number} fabric=${label || fabric_type} rolls=${(roll_ids||[]).length}`]);
    await client.query('COMMIT');
    res.json({ ...r.rows[0], fabric_type: label || r.rows[0].fabric_type, rolls_added: (roll_ids || []).length });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [batch, rolls] = await Promise.all([
      pool.query(`SELECT * FROM batches WHERE batch_id = $1`, [id]),
      pool.query(`
        SELECT r.*, m.machine_name, br.added_at, br.added_by
        FROM batch_rolls br
        JOIN rolls r ON br.roll_id = r.roll_id
        LEFT JOIN machines m ON r.machine_id = m.machine_id
        WHERE br.batch_id = $1
        ORDER BY br.added_at DESC
      `, [id]),
    ]);
    if (!batch.rows.length) return res.status(404).json({ error: 'Batch not found' });
    const fb = await pool.query(`
      SELECT COALESCE(r.fabric_type, 'Unknown') AS fabric_type,
             ROUND(SUM(COALESCE(r.actual_weight_kg, r.weight_kg, 0))::NUMERIC, 3) AS kg,
             COUNT(*) AS rolls
      FROM batch_rolls br JOIN rolls r ON r.roll_id = br.roll_id
      WHERE br.batch_id = $1
      GROUP BY COALESCE(r.fabric_type, 'Unknown')
      ORDER BY 2 DESC
    `, [id]);
    res.json({ ...batch.rows[0], rolls: rolls.rows, fabric_breakdown: fb.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/rolls', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { roll_ids } = req.body; // array of roll_id
    if (!Array.isArray(roll_ids) || !roll_ids.length) return res.status(400).json({ error: 'roll_ids array required' });

    const batch = await client.query(`SELECT * FROM batches WHERE batch_id = $1`, [id]);
    if (!batch.rows.length) return res.status(404).json({ error: 'Batch not found' });
    if (batch.rows[0].status !== 'OPEN') return res.status(400).json({ error: 'Batch is not open' });

    await client.query('BEGIN');
    for (const roll_id of roll_ids) {
      await client.query(
        `INSERT INTO batch_rolls (batch_id, roll_id, added_by) VALUES ($1,$2,$3) ON CONFLICT (roll_id) DO NOTHING`,
        [id, roll_id, req.user.username]
      );
      await client.query(`UPDATE rolls SET warehouse_status='IN_BATCH' WHERE roll_id=$1`, [roll_id]);
    }
    await refreshBatchFabric(client, id);
    await client.query('COMMIT');
    res.json({ added: roll_ids.length });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

router.delete('/:id/rolls/:rollId', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id, rollId } = req.params;
    await client.query('BEGIN');
    await client.query(`DELETE FROM batch_rolls WHERE batch_id=$1 AND roll_id=$2`, [id, rollId]);
    await client.query(`UPDATE rolls SET warehouse_status='GREIGE' WHERE roll_id=$1`, [rollId]);
    await refreshBatchFabric(client, id);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

router.delete('/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const batch = await client.query('SELECT * FROM batches WHERE batch_id=$1', [id]);
    if (!batch.rows.length) return res.status(404).json({ error: 'Batch not found' });
    if (batch.rows[0].status === 'SENT' || batch.rows[0].status === 'RECEIVED' || batch.rows[0].status === 'CLOSED')
      return res.status(400).json({ error: `Cannot delete lot in ${batch.rows[0].status} status` });
    await client.query('BEGIN');
    await client.query(`UPDATE rolls SET warehouse_status='GREIGE' WHERE roll_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)`, [id]);
    await client.query('DELETE FROM batch_rolls WHERE batch_id=$1', [id]);
    await client.query('DELETE FROM batches WHERE batch_id=$1', [id]);
    await client.query('COMMIT');
    res.json({ ok: true, message: `Lot ${batch.rows[0].batch_number} deleted, ${batch.rows[0].roll_count || 0} rolls returned to greige` });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

router.put('/:id/seal', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const r = await pool.query(
      `UPDATE batches SET status='SEALED', updated_at=NOW() WHERE batch_id=$1 AND status='OPEN' RETURNING *`, [id]
    );
    if (!r.rows.length) return res.status(400).json({ error: 'Batch not found or not open' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
