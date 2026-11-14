// Durable inbound queue (CRIT-01), backed by Postgres.
//
// Redis + BullMQ is the textbook answer, but this deployment is a single Windows
// host with no Redis. Postgres is already here, already backed up and already
// monitored, and FOR UPDATE SKIP LOCKED gives correct concurrent claiming. That
// buys the properties that actually matter — survives a crash, retries with
// backoff, dead-letters, replayable — with no new infrastructure to run.
// It does not buy horizontal scale; job_locks covers the multi-instance case.

const os = require('os');
const obs = require('./observability');

const WORKER    = `${os.hostname()}:${process.pid}`;
const POLL_MS   = Number(process.env.WA_QUEUE_POLL_MS) || 2000;
const BATCH     = Number(process.env.WA_QUEUE_BATCH) || 5;
const MAX_TRIES = Number(process.env.WA_QUEUE_MAX_ATTEMPTS) || 5;
// 10s, 40s, 90s, 160s… — quick enough for a blip, slow enough not to hammer a
// provider that is genuinely down.
const backoffSeconds = (attempt) => Math.min(10 * attempt * attempt, 900);

module.exports = (pool, { processor } = {}) => {

  // Called by the HTTP handler BEFORE it acks Meta. If this insert fails the
  // request must not return 200 — Meta redelivering is the desired outcome.
  async function enqueue(payload) {
    const r = await pool.query(
      `INSERT INTO wa_webhook_events (payload) VALUES ($1) RETURNING event_id`,
      [JSON.stringify(payload)]);
    obs.inc('wa_queue_enqueued_total');
    return r.rows[0].event_id;
  }

  // SKIP LOCKED so several workers can drain the queue without contending or
  // double-processing.
  async function claim(limit = BATCH) {
    const r = await pool.query(
      `UPDATE wa_webhook_events SET status='WORKING', locked_by=$1, attempts = attempts + 1
        WHERE event_id IN (
          SELECT event_id FROM wa_webhook_events
           WHERE status='PENDING' AND next_attempt_at <= NOW()
           ORDER BY event_id
           FOR UPDATE SKIP LOCKED
           LIMIT $2)
        RETURNING event_id, payload, attempts`, [WORKER, limit]);
    return r.rows;
  }

  async function complete(eventId) {
    await pool.query(
      `UPDATE wa_webhook_events SET status='DONE', processed_at=NOW(), locked_by=NULL, last_error=NULL
        WHERE event_id=$1`, [eventId]);
    obs.inc('wa_queue_processed_total', { result: 'ok' });
  }

  async function fail(eventId, attempts, error) {
    const dead = attempts >= MAX_TRIES;
    await pool.query(
      // $2 is cast explicitly: used both as a value and inside a comparison,
      // Postgres cannot otherwise deduce one type for it.
      `UPDATE wa_webhook_events
          SET status = $2::varchar,
              locked_by = NULL,
              last_error = $3,
              next_attempt_at = NOW() + ($4 || ' seconds')::interval,
              processed_at = CASE WHEN $2::varchar = 'DEAD' THEN NOW() ELSE NULL END
        WHERE event_id = $1`,
      [eventId, dead ? 'DEAD' : 'PENDING', String(error).slice(0, 800),
       String(dead ? 0 : backoffSeconds(attempts))]);

    obs.inc('wa_queue_processed_total', { result: dead ? 'dead' : 'retry' });
    obs.log(dead ? 'error' : 'warn', dead ? 'wa.queue.dead' : 'wa.queue.retry',
      { event_id: eventId, attempts, error: String(error).slice(0, 200) });
  }

  async function drain() {
    if (!processor) return 0;
    const batch = await claim();
    for (const ev of batch) {
      try {
        await processor.process(ev.payload, ev.event_id);
        await complete(ev.event_id);
      } catch (e) {
        await fail(ev.event_id, ev.attempts, e.message);
      }
    }
    return batch.length;
  }

  // Events stuck in WORKING because the process died mid-flight. Without this
  // they would never be retried — the exact loss this queue exists to prevent.
  async function recoverStuck(minutes = 10) {
    const r = await pool.query(
      `UPDATE wa_webhook_events
          SET status='PENDING', locked_by=NULL,
              last_error=COALESCE(last_error,'') || ' [recovered from stuck WORKING]'
        WHERE status='WORKING' AND received_at < NOW() - ($1 || ' minutes')::interval
        RETURNING event_id`, [String(minutes)]);
    if (r.rows.length) obs.log('warn', 'wa.queue.recovered', { count: r.rows.length });
    return r.rows.length;
  }

  async function stats() {
    const r = await pool.query(
      `SELECT status, COUNT(*)::int n,
              MIN(received_at) FILTER (WHERE status='PENDING') AS oldest_pending
         FROM wa_webhook_events GROUP BY status`);
    const out = { PENDING: 0, WORKING: 0, DONE: 0, DEAD: 0, oldest_pending: null };
    for (const row of r.rows) {
      out[row.status] = row.n;
      if (row.oldest_pending) out.oldest_pending = row.oldest_pending;
    }
    obs.gauge('wa_queue_depth', out.PENDING);
    obs.gauge('wa_queue_dead', out.DEAD);
    return out;
  }

  async function listDead(limit = 100) {
    const r = await pool.query(
      `SELECT event_id, attempts, last_error, received_at, processed_at, payload
         FROM wa_webhook_events WHERE status='DEAD'
        ORDER BY received_at DESC LIMIT $1`, [limit]);
    return r.rows;
  }

  // Put a dead event back in the queue after the underlying problem is fixed.
  async function replay(eventId) {
    const r = await pool.query(
      `UPDATE wa_webhook_events
          SET status='PENDING', attempts=0, next_attempt_at=NOW(), last_error=NULL, processed_at=NULL
        WHERE event_id=$1 AND status='DEAD' RETURNING event_id`, [eventId]);
    if (!r.rows.length) return { error: 'Event not found or not dead', code: 404 };
    obs.log('info', 'wa.queue.replay', { event_id: eventId });
    return { ok: true };
  }

  // Keep DONE rows for a week — long enough to investigate, short enough that
  // the table does not grow without bound. DEAD rows are never auto-purged.
  async function purge(days = 7) {
    const r = await pool.query(
      `DELETE FROM wa_webhook_events
        WHERE status='DONE' AND processed_at < NOW() - ($1 || ' days')::interval
        RETURNING event_id`, [String(days)]);
    return r.rows.length;
  }

  function startWorker() {
    // Polling, not a lock-guarded job: every instance should drain the queue.
    // SKIP LOCKED makes concurrent draining safe.
    setInterval(() => { drain().catch(e => obs.log('error', 'wa.queue.drain', { error: e.message })); }, POLL_MS);
    setInterval(() => { recoverStuck().catch(() => {}); }, 5 * 60 * 1000);
    setInterval(() => { stats().catch(() => {}); purge().catch(() => {}); }, 60 * 60 * 1000);
    obs.log('info', 'wa.queue.worker.started', { worker: WORKER, poll_ms: POLL_MS, max_attempts: MAX_TRIES });
  }

  return { enqueue, drain, claim, complete, fail, recoverStuck, stats, listDead, replay, purge, startWorker, WORKER };
};
