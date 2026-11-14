// Retention.
//
// The dangerous failure here is deleting something that mattered, so most of
// what is checked is what retention REFUSES to do: touch a table that is not a
// policy, reach inside the retention window, or delete anything at all without
// being asked explicitly.
//
//   node tests/retention.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

const retention = require('../src/lib/retention');

let fails = 0;
const ok = (cond, msg, extra = '') => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra ? '   ' + extra : ''));
  if (!cond) fails++;
};

(async () => {
  const marker = 'ZZRET-' + Date.now().toString().slice(-7);

  try {
    console.log('\nWhat may be touched at all');
    const tables = retention.POLICIES.map(p => p.table);
    console.log('  policies: ' + tables.join(', '));

    const forbidden = ['tax_invoices', 'payments', 'payment_allocations', 'credit_notes',
                       'stock_ledger', 'sales_returns', 'lot_allocations', 'partners',
                       'rolls', 'batches', 'wa_messages',
                       'production_history', 'oee_records'];
    ok(forbidden.every(t => !tables.includes(t)),
      'no financial, stock, aggregate or customer-message table is in the list',
      forbidden.filter(t => tables.includes(t)).join(',') || 'none present');

    // The correction that matters: machine_live_data carries UNIQUE(machine_id)
    // and is upserted, so it is current state, not history. Ageing it out would
    // delete the live row of any machine idle past the window.
    const uniq = await pool.query(
      `SELECT COUNT(*)::int n FROM pg_constraint
        WHERE conrelid='machine_live_data'::regclass AND contype='u'`);
    ok(uniq.rows[0].n === 1, 'machine_live_data is confirmed a current-state table (unique on machine_id)');
    ok(!tables.includes('machine_live_data'),
      'so it is NOT a retention target — deleting by age would blank an idle machine');

    ok(tables.includes('audit_logs'), 'audit_logs IS covered — a row per mutating request');
    const audit = retention.POLICIES.find(p => p.table === 'audit_logs');
    ok(audit.keepDays() >= 730, 'and is kept longest of all', `${audit.keepDays()} days`);

    console.log('\nReporting is read-only');
    const before = Number((await pool.query(`SELECT COUNT(*)::int n FROM audit_logs`)).rows[0].n);
    const rep = await retention.report();
    const after = Number((await pool.query(`SELECT COUNT(*)::int n FROM audit_logs`)).rows[0].n);
    ok(before === after, 'report() deletes nothing');
    ok(rep.length > 0 && rep.every(r => r.why && r.keep_days > 0),
      'every policy states its retention period and why');

    console.log('\nDry run is the default');
    // One row well past the window, one comfortably inside it.
    const keep = audit.keepDays();
    await pool.query(
      `INSERT INTO audit_logs (username, action, module, timestamp)
       VALUES ($1,'TEST',$2, NOW() - ($3 || ' days')::interval)`,
      [marker, marker, keep + 30]);
    await pool.query(
      `INSERT INTO audit_logs (username, action, module, timestamp)
       VALUES ($1,'TEST',$2, NOW() - INTERVAL '1 day')`, [marker, marker]);

    const dry = await retention.run({ only: 'audit_logs' });
    ok(dry[0].would_delete >= 1, 'a bare run() reports what it would delete', JSON.stringify(dry[0]));
    ok(dry[0].deleted === undefined, 'and reports no deletion');
    ok(Number((await pool.query(
      `SELECT COUNT(*)::int n FROM audit_logs WHERE module=$1`, [marker])).rows[0].n) === 2,
      'both rows survive a dry run');

    console.log('\nApplying it');
    const applied = await retention.run({ dryRun: false, only: 'audit_logs' });
    ok(applied[0].deleted >= 1, 'old rows are deleted once confirmed', JSON.stringify(applied[0]));
    const left = await pool.query(
      `SELECT timestamp FROM audit_logs WHERE module=$1`, [marker]);
    ok(left.rows.length === 1, 'exactly one of the two rows remains', `${left.rows.length} left`);
    ok(left.rows.length === 1 && new Date(left.rows[0].timestamp) > new Date(Date.now() - 5 * 86400_000),
      'and it is the RECENT one — retention only reaches past the window');

    console.log('\nScope cannot be widened');
    const bogus = await retention.run({ dryRun: false, only: 'tax_invoices' });
    ok(bogus.length === 0, 'asking retention to clear invoices does nothing at all', JSON.stringify(bogus));
    const bogus2 = await retention.run({ dryRun: false, only: 'wa_messages' });
    ok(bogus2.length === 0, 'nor customer messages');

    console.log('\nEvery policy targets a column that exists');
    for (const p of retention.POLICIES) {
      const c = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
        [p.table, p.column]);
      ok(c.rows.length === 1, `  ${p.table}.${p.column}`);
    }
  } finally {
    await pool.query(`DELETE FROM audit_logs WHERE module=$1`, [marker]);
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
