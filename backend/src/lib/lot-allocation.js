// Roll-level allocation with shade continuity, plus quarantine and rework.
//
// The commercial problem this solves: two rolls of the same colour from
// different dye batches do not match. Panels cut from both land in one garment,
// the customer sends the consignment back, and the cost is the whole order plus
// the relationship. Allocating "500 kg of white single jersey" is therefore not
// enough — allocation has to name rolls and know which dye lot each came from.
//
// The rules, in priority order:
//   1. A repeat customer gets the lot they had last time, if it can still cover
//      the order. Continuity across orders matters as much as within one.
//   2. Otherwise the whole quantity comes from ONE lot. Among lots that can
//      cover it, the oldest is used, so stock ages out instead of accumulating.
//   3. Only if no single lot can cover it does the order split — across the
//      fewest lots possible, and flagged as a shade risk that a human approves.
//
// Quarantined, rework and scrap rolls are never allocated, and neither is a roll
// already committed to another live allocation.

const obs = require('./observability');

const q3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

const QUARANTINE_STATES = ['NONE', 'QUARANTINED', 'REWORK', 'SCRAP'];

// Grades that may be sold as first quality. B and C exist and are sold, but never
// by picking them up automatically — that is a deliberate, priced decision.
const DEFAULT_GRADES = ['A'];

// Roll states that represent finished, sellable stock in our warehouse.
const SELLABLE_STATES = ['FINISHED', 'DYED'];

