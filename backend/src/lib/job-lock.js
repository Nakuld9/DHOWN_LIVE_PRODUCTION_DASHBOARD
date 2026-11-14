// Distributed job locks (CRIT-06).
//
// Every scheduled job runs on an in-process timer, so starting a second
// instance — for high availability, or just a zero-downtime deploy — would run
// each job twice: two follow-up scans, two backups, duplicate WhatsApp alerts.
//
// A lease in the database means exactly one instance runs a job. The lease has
// an expiry rather than a boolean, so an instance that dies mid-job releases it
// automatically instead of blocking that job forever.

const os = require('os');
const obs = require('./observability');
const { withDbRetry } = require('./boot-ensure');

const INSTANCE = `${os.hostname()}:${process.pid}`;

// Jobs mostly first-tick together shortly after boot, when the pool is busiest,
// so a lock query can hit the same transient "connection terminated" timeout the
// boot ensures did. Retry briefly with backoff; track:false keeps these out of
// the one-shot boot health-check registry (they are recurring, not schema).
const LOCK_RETRY = { tries: 4, baseMs: 300, maxMs: 3000, track: false };

// First-tick stagger (see schedule()): each scheduled job pushes its initial
// delay STAGGER_MS further out so they do not all fire together after boot.
const STAGGER_MS = 2500;
let scheduleOffset = 0;

module.exports = (pool) => {

  // Try to take the lease. Wins if nobody holds it, the lease has expired, or
  // this instance already holds it (re-entrant across restarts).
  async function acquire(jobName, ttlSeconds = 300) {
    try {
      const r = await withDbRetry(`joblock.acquire:${jobName}`, () => pool.query(
        `INSERT INTO job_locks (job_name, locked_by, locked_until)
         VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval)
         ON CONFLICT (job_name) DO UPDATE
            SET locked_by = EXCLUDED.locked_by,
                locked_until = EXCLUDED.locked_until
          WHERE job_locks.locked_until IS NULL
             OR job_locks.locked_until < NOW()
             OR job_locks.locked_by = EXCLUDED.locked_by
         RETURNING job_name`,
        [jobName, INSTANCE, String(ttlSeconds)]), LOCK_RETRY);
      return r.rows.length > 0;
    } catch (e) {
      // If the lock table itself is unavailable, run the job rather than
      // silently stopping all scheduled work.
      obs.log('error', 'joblock.acquire.failed', { job: jobName, error: e.message });
      return true;
    }
  }

  async function release(jobName, { status, error } = {}) {
    try {
      await withDbRetry(`joblock.release:${jobName}`, () => pool.query(
        `UPDATE job_locks
            SET locked_until = NULL, last_run_at = NOW(),
                last_status = $2, last_error = $3
          WHERE job_name = $1 AND locked_by = $4`,
        [jobName, status || 'ok', error ? String(error).slice(0, 400) : null, INSTANCE]), LOCK_RETRY);
    } catch (e) { obs.log('error', 'joblock.release.failed', { job: jobName, error: e.message }); }
  }

  // Wrap a job so it only runs when this instance holds the lease.
  async function run(jobName, fn, { ttlSeconds = 300 } = {}) {
    if (!(await acquire(jobName, ttlSeconds))) {
      obs.log('info', 'joblock.skipped', { job: jobName, reason: 'held by another instance' });
      return { skipped: true };
    }
    const t0 = Date.now();
    try {
      const result = await fn();
      await release(jobName, { status: 'ok' });
      obs.observe('job_duration', Date.now() - t0, { job: jobName });
      obs.inc('job_runs_total', { job: jobName, result: 'ok' });
      return { skipped: false, result };
    } catch (e) {
      await release(jobName, { status: 'error', error: e.message });
      obs.inc('job_runs_total', { job: jobName, result: 'error' });
      obs.log('error', 'job.failed', { job: jobName, error: e.message });
      return { skipped: false, error: e };
    }
  }

  // setInterval replacement: same signature, but lock-guarded.
  //
  // First ticks are STAGGERED: every job used the same 60s initial delay, so all
  // ten fired at once and stampeded the lock table (and the pool) right when boot
  // work was still finishing — the source of the boot-time lock timeouts. Each
  // schedule() call now offsets its first tick a few seconds further out so they
  // spread instead of colliding. The steady-state interval is unchanged.
  function schedule(jobName, fn, everyMs, { ttlSeconds, delayMs = 60000 } = {}) {
    const tick = () => run(jobName, fn, { ttlSeconds: ttlSeconds || Math.ceil(everyMs / 1000) });
    const firstDelay = delayMs + scheduleOffset;
    scheduleOffset += STAGGER_MS;
    setInterval(tick, everyMs);
    setTimeout(tick, firstDelay);
  }

  async function status() {
    const r = await pool.query(
      `SELECT job_name, locked_by, locked_until, last_run_at, last_status, last_error
         FROM job_locks ORDER BY job_name`);
    return r.rows;
  }

  return { acquire, release, run, schedule, status, INSTANCE };
};
