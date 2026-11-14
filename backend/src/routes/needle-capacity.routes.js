// Needle capacity per machine — how many needles a full set holds, split into
// cylinder + dial beds. Single-bed machines (SJ, TV) use cylinder only; double-bed
// machines (IL, RB) also have a dial bed. Feeds needle costing (full-set value,
// % of a set replaced).

const express = require('express');

// Machine types that run a second (dial) needle bed.
const DOUBLE_BED = new Set(['IL', 'RB', 'DJ']);

// Textbook needle count for a circular machine: needles = π × diameter(in) × gauge(npi).
// Only a suggestion — the mill overrides with the exact spec count.
const suggest = (diameter, gauge) =>
  diameter && gauge ? Math.round(Math.PI * Number(diameter) * Number(gauge)) : null;

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();

  router.get('/', verifyToken, requireRole('OPERATOR'), async (_req, res) => {
    try {
      const rows = (await pool.query(
        `SELECT m.machine_id, m.machine_name, m.machine_type, m.diameter, m.gauge,
                m.cylinder_needles, m.dial_needles, m.sinker_count,
                (SELECT COUNT(*)::int FROM machine_config c WHERE c.machine_id = m.machine_id) AS config_count,
                (SELECT label FROM machine_config c WHERE c.machine_id = m.machine_id AND c.is_active LIMIT 1) AS active_config
           FROM machines m
          ORDER BY m.machine_type, m.machine_id`)).rows;
      res.json(rows.map((m) => {
        const doubleBed = DOUBLE_BED.has(String(m.machine_type || '').toUpperCase());
        const s = suggest(m.diameter, m.gauge);
        // Second bed = dial needles on IL/RB, sinkers on SJ/TV — separate columns.
        const secondaryField = doubleBed ? 'dial_needles' : 'sinker_count';
        return {
          ...m,
          double_bed: doubleBed,
          secondary_kind: doubleBed ? 'DIAL' : 'SINKER',
          secondary_field: secondaryField,
          secondary_value: m[secondaryField],
          suggested_cylinder: s,
          suggested_secondary: s,
          total_needles: (m.cylinder_needles || 0) + (m.dial_needles || 0) + (m.sinker_count || 0),
        };
      }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // All needle/sinker parts, for the part-set picker.
  router.get('/parts-catalog', verifyToken, requireRole('OPERATOR'), async (_req, res) => {
    try {
      const rows = (await pool.query(
        `SELECT id, part_name, sku, category, current_stock, COALESCE(last_unit_cost, avg_cost) AS price
           FROM spare_parts
          WHERE deleted_at IS NULL AND category ILIKE ANY (ARRAY['%needle%','%sinker%'])
          ORDER BY category, part_name`)).rows;
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The active config id for a machine, or null when it has no configs (single set).
  async function activeConfig(machineId) {
    const r = await pool.query(`SELECT id FROM machine_config WHERE machine_id = $1 AND is_active = true LIMIT 1`, [machineId]);
    if (r.rows[0]) return r.rows[0].id;
    const any = await pool.query(`SELECT id FROM machine_config WHERE machine_id = $1 ORDER BY id LIMIT 1`, [machineId]);
    return any.rows[0] ? any.rows[0].id : null;   // fall back to the first config if none flagged
  }

  // Recompute a machine's Needle Capacity from its ACTIVE config's part set, split by
  // bed. Untagged needle lines count as cylinder; sinkers as the sinker bed. Runs
  // whenever a config is activated or its part set is edited, so capacity never drifts.
  async function recomputeCapacity(client, machineId) {
    const cfg = (await client.query(`SELECT id FROM machine_config WHERE machine_id = $1 AND is_active = true LIMIT 1`, [machineId])).rows[0];
    const cfgId = cfg ? cfg.id : null;
    const sums = (await client.query(
      `SELECT
         COALESCE(SUM(default_qty) FILTER (WHERE bed = 'DIAL'), 0)                                    AS dial,
         COALESCE(SUM(default_qty) FILTER (WHERE bed = 'SINKER' OR sp.category ILIKE '%sinker%'), 0)  AS sinker,
         COALESCE(SUM(default_qty) FILTER (WHERE (bed = 'CYLINDER' OR (bed IS NULL AND sp.category ILIKE '%needle%'))), 0) AS cyl
         FROM machine_part mp JOIN spare_parts sp ON sp.id = mp.part_id
        WHERE mp.machine_id = $1 AND mp.config_id IS NOT DISTINCT FROM $2`, [machineId, cfgId])).rows[0];
    await client.query(
      `UPDATE machines SET
         cylinder_needles = $2, dial_needles = NULLIF($3,0), sinker_count = NULLIF($4,0),
         needles_count = $2 + $3 + $4, updated_at = NOW()
       WHERE machine_id = $1`,
      [machineId, Number(sums.cyl), Number(sums.dial), Number(sums.sinker)]);
  }

  // A machine's part set (with live price/stock). Defaults to the ACTIVE config;
  // ?config_id=N fetches a specific config's set (for the editor).
  router.get('/:machineId/parts', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try {
      const cfg = req.query.config_id != null && req.query.config_id !== ''
        ? Number(req.query.config_id) : await activeConfig(req.params.machineId);
      const rows = (await pool.query(
        `SELECT mp.part_id, mp.default_qty, mp.position, mp.bed,
                sp.part_name, sp.sku, sp.category, sp.current_stock,
                COALESCE(sp.last_unit_cost, sp.avg_cost) AS price
           FROM machine_part mp JOIN spare_parts sp ON sp.id = mp.part_id
          WHERE mp.machine_id = $1 AND sp.deleted_at IS NULL
            AND mp.config_id IS NOT DISTINCT FROM $2
          ORDER BY mp.position, sp.part_name`, [req.params.machineId, cfg])).rows;
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Replace a machine's part set (for the given config, or the machine's single set).
  router.put('/:machineId/parts', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    const parts = (req.body && req.body.parts || []).filter((p) => p && p.part_id);
    const cfg = req.body.config_id != null && req.body.config_id !== '' ? Number(req.body.config_id) : null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM machine_part WHERE machine_id = $1 AND config_id IS NOT DISTINCT FROM $2`, [req.params.machineId, cfg]);
      let pos = 0;
      for (const p of parts) {
        const q = p.default_qty == null || p.default_qty === '' ? null : Math.max(0, parseInt(p.default_qty, 10) || 0);
        const bed = ['CYLINDER', 'DIAL', 'SINKER'].includes(p.bed) ? p.bed : null;
        await client.query(
          `INSERT INTO machine_part (machine_id, part_id, default_qty, position, config_id, bed) VALUES ($1,$2,$3,$4,$5,$6)`,
          [req.params.machineId, p.part_id, q, pos++, cfg, bed]);
      }
      await recomputeCapacity(client, req.params.machineId);   // keep capacity in sync
      await client.query('COMMIT');
      res.json({ ok: true, count: parts.length });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
    finally { client.release(); }
  });

  // Configs of a convertible machine.
  router.get('/:machineId/configs', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try {
      const rows = (await pool.query(
        `SELECT id, label, gauge, is_active FROM machine_config WHERE machine_id = $1 ORDER BY id`, [req.params.machineId])).rows;
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Add a gauge config. The first config created becomes active.
  router.post('/:machineId/configs', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    const label = String(req.body.label || '').trim();
    const gauge = req.body.gauge == null || req.body.gauge === '' ? null : parseInt(req.body.gauge, 10);
    if (!label) return res.status(400).json({ error: 'label required' });
    try {
      const existing = (await pool.query(`SELECT COUNT(*)::int n FROM machine_config WHERE machine_id = $1`, [req.params.machineId])).rows[0].n;
      const row = (await pool.query(
        `INSERT INTO machine_config (machine_id, label, gauge, is_active) VALUES ($1,$2,$3,$4)
         ON CONFLICT (machine_id, label) DO UPDATE SET gauge = EXCLUDED.gauge RETURNING *`,
        [req.params.machineId, label, gauge, existing === 0])).rows[0];
      res.status(201).json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Activate a config: flip is_active and set the machine's live gauge to match.
  router.put('/:machineId/activate', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    const cfgId = Number(req.body.config_id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cfg = (await client.query(`SELECT gauge FROM machine_config WHERE id = $1 AND machine_id = $2`, [cfgId, req.params.machineId])).rows[0];
      if (!cfg) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Config not found' }); }
      await client.query(`UPDATE machine_config SET is_active = (id = $1) WHERE machine_id = $2`, [cfgId, req.params.machineId]);
      if (cfg.gauge != null) await client.query(`UPDATE machines SET gauge = $1, updated_at = NOW() WHERE machine_id = $2`, [cfg.gauge, req.params.machineId]);
      await recomputeCapacity(client, req.params.machineId);   // capacity follows the new config
      await client.query('COMMIT');
      res.json({ ok: true, active: cfgId, gauge: cfg.gauge });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
    finally { client.release(); }
  });

  // Update one machine's needle capacity. Only the fields sent are changed; the
  // second bed is dial_needles (IL/RB) or sinker_count (SJ/TV).
  router.put('/:machineId', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    const b = req.body || {};
    const num = (v) => v == null || v === '' ? null : Math.max(0, parseInt(v, 10) || 0);
    try {
      const m = (await pool.query(`SELECT machine_type FROM machines WHERE machine_id = $1`, [req.params.machineId])).rows[0];
      if (!m) return res.status(404).json({ error: 'Machine not found' });

      const sets = [], args = [req.params.machineId];
      for (const col of ['cylinder_needles', 'dial_needles', 'sinker_count']) {
        if (col in b) { args.push(num(b[col])); sets.push(`${col} = $${args.length}`); }
      }
      if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
      await pool.query(`UPDATE machines SET ${sets.join(', ')}, updated_at = NOW() WHERE machine_id = $1`, args);
      // Recompute total from the persisted values (SET can't reference new siblings).
      const row = (await pool.query(
        `UPDATE machines
            SET needles_count = COALESCE(cylinder_needles,0) + COALESCE(dial_needles,0) + COALESCE(sinker_count,0)
          WHERE machine_id = $1
        RETURNING machine_id, cylinder_needles, dial_needles, sinker_count, needles_count`,
        [req.params.machineId])).rows[0];
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
