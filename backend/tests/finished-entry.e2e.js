// Manual finished-goods entry: entering finished rolls adds finished stock AND
// makes them appear in the FINISHED inspection worklist. ZZ fabric, torn down.
//
//   node tests/finished-entry.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});
const entry = require('../src/lib/finished-entry')(pool);
const inspection = require('../src/lib/fabric-inspection')(pool);

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };
const FAB = 'ZZ Finished ' + Date.now().toString().slice(-5);

(async () => {
  const createdIds = [];
  try {
    console.log('\nEntering finished rolls creates finished stock');
    const out = await entry.create({ fabric_type: FAB, color_name: 'Navy', lot_no: 'ZZLOT1', rolls: [{ weight_kg: 40 }, { weight_kg: 42 }] }, 'tester');
    ok(out.ok && out.rolls === 2 && out.total_kg === 82, 'two finished rolls recorded, 82 kg', `${out.rolls}/${out.total_kg}`);
    createdIds.push(...out.created.map(c => c.roll_id));

    const stock = (await pool.query(
      `SELECT COUNT(*) n, COALESCE(SUM(weight_kg),0) kg FROM finished_goods WHERE fabric_type=$1 AND source='MANUAL'`, [FAB])).rows[0];
    ok(Number(stock.n) === 2 && Number(stock.kg) === 82, 'shows as finished stock', `${stock.n} rolls / ${stock.kg} kg`);

    console.log('\nThey appear in the FINISHED inspection worklist');
    const pend = await inspection.pending({ stage: 'FINISHED' });
    const mine = (pend.rolls || []).filter(r => createdIds.includes(r.roll_id));
    ok(mine.length === 2, 'both finished rolls await finished inspection', `${mine.length}`);

    console.log('\nValidation');
    ok((await entry.create({ fabric_type: FAB, rolls: [] })).code === 400, 'no rolls → 400');
    ok((await entry.create({ rolls: [{ weight_kg: 5 }] })).code === 400, 'no fabric_type → 400');

  } finally {
    await pool.query(`DELETE FROM finished_goods WHERE fabric_type=$1 AND source='MANUAL'`, [FAB]).catch(() => {});
  }
  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
