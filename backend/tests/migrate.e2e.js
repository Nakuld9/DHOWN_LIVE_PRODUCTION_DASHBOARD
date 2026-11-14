// The migration runner.
//
// What is worth asserting is not "it ran SQL" but the properties that make a
// migration history trustworthy: it runs a change exactly once, a failure leaves
// nothing half-applied, editing an applied migration is detected, and the
// fingerprint actually changes when the schema does.
//
//   node tests/migrate.e2e.js

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const migrate = require('../src/db/migrate');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

const DIR = path.join(__dirname, '..', 'migrations');
let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};

const stamp = Date.now().toString().slice(-7);
const OKFILE = `9990-zz-test-${stamp}.js`;
const BADFILE = `9991-zz-test-fail-${stamp}.js`;
const written = [];

const write = (name, body) => {
  const p = path.join(DIR, name);
  fs.writeFileSync(p, body);
  written.push(p);
  return p;
};

(async () => {
  try {
    console.log('\nBaseline');
    const s0 = await migrate.status();
    ok(s0.history.some(h => h.name === migrate.LEGACY_BASELINE),
      'the pre-existing hand-run scripts are recorded as baseline, not re-run');
    ok(s0.fingerprint.hash && s0.fingerprint.tables > 100,
      'a schema fingerprint is produced', `${s0.fingerprint.hash} · ${s0.fingerprint.tables} tables`);

    console.log('\nA migration runs exactly once');
    write(OKFILE, `module.exports = { async up(client) {
      await client.query('CREATE TABLE IF NOT EXISTS zz_migrate_${stamp} (id int)');
    } };`);

    const dry = await migrate.run({ dryRun: true });
    ok(dry.some(r => r.name === OKFILE && r.status === 'pending'), 'a dry run reports it as pending');
    ok((await pool.query(
      `SELECT COUNT(*)::int n FROM information_schema.tables WHERE table_name = $1`,
      [`zz_migrate_${stamp}`])).rows[0].n === 0, 'and changes nothing');

    const r1 = await migrate.run({ by: 'test' });
    ok(r1.some(r => r.name === OKFILE && r.status === 'applied'), 'applying it works');
    ok((await pool.query(
      `SELECT COUNT(*)::int n FROM information_schema.tables WHERE table_name = $1`,
      [`zz_migrate_${stamp}`])).rows[0].n === 1, 'and the table exists');

    const r2 = await migrate.run({ by: 'test' });
    ok(!r2.some(r => r.name === OKFILE), 'running again does NOT re-apply it');
    ok((await pool.query(
      `SELECT COUNT(*)::int n FROM schema_migrations WHERE name = $1`, [OKFILE])).rows[0].n === 1,
      'and it is recorded exactly once');

    console.log('\nEditing an applied migration is detected');
    fs.writeFileSync(path.join(DIR, OKFILE),
      fs.readFileSync(path.join(DIR, OKFILE), 'utf8') + '\n// edited after applying\n');
    const r3 = await migrate.run({ by: 'test' });
    ok(r3.some(r => r.name === OKFILE && r.status === 'drift'),
      'checksum drift is flagged rather than silently ignored');

    console.log('\nA failure leaves nothing half-applied');
    write(BADFILE, `module.exports = { async up(client) {
      await client.query('CREATE TABLE zz_migrate_bad_${stamp} (id int)');
      throw new Error('deliberate failure');
    } };`);
    const r4 = await migrate.run({ by: 'test' });
    ok(r4.some(r => r.name === BADFILE && r.status === 'failed'), 'the failure is reported');
    ok((await pool.query(
      `SELECT COUNT(*)::int n FROM information_schema.tables WHERE table_name = $1`,
      [`zz_migrate_bad_${stamp}`])).rows[0].n === 0,
      'the table it created before throwing was rolled back');
    ok((await pool.query(
      `SELECT COUNT(*)::int n FROM schema_migrations WHERE name = $1`, [BADFILE])).rows[0].n === 0,
      'and it is NOT recorded as applied, so it will be retried');

    console.log('\nThe fingerprint tracks the schema');
    const before = (await migrate.fingerprint()).hash;
    await pool.query(`CREATE TABLE zz_fp_${stamp} (id int)`);
    const after = (await migrate.fingerprint()).hash;
    ok(before !== after, 'it changes when the schema changes', `${before} -> ${after}`);
    await pool.query(`DROP TABLE zz_fp_${stamp}`);
    ok((await migrate.fingerprint()).hash === before, 'and returns when the change is reverted');
  } finally {
    for (const p of written) { try { fs.unlinkSync(p); } catch {} }
    await pool.query(`DROP TABLE IF EXISTS zz_migrate_${stamp}`).catch(() => {});
    await pool.query(`DROP TABLE IF EXISTS zz_migrate_bad_${stamp}`).catch(() => {});
    await pool.query(`DROP TABLE IF EXISTS zz_fp_${stamp}`).catch(() => {});
    await pool.query(`DELETE FROM schema_migrations WHERE name LIKE '9990-zz-test-%' OR name LIKE '9991-zz-test-%'`).catch(() => {});
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
