const { classifyError } = require('./errors');

/**
 * The queue worker.
 *
 * Offline mode is the whole point of this loop: when the BUSY PC is
 * unreachable the worker backs off and the queue simply grows. The dashboard
 * keeps accepting dispatches, the factory keeps running, and nothing is lost.
 * When BUSY returns, the queue drains in order.
 */
class QueueWorker {
  constructor(pool, queue, sync, adapter, opts, logger = console) {
    this.pool = pool;
    this.queue = queue;
    this.sync = sync;
    this.adapter = adapter;
    this.opts = opts;
    this.logger = logger;
    this.timer = null;
    this.running = false;
    this.stopped = true;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.logger.log(`[BUSY] queue worker started (adapter=${this.adapter.name}, poll=${this.opts.pollIntervalMs}ms)`);
    const loop = () => {
      if (this.stopped) return;
      this.tick()
        .catch(() => {})
        .finally(() => {
          if (!this.stopped) {
            this.timer = setTimeout(loop, this.opts.pollIntervalMs);
            if (this.timer.unref) this.timer.unref();
          }
        });
    };
    this.timer = setTimeout(loop, 0);
    if (this.timer.unref) this.timer.unref();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Let an in-flight tick finish so we never abandon a job mid-send.
    while (this.running) await new Promise((r) => setTimeout(r, 10));
  }

  /**
   * One pass. Exposed so tests and the dashboard's "Process queue now" button
   * can drive the worker deterministically instead of waiting on the timer.
   */
  async tick() {
    if (this.running) return { processed: 0, online: (await this.connectionState()).online };
    this.running = true;
    try {
      await this.releaseStale();

      const status = await this.adapter.testConnection();
      await this.recordConnection(status.online, status.online ? null : 'CONNECTION_ERROR', status.message);

      if (!status.online) {
        // BUSY is down. Do not burn attempt budget on jobs that cannot
        // possibly succeed — that would march them to MANUAL_REVIEW during a
        // routine outage. Leave them queued.
        return { processed: 0, online: false };
      }

      // Collect acknowledgements for anything handed over asynchronously.
      await this.sync.pollAwaitingBusy();

      const batch = await this.queue.claimBatch(this.opts.batchSize);
      let processed = 0;
      for (const item of batch) {
        await this.sync.process(item);
        processed += 1;
      }
      if (processed > 0) this.logger.log(`[BUSY] processed ${processed} queued transaction(s)`);
      return { processed, online: true };
    } catch (err) {
      const be = classifyError(err);
      await this.recordConnection(false, be.code, be.message).catch(() => {});
      this.logger.error(`[BUSY] worker tick failed: ${be.code} ${be.message}`);
      return { processed: 0, online: false };
    } finally {
      this.running = false;
    }
  }

  async releaseStale() {
    const staleMs = this.opts.staleProcessingMs || Math.max(this.opts.pollIntervalMs * 10, 60000);
    const released = await this.queue.releaseStaleProcessing(new Date(Date.now() - staleMs));
    if (released > 0) this.logger.warn(`[BUSY] released ${released} orphaned PROCESSING job(s)`);
  }

  async recordConnection(online, errorCode, message) {
    await this.pool.query(
      `UPDATE busy_connection_state
          SET online = $1, last_checked_at = NOW(), adapter = $2,
              last_success_at = CASE WHEN $1 THEN NOW() ELSE last_success_at END,
              last_error_code = $3, last_error_message = $4
        WHERE id = 1`,
      [online, this.adapter.name, errorCode, message],
    );
  }

  async connectionState() {
    const { rows } = await this.pool.query('SELECT * FROM busy_connection_state WHERE id = 1');
    const row = rows[0] || {};
    return {
      online: row.online === true,
      lastCheckedAt: row.last_checked_at || null,
      lastSuccessAt: row.last_success_at || null,
      lastErrorCode: row.last_error_code || null,
      lastErrorMessage: row.last_error_message || null,
      adapter: row.adapter || null,
    };
  }
}

module.exports = { QueueWorker };
