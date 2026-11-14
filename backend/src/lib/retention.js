// Data retention.
//
// A note on what does NOT belong here, because it was the obvious guess and it
// was wrong: machine_live_data is not a time series. It carries UNIQUE
// (machine_id) and is upserted, so it holds exactly one current-state row per
// machine and does not grow at all. Ageing it out by timestamp would have
// deleted the live row of any machine idle longer than the window, blanking its
// dashboard tile. It is deliberately absent from the policies below.
//
// What actually accumulates is append-only history: audit_logs (a row per
// mutating request), machine_status_log (a row per run/stop transition),
// rfid_events (a row per scan), and the WhatsApp queue tables.
//
// Two rules this module will not break:
//
//   1. Only telemetry and logs are ever touched. Financial and business records —
//      invoices, payments, credit notes, stock ledger, returns, allocations — are
//      not in the policy list and cannot be added by configuration. Deleting a
//      receivable to save disk is not a trade anyone would make. Neither are
//      production_history and oee_records: they are the compact aggregates that
//      make the raw history disposable, so they outlive it.
//
//   2. wa_messages is excluded too. It looks like a log and is not — it is the
//      record of what was said to a customer, and it is small.

const pool = require('../../config/database');
const obs = require('./observability');

const days = (k, d) => {
  const v = parseInt(process.env[k], 10);
  return Number.isFinite(v) && v > 0 ? v : d;
};

// Delete in batches so a long-running statement never holds a lock across the
// whole table while the factory is writing to it.
const BATCH = 20_000;

// The complete list of what may be aged out. Anything not here is untouchable.
//
// `guard` runs before deletion and must return true, or the table is skipped
// with a reason. It is how rule 2 is enforced.
const POLICIES = [
  {
    table: 'machine_status_log',
    column: 'start_time',
    keepDays: () => days('RETAIN_STATUS_LOG_DAYS', 365),
    why: 'run/stop transitions; a year covers seasonal downtime comparison',
  },
  {
    table: 'rfid_events',
    column: 'event_time',
    keepDays: () => days('RETAIN_RFID_DAYS', 180),
    why: 'operator tag scans',
  },
  {
    table: 'wa_webhook_events',
    column: 'received_at',
    keepDays: () => days('RETAIN_WEBHOOK_EVENTS_DAYS', 30),
    why: 'processed webhook queue; the messages themselves are kept in wa_messages',
    where: `status IN ('DONE','DEAD')`,
  },
  {
    table: 'wa_processed_events',
    column: 'created_at',
    keepDays: () => days('RETAIN_PROCESSED_EVENTS_DAYS', 30),
    why: 'idempotency claims; Meta does not redeliver a month-old message',
  },
  {
    // Kept longest of all. An audit trail is the thing you want when something
    // has gone wrong, and that question is usually asked late.
    table: 'audit_logs',
    column: 'timestamp',
    keepDays: () => days('RETAIN_AUDIT_DAYS', 730),
    why: 'who changed what; two years',
  },
];

async function tableExists(name) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [name]);
  return r.rows.length > 0;
}

// What retention WOULD remove. Safe to call any time and the only thing the
// scheduled job runs first.
async function report() {
  const out = [];
  for (const p of POLICIES) {
    if (!(await tableExists(p.table))) continue;
    const keep = p.keepDays();
    const cutoff = new Date(Date.now() - keep * 86400_000).toISOString();
    const r = await pool.query(
      `SELECT COUNT(*)::bigint AS n, MIN(${p.column}) AS oldest
         FROM ${p.table}
        WHERE ${p.column} < $1 ${p.where ? `AND ${p.where}` : ''}`, [cutoff]);
    const total = await pool.query(`SELECT COUNT(*)::bigint AS n FROM ${p.table}`);
    out.push({
      table: p.table, keep_days: keep, cutoff,
      eligible: Number(r.rows[0].n), total: Number(total.rows[0].n),
      oldest: r.rows[0].oldest, why: p.why,
    });
  }
  return out;
}

// Apply the policies. dryRun defaults to TRUE: deleting rows is irreversible and
// should be something a caller asks for explicitly, not something that happens
// because an argument was forgotten.
async function run({ dryRun = true, only = null } = {}) {
  const results = [];
  for (const p of POLICIES) {
    if (only && p.table !== only) continue;
    if (!(await tableExists(p.table))) {
      results.push({ table: p.table, skipped: 'table does not exist' });
      continue;
    }

    const keep = p.keepDays();
    const cutoff = new Date(Date.now() - keep * 86400_000).toISOString();

    if (p.guard) {
      const g = await p.guard(cutoff);
      if (!g.ok) {
        obs.log('warn', 'retention.skipped', { table: p.table, reason: g.reason });
        results.push({ table: p.table, skipped: g.reason });
        continue;
      }
    }

    const eligible = Number((await pool.query(
      `SELECT COUNT(*)::bigint AS n FROM ${p.table}
        WHERE ${p.column} < $1 ${p.where ? `AND ${p.where}` : ''}`, [cutoff])).rows[0].n);

    if (!eligible) { results.push({ table: p.table, deleted: 0, cutoff }); continue; }
    if (dryRun) { results.push({ table: p.table, would_delete: eligible, cutoff }); continue; }

    // Batched delete. ctid is used because several of these tables have no
    // single-column key that is cheap to filter on.
    let deleted = 0;
    for (;;) {
      const r = await pool.query(
        `DELETE FROM ${p.table}
          WHERE ctid IN (
            SELECT ctid FROM ${p.table}
             WHERE ${p.column} < $1 ${p.where ? `AND ${p.where}` : ''}
             LIMIT ${BATCH})`, [cutoff]);
      deleted += r.rowCount;
      if (r.rowCount < BATCH) break;
    }
    obs.log('info', 'retention.deleted', { table: p.table, rows: deleted, cutoff });
    obs.inc('retention_rows_deleted_total', deleted);
    results.push({ table: p.table, deleted, cutoff });
  }
  return results;
}

// Daily at 03:00, an hour after the backup so a night's deletions are always
// already captured in a dump that predates them.
function schedule() {
  const tick = async () => {
    const now = new Date();
    if (now.getHours() !== 3 || now.getMinutes() >= 10) return;
    try {
      const res = await run({ dryRun: false });
      const removed = res.filter(r => r.deleted > 0);
      if (removed.length) obs.log('info', 'retention.run', { removed });
    } catch (e) {
      obs.log('error', 'retention.failed', { error: e.message });
    }
  };
  // Every ten minutes, matching how the other schedulers in this codebase work.
  setInterval(tick, 10 * 60 * 1000);
}

module.exports = { report, run, schedule, POLICIES };
