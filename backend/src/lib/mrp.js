// MRP-lite — yarn requirement planning.
//
// Explodes OPEN sales orders through the BOM (fabric → yarn, by blend %) into a
// gross yarn requirement, then nets it against yarn on hand and yarn already on
// order, so what remains is what actually needs buying. Deliberately simple: gross
// demand on open orders, not a time-phased plan — it answers "do we have the yarn
// for the order book, and if not, how much short".

const SO_CLOSED = `('DISPATCHED','COMPLETED','CLOSED','CANCELLED','DELIVERED','FULLY DISPATCHED')`;
const PO_CLOSED = `('CLOSED','COMPLETED','CANCELLED','RECEIVED','FULLY RECEIVED')`;

module.exports = (pool) => {
  async function yarnRequirement() {
    // Gross yarn required = fabric kg on open orders × blend% × (1 + knit loss%).
    const req = (await pool.query(
      `SELECT bl.yarn_item_id,
              SUM( COALESCE(soi.quantity_kg, soi.quantity, 0)
                   * (bl.percentage / 100.0)
                   * (1 + COALESCE(fi.standard_loss_pct, 0) / 100.0) ) AS required_kg
         FROM sales_orders so
         JOIN sales_order_items soi ON soi.so_id = so.so_id
         JOIN bom_lines bl          ON bl.fabric_item_id = soi.item_id
         LEFT JOIN items fi         ON fi.item_id = soi.item_id
        WHERE COALESCE(UPPER(so.status),'') NOT IN ${SO_CLOSED}
        GROUP BY bl.yarn_item_id`)).rows;

    if (req.length === 0) return { count: 0, lines: [], total_shortfall_kg: 0, note: 'No open sales orders to plan against.' };

    const onHand = Object.fromEntries((await pool.query(
      `SELECT item_id, SUM(COALESCE(current_stock_kg,0)) AS kg
         FROM yarn_lots WHERE item_id IS NOT NULL GROUP BY item_id`)).rows.map(r => [r.item_id, Number(r.kg)]));

    const onOrder = Object.fromEntries((await pool.query(
      `SELECT poi.item_id, SUM(GREATEST(COALESCE(poi.quantity,0) - COALESCE(poi.received_qty,0), 0)) AS kg
         FROM purchase_orders po
         JOIN purchase_order_items poi ON poi.po_id = po.po_id
        WHERE COALESCE(UPPER(po.status),'') NOT IN ${PO_CLOSED} AND poi.item_id IS NOT NULL
        GROUP BY poi.item_id`)).rows.map(r => [r.item_id, Number(r.kg)]));

    // Names for the yarn items.
    const ids = req.map(r => r.yarn_item_id);
    const names = Object.fromEntries((await pool.query(
      `SELECT i.item_id, i.item_name, ya.count, ya.yarn_type, ya.shade
         FROM items i LEFT JOIN item_yarn_attrs ya ON ya.item_id = i.item_id
        WHERE i.item_id = ANY($1)`, [ids])).rows.map(r => [r.item_id,
          [r.count, r.yarn_type, r.item_name, r.shade].filter(Boolean).join(' ') || `item ${r.item_id}`]));

    const r2 = (n) => Math.round(Number(n) * 100) / 100;
    const lines = req.map(r => {
      const required = r2(r.required_kg);
      const stock = r2(onHand[r.yarn_item_id] || 0);
      const order = r2(onOrder[r.yarn_item_id] || 0);
      const shortfall = r2(Math.max(required - stock - order, 0));
      return { yarn_item_id: r.yarn_item_id, yarn: names[r.yarn_item_id] || `item ${r.yarn_item_id}`,
               required_kg: required, on_hand_kg: stock, on_order_kg: order, shortfall_kg: shortfall };
    }).sort((a, b) => b.shortfall_kg - a.shortfall_kg || b.required_kg - a.required_kg);

    return {
      count: lines.length,
      lines,
      total_required_kg: r2(lines.reduce((s, l) => s + l.required_kg, 0)),
      total_shortfall_kg: r2(lines.reduce((s, l) => s + l.shortfall_kg, 0)),
      short_items: lines.filter(l => l.shortfall_kg > 0).length,
    };
  }

  return { yarnRequirement };
};
