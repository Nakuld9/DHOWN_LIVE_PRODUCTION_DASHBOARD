// Dispatch logistics: transporters, e-way bills and proof of delivery.
//
// This does NOT talk to the NIC e-way bill portal. The number is generated on
// the portal (or by the transporter) and recorded here. What this module owns is
// the part that actually goes wrong in practice: knowing when a bill was
// *required* and missing, and knowing when one has expired while the goods are
// still on the road. Both are seizure-and-penalty risks, and neither is visible
// if the number only exists in someone's WhatsApp.

const obs = require('./observability');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Statutory thresholds on consignment value. ₹50,000 is the central rule for
// inter-state movement. States may set a higher intra-state limit — Punjab, where
// we are, uses ₹1,00,000 — so the two are separate and both are configurable
// rather than hardcoded, because getting this wrong in either direction is
// expensive.
const INTER_STATE_THRESHOLD = Number(process.env.EWAY_INTERSTATE_THRESHOLD || 50000);
const INTRA_STATE_THRESHOLD = Number(process.env.EWAY_INTRASTATE_THRESHOLD || 100000);

// Validity is one day per 200 km of approximate distance, minimum one day.
// Over-dimensional cargo runs at 20 km/day; we do not move any, so the regular
// rate is used and the slower one is left out rather than guessed at.
const KM_PER_DAY = 200;

const validityDays = (distanceKm) => Math.max(1, Math.ceil((Number(distanceKm) || 0) / KM_PER_DAY));

// A vehicle number the portal will accept: state code, RTO digits, optional
// series letters, then up to four digits. Rejecting a malformed one here is
// better than discovering it when the bill is rejected at generation time.
const VEHICLE_RE = /^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{1,4}$/;
const normaliseVehicle = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

