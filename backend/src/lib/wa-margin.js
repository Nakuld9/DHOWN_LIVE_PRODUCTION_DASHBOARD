// Quote margin (HIGH-12).
//
// A manager approving a rate could not see what the fabric costs, even though
// the MES already knows: cost_entries carries FIFO yarn and knitting cost per
// fabric and shade. Approving a price without margin is approving blind, and
// below-cost selling is invisible until the month closes.
//
// Pure helpers are separated from the lookup so the arithmetic can be tested.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Margin on the SELLING price (not on cost) — that is how a mill quotes it, and
// mixing the two conventions is a classic way to sell below cost by accident.
function marginPct(rate, cost) {
  const r = Number(rate), c = Number(cost);
  if (!Number.isFinite(r) || r <= 0) return null;
  if (!Number.isFinite(c) || c <= 0) return null;   // unknown cost -> unknown margin, never "100%"
  return r2(((r - c) / r) * 100);
}

function marginBand(pct, floor = 8) {
  if (pct === null) return 'UNKNOWN';
  if (pct < 0) return 'BELOW_COST';
  if (pct < floor) return 'THIN';
  return 'OK';
}

module.exports = (pool) => {
  const FLOOR = Number(process.env.MARGIN_FLOOR_PCT) || 8;

  // Cost per kg for a fabric/shade from real production cost entries, most
  // recent first. Falls back to the item master, then reports unknown — it
  // never guesses, because a wrong cost is worse than a missing one.
  async function unitCost({ product, shade } = {}) {
    const prod = String(product || '').trim();
    const shd = String(shade || '').trim();
    if (!prod) return { cost: null, source: 'none' };

    // Each cost COMPONENT (yarn, knitting, dyeing…) records the same batch
    // quantity, so summing quantity across components multiplies the denominator
    // by the number of components and halves — or thirds — the true cost. Roll
    // up per reference first, taking the quantity once.
    const ce = await pool.query(
      `SELECT SUM(amt) AS amt, SUM(qty) AS qty FROM (
         SELECT reference_id, SUM(amount_rs) AS amt, MAX(quantity_kg) AS qty
           FROM cost_entries
          WHERE fabric_type ILIKE $1
            AND ($2 = '' OR color_name ILIKE $2)
            AND quantity_kg > 0
            AND created_at > NOW() - INTERVAL '180 days'
          GROUP BY reference_id
       ) per_batch`,
      [`%${prod}%`, shd ? `%${shd}%` : '']);
    const amt = Number(ce.rows[0]?.amt) || 0;
    const qty = Number(ce.rows[0]?.qty) || 0;
    if (qty > 0 && amt > 0) return { cost: r2(amt / qty), source: 'production_costs' };

    const im = await pool.query(
      `SELECT standard_cost FROM items
        WHERE COALESCE(is_active,true) = true AND item_name ILIKE $1
          AND standard_cost IS NOT NULL AND standard_cost > 0
        ORDER BY updated_at DESC NULLS LAST LIMIT 1`, [`%${prod}%`]);
    if (im.rows.length) return { cost: r2(im.rows[0].standard_cost), source: 'item_master' };

    return { cost: null, source: 'unknown' };
  }

  // Everything a manager needs to decide, in one object.
  async function assess({ product, shade, rate, quantity_kg } = {}) {
    const { cost, source } = await unitCost({ product, shade });
    const pct = marginPct(rate, cost);
    const band = marginBand(pct, FLOOR);
    const qty = Number(quantity_kg) || 0;
    return {
      unit_cost: cost,
      cost_source: source,
      rate: rate != null ? r2(rate) : null,
      margin_pct: pct,
      margin_value: cost != null && rate != null ? r2((Number(rate) - cost) * qty) : null,
      band, floor_pct: FLOOR,
      note: band === 'BELOW_COST' ? 'This rate is BELOW cost.'
          : band === 'THIN' ? `Margin is under the ${FLOOR}% floor.`
          : band === 'UNKNOWN' ? 'No cost on file for this product — margin cannot be checked.'
          : null,
    };
  }

  return { unitCost, assess, marginPct, marginBand, FLOOR };
};

module.exports.marginPct = marginPct;
module.exports.marginBand = marginBand;
