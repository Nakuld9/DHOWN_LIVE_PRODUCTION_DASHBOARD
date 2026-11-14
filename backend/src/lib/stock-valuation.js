// Stock valuation as at a date.
//
// The honest difficulty here is that "as at a date" needs history, and the only
// history is stock_ledger, which was introduced recently and does not cover the
// life of the business. A report that quietly returns a near-zero valuation for
// last March — because the ledger simply had no rows then — would be a
// confidently wrong number in a document someone shows their accountant.
//
// So this does two things rather than one:
//
//   1. Values TODAY from the live stock tables. That is reliable, because it is
//      the same data every stock screen reads.
//   2. For a past date, rolls that position backwards through ledger movements
//      recorded after the date — and reports the ledger's coverage alongside,
//      so the number is presented with the thing that limits it.
//
// Where coverage does not reach, the report says so. It does not guess.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const q3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

module.exports = (pool) => {

  // How far back the ledger can actually speak for.
  async function coverage() {
    const r = (await pool.query(
      `SELECT COUNT(*)::int AS rows,
              MIN(txn_date)::text AS from_date,
              MAX(txn_date)::text AS to_date
         FROM stock_ledger`)).rows[0];
    return { rows: Number(r.rows), from_date: r.from_date, to_date: r.to_date };
  }

  // Live position, valued at the cost we actually hold.
  //
  // Yarn is valued at its purchase rate — the real number, per lot. Greige and
  // finished goods have no purchase price, so they are valued at the yarn cost
  // that went into them where a rate is known, and reported separately with the
  // basis named. Presenting a conversion cost as if it were a purchase price
  // would overstate the balance sheet.
  async function livePosition() {
    const yarn = (await pool.query(
      `SELECT COALESCE(SUM(current_stock_kg),0) AS kg,
              COALESCE(SUM(current_stock_kg * COALESCE(rate_per_kg,0)),0) AS value,
              COUNT(*) FILTER (WHERE current_stock_kg > 0)::int AS lots,
              COUNT(*) FILTER (WHERE current_stock_kg > 0 AND COALESCE(rate_per_kg,0) = 0)::int AS unpriced
         FROM yarn_lots
        WHERE COALESCE(current_stock_kg,0) > 0
          AND COALESCE(status,'') <> 'CONSUMED'`)).rows[0];

    // Greige: rolls still in the warehouse. Valued at the average yarn rate,
    // which is a floor, not a true cost — conversion is not included.
    const rate = (await pool.query(
      `SELECT COALESCE(AVG(NULLIF(price_per_kg,0)),0) AS avg_rate FROM cost_rates`)).rows[0].avg_rate;

    const greige = (await pool.query(
      `SELECT COALESCE(SUM(COALESCE(actual_weight_kg, roll_weight_kg, weight_kg, 0)),0) AS kg,
              COUNT(*)::int AS rolls
         FROM rolls
        WHERE COALESCE(warehouse_status,'') NOT IN ('DISPATCHED')
          AND COALESCE(status,'') NOT IN ('CANCELLED')`)).rows[0];

    const fg = (await pool.query(
      `SELECT COALESCE(SUM(weight_kg),0) AS kg, COUNT(*)::int AS lots
         FROM finished_goods
        WHERE COALESCE(status,'') = 'IN_STOCK'`)).rows[0];

    const avgRate = Number(rate) || 0;
    return {
      yarn: {
        kg: q3(yarn.kg), value: r2(yarn.value), lots: Number(yarn.lots),
        unpriced_lots: Number(yarn.unpriced),
        basis: 'purchase rate per lot',
      },
      greige: {
        kg: q3(greige.kg), rolls: Number(greige.rolls),
        value: r2(Number(greige.kg) * avgRate),
        basis: avgRate ? `average yarn rate ${r2(avgRate)}/kg — conversion cost not included` : 'no yarn rate available',
      },
      finished: {
        kg: q3(fg.kg), lots: Number(fg.lots),
        value: r2(Number(fg.kg) * avgRate),
        basis: avgRate ? `average yarn rate ${r2(avgRate)}/kg — conversion cost not included` : 'no yarn rate available',
      },
    };
  }

  // Net movement recorded after a date, by item. Rolling the live position back
  // through this reconstructs the position as it stood.
  async function movementsSince(date) {
    const r = await pool.query(
      `SELECT movement_type,
              COALESCE(SUM(quantity),0) AS qty,
              COALESCE(SUM(COALESCE(total_cost, quantity * COALESCE(unit_cost,0))),0) AS value,
              COUNT(*)::int AS n
         FROM stock_ledger
        WHERE txn_date > $1::date
        GROUP BY movement_type`, [date]);
    let inQty = 0, inVal = 0, outQty = 0, outVal = 0, rows = 0;
    for (const m of r.rows) {
      rows += Number(m.n);
      const t = String(m.movement_type || '').toUpperCase();
      if (t === 'IN' || t === 'RETURN' || t === 'RECEIPT') { inQty += Number(m.qty); inVal += Number(m.value); }
      else { outQty += Number(m.qty); outVal += Number(m.value); }
    }
    return { in_qty: q3(inQty), in_value: r2(inVal), out_qty: q3(outQty), out_value: r2(outVal), rows };
  }

  async function valuation({ as_at = null } = {}) {
    const today = (await pool.query(`SELECT CURRENT_DATE::text d`)).rows[0].d;
    const asAt = as_at || today;
    const cov = await coverage();
    const live = await livePosition();

    const liveTotal = r2(live.yarn.value + live.greige.value + live.finished.value);
    const liveKg = q3(live.yarn.kg + live.greige.kg + live.finished.kg);

    const warnings = [];
    if (live.yarn.unpriced_lots) {
      warnings.push(`${live.yarn.unpriced_lots} yarn lot(s) in stock have no purchase rate and are valued at zero.`);
    }
    if (!live.greige.value && live.greige.kg) {
      warnings.push('Greige stock could not be valued — no yarn rate is configured.');
    }

    // Today needs no reconstruction.
    if (asAt >= today) {
      return {
        as_at: today, basis: 'live stock tables',
        categories: live, total_kg: liveKg, total_value: liveTotal,
        ledger_coverage: cov, reconstructed: false, warnings,
      };
    }

    // A past date. Roll backwards, and be explicit about what that rests on.
    const moved = await movementsSince(asAt);
    const reconstructedValue = r2(liveTotal - moved.in_value + moved.out_value);
    const reconstructedKg = q3(liveKg - moved.in_qty + moved.out_qty);

    if (!cov.rows || (cov.from_date && asAt < cov.from_date)) {
      warnings.unshift(
        cov.rows
          ? `The stock ledger only goes back to ${cov.from_date}. A valuation as at ${asAt} cannot be reconstructed from it, so the figure below is not reliable for that date.`
          : 'The stock ledger has no entries, so a past-dated valuation cannot be reconstructed at all.');
    }

    return {
      as_at: asAt,
      basis: 'live position rolled back through the stock ledger',
      categories: live,
      live_total_value: liveTotal, live_total_kg: liveKg,
      movements_since: moved,
      total_kg: reconstructedKg, total_value: reconstructedValue,
      ledger_coverage: cov,
      reconstructed: true,
      // The single flag a caller should check before quoting the number.
      reliable: !!cov.rows && !!cov.from_date && asAt >= cov.from_date,
      warnings,
    };
  }

  return { valuation, livePosition, coverage, movementsSince };
};
