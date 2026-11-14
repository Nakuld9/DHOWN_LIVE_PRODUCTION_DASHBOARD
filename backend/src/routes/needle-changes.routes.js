// Needle-change documents. A change on a machine is a SET of spare parts (several
// needle butt types + sinkers), not a single needle. Each document has a header
// (machine, date, reason) and many lines; every line is a CONSUMED spare-part
// movement tagged with needle_change_id + machine_id, valued at the part's stock
// cost — so stock draws down, per-machine spend rolls up, and the change is costed.

const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();

  // List change documents + a per-machine cost summary + the needle/sinker parts
  // (with stock cost) for the line dropdown.
  router.get('/', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try {
      const { machine_id } = req.query;
      const args = [], where = [];
      if (machine_id) { args.push(machine_id); where.push(`nc.machine_id = $${args.length}`); }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const documents = (await pool.query(
        `SELECT nc.*, m.machine_name,
                COUNT(mv.id)::int              AS line_count,
                COALESCE(SUM(mv.total_cost),0) AS total_cost
           FROM needle_change nc
           JOIN machines m ON m.machine_id = nc.machine_id
           LEFT JOIN spare_part_movements mv ON mv.needle_change_id = nc.id
           ${w}
          GROUP BY nc.id, m.machine_name
          ORDER BY nc.change_date DESC, nc.id DESC
          LIMIT 500`, args)).rows;

      const summary = (await pool.query(
        `SELECT nc.machine_id, m.machine_name,
                COUNT(DISTINCT nc.id)::int     AS changes,
                COALESCE(SUM(mv.total_cost),0) AS total_cost,
                MAX(nc.change_date)            AS last_change
           FROM needle_change nc
           JOIN machines m ON m.machine_id = nc.machine_id
           LEFT JOIN spare_part_movements mv ON mv.needle_change_id = nc.id
          GROUP BY nc.machine_id, m.machine_name
          ORDER BY total_cost DESC NULLS LAST`)).rows;

      const parts = (await pool.query(
        `SELECT id, part_name, sku, category, current_stock,
                COALESCE(last_unit_cost, avg_cost) AS price
           FROM spare_parts
          WHERE deleted_at IS NULL AND category ILIKE ANY (ARRAY['%needle%','%sinker%'])
          ORDER BY category, part_name`)).rows;

      res.json({ documents, summary, parts });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // One document with its lines.
  router.get('/:id(\\d+)', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try {
      const hdr = (await pool.query(
        `SELECT nc.*, m.machine_name, m.machine_type, m.gauge
           FROM needle_change nc JOIN machines m ON m.machine_id = nc.machine_id
          WHERE nc.id = $1`, [req.params.id])).rows[0];
      if (!hdr) return res.status(404).json({ error: 'Change not found' });
      const lines = (await pool.query(
        `SELECT mv.id, mv.part_id, sp.part_name, sp.sku, sp.unit, mv.quantity, mv.unit_cost, mv.total_cost
           FROM spare_part_movements mv JOIN spare_parts sp ON sp.id = mv.part_id
          WHERE mv.needle_change_id = $1 ORDER BY mv.id`, [req.params.id])).rows;
      res.json({ ...hdr, lines });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Kg produced by a machine in a date window (needle-cost denominator).
  async function kgProduced(client, machineId, fromDate, toDate) {
    const r = await client.query(
      `SELECT COALESCE(SUM(production_kg),0)::numeric AS kg FROM production_history
        WHERE machine_id = $1 AND record_date >= $2 AND record_date <= $3`,
      [machineId, fromDate, toDate]);
    return Number(r.rows[0].kg);
  }

  // Create a change document with multiple part lines. FULL_BED starts a new needle-
  // life cycle (closing the previous one and deriving its ₹/kg); BREAKAGE adds its cost
  // to the machine's open cycle.
  router.post('/', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    const b = req.body || {};
    if (!b.machine_id) return res.status(400).json({ error: 'machine_id required' });
    const lines = (b.lines || []).filter((l) => l && l.part_id && parseFloat(l.quantity) > 0);
    if (!lines.length) return res.status(400).json({ error: 'Add at least one part line with a quantity' });
    const changeType = b.change_type === 'FULL_BED' ? 'FULL_BED' : 'BREAKAGE';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hdr = (await client.query(
        `INSERT INTO needle_change (machine_id, change_date, reason, notes, changed_by, change_type)
         VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6) RETURNING *`,
        [b.machine_id, b.change_date || null, b.reason || null, b.notes || null, req.user?.username || null, changeType])).rows[0];

      let total = 0;
      for (const l of lines) {
        const qty = Math.max(0, parseFloat(l.quantity));
        const part = (await client.query(`SELECT current_stock, COALESCE(last_unit_cost, avg_cost) AS price FROM spare_parts WHERE id = $1 FOR UPDATE`, [l.part_id])).rows[0];
        if (!part) continue;
        const cost = l.unit_cost == null || l.unit_cost === '' ? Number(part.price || 0) : Math.max(0, parseFloat(l.unit_cost));
        total += qty * cost;
        await client.query(
          `INSERT INTO spare_part_movements (part_id, movement_type, quantity, unit_cost, machine_id, needle_change_id, reference, created_by)
           VALUES ($1,'CONSUMED',$2,$3,$4,$5,'Needle change',$6)`,
          [l.part_id, qty, cost, b.machine_id, hdr.id, req.user?.username || null]);
        await client.query(`UPDATE spare_parts SET current_stock = GREATEST(0, current_stock - $1), updated_at = NOW() WHERE id = $2`, [qty, l.part_id]);
      }

      // ── Needle-life cycle bookkeeping ──
      const open = (await client.query(`SELECT * FROM needle_life_cycle WHERE machine_id = $1 AND ended_on IS NULL ORDER BY started_on DESC LIMIT 1`, [b.machine_id])).rows[0];
      const chgDate = hdr.change_date;
      if (changeType === 'FULL_BED') {
        if (open) {
          const kg = await kgProduced(client, b.machine_id, open.started_on, chgDate);
          const totalCost = Number(open.set_cost) + Number(open.breakage_cost);
          await client.query(
            `UPDATE needle_life_cycle SET ended_on = $2, closing_change_id = $3, kgs_produced = $4,
                    cost_per_kg = CASE WHEN $4 > 0 THEN ROUND($5 / $4, 4) ELSE NULL END, updated_at = NOW()
              WHERE id = $1`, [open.id, chgDate, hdr.id, kg, totalCost]);
        }
        await client.query(
          `INSERT INTO needle_life_cycle (machine_id, started_on, opening_change_id, set_cost) VALUES ($1,$2,$3,$4)`,
          [b.machine_id, chgDate, hdr.id, total]);
      } else if (open) {
        await client.query(`UPDATE needle_life_cycle SET breakage_cost = breakage_cost + $2, updated_at = NOW() WHERE id = $1`, [open.id, total]);
      }

      await client.query('COMMIT');
      res.status(201).json({ ...hdr, cost: total, cycle_note: changeType === 'BREAKAGE' && !open ? 'No open needle-life cycle — log a Full Bed change first to start costing.' : undefined });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
    finally { client.release(); }
  });

  // Needle-life cycles per machine (open + closed) with live ₹/kg and vs-standard.
  router.get('/cycles', verifyToken, requireRole('OPERATOR'), async (_req, res) => {
    try {
      const std = Number((await pool.query(`SELECT value FROM app_settings WHERE key = 'needle_std_cost_per_kg'`)).rows[0]?.value || 0) || null;
      const rows = (await pool.query(
        `SELECT c.*, m.machine_name,
                CASE WHEN c.ended_on IS NULL
                     THEN (SELECT COALESCE(SUM(production_kg),0)::numeric FROM production_history ph
                            WHERE ph.machine_id = c.machine_id AND ph.record_date >= c.started_on)
                     ELSE c.kgs_produced END AS kg_live
           FROM needle_life_cycle c JOIN machines m ON m.machine_id = c.machine_id
          ORDER BY c.machine_id, c.started_on DESC`)).rows;
      const cycles = rows.map((c) => {
        const totalCost = Number(c.set_cost) + Number(c.breakage_cost);
        const kg = Number(c.kg_live) || 0;
        const cpk = c.ended_on ? (c.cost_per_kg != null ? Number(c.cost_per_kg) : null) : (kg > 0 ? Math.round((totalCost / kg) * 10000) / 10000 : null);
        return { ...c, total_cost: totalCost, cost_per_kg_live: cpk, open: !c.ended_on,
                 variance: (std && cpk != null) ? Math.round((cpk - std) * 10000) / 10000 : null };
      });
      res.json({ cycles, standard_cost_per_kg: std });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Get / set the standard needle cost per kg (benchmark).
  router.get('/standard', verifyToken, requireRole('OPERATOR'), async (_req, res) => {
    try { res.json({ standard_cost_per_kg: Number((await pool.query(`SELECT value FROM app_settings WHERE key='needle_std_cost_per_kg'`)).rows[0]?.value || 0) || null }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/standard', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    const v = req.body.standard_cost_per_kg == null || req.body.standard_cost_per_kg === '' ? '' : String(Math.max(0, parseFloat(req.body.standard_cost_per_kg) || 0));
    try {
      await pool.query(`INSERT INTO app_settings (key, value, updated_at) VALUES ('needle_std_cost_per_kg', $1, NOW())
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [v]);
      res.json({ ok: true, standard_cost_per_kg: v ? Number(v) : null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Delete a change document: reverse every line's stock, then remove.
  router.delete('/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lines = (await client.query(`SELECT id, part_id, quantity FROM spare_part_movements WHERE needle_change_id = $1`, [req.params.id])).rows;
      for (const l of lines) {
        await client.query(`UPDATE spare_parts SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2`, [l.quantity, l.part_id]);
      }
      await client.query(`DELETE FROM spare_part_movements WHERE needle_change_id = $1`, [req.params.id]);
      await client.query(`DELETE FROM needle_change WHERE id = $1`, [req.params.id]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
    finally { client.release(); }
  });

  return router;
};
