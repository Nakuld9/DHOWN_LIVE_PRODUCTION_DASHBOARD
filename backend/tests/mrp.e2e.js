// MRP-lite yarn requirement, against the real BOM. Adds one open sales order for a
// fabric that has BOM lines and checks the yarn requirement rises by exactly the
// exploded amount (fabric kg × blend% × (1+loss)), and that shortfall = required −
// on-hand − on-order. Uses a delta so other open orders in the DB don't matter.
//
//   node tests/mrp.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});
const mrp = require('../src/lib/mrp')(pool);

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };
const lineFor = (rep, id) => (rep.lines || []).find(l => l.yarn_item_id === id);

(async () => {
  let soId;
  try {
    // A fabric that has a BOM, and one of its yarn lines.
    const bl = (await pool.query(
      `SELECT bl.fabric_item_id, bl.yarn_item_id, bl.percentage,
              COALESCE(fi.standard_loss_pct,0) AS loss
         FROM bom_lines bl LEFT JOIN items fi ON fi.item_id = bl.fabric_item_id
        ORDER BY bl.bom_line_id LIMIT 1`)).rows[0];
    if (!bl) { console.log('  SKIP  no bom_lines seeded'); await pool.end(); process.exit(0); }
    const fabricId = bl.fabric_item_id, yarnId = bl.yarn_item_id;
    const pct = Number(bl.percentage), loss = Number(bl.loss);
    const QTY = 100;
    const expectedDelta = Math.round(QTY * (pct / 100) * (1 + loss / 100) * 100) / 100;

    const before = await mrp.yarnRequirement();
    const beforeReq = lineFor(before, yarnId)?.required_kg || 0;

    console.log('\nAn open order raises the yarn requirement by the exploded amount');
    soId = (await pool.query(
      `INSERT INTO sales_orders (so_number, customer_name, order_date, status)
       VALUES ($1,'ZZ MRP Test', NOW(), 'OPEN') RETURNING so_id`,
      ['ZZMRP' + Date.now().toString().slice(-6)])).rows[0].so_id;
    await pool.query(
      `INSERT INTO sales_order_items (so_id, item_id, item_name, quantity, quantity_kg, uom)
       VALUES ($1,$2,'ZZ fabric',$3,$3,'KG')`, [soId, fabricId, QTY]);

    const after = await mrp.yarnRequirement();
    const line = lineFor(after, yarnId);
    ok(!!line, 'the fabric\'s yarn appears in the requirement');
    const delta = Math.round((line.required_kg - beforeReq) * 100) / 100;
    ok(Math.abs(delta - expectedDelta) < 0.5, 'requirement rose by fabric kg × blend% × (1+loss)', `Δ${delta} vs ${expectedDelta}`);

    console.log('\nShortfall = required − on-hand − on-order');
    const expectShort = Math.max(Math.round((line.required_kg - line.on_hand_kg - line.on_order_kg) * 100) / 100, 0);
    ok(Math.abs(line.shortfall_kg - expectShort) < 0.01, 'shortfall is netted correctly', `${line.shortfall_kg} vs ${expectShort}`);
    ok(typeof after.total_shortfall_kg === 'number' && typeof after.short_items === 'number', 'totals are returned');

  } finally {
    if (soId) {
      await pool.query(`DELETE FROM sales_order_items WHERE so_id=$1`, [soId]).catch(() => {});
      await pool.query(`DELETE FROM sales_orders WHERE so_id=$1`, [soId]).catch(() => {});
    }
  }
  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
