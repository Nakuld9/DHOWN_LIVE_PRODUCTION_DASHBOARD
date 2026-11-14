// Push daily production into Busy, shift by shift.
//
// Busy is the book of accounts and holds the aggregate produced quantity; the
// MES keeps the roll detail. So this exports one line per (date, shift, fabric),
// but tracks what has been sent at the ROLL level — because the one failure that
// matters is the same production reaching Busy twice, which double-stocks the
// ledger and is invisible until a stock-take.
//
// "Produced" means a roll that has been CLOSED (physically exists and is
// weighed). Its production date is the close date; its shift is the roll's
// shift. Weight is the actual weighed weight, never the target.

const q3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

module.exports = (pool) => {

  // Rolls that count as produced. Excludes cancelled and test machines, and any
  // roll already pushed to Busy.
  const PRODUCED_UNSENT = `
    SELECT r.roll_id,
           COALESCE(r.closed_at::date, r.created_at::date) AS production_date,
           COALESCE(r.shift, '?') AS shift,
           COALESCE(NULLIF(TRIM(r.fabric_type), ''), 'Unspecified') AS fabric_type,
           COALESCE(r.actual_weight_kg, r.roll_weight_kg, r.weight_kg, 0) AS weight_kg
      FROM rolls r
     WHERE r.closed_at IS NOT NULL
       AND COALESCE(r.status, '') <> 'CANCELLED'
       AND r.machine_id NOT LIKE 'ZZ%'
       AND NOT EXISTS (SELECT 1 FROM busy_production_export_rolls e WHERE e.roll_id = r.roll_id)
       AND ($1::date IS NULL OR COALESCE(r.closed_at::date, r.created_at::date) >= $1::date)
       AND ($2::date IS NULL OR COALESCE(r.closed_at::date, r.created_at::date) <= $2::date)`;

  // What WOULD be exported: produced rolls not yet sent, grouped into the shift
  // lines Busy will receive. Read-only — this is the preview before committing.
  async function preview({ from = null, to = null } = {}) {
    const lines = (await pool.query(
      `SELECT production_date, shift, fabric_type,
              COUNT(*)::int AS roll_count,
              SUM(weight_kg) AS total_kg,
              ARRAY_AGG(roll_id ORDER BY roll_id) AS roll_ids
         FROM (${PRODUCED_UNSENT}) p
        GROUP BY production_date, shift, fabric_type
        ORDER BY production_date, shift, fabric_type`, [from, to])).rows
      .map(r => ({ ...r, total_kg: q3(r.total_kg), roll_count: Number(r.roll_count) }));

    return {
      period: { from, to },
      lines,
      total_rolls: lines.reduce((s, l) => s + l.roll_count, 0),
      total_kg: q3(lines.reduce((s, l) => s + l.total_kg, 0)),
      shifts: new Set(lines.map(l => `${l.production_date}|${l.shift}`)).size,
    };
  }

  // Commit an export: claim the unsent rolls into a batch (so they can never be
  // sent again) and return the aggregated lines for the CSV. Atomic — the claim
  // and the aggregation see the same rows, so nothing is exported without being
  // recorded and nothing is recorded without being exported.
  async function generate({ from = null, to = null, by } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the candidate rolls so two concurrent exports cannot both claim
      // the same production.
      const rolls = (await client.query(
        `${PRODUCED_UNSENT} FOR UPDATE OF r`, [from, to])).rows;

      if (!rolls.length) {
        await client.query('ROLLBACK');
        return { ok: true, empty: true, message: 'No new production to export in this period.' };
      }

      // Aggregate in memory (the rows are already locked and small per run).
      const byLine = new Map();
      for (const r of rolls) {
        const key = `${r.production_date}|${r.shift}|${r.fabric_type}`;
        const cur = byLine.get(key) || {
          production_date: r.production_date, shift: r.shift, fabric_type: r.fabric_type,
          roll_count: 0, total_kg: 0, roll_ids: [],
        };
        cur.roll_count += 1;
        cur.total_kg += Number(r.weight_kg) || 0;
        cur.roll_ids.push(r.roll_id);
        byLine.set(key, cur);
      }
      const lines = [...byLine.values()].map(l => ({ ...l, total_kg: q3(l.total_kg) }))
        .sort((a, b) => `${a.production_date}${a.shift}${a.fabric_type}`.localeCompare(`${b.production_date}${b.shift}${b.fabric_type}`));

      const totalKg = q3(rolls.reduce((s, r) => s + (Number(r.weight_kg) || 0), 0));

      const batch = (await client.query(
        `INSERT INTO busy_production_batches (from_date, to_date, roll_count, total_kg, line_count, generated_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [from, to, rolls.length, totalKg, lines.length, by || null])).rows[0];

      // Record every roll as sent, in this batch. The PK on roll_id is the
      // idempotency guarantee — a second attempt to claim the same roll fails.
      for (const r of rolls) {
        await client.query(
          `INSERT INTO busy_production_export_rolls
             (roll_id, batch_id, production_date, shift, fabric_type, weight_kg)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [r.roll_id, batch.batch_id, r.production_date, r.shift, r.fabric_type, r.weight_kg]);
      }

      await client.query('COMMIT');
      return { ok: true, batch_id: batch.batch_id, batch, lines,
               total_rolls: rolls.length, total_kg: totalKg };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // The CSV Busy imports. One row per shift line. Roll ids travel in a reference
  // column so Busy carries the traceability even though it holds the aggregate.
  // Column names follow the existing GRN/dispatch exports' style; the exact Busy
  // import template maps onto these in Busy's own import mapping.
  function toCsv(lines, batchId) {
    const header = 'Date,Shift,Item,Qty (kg),Rolls,Batch Ref,Roll IDs,Narration';
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = lines.map(l => [
      l.production_date, l.shift, esc(l.fabric_type), l.total_kg, l.roll_count,
      `MES-PROD-${batchId}`, esc(l.roll_ids.join('; ')),
      esc(`Production ${l.shift} shift ${l.production_date} — ${l.roll_count} rolls, ${l.total_kg} kg`),
    ].join(','));
    return [header, ...rows].join('\n');
  }

  async function history({ limit = 100 } = {}) {
    return (await pool.query(
      `SELECT b.*,
              (SELECT COUNT(*)::int FROM busy_production_export_rolls e WHERE e.batch_id = b.batch_id) AS rolls_now
         FROM busy_production_batches b
        ORDER BY b.generated_at DESC LIMIT $1`, [limit])).rows;
  }

  async function getBatch(id) {
    const b = (await pool.query(`SELECT * FROM busy_production_batches WHERE batch_id=$1`, [id])).rows[0];
    if (!b) return null;
    const lines = (await pool.query(
      `SELECT production_date, shift, fabric_type,
              COUNT(*)::int AS roll_count, SUM(weight_kg) AS total_kg,
              ARRAY_AGG(roll_id ORDER BY roll_id) AS roll_ids
         FROM busy_production_export_rolls WHERE batch_id=$1
        GROUP BY production_date, shift, fabric_type
        ORDER BY production_date, shift, fabric_type`, [id])).rows
      .map(r => ({ ...r, total_kg: q3(r.total_kg), roll_count: Number(r.roll_count) }));
    return { batch: b, lines };
  }

  // Confirm a batch was accepted by Busy (optionally with the Busy voucher ref).
  async function confirm(id, { by, busy_ref } = {}) {
    const r = await pool.query(
      `UPDATE busy_production_batches
          SET status='CONFIRMED', confirmed_by=$2, confirmed_at=NOW(), busy_ref=$3
        WHERE batch_id=$1 AND status='EXPORTED' RETURNING *`,
      [id, by || null, busy_ref || null]);
    if (!r.rows.length) return { error: 'Batch not found, or not in EXPORTED state', code: 404 };
    return { ok: true, batch: r.rows[0] };
  }

  // Void a batch — the Busy import failed, so release its rolls to be re-sent.
  // Deletes the roll claims (freeing them) and marks the batch VOIDED for the
  // record. It must never be applied to a CONFIRMED batch, or the same
  // production could be pushed to Busy twice.
  async function voidBatch(id, { by, reason } = {}) {
    const b = (await pool.query(`SELECT status FROM busy_production_batches WHERE batch_id=$1`, [id])).rows[0];
    if (!b) return { error: 'Batch not found', code: 404 };
    if (b.status === 'CONFIRMED') {
      return { error: 'This batch is confirmed as imported into Busy. Voiding it would let the same production be pushed twice — reverse it in Busy instead.', code: 409 };
    }
    if (b.status === 'VOIDED') return { error: 'Batch is already voided', code: 409 };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const freed = await client.query(`DELETE FROM busy_production_export_rolls WHERE batch_id=$1`, [id]);
      await client.query(
        `UPDATE busy_production_batches SET status='VOIDED', note=$2 WHERE batch_id=$1`,
        [id, reason || `Voided by ${by || 'unknown'}`]);
      await client.query('COMMIT');
      return { ok: true, released_rolls: freed.rowCount };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  return { preview, generate, toCsv, history, getBatch, confirm, voidBatch };
};
