// AI material-shortage analysis (spec §25).
//
// ANALYSIS ONLY. It reads live data (stock, consumption, open-order requirement,
// incoming shipments + ETAs) and returns a shortage assessment plus operational
// CONSIDERATIONS for a human. It NEVER places a PO, changes stock, alters a
// production plan, or makes any commitment. Every figure is labelled; where the
// data isn't there (e.g. no consumption history yet) it says so rather than
// guessing.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v, d) => { const n = parseFloat(process.env[v]); return Number.isFinite(n) ? n : d; };

module.exports = (pool) => {
  const q = async (sql, p = []) => { try { return (await pool.query(sql, p)).rows; } catch { return null; } };

  async function analyze(materialId, { horizonDays } = {}) {
    const H = num('IMPORT_SHORTAGE_HORIZON_DAYS', horizonDays || 30);
    const CONSUMP_DAYS = num('IMPORT_CONSUMPTION_WINDOW_DAYS', 90);
    const SAFETY = num('IMPORT_SAFETY_STOCK_KG', 0);

    const item = (await q(`SELECT item_id, item_name, category_id FROM items WHERE item_id=$1`, [materialId]))?.[0];
    if (!item) return { error: 'Material not found', code: 404 };

    // Current stock (actual).
    const current_stock = r2((await q(`SELECT COALESCE(SUM(current_stock_kg),0) s FROM yarn_lots WHERE item_id=$1`, [materialId]))?.[0]?.s || 0);

    // Average daily consumption from yarn issues (movements OUT) over the window.
    const consRow = (await q(`
      SELECT COALESCE(SUM(ABS(m.quantity_kg)),0) kg
        FROM yarn_lot_movements m JOIN yarn_lots yl ON yl.lot_id=m.lot_id
       WHERE yl.item_id=$1 AND m.created_at >= CURRENT_DATE - ($2::int)
         AND m.movement_type ILIKE ANY (ARRAY['%issue%','%consume%','%out%'])`, [materialId, CONSUMP_DAYS]))?.[0];
    const consumedKg = Number(consRow?.kg || 0);
    const avg_daily = consumedKg > 0 ? r2(consumedKg / CONSUMP_DAYS) : null;
    const days_of_cover = avg_daily ? r2(current_stock / avg_daily) : null;

    // Incoming imports for this material, not yet received.
    const incoming = (await q(`
      SELECT i.import_no, i.quantity, i.current_eta, i.original_eta,
             GREATEST(COALESCE(i.current_eta,i.original_eta) - i.original_eta, 0) AS delay_days,
             (i.current_eta - CURRENT_DATE) AS days_to_eta
        FROM imports i
       WHERE i.deleted_at IS NULL AND i.material_id=$1
         AND i.status NOT IN ('GRN_COMPLETED','CLOSED')
       ORDER BY i.current_eta NULLS LAST`, [materialId])) || [];
    const incoming_total = r2(incoming.reduce((s, x) => s + Number(x.quantity || 0), 0));
    const earliest_eta = incoming.map(x => x.current_eta).filter(Boolean).sort()[0] || null;

    // Open-order requirement for this yarn from the MRP netting.
    let open_requirement = null;
    try {
      const mrp = await require('./mrp')(pool).yarnRequirement();
      const line = (mrp.lines || []).find(l => String(l.yarn_item_id) === String(materialId));
      if (line) open_requirement = r2(line.required);
    } catch { /* mrp optional */ }

    // Shortage assessment. Two independent signals; either raises a flag.
    let is_shortage = false; const reasons = [];
    if (days_of_cover != null && earliest_eta) {
      const runout = new Date(); runout.setDate(runout.getDate() + Math.floor(days_of_cover));
      if (runout < new Date(earliest_eta)) { is_shortage = true; reasons.push(`Stock covers ~${days_of_cover} days; runs out before the next shipment (ETA ${String(earliest_eta).slice(0, 10)}).`); }
    }
    if (open_requirement != null && (current_stock + incoming_total) < open_requirement - 0.01) {
      is_shortage = true; reasons.push(`Open-order requirement ${open_requirement} kg exceeds stock ${current_stock} + incoming ${incoming_total} = ${r2(current_stock + incoming_total)} kg.`);
    }
    if (SAFETY > 0 && current_stock < SAFETY) { is_shortage = is_shortage || true; reasons.push(`Stock ${current_stock} kg is below the ${SAFETY} kg safety level.`); }

    // Alternative stock: other yarns in the same category with stock on hand.
    const alternatives = (await q(`
      SELECT it.item_id, it.item_name, COALESCE(SUM(yl.current_stock_kg),0) kg
        FROM items it JOIN yarn_lots yl ON yl.item_id=it.item_id
       WHERE it.category_id=$1 AND it.item_id<>$2
       GROUP BY it.item_id, it.item_name HAVING COALESCE(SUM(yl.current_stock_kg),0) > 0
       ORDER BY kg DESC LIMIT 5`, [item.category_id, materialId])) || [];

    // Operational considerations — NOT actions the system takes.
    const considerations = [];
    if (is_shortage) {
      if (alternatives.length) considerations.push(`Check alternate available stock: ${alternatives.slice(0, 3).map(a => `${a.item_name} (${r2(a.kg)} kg)`).join(', ')}.`);
      if (incoming.some(x => Number(x.delay_days) > 0)) considerations.push('An incoming shipment is delayed — review shipment acceleration options with the forwarder/CHA.');
      considerations.push('Review production allocation and priority for this material.');
      considerations.push('Review additional procurement if the gap cannot be covered in time.');
    }

    return {
      material: { id: item.item_id, name: item.item_name },
      current_stock: { value: current_stock, kind: 'actual', source: 'MES (yarn_lots)' },
      avg_daily_consumption: avg_daily != null ? { value: avg_daily, kind: 'actual', window_days: CONSUMP_DAYS } : { value: null, kind: 'unavailable', note: 'No yarn-issue history in the window — consumption unknown.' },
      days_of_cover,
      open_order_requirement: open_requirement != null ? { value: open_requirement, kind: 'actual' } : { value: null, kind: 'unavailable', note: 'No open-order BOM requirement for this yarn.' },
      incoming: incoming.map(x => ({ import_no: x.import_no, quantity: r2(x.quantity), current_eta: x.current_eta, delay_days: Number(x.delay_days) || 0, days_to_eta: x.days_to_eta == null ? null : Number(x.days_to_eta) })),
      incoming_total, earliest_incoming_eta: earliest_eta,
      shortage: { is_shortage, reasons },
      alternatives: alternatives.map(a => ({ item_id: a.item_id, item_name: a.item_name, stock_kg: r2(a.kg) })),
      considerations,
      note: 'AI ANALYSIS / RECOMMENDATION — not an instruction. Figures are live MES data.',
      disclaimer: 'This module does not place purchase orders, change stock, or alter production plans. Any action is a human decision.',
    };
  }

  // Analyse every material that has an active import (the control-tower context).
  async function analyzeAll() {
    const mats = (await q(`SELECT DISTINCT material_id FROM imports
       WHERE deleted_at IS NULL AND material_id IS NOT NULL AND status NOT IN ('GRN_COMPLETED','CLOSED')`)) || [];
    const out = [];
    for (const m of mats) { const a = await analyze(m.material_id); if (!a.error) out.push(a); }
    out.sort((a, b) => (b.shortage.is_shortage - a.shortage.is_shortage) || ((a.days_of_cover ?? 1e9) - (b.days_of_cover ?? 1e9)));
    return { materials: out, at_risk: out.filter(x => x.shortage.is_shortage).length };
  }

  return { analyze, analyzeAll };
};