module.exports = (pool, { approvals } = {}) => {

  // Everything that could be allocated right now, grouped by dye lot.
  //
  // "Available" means: finished, right grade, not quarantined, and not already
  // committed to a live allocation. A roll missing any of those is invisible
  // here, which is the point — availability that includes unshippable rolls is
  // worse than no number at all.
  async function availableLots({ fabric_type, color_name, gsm, grades, db = pool } = {}) {
    const g = Array.isArray(grades) && grades.length ? grades : DEFAULT_GRADES;
    const r = await db.query(
      // The dye batch is reached through batch_rolls, NOT through rolls.lot_id —
      // that column is the *yarn* lot the roll was knitted from, which is a
      // different thing entirely. Shade is set by the dye batch, so that is what
      // continuity has to be measured on.
      `SELECT b.batch_id, b.batch_number, b.color_name, b.color_code, b.fabric_type,
              MIN(r.created_at)               AS lot_created_at,
              COUNT(*)::int                   AS roll_count,
              SUM(COALESCE(r.actual_weight_kg, r.roll_weight_kg, r.weight_kg, 0)) AS available_kg
         FROM rolls r
         JOIN batch_rolls br ON br.roll_id = r.roll_id
         JOIN batches b      ON b.batch_id = br.batch_id
        WHERE r.warehouse_status = ANY($1)
          AND COALESCE(r.quality_grade,'A') = ANY($2)
          AND COALESCE(r.quarantine_status,'NONE') = 'NONE'
          AND NOT EXISTS (SELECT 1 FROM lot_allocation_rolls lar
                           WHERE lar.roll_id = r.roll_id AND lar.released_at IS NULL)
          AND ($3::text IS NULL OR COALESCE(b.fabric_type, r.fabric_type) ILIKE $3)
          AND ($4::text IS NULL OR b.color_name ILIKE $4)
        GROUP BY b.batch_id, b.batch_number, b.color_name, b.color_code, b.fabric_type
        ORDER BY MIN(r.created_at)`,
      [SELLABLE_STATES, g, fabric_type || null, color_name || null]);

    return r.rows.map(x => ({
      batch_id: x.batch_id, batch_number: x.batch_number,
      fabric_type: x.fabric_type, color_name: x.color_name, color_code: x.color_code,
      roll_count: x.roll_count, available_kg: q3(x.available_kg),
      lot_created_at: x.lot_created_at,
    }));
  }

  // The dye lot this customer last received for this fabric and colour.
  async function lastLotFor(partnerId, { fabric_type, color_name, db = pool }) {
    if (!partnerId) return null;
    const r = await db.query(
      `SELECT lar.batch_id, MAX(la.created_at) AS last_used
         FROM lot_allocations la
         JOIN lot_allocation_rolls lar ON lar.allocation_id = la.allocation_id
        WHERE la.partner_id = $1
          AND ($2::text IS NULL OR la.fabric_type ILIKE $2)
          AND ($3::text IS NULL OR la.color_name  ILIKE $3)
          AND lar.batch_id IS NOT NULL
        GROUP BY lar.batch_id
        ORDER BY MAX(la.created_at) DESC
        LIMIT 1`, [partnerId, fabric_type || null, color_name || null]);
    return r.rows.length ? r.rows[0].batch_id : null;
  }

  // Work out which lots to draw from, without committing anything.
  //
  // Returned as a plan so it can be shown to whoever is deciding before rolls are
  // locked — particularly when the answer carries a shade risk.
  // db lets a caller that already holds a transaction client reuse it. Without
  // this, commit() held one connection and then asked the pool for three more —
  // at concurrency equal to the pool size that deadlocks the entire application.
  async function plan({ partner_id, fabric_type, color_name, gsm, quantity_kg,
                        grades, allow_split = true, tolerance_pct = 5, db = pool }) {
    const want = q3(quantity_kg);
    if (!(want > 0)) return { error: 'A positive quantity is required', code: 400 };

    const lots = await availableLots({ fabric_type, color_name, gsm, grades, db });
    const total = q3(lots.reduce((s, l) => s + l.available_kg, 0));
    if (!lots.length) {
      return { ok: false, reason: 'NO_STOCK', requested: want, available: 0,
               note: 'No finished, unquarantined, unallocated stock matches.' };
    }

    // A short pick within tolerance is normal in fabric — rolls do not come in
    // exact weights. Beyond it, the order genuinely cannot be met.
    const floor = q3(want * (1 - (Number(tolerance_pct) || 0) / 100));
    if (total < floor) {
      return { ok: false, reason: 'INSUFFICIENT', requested: want, available: total,
               shortfall: q3(want - total),
               note: `Only ${total} kg available against ${want} kg requested.` };
    }

    // Rule 1 — continuity for a repeat customer.
    const preferred = await lastLotFor(partner_id, { fabric_type, color_name, db });
    const covers = (l) => l.available_kg >= floor;

    let chosen = null, basis = null;
    const preferredLot = preferred ? lots.find(l => l.batch_id === preferred) : null;
    if (preferredLot && covers(preferredLot)) {
      chosen = [preferredLot];
      basis = 'REPEAT_LOT';
    } else {
      // Rule 2 — single lot, oldest that can cover it.
      const single = lots.filter(covers)[0];
      if (single) { chosen = [single]; basis = 'SINGLE_LOT'; }
    }

    if (!chosen) {
      if (!allow_split) {
        return { ok: false, reason: 'NO_SINGLE_LOT', requested: want, available: total,
                 largest_lot_kg: q3(Math.max(...lots.map(l => l.available_kg))),
                 note: 'No single dye lot can cover this quantity, and splitting was not permitted.' };
      }
      // Rule 3 — fewest lots. Taking the largest lots first minimises how many
      // shades end up in the consignment, which is the thing being minimised
      // here; ageing is a secondary concern once continuity is already lost.
      chosen = [];
      let need = floor;
      for (const l of [...lots].sort((a, b) => b.available_kg - a.available_kg)) {
        if (need <= 0) break;
        chosen.push(l);
        need = q3(need - l.available_kg);
      }
      basis = 'SPLIT';
    }

    // Pick actual rolls, oldest first inside each lot, stopping once the
    // requested weight is met. Rolls are whole units — the last one usually
    // takes the pick slightly over rather than under.
    const picked = [];
    let got = 0;
    for (const lot of chosen) {
      if (got >= want) break;
      const rolls = (await db.query(
        `SELECT r.roll_id, br.batch_id,
                COALESCE(r.actual_weight_kg, r.roll_weight_kg, r.weight_kg, 0) AS weight_kg,
                r.quality_grade, r.created_at
           FROM rolls r
           JOIN batch_rolls br ON br.roll_id = r.roll_id
          WHERE br.batch_id = $1
            AND r.warehouse_status = ANY($2)
            AND COALESCE(r.quality_grade,'A') = ANY($3)
            AND COALESCE(r.quarantine_status,'NONE') = 'NONE'
            AND NOT EXISTS (SELECT 1 FROM lot_allocation_rolls lar
                             WHERE lar.roll_id = r.roll_id AND lar.released_at IS NULL)
          ORDER BY r.created_at, r.roll_id`,
        [lot.batch_id, SELLABLE_STATES,
         Array.isArray(grades) && grades.length ? grades : DEFAULT_GRADES])).rows;

      for (const roll of rolls) {
        if (got >= want) break;
        picked.push({ roll_id: roll.roll_id, batch_id: lot.batch_id,
                      batch_number: lot.batch_number,
                      weight_kg: q3(roll.weight_kg), grade: roll.quality_grade });
        got = q3(got + Number(roll.weight_kg));
      }
    }

    const lotIds = [...new Set(picked.map(p => p.batch_id))];
    const shadeRisk = lotIds.length > 1;

    return {
      ok: true, basis, shade_risk: shadeRisk,
      requested: want, allocated: q3(got),
      variance_pct: q3(((got - want) / want) * 100),
      lots: lotIds.map(id => {
        const l = chosen.find(c => c.batch_id === id) || {};
        const mine = picked.filter(p => p.batch_id === id);
        return { batch_id: id, batch_number: l.batch_number,
                 rolls: mine.length, kg: q3(mine.reduce((s, m) => s + m.weight_kg, 0)) };
      }),
      rolls: picked,
      note: shadeRisk
        ? `This pick spans ${lotIds.length} dye lots. Shades will not match between them — needs approval before dispatch.`
        : basis === 'REPEAT_LOT'
          ? 'Same dye lot this customer received last time.'
          : 'Single dye lot.',
    };
  }

  // Commit a plan. Re-picks under a lock rather than trusting the plan's roll
  // list, because anything could have been allocated in between — a plan shown
  // on screen is a proposal, not a claim.
  async function commit({ ref_type, ref_id, partner_id, fabric_type, color_name, gsm,
                          quantity_kg, grades, allow_split = true, tolerance_pct = 5,
                          notes, created_by }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialise allocation for this fabric+colour so two operators cannot pick
      // the same rolls. Without this the unique index catches it, but as an
      // error rather than a correct second answer.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`alloc:${String(fabric_type || '')}|${String(color_name || '')}`]);

      const p = await plan({ partner_id, fabric_type, color_name, gsm, quantity_kg,
                             grades, allow_split, tolerance_pct, db: client });
      if (!p.ok) { await client.query('ROLLBACK'); return p; }

      const hdr = await client.query(
        `INSERT INTO lot_allocations (ref_type, ref_id, partner_id, fabric_type, color_name, gsm,
                                      requested_kg, allocated_kg, lot_count, shade_risk, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [String(ref_type || 'MANUAL'), ref_id ? String(ref_id) : null, partner_id || null,
         fabric_type || null, color_name || null, gsm || null,
         q3(quantity_kg), p.allocated, p.lots.length, p.shade_risk, notes || null, created_by || null]);
      const allocId = hdr.rows[0].allocation_id;

      for (const roll of p.rolls) {
        await client.query(
          `INSERT INTO lot_allocation_rolls (allocation_id, roll_id, batch_id, weight_kg)
           VALUES ($1,$2,$3,$4)`, [allocId, roll.roll_id, roll.batch_id, roll.weight_kg]);
      }

      // A multi-lot pick is a commercial decision. Raise it as an approval so it
      // is visible and someone owns it, rather than being discovered on delivery.
      let approval = null;
      if (p.shade_risk && approvals) {
        approval = await approvals.request({
          docType: 'ORDER', docId: `ALLOC-${allocId}`, reason: 'SHADE_SPLIT',
          detail: `${p.lots.length} dye lots for ${q3(quantity_kg)} kg of ${color_name || ''} ${fabric_type || ''}`.trim(),
          value: 0, requestedBy: created_by,
        });
      }

      await client.query('COMMIT');
      obs.inc('lot_allocations_total');
      if (p.shade_risk) obs.inc('lot_allocations_shade_risk_total');

      return { ok: true, allocation_id: allocId, ...p, approval };
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') {
        return { error: 'Some of those rolls were allocated by someone else — try again', code: 409 };
      }
      throw e;
    } finally { client.release(); }
  }

  async function get(allocationId) {
    const h = await pool.query(
      `SELECT la.*, p.company_name FROM lot_allocations la
         LEFT JOIN partners p ON p.partner_id = la.partner_id
        WHERE la.allocation_id = $1`, [allocationId]);
    if (!h.rows.length) return null;
    const rolls = await pool.query(
      `SELECT lar.*, b.batch_number, r.quality_grade, r.warehouse_status
         FROM lot_allocation_rolls lar
         LEFT JOIN batches b ON b.batch_id = lar.batch_id
         LEFT JOIN rolls r   ON r.roll_id  = lar.roll_id
        WHERE lar.allocation_id = $1 ORDER BY lar.batch_id, lar.roll_id`, [allocationId]);
    return { ...h.rows[0], rolls: rolls.rows };
  }

  async function list({ partner_id, ref_type, ref_id, status, limit = 100 } = {}) {
    const r = await pool.query(
      `SELECT la.*, p.company_name FROM lot_allocations la
         LEFT JOIN partners p ON p.partner_id = la.partner_id
        WHERE ($1::int  IS NULL OR la.partner_id = $1)
          AND ($2::text IS NULL OR la.ref_type   = $2)
          AND ($3::text IS NULL OR la.ref_id     = $3)
          AND ($4::text IS NULL OR la.status     = $4)
        ORDER BY la.created_at DESC LIMIT $5`,
      [partner_id || null, ref_type || null, ref_id || null, status || null, limit]);
    return r.rows;
  }

  // Approving the shade split. Separate from the allocation itself so the rolls
  // are held while the decision is being made rather than after it.
  async function approveShade(allocationId, { by, note } = {}) {
    const a = (await pool.query(`SELECT * FROM lot_allocations WHERE allocation_id=$1`, [allocationId])).rows[0];
    if (!a) return { error: 'Allocation not found', code: 404 };
    if (!a.shade_risk) return { error: 'This allocation is from a single lot — nothing to approve', code: 400 };
    if (a.shade_approved_at) return { error: 'Already approved', code: 409 };
    const r = await pool.query(
      `UPDATE lot_allocations SET shade_approved_by=$2, shade_approved_at=NOW(),
              notes = COALESCE(notes,'') || ' [shade split approved: ' || COALESCE($3,'no note') || ']'
        WHERE allocation_id=$1 RETURNING *`, [allocationId, by || null, note || null]);
    return { ok: true, allocation: r.rows[0] };
  }

  // Release the rolls back to available stock.
  async function release(allocationId, { by, reason } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const a = (await client.query(
        `SELECT * FROM lot_allocations WHERE allocation_id=$1 FOR UPDATE`, [allocationId])).rows[0];
      if (!a) { await client.query('ROLLBACK'); return { error: 'Allocation not found', code: 404 }; }
      if (a.status !== 'ACTIVE') { await client.query('ROLLBACK'); return { error: `Allocation is already ${a.status}`, code: 409 }; }

      await client.query(
        `UPDATE lot_allocation_rolls SET released_at=NOW() WHERE allocation_id=$1 AND released_at IS NULL`,
        [allocationId]);
      await client.query(
        `UPDATE lot_allocations SET status='RELEASED', released_at=NOW(), released_by=$2,
                notes = COALESCE(notes,'') || ' [released: ' || COALESCE($3,'no reason') || ']'
          WHERE allocation_id=$1`, [allocationId, by || null, reason || null]);

      await client.query('COMMIT');
      return { ok: true, allocation_id: allocationId };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }
  }

  // Consume: the goods have shipped. The rolls stay tied to the allocation as
  // the shade record for this customer, and are not returned to stock.
  async function consume(allocationId, { by } = {}) {
    const a = (await pool.query(`SELECT * FROM lot_allocations WHERE allocation_id=$1`, [allocationId])).rows[0];
    if (!a) return { error: 'Allocation not found', code: 404 };
    if (a.status !== 'ACTIVE') return { error: `Allocation is already ${a.status}`, code: 409 };
    if (a.shade_risk && !a.shade_approved_at) {
      return { error: 'This allocation spans multiple dye lots and has not been approved', code: 409 };
    }
    await pool.query(
      `UPDATE rolls SET warehouse_status='DISPATCHED'
        WHERE roll_id IN (SELECT roll_id FROM lot_allocation_rolls WHERE allocation_id=$1)`,
      [allocationId]);
    const r = await pool.query(
      `UPDATE lot_allocations SET status='CONSUMED' WHERE allocation_id=$1 RETURNING *`, [allocationId]);
    return { ok: true, allocation: r.rows[0] };
  }

  // ── Quarantine and rework ─────────────────────────────────────────────────
  //
  // Quarantining a roll that is already committed to an allocation releases it
  // from that allocation. Leaving it committed would mean an order silently
  // short-ships on the day it is picked.
  async function setQuarantine(rollId, status, { reason, defect_type, by } = {}) {
    const to = String(status || '').toUpperCase();
    if (!QUARANTINE_STATES.includes(to)) {
      return { error: `Status must be one of ${QUARANTINE_STATES.join(', ')}`, code: 400 };
    }
    if (to !== 'NONE' && !reason) return { error: 'A reason is required', code: 400 };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const roll = (await client.query(
        `SELECT roll_id, quarantine_status FROM rolls WHERE roll_id=$1 FOR UPDATE`, [rollId])).rows[0];
      if (!roll) { await client.query('ROLLBACK'); return { error: 'Roll not found', code: 404 }; }

      const from = roll.quarantine_status || 'NONE';
      if (from === to) { await client.query('ROLLBACK'); return { error: `Roll is already ${to}`, code: 409 }; }

      await client.query(
        // $2 is both assigned and compared, so its type has to be stated —
        // Postgres cannot deduce one type from the two uses.
        `UPDATE rolls SET quarantine_status=$2::varchar, quarantine_reason=$3,
                quarantined_at = CASE WHEN $2::varchar = 'NONE' THEN NULL ELSE NOW() END,
                quarantined_by = CASE WHEN $2::varchar = 'NONE' THEN NULL ELSE $4 END
          WHERE roll_id=$1`, [rollId, to, to === 'NONE' ? null : reason, by || null]);

      await client.query(
        `INSERT INTO roll_quarantine_log (roll_id, from_status, to_status, reason, defect_type, changed_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [rollId, from, to, reason || null, defect_type || null, by || null]);

      let freed = [];
      if (to !== 'NONE') {
        const r = await client.query(
          `UPDATE lot_allocation_rolls SET released_at=NOW()
            WHERE roll_id=$1 AND released_at IS NULL RETURNING allocation_id`, [rollId]);
        freed = r.rows.map(x => x.allocation_id);

        // The allocation is now short. Say so on the record rather than letting
        // it be found at the loading bay.
        for (const id of freed) {
          await client.query(
            `UPDATE lot_allocations
                SET allocated_kg = COALESCE((SELECT SUM(weight_kg) FROM lot_allocation_rolls
                                              WHERE allocation_id=$1 AND released_at IS NULL),0),
                    notes = COALESCE(notes,'') || ' [roll ' || $2 || ' ' || $3 || ' — allocation is short]'
              WHERE allocation_id=$1`, [id, String(rollId), to]);
        }
      }

      await client.query('COMMIT');
      obs.inc('roll_quarantine_changes_total');
      return { ok: true, roll_id: String(rollId), from, to,
               allocations_affected: freed };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }
  }

  async function quarantineList({ status, limit = 200 } = {}) {
    const r = await pool.query(
      `SELECT r.roll_id, r.fabric_type, r.quality_grade, r.warehouse_status,
              r.quarantine_status, r.quarantine_reason, r.quarantined_at, r.quarantined_by,
              COALESCE(r.actual_weight_kg, r.roll_weight_kg, r.weight_kg, 0) AS weight_kg,
              b.batch_number, b.color_name
         FROM rolls r
         LEFT JOIN batch_rolls br ON br.roll_id = r.roll_id
         LEFT JOIN batches b      ON b.batch_id = br.batch_id
        WHERE COALESCE(r.quarantine_status,'NONE') <> 'NONE'
          AND ($1::text IS NULL OR r.quarantine_status = $1)
        ORDER BY r.quarantined_at DESC LIMIT $2`, [status || null, limit]);
    return r.rows.map(x => ({ ...x, weight_kg: q3(x.weight_kg) }));
  }

  async function quarantineHistory(rollId) {
    const r = await pool.query(
      `SELECT * FROM roll_quarantine_log WHERE roll_id=$1 ORDER BY changed_at`, [rollId]);
    return r.rows;
  }

  return {
    availableLots, lastLotFor, plan, commit, get, list, approveShade, release, consume,
    setQuarantine, quarantineList, quarantineHistory,
    QUARANTINE_STATES, SELLABLE_STATES,
  };
};
