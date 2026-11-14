// Stock reservations and available-to-promise (HIGH-02).
//
// Before this, availability was a live SUM over finished_goods. Two salespeople
// quoting the same lot both saw it free, and the mill oversold — which in a
// make-to-order textile business means a missed delivery, an emergency dye lot,
// or a lost customer.
//
//   SOFT  quoted, not committed. Expires with the quote so abandoned quotes do
//         not sterilise stock forever.
//   HARD  confirmed order. Held until dispatch consumes it.
//
//   ATP = physical − hard − unexpired soft
//
// The reservation is against fabric + shade rather than a specific roll: the
// floor picks the actual rolls at dispatch, and pinning rolls this early would
// fight how the mill really works.

const obs = require('./observability');

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const norm = (s) => String(s || '').trim().toLowerCase();

module.exports = (pool) => {

  // Physical stock and active holds for one fabric/shade.
  async function atp({ fabric_type, color_name } = {}) {
    const [phys, held] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(weight_kg),0) AS physical,
                COALESCE(SUM(weight_kg) FILTER (WHERE status IN ('AVAILABLE','IN_STOCK')),0) AS sellable
           FROM finished_goods
          WHERE ($1 = '' OR LOWER(fabric_type) = $1)
            AND ($2 = '' OR LOWER(COALESCE(color_name,'')) = $2)`,
        [norm(fabric_type), norm(color_name)]),
      pool.query(
        `SELECT COALESCE(SUM(quantity_kg) FILTER (WHERE hold_type='HARD'),0) AS hard,
                COALESCE(SUM(quantity_kg) FILTER (
                  WHERE hold_type='SOFT' AND (expires_at IS NULL OR expires_at > NOW())),0) AS soft
           FROM stock_reservations
          WHERE status='ACTIVE'
            AND ($1 = '' OR LOWER(COALESCE(fabric_type,'')) = $1)
            AND ($2 = '' OR LOWER(COALESCE(color_name,'')) = $2)`,
        [norm(fabric_type), norm(color_name)]),
    ]);

    const sellable = round3(phys.rows[0].sellable);
    const hard = round3(held.rows[0].hard);
    const soft = round3(held.rows[0].soft);
    return {
      fabric_type: fabric_type || null,
      color_name: color_name || null,
      physical_kg: round3(phys.rows[0].physical),
      sellable_kg: sellable,
      hard_hold_kg: hard,
      soft_hold_kg: soft,
      // Never report negative ATP — an over-reserved position is a data problem
      // to surface, not a negative number to propagate into a quote.
      available_to_promise_kg: round3(Math.max(0, sellable - hard - soft)),
      over_reserved: sellable - hard - soft < 0,
    };
  }

  // Take a hold. Refuses rather than allowing a negative position, so the
  // guarantee actually holds under concurrency.
  async function reserve({ fabric_type, color_name, gsm, quantity_kg, hold_type = 'SOFT',
                           ref_type, ref_id, partner_id, conversation_id, expires_at, created_by, force = false }) {
    const qty = Number(quantity_kg);
    if (!(qty > 0)) return { error: 'quantity_kg must be positive', code: 400 };
    const kind = hold_type === 'HARD' ? 'HARD' : 'SOFT';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialise reservations for this fabric/shade so two concurrent quotes
      // cannot both pass the availability check.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`res:${norm(fabric_type)}:${norm(color_name)}`]);

      const a = await atp({ fabric_type, color_name });
      if (!force && qty > a.available_to_promise_kg) {
        await client.query('ROLLBACK');
        return {
          error: `Only ${a.available_to_promise_kg} kg available to promise (${a.sellable_kg} in stock, ${a.hard_hold_kg} on confirmed orders, ${a.soft_hold_kg} quoted).`,
          code: 409, atp: a,
        };
      }

      const r = await client.query(
        `INSERT INTO stock_reservations
           (fabric_type,color_name,gsm,quantity_kg,hold_type,ref_type,ref_id,partner_id,conversation_id,expires_at,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [fabric_type || null, color_name || null, gsm || null, qty, kind,
         ref_type || null, ref_id ? String(ref_id) : null, partner_id || null,
         conversation_id || null, expires_at || null, created_by || null]);
      await client.query('COMMIT');

      obs.inc('stock_reserved_total', { type: kind });
      return { reservation: r.rows[0], atp: await atp({ fabric_type, color_name }) };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }
  }

  async function release(reservationId, { by, reason } = {}) {
    const r = await pool.query(
      `UPDATE stock_reservations
          SET status='RELEASED', released_by=$2, released_at=NOW(), release_reason=$3
        WHERE reservation_id=$1 AND status='ACTIVE' RETURNING *`,
      [reservationId, by || null, reason || null]);
    if (!r.rows.length) return { error: 'Reservation not found or already closed', code: 404 };
    obs.inc('stock_released_total');
    return { ok: true, reservation: r.rows[0] };
  }

  // Release every active hold for a document — quote rejected, order cancelled.
  async function releaseFor(refType, refId, { by, reason } = {}) {
    const r = await pool.query(
      `UPDATE stock_reservations
          SET status='RELEASED', released_by=$3, released_at=NOW(), release_reason=$4
        WHERE ref_type=$1 AND ref_id=$2 AND status='ACTIVE' RETURNING reservation_id`,
      [refType, String(refId), by || null, reason || null]);
    return r.rows.length;
  }

  // Quote accepted -> the soft hold becomes a firm commitment.
  async function promoteToHard(refType, refId, { newRefType, newRefId, by } = {}) {
    const r = await pool.query(
      `UPDATE stock_reservations
          SET hold_type='HARD', expires_at=NULL,
              ref_type=COALESCE($3, ref_type), ref_id=COALESCE($4, ref_id),
              created_by=COALESCE(created_by,$5)
        WHERE ref_type=$1 AND ref_id=$2 AND status='ACTIVE' AND hold_type='SOFT'
        RETURNING reservation_id`,
      [refType, String(refId), newRefType || null, newRefId ? String(newRefId) : null, by || null]);
    return r.rows.length;
  }

  async function consumeFor(refType, refId, { by } = {}) {
    const r = await pool.query(
      `UPDATE stock_reservations
          SET status='CONSUMED', released_by=$3, released_at=NOW(), release_reason='Dispatched'
        WHERE ref_type=$1 AND ref_id=$2 AND status='ACTIVE' RETURNING reservation_id`,
      [refType, String(refId), by || null]);
    return r.rows.length;
  }

  // Expired soft holds must be swept, or abandoned quotes sterilise stock.
  async function expireSoftHolds() {
    const r = await pool.query(
      `UPDATE stock_reservations
          SET status='RELEASED', released_by='SYSTEM', released_at=NOW(),
              release_reason='Quote validity expired'
        WHERE status='ACTIVE' AND hold_type='SOFT'
          AND expires_at IS NOT NULL AND expires_at < NOW()
        RETURNING reservation_id`);
    if (r.rows.length) obs.log('info', 'stock.softholds.expired', { count: r.rows.length });
    return r.rows.length;
  }

  async function list({ status = 'ACTIVE', ref_type, ref_id } = {}) {
    const r = await pool.query(
      `SELECT sr.*, p.company_name
         FROM stock_reservations sr
         LEFT JOIN partners p ON p.partner_id = sr.partner_id
        WHERE sr.status = $1
          AND ($2::text IS NULL OR sr.ref_type = $2)
          AND ($3::text IS NULL OR sr.ref_id = $3)
        ORDER BY sr.created_at DESC LIMIT 200`,
      [status, ref_type || null, ref_id ? String(ref_id) : null]);
    return r.rows;
  }

  // Everything with stock or holds, for the ATP screen.
  async function overview() {
    const r = await pool.query(
      `WITH fg AS (
         SELECT fabric_type, color_name,
                SUM(weight_kg) AS physical,
                SUM(weight_kg) FILTER (WHERE status IN ('AVAILABLE','IN_STOCK')) AS sellable
           FROM finished_goods GROUP BY fabric_type, color_name),
       res AS (
         SELECT fabric_type, color_name,
                SUM(quantity_kg) FILTER (WHERE hold_type='HARD') AS hard,
                SUM(quantity_kg) FILTER (WHERE hold_type='SOFT'
                  AND (expires_at IS NULL OR expires_at > NOW())) AS soft
           FROM stock_reservations WHERE status='ACTIVE'
          GROUP BY fabric_type, color_name)
       SELECT COALESCE(fg.fabric_type, res.fabric_type) AS fabric_type,
              COALESCE(fg.color_name,  res.color_name)  AS color_name,
              COALESCE(fg.physical,0) AS physical_kg,
              COALESCE(fg.sellable,0) AS sellable_kg,
              COALESCE(res.hard,0)    AS hard_hold_kg,
              COALESCE(res.soft,0)    AS soft_hold_kg,
              GREATEST(0, COALESCE(fg.sellable,0) - COALESCE(res.hard,0) - COALESCE(res.soft,0)) AS atp_kg
         FROM fg FULL OUTER JOIN res
           ON LOWER(fg.fabric_type)=LOWER(res.fabric_type)
          AND LOWER(COALESCE(fg.color_name,''))=LOWER(COALESCE(res.color_name,''))
        ORDER BY 1,2`);
    return r.rows.map(x => ({
      fabric_type: x.fabric_type, color_name: x.color_name,
      physical_kg: round3(x.physical_kg), sellable_kg: round3(x.sellable_kg),
      hard_hold_kg: round3(x.hard_hold_kg), soft_hold_kg: round3(x.soft_hold_kg),
      atp_kg: round3(x.atp_kg),
    }));
  }

  return { atp, reserve, release, releaseFor, promoteToHard, consumeFor, expireSoftHolds, list, overview };
};