module.exports = (pool, { nextInvSeq } = {}) => {

  // ── Transporters ──────────────────────────────────────────────────────────
  async function listTransporters({ activeOnly = true } = {}) {
    const r = await pool.query(
      `SELECT * FROM transporters WHERE ($1::bool IS NOT TRUE OR is_active = TRUE)
        ORDER BY is_active DESC, name`, [activeOnly]);
    return r.rows;
  }

  async function saveTransporter({ transporter_id, name, gstin, transporter_code,
                                   contact_person, mobile, address, is_active, by }) {
    if (!name || !String(name).trim()) return { error: 'Transporter name is required', code: 400 };
    // The portal needs one of the two to identify the transporter at all.
    if (!gstin && !transporter_code) {
      return { error: 'A GSTIN or a 15-character Transporter ID is required', code: 400 };
    }
    if (transporter_id) {
      const r = await pool.query(
        `UPDATE transporters SET name=$2, gstin=$3, transporter_code=$4, contact_person=$5,
                mobile=$6, address=$7, is_active=COALESCE($8, is_active)
          WHERE transporter_id=$1 RETURNING *`,
        [transporter_id, name.trim(), gstin || null, transporter_code || null,
         contact_person || null, mobile || null, address || null,
         is_active === undefined ? null : !!is_active]);
      if (!r.rows.length) return { error: 'Transporter not found', code: 404 };
      return r.rows[0];
    }
    const r = await pool.query(
      `INSERT INTO transporters (name, gstin, transporter_code, contact_person, mobile, address, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name.trim(), gstin || null, transporter_code || null, contact_person || null,
       mobile || null, address || null, by || null]);
    return r.rows[0];
  }

  // ── Is an e-way bill required? ────────────────────────────────────────────
  // Answered from the consignment value and whether the movement crosses a state
  // border. Called before dispatch so the answer arrives while the goods can
  // still be held back, not after the vehicle has left.
  async function requirement({ dispatch_id, invoice_id, value, interstate }) {
    let val = Number(value) || 0;
    let inter = interstate;

    if (invoice_id) {
      const r = await pool.query(
        `SELECT ti.grand_total, ti.supply_type, ti.place_of_supply, ti.customer_state
           FROM tax_invoices ti WHERE ti.invoice_id = $1`, [invoice_id]);
      if (r.rows.length) {
        val = val || Number(r.rows[0].grand_total) || 0;
        // IGST on the invoice means the supply crossed a state border.
        if (inter === undefined) {
          inter = String(r.rows[0].supply_type || '').toUpperCase() === 'INTERSTATE';
        }
      }
    }
    if (!val && dispatch_id) {
      const r = await pool.query(`SELECT grand_total FROM dispatch_challans WHERE dispatch_id=$1`, [dispatch_id]);
      if (r.rows.length) val = Number(r.rows[0].grand_total) || 0;
    }

    const threshold = inter ? INTER_STATE_THRESHOLD : INTRA_STATE_THRESHOLD;
    const required = val > threshold;
    return {
      required, value: r2(val), threshold,
      interstate: !!inter,
      reason: required
        ? `Consignment value ${r2(val)} exceeds the ${inter ? 'inter' : 'intra'}-state threshold of ${threshold}.`
        : `Consignment value ${r2(val)} is within the ${inter ? 'inter' : 'intra'}-state threshold of ${threshold}.`,
    };
  }

  // ── Record a generated e-way bill ─────────────────────────────────────────
  async function recordEway({ eway_no, dispatch_id, invoice_id, partner_id, doc_value,
                              distance_km, transport_mode, transporter_id, vehicle_number,
                              lr_number, generated_at, notes, by }) {
    if (!eway_no || !/^\d{12}$/.test(String(eway_no).trim())) {
      return { error: 'An e-way bill number is 12 digits', code: 400 };
    }
    // Road movement is the only mode where a vehicle number is meaningful, but it
    // is also the only mode we use, so it is required rather than optional.
    const mode = String(transport_mode || 'ROAD').toUpperCase();
    const veh = normaliseVehicle(vehicle_number);
    if (mode === 'ROAD') {
      if (!veh) return { error: 'A vehicle number is required for road movement', code: 400 };
      if (!VEHICLE_RE.test(veh)) return { error: `Vehicle number "${vehicle_number}" is not a valid format`, code: 400 };
    }
    if (!transporter_id && mode === 'ROAD' && !veh) {
      return { error: 'Either a transporter or a vehicle number is required', code: 400 };
    }

    const dist = Math.max(0, Number(distance_km) || 0);
    const gen = generated_at ? new Date(generated_at) : new Date();
    // Validity runs to midnight of the last day, which is how the portal counts
    // it — a bill generated at 23:00 does not expire an hour later.
    const validUntil = new Date(gen);
    validUntil.setDate(validUntil.getDate() + validityDays(dist));
    validUntil.setHours(23, 59, 59, 0);

    try {
      const r = await pool.query(
        `INSERT INTO eway_bills (eway_no, dispatch_id, invoice_id, partner_id, doc_value,
                                 distance_km, transport_mode, transporter_id, vehicle_number,
                                 lr_number, generated_at, valid_until, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [String(eway_no).trim(), dispatch_id || null, invoice_id || null, partner_id || null,
         r2(doc_value), dist, mode, transporter_id || null, veh || null, lr_number || null,
         gen, validUntil, notes || null, by || null]);

      if (dispatch_id) {
        await pool.query(
          `UPDATE dispatch_challans
              SET transporter_id = COALESCE($2, transporter_id),
                  vehicle_number = COALESCE($3, vehicle_number),
                  lr_number      = COALESCE($4, lr_number),
                  transport_mode = COALESCE($5, transport_mode),
                  distance_km    = COALESCE($6, distance_km)
            WHERE dispatch_id = $1`,
          [dispatch_id, transporter_id || null, veh || null, lr_number || null, mode, dist || null]);
      }
      obs.inc('eway_bills_recorded_total');
      return { ...r.rows[0], validity_days: validityDays(dist) };
    } catch (e) {
      if (e.code === '23505') return { error: `E-way bill ${eway_no} is already recorded`, code: 409 };
      throw e;
    }
  }

  // Part-B update: same bill, new vehicle. Breakdowns and transhipment are
  // routine, and the old vehicle number has to stay on record.
  async function updateVehicle(ewayId, { vehicle_number, from_place, reason, by }) {
    const veh = normaliseVehicle(vehicle_number);
    if (!VEHICLE_RE.test(veh)) return { error: `Vehicle number "${vehicle_number}" is not a valid format`, code: 400 };

    const e = (await pool.query(`SELECT * FROM eway_bills WHERE eway_id=$1`, [ewayId])).rows[0];
    if (!e) return { error: 'E-way bill not found', code: 404 };
    if (e.status === 'CANCELLED') return { error: 'This e-way bill is cancelled', code: 409 };
    if (new Date(e.valid_until) < new Date()) {
      return { error: 'This e-way bill has expired; a fresh one is needed', code: 409 };
    }

    await pool.query(
      `INSERT INTO eway_vehicle_updates (eway_id, vehicle_number, from_place, reason, updated_by)
       VALUES ($1,$2,$3,$4,$5)`, [ewayId, veh, from_place || null, reason || null, by || null]);
    const r = await pool.query(
      `UPDATE eway_bills SET vehicle_number=$2 WHERE eway_id=$1 RETURNING *`, [ewayId, veh]);
    return { ok: true, eway: r.rows[0] };
  }

  // The portal only allows cancellation within 24 hours of generation, and not
  // once the consignment has been verified in transit. Enforcing the window here
  // means the record cannot claim a cancellation the portal would have refused.
  async function cancelEway(ewayId, { reason, by } = {}) {
    const e = (await pool.query(`SELECT * FROM eway_bills WHERE eway_id=$1`, [ewayId])).rows[0];
    if (!e) return { error: 'E-way bill not found', code: 404 };
    if (e.status === 'CANCELLED') return { error: 'Already cancelled', code: 409 };

    const hours = (Date.now() - new Date(e.generated_at).getTime()) / 36e5;
    if (hours > 24) {
      return { error: `E-way bills can only be cancelled within 24 hours of generation (this one is ${Math.floor(hours)} hours old).`, code: 409 };
    }
    const r = await pool.query(
      `UPDATE eway_bills SET status='CANCELLED', cancelled_at=NOW(), cancelled_by=$2, cancel_reason=$3
        WHERE eway_id=$1 RETURNING *`, [ewayId, by || null, reason || null]);
    return { ok: true, eway: r.rows[0] };
  }

  async function listEway({ dispatch_id, partner_id, status, limit = 200 } = {}) {
    const r = await pool.query(
      `SELECT e.*, t.name AS transporter_name,
              (e.status = 'ACTIVE' AND e.valid_until < NOW()) AS expired
         FROM eway_bills e
         LEFT JOIN transporters t ON t.transporter_id = e.transporter_id
        WHERE ($1::int IS NULL OR e.dispatch_id = $1)
          AND ($2::int IS NULL OR e.partner_id = $2)
          AND ($3::text IS NULL OR e.status = $3)
        ORDER BY e.generated_at DESC LIMIT $4`,
      [dispatch_id || null, partner_id || null, status || null, limit]);
    return r.rows;
  }

  // The compliance worklist, and the reason this module exists.
  //
  //   * EXPIRED  — goods are moving on a bill that is no longer valid.
  //   * MISSING  — a dispatch over the threshold with no bill recorded at all.
  //
  // Both are penalty exposure, so they are surfaced together rather than left to
  // be noticed.
  async function complianceAlerts() {
    const expired = (await pool.query(
      `SELECT e.eway_id, e.eway_no, e.dispatch_id, e.valid_until, e.vehicle_number,
              d.dispatch_number, d.customer_name,
              EXTRACT(EPOCH FROM (NOW() - e.valid_until))/3600 AS hours_expired
         FROM eway_bills e
         LEFT JOIN dispatch_challans d ON d.dispatch_id = e.dispatch_id
        WHERE e.status = 'ACTIVE' AND e.valid_until < NOW()
          AND COALESCE(d.delivery_status,'PENDING') <> 'DELIVERED'
        ORDER BY e.valid_until`)).rows;

    const missing = (await pool.query(
      `SELECT d.dispatch_id, d.dispatch_number, d.dispatch_date, d.customer_name,
              d.grand_total, d.partner_id
         FROM dispatch_challans d
        WHERE COALESCE(d.grand_total,0) > $1
          AND NOT EXISTS (SELECT 1 FROM eway_bills e
                           WHERE e.dispatch_id = d.dispatch_id AND e.status = 'ACTIVE')
          AND d.dispatch_date >= CURRENT_DATE - INTERVAL '90 days'
        ORDER BY d.dispatch_date DESC`,
      // The lower of the two thresholds, so nothing that might need a bill is
      // filtered out before a human looks at it.
      [Math.min(INTER_STATE_THRESHOLD, INTRA_STATE_THRESHOLD)])).rows;

    return {
      expired: expired.map(x => ({ ...x, hours_expired: Math.floor(Number(x.hours_expired)) })),
      missing: missing.map(x => ({ ...x, grand_total: r2(x.grand_total) })),
      counts: { expired: expired.length, missing: missing.length },
    };
  }

  // ── Proof of delivery ─────────────────────────────────────────────────────
  // One POD per dispatch. Recording it closes the dispatch and stops it being
  // reported as an in-transit compliance risk.
  async function recordPod(dispatchId, { received_by, received_at, condition,
                                         shortage_kg, remarks, photo_file, by }) {
    const d = (await pool.query(`SELECT * FROM dispatch_challans WHERE dispatch_id=$1`, [dispatchId])).rows[0];
    if (!d) return { error: 'Dispatch not found', code: 404 };

    const cond = String(condition || 'OK').toUpperCase();
    if (!['OK', 'SHORT', 'DAMAGED', 'REFUSED'].includes(cond)) {
      return { error: 'Condition must be OK, SHORT, DAMAGED or REFUSED', code: 400 };
    }
    const short = Math.max(0, Number(shortage_kg) || 0);
    if (cond === 'SHORT' && short <= 0) {
      return { error: 'A short delivery needs the shortage quantity recorded', code: 400 };
    }

    const r = await pool.query(
      `INSERT INTO delivery_proofs (dispatch_id, received_by, received_at, condition,
                                    shortage_kg, remarks, photo_file, recorded_by)
       VALUES ($1,$2,COALESCE($3,NOW()),$4,$5,$6,$7,$8)
       ON CONFLICT (dispatch_id) DO UPDATE SET
         received_by = EXCLUDED.received_by, received_at = EXCLUDED.received_at,
         condition   = EXCLUDED.condition,   shortage_kg = EXCLUDED.shortage_kg,
         remarks     = EXCLUDED.remarks,     photo_file  = EXCLUDED.photo_file,
         recorded_by = EXCLUDED.recorded_by
       RETURNING *`,
      [dispatchId, received_by || null, received_at || null, cond, short,
       remarks || null, photo_file || null, by || null]);

    // A refused consignment has not been delivered — it is coming back, and
    // marking it DELIVERED would hide it from the returns worklist.
    const status = cond === 'REFUSED' ? 'REFUSED' : 'DELIVERED';
    await pool.query(`UPDATE dispatch_challans SET delivery_status=$2 WHERE dispatch_id=$1`,
      [dispatchId, status]);

    return { ok: true, pod: r.rows[0], delivery_status: status };
  }

  async function getPod(dispatchId) {
    const r = await pool.query(`SELECT * FROM delivery_proofs WHERE dispatch_id=$1`, [dispatchId]);
    return r.rows[0] || null;
  }

  // Consignments the customer refused, and short/damaged ones, that have not yet
  // been turned into a sales return.
  //
  // Refusing removes a dispatch from the pending list — correctly, the gate is
  // done with it — but the goods are physically coming back and somebody has to
  // act. Without this they would sit in a gap between "not delivered" and "not
  // pending" that no screen shows.
  async function unresolvedDeliveries() {
    const r = await pool.query(
      `SELECT d.dispatch_id, d.dispatch_number, d.dispatch_date, d.customer_name,
              d.partner_id, d.grand_total, d.delivery_status,
              p.condition, p.shortage_kg, p.remarks, p.received_at, p.received_by,
              (CURRENT_DATE - p.received_at::date)::int AS days_since
         FROM dispatch_challans d
         JOIN delivery_proofs p ON p.dispatch_id = d.dispatch_id
        WHERE p.condition IN ('REFUSED','SHORT','DAMAGED')
          AND NOT EXISTS (SELECT 1 FROM sales_returns sr
                           WHERE sr.dispatch_id = d.dispatch_id
                             AND sr.status IN ('DRAFT','APPROVED'))
        ORDER BY p.received_at DESC`);
    return r.rows.map(x => ({ ...x, grand_total: r2(x.grand_total), shortage_kg: Number(x.shortage_kg) }));
  }

  // Dispatches that left but were never confirmed as received.
  async function pendingDeliveries({ olderThanDays = 0 } = {}) {
    const r = await pool.query(
      `SELECT d.dispatch_id, d.dispatch_number, d.dispatch_date, d.customer_name,
              d.partner_id, d.grand_total, d.vehicle_number, t.name AS transporter_name,
              (CURRENT_DATE - d.dispatch_date)::int AS days_out,
              e.eway_no, e.valid_until
         FROM dispatch_challans d
         LEFT JOIN transporters t ON t.transporter_id = d.transporter_id
         LEFT JOIN eway_bills e ON e.dispatch_id = d.dispatch_id AND e.status = 'ACTIVE'
        WHERE COALESCE(d.delivery_status,'PENDING') = 'PENDING'
          AND (CURRENT_DATE - d.dispatch_date) >= $1
        ORDER BY d.dispatch_date`, [Math.max(0, Number(olderThanDays) || 0)]);
    return r.rows;
  }

  return {
    listTransporters, saveTransporter,
    requirement, recordEway, updateVehicle, cancelEway, listEway, complianceAlerts,
    recordPod, getPod, pendingDeliveries, unresolvedDeliveries,
    // exported for tests
    validityDays, normaliseVehicle, VEHICLE_RE,
    thresholds: { interstate: INTER_STATE_THRESHOLD, intrastate: INTRA_STATE_THRESHOLD },
  };
};
