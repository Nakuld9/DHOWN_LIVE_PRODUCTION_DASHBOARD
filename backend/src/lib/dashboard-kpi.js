// Operations dashboard — one cross-domain KPI snapshot of the mill, pulling from
// the same sources the AI agents use so the numbers always agree. Read-only.

const { computeLiveStatus } = require('./machine');

const SO_CLOSED = `('DISPATCHED','COMPLETED','CLOSED','CANCELLED','DELIVERED','FULLY DISPATCHED')`;
const PO_CLOSED = `('CLOSED','COMPLETED','CANCELLED','RECEIVED','FULLY RECEIVED')`;

module.exports = (pool) => {
  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

  async function operations() {
    // Production today (rolls closed today) + machines live.
    const prod = (await pool.query(
      `SELECT COUNT(*) AS rolls, COALESCE(SUM(actual_weight_kg),0) AS kg
         FROM rolls WHERE closed_at::date = CURRENT_DATE AND COALESCE(warehouse_status,'') <> 'CANCELLED'`)).rows[0];
    const machRows = (await pool.query(
      `SELECT ld.dc_status, ld.rpm FROM machines m
         LEFT JOIN machine_live_data ld ON ld.machine_id = m.machine_id
        WHERE COALESCE(m.active,true)=true`)).rows;
    const mach = machRows.map(x => computeLiveStatus(x.dc_status, x.rpm));
    const machines = { total: mach.length, running: mach.filter(s => s === 'RUNNING').length, offline: mach.filter(s => s === 'OFFLINE').length };

    // Quality — reject rate over the last 30 days (from the 4-point report).
    const q = await require('./fabric-inspection')(pool).report({ from: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10) });
    const qTotal = q.grades.reduce((s, g) => s + Number(g.rolls), 0);
    const qReject = q.grades.filter(g => g.grade === 'REJECT').reduce((s, g) => s + Number(g.rolls), 0);
    const quality = { inspected: qTotal, reject_pct: qTotal > 0 ? Math.round((qReject / qTotal) * 1000) / 10 : 0 };

    // Inventory: yarn / greige / finished on hand, low-stock, and at-vendor.
    const yarn = (await pool.query(`SELECT COALESCE(SUM(current_stock_kg),0) kg FROM yarn_lots WHERE COALESCE(current_stock_kg,0)>0`)).rows[0];
    const greige = (await pool.query(`SELECT COALESCE(SUM(actual_weight_kg),0) kg FROM rolls WHERE COALESCE(warehouse_status,'')='IN_STOCK' AND COALESCE(quarantine_status,'NONE')='NONE'`)).rows[0];
    const finished = (await pool.query(`SELECT COALESCE(SUM(weight_kg),0) kg FROM finished_goods WHERE COALESCE(weight_kg,0)>0`)).rows[0];
    const low = (await pool.query(`SELECT COUNT(*) n FROM yarn_lots WHERE COALESCE(current_stock_kg,0)>0 AND current_stock_kg <= COALESCE(NULLIF(low_stock_threshold_kg,0),100)`)).rows[0];
    const atVendor = (await pool.query(`SELECT COALESCE(SUM(sent_weight_kg),0) kg, COUNT(*) FILTER (WHERE expected_return_date < CURRENT_DATE) overdue FROM subcontract_challans WHERE COALESCE(status,'')='SENT'`)).rows[0];

    // Orders / purchase.
    const so = (await pool.query(`SELECT COUNT(*) open, COUNT(*) FILTER (WHERE delivery_date < CURRENT_DATE) overdue FROM sales_orders WHERE COALESCE(UPPER(status),'') NOT IN ${SO_CLOSED}`)).rows[0];
    const po = (await pool.query(`SELECT COUNT(*) open, COUNT(*) FILTER (WHERE expected_date < CURRENT_DATE) overdue FROM purchase_orders WHERE COALESCE(UPPER(status),'') NOT IN ${PO_CLOSED}`)).rows[0];

    // Yarn shortfall from MRP.
    const mrp = await require('./mrp')(pool).yarnRequirement();

    return {
      generated_at: new Date().toISOString(),
      production: { rolls_today: Number(prod.rolls), kg_today: r2(prod.kg) },
      machines,
      quality,
      inventory: {
        yarn_kg: r2(yarn.kg), greige_kg: r2(greige.kg), finished_kg: r2(finished.kg),
        low_stock_yarns: Number(low.n),
        at_vendor_kg: r2(atVendor.kg), at_vendor_overdue: Number(atVendor.overdue),
      },
      orders: { open: Number(so.open), overdue: Number(so.overdue) },
      purchase: { open: Number(po.open), overdue: Number(po.overdue) },
      mrp: { short_items: mrp.short_items || 0, shortfall_kg: mrp.total_shortfall_kg || 0 },
    };
  }

  return { operations };
};
