// Unit conversion: kg <-> metres <-> pieces <-> rolls.
//
// The rule that matters here is that this module refuses to guess. A wrong
// conversion does not throw — it produces a plausible number that gets quoted,
// invoiced and shipped, and is discovered when the customer weighs the delivery.
// So every path either has a defensible basis or returns an error explaining
// what is missing.
//
// Bases, in order of preference:
//   1. An explicit per-item factor.
//   2. Derived from the item's own GSM and width, for kg <-> metres. This is
//      real physics, not a fudge: 1 metre weighs width_m * gsm / 1000 kg.
//   3. A global factor, but only for ratios that genuinely do not depend on the
//      fabric.
// If none apply, it is an error.

const r6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;
const q3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

const norm = (u) => String(u || '').trim().toUpperCase();

// Ratios that hold regardless of what is being measured.
const UNIVERSAL = {
  'DOZ|PCS': 12,
  'PCS|DOZ': 1 / 12,
};

module.exports = (pool) => {

  // Fabric attributes needed to derive weight per metre. Finished values win —
  // they describe what actually ships, and greige shrinks during finishing.
  async function fabricSpec(itemId) {
    const r = await pool.query(
      `SELECT COALESCE(fa.finished_gsm, fa.gsm)             AS gsm,
              COALESCE(fa.finished_width_cm, fa.width_cm)   AS width_cm,
              i.item_name
         FROM item_fabric_attrs fa
         JOIN items i ON i.item_id = fa.item_id
        WHERE fa.item_id = $1`, [itemId]);
    if (!r.rows.length) return null;
    const gsm = Number(r.rows[0].gsm) || 0;
    const width = Number(r.rows[0].width_cm) || 0;
    if (!(gsm > 0) || !(width > 0)) return null;
    return { gsm, width_cm: width, item_name: r.rows[0].item_name };
  }

  // Kilograms in one metre of this fabric.
  //   width in metres * grams per square metre / 1000 = kg per metre
  const kgPerMetre = ({ gsm, width_cm }) => r6((width_cm / 100) * gsm / 1000);

  async function explicitFactor(itemId, from, to) {
    const r = await pool.query(
      `SELECT factor, item_id FROM uom_conversions
        WHERE from_uom=$2 AND to_uom=$3
          AND (item_id = $1 OR item_id IS NULL)
        ORDER BY item_id NULLS LAST
        LIMIT 1`, [itemId || null, from, to]);
    if (!r.rows.length) return null;
    return { factor: Number(r.rows[0].factor), scope: r.rows[0].item_id ? 'ITEM' : 'GLOBAL' };
  }

  // Average weight of a roll of this item, from rolls actually produced. Used for
  // ROLL <-> KG, which has no formula — a roll is however heavy it came off the
  // machine. Requires enough history to be meaningful.
  async function avgRollWeight(itemId, { minRolls = 5 } = {}) {
    const r = await pool.query(
      `SELECT COUNT(*)::int n,
              AVG(COALESCE(actual_weight_kg, roll_weight_kg, weight_kg)) AS avg_kg
         FROM rolls
        WHERE fabric_item_id = $1
          AND COALESCE(actual_weight_kg, roll_weight_kg, weight_kg) > 0`, [itemId]);
    const n = r.rows[0].n, avg = Number(r.rows[0].avg_kg) || 0;
    if (n < minRolls || !(avg > 0)) return null;
    return { factor: r6(avg), samples: n };
  }

  // The core call. Returns the converted value together with the basis used, so
  // a caller can show *why* the number is what it is.
  async function convert({ item_id, from_uom, to_uom, quantity }) {
    const from = norm(from_uom), to = norm(to_uom);
    const qty = Number(quantity);
    if (!Number.isFinite(qty)) return { error: 'A numeric quantity is required', code: 400 };
    if (!from || !to) return { error: 'Both units are required', code: 400 };
    if (from === to) return { ok: true, quantity: q3(qty), factor: 1, basis: 'IDENTITY', from, to };

    // 1. Explicit factor, item-specific before global.
    const ex = await explicitFactor(item_id, from, to);
    if (ex) {
      return { ok: true, quantity: q3(qty * ex.factor), factor: ex.factor,
               basis: ex.scope === 'ITEM' ? 'ITEM_FACTOR' : 'GLOBAL_FACTOR', from, to };
    }
    // The reverse of a stored factor is just as valid as the factor itself.
    const rev = await explicitFactor(item_id, to, from);
    if (rev) {
      const f = r6(1 / rev.factor);
      return { ok: true, quantity: q3(qty * f), factor: f,
               basis: rev.scope === 'ITEM' ? 'ITEM_FACTOR_INVERSE' : 'GLOBAL_FACTOR_INVERSE', from, to };
    }

    // 2. Derived from the fabric's own GSM and width.
    if ((from === 'KG' && to === 'MTR') || (from === 'MTR' && to === 'KG')) {
      if (!item_id) {
        return { error: 'Converting between kilograms and metres needs an item — the ratio depends on the fabric\'s GSM and width', code: 400 };
      }
      const spec = await fabricSpec(item_id);
      if (!spec) {
        return { error: 'This item has no finished GSM and width recorded, so kilograms and metres cannot be related. Set them on the item, or add an explicit conversion factor.', code: 422 };
      }
      const kgm = kgPerMetre(spec);
      const factor = from === 'MTR' ? kgm : r6(1 / kgm);
      return {
        ok: true, quantity: q3(qty * factor), factor, basis: 'DERIVED_FROM_GSM', from, to,
        derivation: { gsm: spec.gsm, width_cm: spec.width_cm, kg_per_metre: kgm },
      };
    }

    // 3. Roll <-> kg, from measured history rather than an assumed roll size.
    if ((from === 'ROLL' && to === 'KG') || (from === 'KG' && to === 'ROLL')) {
      if (!item_id) return { error: 'Converting rolls needs an item — roll weight varies by fabric', code: 400 };
      const avg = await avgRollWeight(item_id);
      if (!avg) {
        return { error: 'Not enough roll history for this item to derive an average roll weight. Add an explicit ROLL to KG factor.', code: 422 };
      }
      const factor = from === 'ROLL' ? avg.factor : r6(1 / avg.factor);
      return { ok: true, quantity: q3(qty * factor), factor, basis: 'AVG_ROLL_WEIGHT', from, to,
               derivation: { avg_roll_kg: avg.factor, samples: avg.samples },
               // Rolls are whole objects; a fractional answer is a planning
               // figure, not something anyone can pick.
               note: to === 'ROLL' ? `About ${Math.ceil(q3(qty * factor))} rolls.` : undefined };
    }

    // 4. Genuinely universal ratios.
    const uni = UNIVERSAL[`${from}|${to}`];
    if (uni) return { ok: true, quantity: q3(qty * uni), factor: uni, basis: 'UNIVERSAL', from, to };

    // Anything reaching here would have to be guessed, so it is refused.
    return {
      error: `No conversion from ${from} to ${to}${item_id ? ' for this item' : ''}. Add one under item conversions rather than assuming a rate.`,
      code: 422,
    };
  }

  // Two-hop conversion through kilograms, which is the unit everything else in
  // the mill is measured against. Lets MTR -> PCS work when only MTR -> KG and
  // KG -> PCS are known.
  async function convertVia({ item_id, from_uom, to_uom, quantity, via = 'KG' }) {
    const direct = await convert({ item_id, from_uom, to_uom, quantity });
    if (direct.ok || direct.code === 400) return direct;

    const hop1 = await convert({ item_id, from_uom, to_uom: via, quantity });
    if (!hop1.ok) return direct;   // report the original failure, not the detour's
    const hop2 = await convert({ item_id, from_uom: via, to_uom, quantity: hop1.quantity });
    if (!hop2.ok) return direct;

    return {
      ok: true, quantity: hop2.quantity, factor: r6(hop2.quantity / (quantity || 1)),
      basis: 'VIA_' + norm(via), from: norm(from_uom), to: norm(to_uom),
      steps: [
        { from: hop1.from, to: hop1.to, quantity: hop1.quantity, basis: hop1.basis },
        { from: hop2.from, to: hop2.to, quantity: hop2.quantity, basis: hop2.basis },
      ],
    };
  }

  // ── Maintaining factors ───────────────────────────────────────────────────
  async function listFactors({ item_id } = {}) {
    const r = await pool.query(
      `SELECT c.*, i.item_name FROM uom_conversions c
         LEFT JOIN items i ON i.item_id = c.item_id
        WHERE ($1::int IS NULL OR c.item_id = $1 OR c.item_id IS NULL)
        ORDER BY c.item_id NULLS FIRST, c.from_uom, c.to_uom`, [item_id || null]);
    return r.rows.map(x => ({ ...x, factor: Number(x.factor) }));
  }

  async function saveFactor({ item_id, from_uom, to_uom, factor, notes, by }) {
    const from = norm(from_uom), to = norm(to_uom);
    const f = Number(factor);
    if (!from || !to) return { error: 'Both units are required', code: 400 };
    if (from === to) return { error: 'A unit cannot convert to itself', code: 400 };
    if (!(f > 0)) return { error: 'The factor must be greater than zero', code: 400 };

    // A global kg/metre factor is the specific mistake this module exists to
    // prevent, so it is refused outright rather than merely discouraged.
    if (!item_id && ((from === 'KG' && to === 'MTR') || (from === 'MTR' && to === 'KG'))) {
      return { error: 'Kilograms and metres cannot have a global factor — the ratio depends on GSM and width. Set it against a specific item.', code: 400 };
    }

    const r = await pool.query(
      `INSERT INTO uom_conversions (item_id, from_uom, to_uom, factor, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (item_id, from_uom, to_uom) WHERE item_id IS NOT NULL
       DO UPDATE SET factor = EXCLUDED.factor, notes = EXCLUDED.notes
       RETURNING *`,
      [item_id || null, from, to, f, notes || null, by || null]);
    return { ...r.rows[0], factor: Number(r.rows[0].factor) };
  }

  async function deleteFactor(conversionId) {
    const r = await pool.query(
      `DELETE FROM uom_conversions WHERE conversion_id=$1 RETURNING conversion_id`, [conversionId]);
    if (!r.rows.length) return { error: 'Conversion not found', code: 404 };
    return { ok: true };
  }

  // Every unit this item can be expressed in, and how. Useful on an order screen
  // where someone needs to know whether metres is even an option.
  async function supportedUnits(itemId) {
    const units = ['KG', 'MTR', 'PCS', 'ROLL'];
    const out = [];
    for (const u of units) {
      if (u === 'KG') { out.push({ uom: 'KG', available: true, basis: 'BASE' }); continue; }
      const c = await convert({ item_id: itemId, from_uom: 'KG', to_uom: u, quantity: 1 });
      out.push(c.ok
        ? { uom: u, available: true, basis: c.basis, per_kg: c.quantity }
        : { uom: u, available: false, reason: c.error });
    }
    return out;
  }

  return { convert, convertVia, listFactors, saveFactor, deleteFactor,
           supportedUnits, fabricSpec, kgPerMetre };
};
