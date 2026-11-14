// Defect-type master management — create, rename (with dup guard), deactivate.
// The defect name is text on inspections, so deactivate hides it without erasing
// history; that separation is what is checked here.
//
//   node tests/defect-types.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

const svc = require('../src/lib/defect-types')(pool);
const NAME = 'ZZ Test Defect ' + Date.now().toString().slice(-5);
let id;

(async () => {
  try {
    console.log('\nCreate, and refuse a duplicate');
    const c = await svc.create({ name: NAME, description: 'a test defect' });
    ok(c.ok && c.defect.is_active === true, 'creates an active defect type');
    id = c.defect.id;
    const dup = await svc.create({ name: NAME.toUpperCase() });
    ok(dup.code === 409, 'a duplicate name (any case) is refused', dup.error);

    console.log('\nRename and reorder');
    const u = await svc.update(id, { name: NAME + ' R', sort_order: 99, description: 'edited' });
    ok(u.ok && u.defect.name === NAME + ' R' && Number(u.defect.sort_order) === 99, 'rename + reorder applied');

    console.log('\nDeactivate hides it from the active list but keeps the row');
    await svc.setActive(id, false);
    const all = await svc.listAll();
    const row = all.find(x => x.id === id);
    ok(row && row.is_active === false, 'row still exists, marked inactive');
    // The inspection screen's active-only list must not include it.
    const active = (await pool.query(`SELECT 1 FROM defect_types WHERE id=$1 AND is_active=true`, [id]));
    ok(active.rowCount === 0, 'excluded from the active-only list inspections use');

    const re = await svc.setActive(id, true);
    ok(re.ok && re.defect.is_active === true, 'can be reactivated');
  } finally {
    await pool.query(`DELETE FROM defect_types WHERE id=$1`, [id]).catch(() => {});
  }
  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
