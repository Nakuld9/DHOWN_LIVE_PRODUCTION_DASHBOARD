// Order and invoice lines resolved to kilograms.
//
// Everything downstream — stock, allocation, dispatch, costing — is in kg,
// while orders are taken in whatever unit the customer buys in. That gap used
// to be bridged by someone doing the sum in their head, which is where a wrong
// number enters and is not noticed until the delivery is weighed.
//
// The three properties worth protecting, in order:
//
//   1. It never guesses. A conversion with no defensible basis is refused, and
//      the refusal is passed through rather than softened into a number.
//   2. An unconvertible line does not block the order. Refusing an order
//      because a fabric has no GSM recorded pushes it back into a WhatsApp
//      thread, which is worse than one order line with an unknown weight.
//   3. The basis is recorded. "84.2 kg" is worth little; "84.2 kg, derived
//      from GSM and width" can be checked.
//
//   node tests/line-weights.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

const weigh = require('../src/lib/line-weights')(pool);

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};

const TAG = 'ZZUOM' + Date.now().toString().slice(-6);
const made = { items: [], convs: [] };

(async () => {
  try {
    console.log('\nKilograms need no conversion');
    const native = await weigh.resolveLine({ quantity: 250, uom: 'KG', item_name: 'Plain' });
    ok(native.quantity_kg === 250, 'a kg line passes straight through', String(native.quantity_kg));
    ok(native.uom_basis === 'NATIVE', 'and is recorded as native, not converted', native.uom_basis);
    ok(native.warning === null, 'with no warning');

    ok((await weigh.resolveLine({ quantity: 100, uom: 'kg' })).quantity_kg === 100,
      'the unit is case-insensitive');

    console.log('\nIt refuses to guess');
    // No item, no factor, no physics — the one thing that must never produce
    // a plausible-looking number.
    const guess = await weigh.resolveLine({ quantity: 500, uom: 'MTR', item_name: 'Unknown fabric' });
    ok(guess.quantity_kg === null, 'metres with no item is not converted', String(guess.quantity_kg));
    ok(!!guess.warning, 'and says so');
    ok(/could not be converted/i.test(guess.warning), 'naming the line and the reason', guess.warning);
    ok(/GSM|item|factor/i.test(guess.warning), 'and what would fix it', guess.warning);

    console.log('\nGSM and width are real physics, not a fudge');
    // 1 metre weighs width_m * gsm / 1000 kg. At 180 gsm and 150 cm:
    //   1.5 * 180 / 1000 = 0.27 kg/m, so 500 m = 135 kg.
    const itemId = (await pool.query(
      `INSERT INTO items (item_code, item_name, category_id)
       VALUES ($1,'ZZ UoM Fabric',(SELECT category_id FROM item_categories ORDER BY category_id LIMIT 1))
       RETURNING item_id`, [TAG])).rows[0].item_id;
    made.items.push(itemId);
    await pool.query(
      `INSERT INTO item_fabric_attrs (item_id, finished_gsm, finished_width_cm)
       VALUES ($1, 180, 150)
       ON CONFLICT (item_id) DO UPDATE SET finished_gsm=180, finished_width_cm=150`, [itemId]);

    const derived = await weigh.resolveLine({ item_id: itemId, quantity: 500, uom: 'MTR', item_name: 'ZZ UoM Fabric' });
    ok(derived.quantity_kg === 135, '500 m at 180 gsm and 150 cm is 135 kg', String(derived.quantity_kg));
    ok(derived.uom_basis === 'DERIVED_FROM_GSM', 'and the basis says where that came from', derived.uom_basis);
    ok(derived.warning === null, 'with no warning');

    console.log('\nAn explicit factor beats a derivation');
    await pool.query(
      `INSERT INTO uom_conversions (item_id, from_uom, to_uom, factor, notes)
       VALUES ($1,'PCS','KG',0.4,'ZZ test')`, [itemId]);
    made.convs.push(itemId);
    const pcs = await weigh.resolveLine({ item_id: itemId, quantity: 250, uom: 'PCS', item_name: 'ZZ UoM Fabric' });
    ok(pcs.quantity_kg === 100, '250 pieces at 0.4 kg each is 100 kg', String(pcs.quantity_kg));
    ok(pcs.uom_basis === 'ITEM_FACTOR', 'recorded as an item factor', pcs.uom_basis);

    console.log('\nA whole document resolves, and partial totals are not mistaken for complete ones');
    const doc = await weigh.resolveAll([
      { item_id: itemId, quantity: 500, uom: 'MTR', item_name: 'ZZ UoM Fabric' },
      { quantity: 100, uom: 'KG', item_name: 'Plain kg line' },
      { quantity: 40, uom: 'MTR', item_name: 'Unmeasurable' },      // no item
    ]);
    ok(doc.lines.length === 3, 'every line comes back, in order');
    ok(doc.unresolved === 1, 'the unconvertible one is counted', String(doc.unresolved));
    ok(doc.total_kg === 235, 'the total covers only what could be resolved (135 + 100)', String(doc.total_kg));
    ok(doc.warnings.length === 1, 'with one warning');
    ok(/Unmeasurable/.test(doc.warnings[0]), 'naming the line it is about', doc.warnings[0]);

    console.log('\nAn order is written with its weights');
    const partnerId = (await pool.query(
      `INSERT INTO partners (partner_code, company_name) VALUES ($1,'ZZ UoM Customer') RETURNING partner_id`,
      [TAG])).rows[0].partner_id;
    made.partner = partnerId;

    const soRepo = require('../src/repositories/sales-orders.repository')(pool);
    const so = await soRepo.insert(TAG + '-SO', {
      partner_id: partnerId, customer_name: 'ZZ UoM Customer',
      items: [
        { item_id: itemId, item_name: 'ZZ UoM Fabric', quantity: 500, uom: 'MTR', rate: 90 },
        { item_name: 'Plain kg line', quantity: 100, uom: 'KG', rate: 240 },
      ],
      created_by: 'test',
    });
    made.so = so.so_id;

    ok(!!so.so_id, 'the order is created');
    const soLines = (await pool.query(
      `SELECT uom, quantity, quantity_kg, uom_basis FROM sales_order_items WHERE so_id=$1 ORDER BY so_item_id`,
      [so.so_id])).rows;
    ok(Number(soLines[0].quantity_kg) === 135,
      'the metres line carries its weight in kg', String(soLines[0].quantity_kg));
    ok(soLines[0].uom_basis === 'DERIVED_FROM_GSM', 'and how it was derived', soLines[0].uom_basis);
    ok(Number(soLines[1].quantity_kg) === 100, 'the kg line carries its own quantity');
    ok(so.total_kg === 235, 'and the order reports its total weight', String(so.total_kg));
    ok(so.unresolved_lines === 0, 'with nothing unresolved');

    console.log('\nAn unconvertible line does not stop the order');
    const so2 = await soRepo.insert(TAG + '-SO2', {
      partner_id: partnerId, customer_name: 'ZZ UoM Customer',
      items: [{ item_name: 'Mystery fabric', quantity: 300, uom: 'MTR', rate: 80 }],
      created_by: 'test',
    });
    made.so2 = so2.so_id;
    ok(!!so2.so_id, 'the order is still created');
    ok(so2.unresolved_lines === 1, 'the line is flagged unresolved', String(so2.unresolved_lines));
    ok(so2.uom_warnings.length === 1, 'and the warning is returned to the caller — not buried in a log');
    const l2 = (await pool.query(
      `SELECT quantity_kg FROM sales_order_items WHERE so_id=$1`, [so2.so_id])).rows[0];
    ok(l2.quantity_kg === null, 'the weight is stored as unknown rather than guessed');

  } finally {
    if (made.so) await pool.query(`DELETE FROM sales_order_items WHERE so_id=$1`, [made.so]).catch(() => {});
    if (made.so2) await pool.query(`DELETE FROM sales_order_items WHERE so_id=$1`, [made.so2]).catch(() => {});
    if (made.so) await pool.query(`DELETE FROM sales_orders WHERE so_id=$1`, [made.so]).catch(() => {});
    if (made.so2) await pool.query(`DELETE FROM sales_orders WHERE so_id=$1`, [made.so2]).catch(() => {});
    if (made.partner) await pool.query(`DELETE FROM partners WHERE partner_id=$1`, [made.partner]).catch(() => {});
    for (const id of made.convs) await pool.query(`DELETE FROM uom_conversions WHERE item_id=$1`, [id]).catch(() => {});
    for (const id of made.items) {
      await pool.query(`DELETE FROM item_fabric_attrs WHERE item_id=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM items WHERE item_id=$1`, [id]).catch(() => {});
    }
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
