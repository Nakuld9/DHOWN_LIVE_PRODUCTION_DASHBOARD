// Path C — Valued Stock Status (Busy "Stock Status" equivalent) from the REAL
// MES inventory, valued at FIFO lot cost, and reconciled to the GL Inventory
// ledger. Physical quantity stays authoritative in the MES; this values it the
// same way the GL does, so "stock in the books" = "stock on the floor".
//
//   Yarn           yarn_lots.current_stock_kg × rate_per_kg  (each lot is its
//                  own FIFO layer, so lot rate IS the FIFO cost)
//   Finished goods cost_entries(ROLL) of the in-stock finished rolls (FIFO yarn
//                  + knitting/dyeing already accumulated per roll)
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

module.exports = (pool) => {
  const svc = require('./service')(pool);

  async function valuedStock({ as_of } = {}) {
    // ── Yarn stock, valued at each lot's own rate (FIFO layer) ───────────────
    const yarnRows = (await pool.query(`
      SELECT COALESCE(NULLIF(TRIM(yarn_type), ''), '(unspecified)') AS item,
             COUNT(*)::int AS lots,
             SUM(current_stock_kg) AS kg,
             SUM(current_stock_kg * COALESCE(rate_per_kg, 0)) AS value
        FROM yarn_lots
       WHERE COALESCE(status, '') <> 'CANCELLED' AND COALESCE(current_stock_kg, 0) > 0
       GROUP BY 1 ORDER BY value DESC NULLS LAST`)).rows.map((x) => ({ item: x.item, lots: x.lots, kg: r3(x.kg), value: r2(x.value) }));
    const yarnVal = r2(yarnRows.reduce((s, x) => s + x.value, 0));
    const yarnKg = r3(yarnRows.reduce((s, x) => s + x.kg, 0));

    // ── Finished goods, valued at the accumulated roll cost ──────────────────
    const fgRows = (await pool.query(`
      SELECT COALESCE(NULLIF(TRIM(f.fabric_type), ''), '(unspecified)') AS item,
             COUNT(*)::int AS rolls,
             SUM(f.weight_kg) AS kg,
             COALESCE(SUM((SELECT SUM(ce.amount_rs) FROM cost_entries ce
                            WHERE ce.reference_type='ROLL' AND ce.reference_id = f.roll_id)), 0) AS value
        FROM finished_goods f
       WHERE COALESCE(f.status, '') NOT IN ('DISPATCHED', 'CANCELLED')
       GROUP BY 1 ORDER BY value DESC NULLS LAST`)).rows.map((x) => ({ item: x.item, rolls: x.rolls, kg: r3(x.kg), value: r2(x.value) }));
    const fgVal = r2(fgRows.reduce((s, x) => s + x.value, 0));
    const fgKg = r3(fgRows.reduce((s, x) => s + x.kg, 0));

    const totalValue = r2(yarnVal + fgVal);

    // ── GL stock ledgers (Raw / WIP / Finished Goods) ─────────────────────────
    let gl = null; let glValue = 0; let glStock = null;
    try {
      const leds = await svc.listLedgers({});
      const bal = async (code) => { const l = leds.find((x) => x.code === code); if (!l) return null; const b = await svc.ledgerBalance(l.ledger_id, as_of); return { balance: b, value: r2((b.side === 'Cr' ? -1 : 1) * (Number(b.amount) || 0)) }; };
      const raw = await bal('INVENTORY'); const wip = await bal('WIP'); const fg = await bal('FINISHED_GOODS');
      glStock = { raw, wip, finished: fg, total: r2((raw?.value || 0) + (wip?.value || 0) + (fg?.value || 0)) };
      gl = raw ? raw.balance : null; glValue = raw ? raw.value : 0; // back-compat field
    } catch { /* accounting engine not present */ }
    const difference = glStock ? r2(totalValue - glStock.total) : null;

    return {
      as_of: as_of || null,
      yarn: { items: yarnRows, total_kg: yarnKg, total_value: yarnVal },
      finished: { items: fgRows, total_kg: fgKg, total_value: fgVal },
      total_stock_value: totalValue,
      gl_inventory: gl ? { balance: gl, value: glValue } : null,
      gl_stock: glStock,
      difference,
      reconciled: glStock ? Math.abs(difference) < 1 : null,
      notes: [
        'Yarn valued at each lot’s rate (FIFO layer); finished goods at accumulated roll cost from cost_entries.',
        ...(glStock && Math.abs(difference) >= 1 ? ['GL stock ledgers (Raw + WIP + Finished Goods) differ from physical stock value — expected until GRN/issue/production/dispatch postings flow through the engine (shadow mode).'] : []),
        ...(fgVal === 0 && fgRows.length > 0 ? ['Finished goods have no roll cost_entries yet, so FG value is 0 (production costing not populated).'] : []),
      ],
    };
  }

  return { valuedStock };
};
