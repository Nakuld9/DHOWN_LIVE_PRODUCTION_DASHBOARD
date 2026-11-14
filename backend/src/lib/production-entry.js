// Manual shift-production entry — record what a machine knitted in a shift when no
// data collector is wired. Each entered roll becomes a CLOSED greige roll, exactly
// like a live-produced one, so it flows straight into the production summary, the
// dashboard, greige stock and the inspection worklist. Purpose-built for manual
// entry (a chosen date, many rolls at once) rather than the live open→close cycle.

module.exports = (pool) => {
  // Resolve the roll-id prefix + the machine's fabric so ids match the live format.
  async function context(machine_id) {
    const [pfx, mach] = await Promise.all([
      pool.query(`SELECT value FROM app_settings WHERE key='roll_prefix'`),
      pool.query(`SELECT fabric_code, fabric FROM machines WHERE machine_id=$1`, [machine_id]),
    ]);
    if (mach.rows.length === 0) return null;
    let fabric_item_id = null;
    const fabricCode = mach.rows[0].fabric_code || null;
    if (fabricCode) {
      const it = await pool.query(`SELECT item_id FROM items WHERE item_code=$1 LIMIT 1`, [fabricCode]);
      if (it.rows.length) fabric_item_id = it.rows[0].item_id;
    }
    return {
      prefix: (pfx.rows[0]?.value || 'DHM-').replace(/[-\s]+$/, ''),
      fabricCode, defaultFabric: mach.rows[0].fabric || null, fabric_item_id,
    };
  }

  // body: { machine_id, shift, date?, fabric_type?, rolls:[{weight_kg}] }
  async function create({ machine_id, shift, date, fabric_type, rolls }, by) {
    if (!machine_id) return { code: 400, error: 'machine_id is required' };
    if (!shift) return { code: 400, error: 'shift is required' };
    const list = (Array.isArray(rolls) ? rolls : []).filter(r => Number(r.weight_kg) > 0);
    if (!list.length) return { code: 400, error: 'at least one roll with a weight is required' };

    const ctx = await context(machine_id);
    if (!ctx) return { code: 404, error: `unknown machine: ${machine_id}` };

    const day = date || new Date().toISOString().slice(0, 10);
    const stamp = `${day} 12:00:00`;
    const datePart = day.replace(/-/g, '');
    const fabricType = fabric_type || ctx.defaultFabric || null;
    const fabricPart = ctx.fabricCode ? `-${ctx.fabricCode}` : '';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Manual rolls carry an 'M' seq marker so they never collide with live ids.
      const base = Number((await client.query(
        `SELECT COUNT(*) n FROM rolls WHERE machine_id=$1 AND DATE(COALESCE(closed_at,created_at))=$2::date`,
        [machine_id, day])).rows[0].n);
      const created = [];
      let i = 0;
      for (const r of list) {
        i += 1;
        const seq = String(base + i).padStart(3, '0');
        const roll_id = `${ctx.prefix}-${machine_id}${fabricPart}-${datePart}-${shift}-M${seq}`;
        await client.query(
          `INSERT INTO rolls (roll_id, machine_id, fabric_type, shift, actual_weight_kg,
                              status, warehouse_status, quarantine_status, source,
                              created_at, closed_at, operator_id, fabric_item_id)
           VALUES ($1,$2,$3,$4,$5,'CLOSED','IN_STOCK','NONE','MANUAL',$6::timestamp,$6::timestamp,$7,$8)`,
          [roll_id, machine_id, fabricType, shift, Number(r.weight_kg), stamp, by || null, ctx.fabric_item_id]);
        created.push({ roll_id, weight_kg: Number(r.weight_kg) });
      }
      await client.query('COMMIT');
      const total = Math.round(created.reduce((s, r) => s + r.weight_kg, 0) * 100) / 100;
      return { ok: true, machine_id, shift, date: day, rolls: created.length, total_kg: total, created };
    } catch (e) {
      await client.query('ROLLBACK');
      return { code: 500, error: e.message };
    } finally {
      client.release();
    }
  }

  // Recent manual entries, newest first.
  async function recent({ limit = 100 } = {}) {
    return (await pool.query(
      `SELECT roll_id, machine_id, fabric_type, shift, actual_weight_kg AS weight_kg, closed_at
         FROM rolls WHERE source='MANUAL'
        ORDER BY closed_at DESC NULLS LAST LIMIT $1`, [limit])).rows;
  }

  return { create, recent };
};
