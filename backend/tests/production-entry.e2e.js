// Manual shift-production entry: entering rolls creates closed greige rolls that
// immediately show up in the production summary and count as greige stock — the
// point of the feature (data without a collector). ZZ machine, torn down.
//
//   node tests/production-entry.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});
const entry = require('../src/lib/production-entry')(pool);
const prodSummary = require('../src/ai/tools/production.tools'); // registered into a registry
const { createRegistry } = require('../src/ai/tool-registry');

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

(async () => {
  const MACH = 'ZZPE' + Date.now().toString().slice(-4);
  await pool.query(`INSERT INTO machines (machine_id, machine_name, fabric) VALUES ($1,'ZZ PE Test','Single Jersey') ON CONFLICT DO NOTHING`, [MACH]);
  const today = new Date().toISOString().slice(0, 10);

  // Production summary tool (reads rolls closed today).
  const reg = createRegistry(); prodSummary(reg, { pool });
  const summaryToday = async () => (await reg.call('get_production_summary', {}, { role: 'SUPERVISOR', allowed: ['get_production_summary'] }));

  try {
    const before = await summaryToday();

    console.log('\nEntering a shift creates closed greige rolls');
    const out = await entry.create({ machine_id: MACH, shift: 'A', date: today, rolls: [{ weight_kg: 24.5 }, { weight_kg: 25.5 }, { weight_kg: 26 }] }, 'tester');
    ok(out.ok && out.rolls === 3, 'three rolls recorded', `${out.rolls}`);
    ok(out.total_kg === 76, 'total weight summed', `${out.total_kg}`);

    const rows = (await pool.query(`SELECT status, warehouse_status, source, shift FROM rolls WHERE machine_id=$1`, [MACH])).rows;
    ok(rows.length === 3 && rows.every(r => r.status === 'CLOSED' && r.warehouse_status === 'IN_STOCK' && r.source === 'MANUAL'),
      'rolls are CLOSED, in stock, marked MANUAL');

    console.log('\nThe production summary picks them up immediately');
    const after = await summaryToday();
    ok(after.total_rolls - before.total_rolls === 3, 'production summary rolls +3', `${before.total_rolls}→${after.total_rolls}`);
    ok(Math.round((after.total_kg - before.total_kg) * 100) / 100 === 76, 'production summary kg +76', `Δ${Math.round((after.total_kg - before.total_kg) * 100) / 100}`);

    console.log('\nValidation');
    ok((await entry.create({ machine_id: MACH, shift: 'A', rolls: [] })).code === 400, 'no rolls → 400');
    ok((await entry.create({ machine_id: 'NOPE', shift: 'A', rolls: [{ weight_kg: 5 }] })).code === 404, 'unknown machine → 404');

  } finally {
    await pool.query(`DELETE FROM rolls WHERE machine_id=$1`, [MACH]).catch(() => {});
    await pool.query(`DELETE FROM machines WHERE machine_id=$1`, [MACH]).catch(() => {});
  }
  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
