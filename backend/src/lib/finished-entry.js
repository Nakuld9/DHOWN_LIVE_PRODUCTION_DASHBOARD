// Manual finished-goods entry — record dyed/finished fabric received back (from
// the dye house / finisher) when it isn't captured elsewhere. Each roll becomes a
// finished_goods row with its own roll_id, so it counts as finished stock AND shows
// up in the FINISHED inspection worklist for 4-point grading. Companion to manual
// shift-production entry (which handles greige).

module.exports = (pool) => {
  // body: { fabric_type, color_name?, lot_no?, date?, rolls:[{weight_kg}] }
  async function create({ fabric_type, color_name, lot_no, date, rolls }, by) {
    if (!fabric_type) return { code: 400, error: 'fabric_type is required' };
    const list = (Array.isArray(rolls) ? rolls : []).filter(r => Number(r.weight_kg) > 0);
    if (!list.length) return { code: 400, error: 'at least one roll with a weight is required' };

    const day = date || new Date().toISOString().slice(0, 10);
    const stamp = `${day} 12:00:00`;
    const datePart = day.replace(/-/g, '');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const base = Number((await client.query(
        `SELECT COUNT(*) n FROM finished_goods WHERE DATE(created_at)=$1::date AND COALESCE(source,'')='MANUAL'`, [day])).rows[0].n);
      const created = [];
      let i = 0;
      for (const r of list) {
        i += 1;
        const roll_id = `FG-${datePart}-M${String(base + i).padStart(3, '0')}`;
        await client.query(
          `INSERT INTO finished_goods (roll_id, fabric_type, color_name, lot_no, weight_kg, roll_count,
                                       status, source, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,1,'IN_STOCK','MANUAL',$6::timestamp,$6::timestamp)`,
          [roll_id, fabric_type, color_name || null, lot_no || null, Number(r.weight_kg), stamp]);
        created.push({ roll_id, weight_kg: Number(r.weight_kg) });
      }
      await client.query('COMMIT');
      const total = Math.round(created.reduce((s, r) => s + r.weight_kg, 0) * 100) / 100;
      return { ok: true, fabric_type, color_name: color_name || null, date: day, rolls: created.length, total_kg: total, created };
    } catch (e) {
      await client.query('ROLLBACK');
      return { code: 500, error: e.message };
    } finally {
      client.release();
    }
  }

  async function recent({ limit = 100 } = {}) {
    return (await pool.query(
      `SELECT roll_id, fabric_type, color_name, lot_no, weight_kg, created_at
         FROM finished_goods WHERE COALESCE(source,'')='MANUAL'
        ORDER BY created_at DESC NULLS LAST LIMIT $1`, [limit])).rows;
  }

  return { create, recent };
};
