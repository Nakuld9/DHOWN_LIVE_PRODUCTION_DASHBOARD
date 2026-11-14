// Schema versioning.
//
// This does NOT replace the ensure*() functions in schema.js, and that is a
// deliberate choice. Those are idempotent and describe the CURRENT SHAPE of the
// schema; they have proven themselves (they brought a second firm's database
// from 71 to 117 tables cleanly on first boot). Rewriting 118 tables of DDL into
// a sequential migration history would be a large, risky change that buys
// nothing today.
//
// What was actually missing is what ensure*() cannot express or answer:
//
//   1. A RECORD of what has run. There was none, so "does this server have that
//      change?" had no answer except reading the schema by hand.
//   2. A place for changes that are NOT idempotent — backfills, column type
//      changes, one-off data corrections. "CREATE TABLE IF NOT EXISTS" cannot
//      say "run this once, ever".
//   3. A way to compare two servers, now that there are two.
//
// So the two work together: ensure*() builds the shape, migrations carry the
// one-off changes, and both are fingerprinted.
//
// On rollback, honestly: down() is supported but a destructive change is rolled
// back by restoring a backup (see docs/DISASTER_RECOVERY.md), which is tested.
// A down() that drops a column is just another untested destructive path.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../../config/database');

const DIR = path.join(__dirname, '..', '..', 'migrations');

// The 20 migration_*.js scripts in backend/ predate this and were applied by
// hand. They are recorded as baseline rather than re-run: ensure*() already
// builds everything they created, so running them again would be at best a
// no-op and at worst destructive.
const LEGACY_BASELINE = 'baseline-2026-08-06-pre-migration-runner';

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(200) NOT NULL UNIQUE,
      checksum    VARCHAR(64),
      applied_at  TIMESTAMP NOT NULL DEFAULT NOW(),
      duration_ms INT,
      applied_by  VARCHAR(60)
    )`);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function listFiles() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter(f => /^\d+.*\.js$/.test(f))
    .sort();                                  // numeric prefixes give the order
}

async function applied() {
  const r = await pool.query(`SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name`);
  return r.rows;
}

// A fingerprint of the schema's actual shape. Two servers with the same
// fingerprint have the same structure, whatever route they took to get there —
// which is the question that matters when one firm's instance behaves oddly.
async function fingerprint() {
  const r = await pool.query(`
    SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, column_name`);
  const cons = await pool.query(`
    SELECT conrelid::regclass::text AS t, conname, contype
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace
     ORDER BY 1, 2`);

  const body = r.rows.map(x => `${x.table_name}.${x.column_name}:${x.data_type}:${x.is_nullable}`).join('|')
             + '#' + cons.rows.map(x => `${x.t}.${x.conname}:${x.contype}`).join('|');

  return {
    hash: sha(body).slice(0, 16),
    tables: new Set(r.rows.map(x => x.table_name)).size,
    columns: r.rows.length,
    constraints: cons.rows.length,
  };
}

// Record the pre-existing hand-run scripts once, so the runner starts from a
// known point instead of pretending this database is empty.
async function baseline() {
  const have = await pool.query(`SELECT 1 FROM schema_migrations WHERE name = $1`, [LEGACY_BASELINE]);
  if (have.rows.length) return false;

  const legacy = fs.readdirSync(path.join(__dirname, '..', '..'))
    .filter(f => /^migration_.*\.js$/.test(f)).sort();

  await pool.query(
    `INSERT INTO schema_migrations (name, checksum, duration_ms, applied_by)
     VALUES ($1, $2, 0, 'baseline')`,
    [LEGACY_BASELINE, sha(legacy.join(','))]);
  console.log(`[migrate] baseline recorded (${legacy.length} pre-existing scripts noted as already applied)`);
  return true;
}

// Apply everything pending, oldest first, each in its own transaction so a
// failure leaves the ones before it intact rather than half-applying a batch.
async function run({ dryRun = false, by = 'system' } = {}) {
  await ensureTable();
  await baseline();

  const done = new Map((await applied()).map(r => [r.name, r.checksum]));
  const files = listFiles();
  const results = [];

  for (const f of files) {
    const full = path.join(DIR, f);
    const src = fs.readFileSync(full, 'utf8');
    const sum = sha(src);

    if (done.has(f)) {
      // An applied migration whose file has since changed means two servers can
      // silently differ — the record says "applied" but not the same thing.
      if (done.get(f) && done.get(f) !== sum) {
        console.error(`[migrate] WARNING: ${f} was modified after being applied. `
                    + `Servers may differ. Add a new migration instead of editing an applied one.`);
        results.push({ name: f, status: 'drift' });
      }
      continue;
    }

    if (dryRun) { results.push({ name: f, status: 'pending' }); continue; }

    const mod = require(full);
    if (typeof mod.up !== 'function') {
      console.error(`[migrate] ${f} has no up() — skipped`);
      results.push({ name: f, status: 'invalid' });
      continue;
    }

    const client = await pool.connect();
    const started = Date.now();
    try {
      await client.query('BEGIN');
      await mod.up(client);
      await client.query(
        `INSERT INTO schema_migrations (name, checksum, duration_ms, applied_by) VALUES ($1,$2,$3,$4)`,
        [f, sum, Date.now() - started, by]);
      await client.query('COMMIT');
      console.log(`[migrate] applied ${f} (${Date.now() - started}ms)`);
      results.push({ name: f, status: 'applied', ms: Date.now() - started });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      // Stop rather than continue: later migrations usually assume earlier ones.
      console.error(`[migrate] FAILED ${f}: ${err.message}`);
      results.push({ name: f, status: 'failed', error: err.message });
      // No release here — the finally below owns it. Releasing in both places
      // throws "client has already been released" and masks the real failure.
      return results;
    } finally {
      client.release();
    }
  }
  return results;
}

// What the admin screen and the ops runbook both want to know.
async function status() {
  await ensureTable();
  const [rows, fp] = await Promise.all([applied(), fingerprint()]);
  const files = listFiles();
  const names = new Set(rows.map(r => r.name));
  return {
    applied: rows.length,
    pending: files.filter(f => !names.has(f)),
    last: rows.length ? rows[rows.length - 1] : null,
    fingerprint: fp,
    history: rows,
  };
}

module.exports = { run, status, fingerprint, ensureTable, LEGACY_BASELINE };
