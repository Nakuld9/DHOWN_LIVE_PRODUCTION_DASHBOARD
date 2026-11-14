// Inventory read tools — yarn, greige, and finished fabric on hand, plus low-stock
// yarn. Read-only; every number comes straight from the stock tables so the agent
// reports only what is actually in stock, never an estimate.

module.exports = function registerInventoryTools(registry, { pool }) {
  // On-hand stock across the three stores.
  registry.register({
    name: 'get_stock_summary',
    description: 'Total stock on hand: yarn (kg, cones, lots), greige rolls (kg), and finished fabric (kg, rolls). No arguments.',
    minRole: 'OPERATOR',
    handler: async () => {
      const yarn = (await pool.query(
        `SELECT COUNT(*) AS lots,
                COALESCE(SUM(current_stock_kg),0) AS kg,
                COALESCE(SUM(current_cones),0) AS cones
           FROM yarn_lots WHERE COALESCE(current_stock_kg,0) > 0`)).rows[0];
      const greige = (await pool.query(
        `SELECT COUNT(*) AS rolls, COALESCE(SUM(actual_weight_kg),0) AS kg
           FROM rolls
          WHERE COALESCE(warehouse_status,'') = 'IN_STOCK'
            AND COALESCE(quarantine_status,'NONE') = 'NONE'`)).rows[0];
      const finished = (await pool.query(
        `SELECT COUNT(*) AS entries,
                COALESCE(SUM(weight_kg),0) AS kg,
                COALESCE(SUM(roll_count),0) AS rolls
           FROM finished_goods WHERE COALESCE(weight_kg,0) > 0`)).rows[0];
      const r2 = (n) => Math.round(Number(n) * 100) / 100;
      return {
        yarn:     { lots: Number(yarn.lots), kg: r2(yarn.kg), cones: Number(yarn.cones) },
        greige:   { rolls: Number(greige.rolls), kg: r2(greige.kg) },
        finished: { rolls: Number(finished.rolls), kg: r2(finished.kg) },
        note: (Number(yarn.lots) + Number(greige.rolls) + Number(finished.entries)) === 0
          ? 'No stock recorded in any store.' : undefined,
      };
    },
  });

  // Yarn lots at or below their reorder level (per-lot threshold, else 100 kg).
  registry.register({
    name: 'get_low_stock',
    description: 'Yarn lots at or below their low-stock threshold (reorder level). No arguments.',
    minRole: 'OPERATOR',
    handler: async () => {
      const rows = (await pool.query(
        `SELECT lot_number, yarn_type, count, color, brand,
                current_stock_kg,
                COALESCE(NULLIF(low_stock_threshold_kg,0), 100) AS threshold_kg
           FROM yarn_lots
          WHERE COALESCE(current_stock_kg,0) > 0
            AND current_stock_kg <= COALESCE(NULLIF(low_stock_threshold_kg,0), 100)
          ORDER BY current_stock_kg ASC LIMIT 50`)).rows;
      return {
        count: rows.length,
        lots: rows.map(r => ({
          lot: r.lot_number, yarn: [r.brand, r.count, r.yarn_type, r.color].filter(Boolean).join(' '),
          current_kg: Math.round(Number(r.current_stock_kg) * 100) / 100,
          threshold_kg: Number(r.threshold_kg),
        })),
        note: rows.length === 0 ? 'No yarn lot is below its reorder level.' : undefined,
      };
    },
  });

  // ── WRITE tool — move stock between warehouses, behind the approvals queue ────
  // A transfer is two stock_ledger lines: OUT of the source store, IN to the
  // destination. Proposes only; a SUPERVISOR approval posts both lines. Warehouses
  // are given by code or name and resolved against the warehouses table.
  const resolveWarehouse = async (ref) => {
    const s = String(ref || '').trim();
    if (!s) return null;
    return (await pool.query(
      `SELECT warehouse_id, code, name FROM warehouses
        WHERE UPPER(code)=UPPER($1) OR UPPER(name)=UPPER($1) LIMIT 1`, [s])).rows[0] || null;
  };
  registry.register({
    name: 'stock_transfer',
    description: 'Move stock between two warehouses/stores. Proposes for approval; a SUPERVISOR must approve before it is posted. Args: {item_desc, quantity, from_location, to_location, uom?}. Locations are a store code or name (e.g. "GREIGE-STORE", "Dye House").',
    safe: false,
    minRole: 'OPERATOR',
    approveRole: 'SUPERVISOR',
    propose: async ({ item_desc, quantity, from_location, to_location, uom } = {}) => {
      const item = String(item_desc || '').trim();
      const qty = Number(quantity);
      if (!item) return { error: 'item_desc is required' };
      if (!(qty > 0)) return { error: 'quantity must be greater than zero' };
      const from = await resolveWarehouse(from_location);
      const to = await resolveWarehouse(to_location);
      if (!from) return { error: `unknown from_location: ${from_location}` };
      if (!to) return { error: `unknown to_location: ${to_location}` };
      if (from.warehouse_id === to.warehouse_id) return { error: 'from_location and to_location must differ' };
      return {
        summary: `Transfer ${qty} ${uom || 'KG'} of ${item}: ${from.name} → ${to.name}`,
        payload: { item_desc: item, quantity: qty, uom: (uom || 'KG').toUpperCase(),
                   from_id: from.warehouse_id, from_name: from.name, to_id: to.warehouse_id, to_name: to.name },
      };
    },
    execute: async ({ item_desc, quantity, uom, from_id, from_name, to_id, to_name }, { user } = {}) => {
      const doc_id = 'TR-' + Date.now().toString().slice(-8);
      const by = user?.username || 'ai-approval';
      const out = (await pool.query(
        `INSERT INTO stock_ledger (txn_date, doc_type, doc_id, item_desc, warehouse_id, movement_type, quantity, uom_code, notes, created_by)
         VALUES (CURRENT_DATE,'TRANSFER',$1,$2,$3,'OUT',$4,$5,$6,$7) RETURNING ledger_id`,
        [doc_id, item_desc, from_id, quantity, uom, `Transfer to ${to_name}`, by])).rows[0];
      const inn = (await pool.query(
        `INSERT INTO stock_ledger (txn_date, doc_type, doc_id, item_desc, warehouse_id, movement_type, quantity, uom_code, notes, created_by)
         VALUES (CURRENT_DATE,'TRANSFER',$1,$2,$3,'IN',$4,$5,$6,$7) RETURNING ledger_id`,
        [doc_id, item_desc, to_id, quantity, uom, `Transfer from ${from_name}`, by])).rows[0];
      return { ok: true, doc_id, out_ledger_id: out.ledger_id, in_ledger_id: inn.ledger_id };
    },
  });
};
