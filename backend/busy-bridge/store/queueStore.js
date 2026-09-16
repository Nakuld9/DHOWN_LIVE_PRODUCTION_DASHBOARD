/**
 * The outbound queue.
 *
 * The dashboard never talks to BUSY directly and never waits for it. It hands
 * a record to this queue and carries on — which is what keeps the factory
 * running when the BUSY PC is off.
 */

function toItem(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    dhownEntityId: row.dhown_entity_id,
    operation: row.operation,
    payload: row.payload, // JSONB — already an object
    payloadVersion: row.payload_version,
    externalReference: row.external_reference,
    status: row.status,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
    nextRetryAt: row.next_retry_at,
    busyReference: row.busy_reference,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    errorDetails: row.error_details,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class QueueStore {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Enqueue, idempotently.
   *
   * The UNIQUE index on external_reference is the real guarantee. We attempt
   * the insert and treat a conflict as "already queued" rather than checking
   * first — a check-then-insert has a race window that two concurrent requests
   * will eventually find.
   */
  async enqueue(input) {
    const { rows } = await this.pool.query(
      `INSERT INTO busy_sync_queue
         (entity_type, dhown_entity_id, operation, payload, payload_version, external_reference, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7)
       ON CONFLICT (external_reference) DO NOTHING
       RETURNING *`,
      [
        input.entityType,
        input.dhownEntityId,
        input.operation,
        JSON.stringify(input.payload),
        input.payloadVersion || 1,
        input.externalReference,
        input.createdBy || 'DASHBOARD',
      ],
    );

    if (rows[0]) return { item: toItem(rows[0]), created: true };
    return { item: await this.findByExternalReference(input.externalReference), created: false };
  }

  async findById(id) {
    const { rows } = await this.pool.query('SELECT * FROM busy_sync_queue WHERE id = $1', [id]);
    return rows[0] ? toItem(rows[0]) : null;
  }

  async findByExternalReference(externalReference) {
    const { rows } = await this.pool.query('SELECT * FROM busy_sync_queue WHERE external_reference = $1', [
      externalReference,
    ]);
    return rows[0] ? toItem(rows[0]) : null;
  }

  /**
   * Atomically claim up to `limit` jobs that are due.
   *
   * FOR UPDATE SKIP LOCKED is the reason this is safe with more than one
   * worker (or a worker plus a supervisor clicking Retry): rows being claimed
   * by one transaction are skipped by the other rather than waited on, so the
   * same job can never be sent to BUSY twice.
   */
  async claimBatch(limit, at = new Date()) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE busy_sync_queue SET status = 'PROCESSING', updated_at = NOW()
          WHERE id IN (
            SELECT id FROM busy_sync_queue
             WHERE status = 'PENDING'
                OR (status = 'RETRY' AND (next_retry_at IS NULL OR next_retry_at <= $1))
             ORDER BY id ASC
             LIMIT $2
             FOR UPDATE SKIP LOCKED
          )
          RETURNING *`,
        [at, limit],
      );
      await client.query('COMMIT');
      return rows.map(toItem).sort((a, b) => a.id - b.id);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** Jobs handed to BUSY asynchronously whose acknowledgement we still await. */
  async awaitingBusy(limit = 100) {
    const { rows } = await this.pool.query(
      `SELECT * FROM busy_sync_queue WHERE status = 'AWAITING_BUSY' ORDER BY id ASC LIMIT $1`,
      [limit],
    );
    return rows.map(toItem);
  }

  async recordAttempt(id) {
    await this.pool.query(
      'UPDATE busy_sync_queue SET attempt_count = attempt_count + 1, last_attempt_at = NOW(), updated_at = NOW() WHERE id = $1',
      [id],
    );
  }

  async markSuccess(id, busyReference) {
    await this.pool.query(
      `UPDATE busy_sync_queue
          SET status = 'SUCCESS', busy_reference = COALESCE($2, busy_reference),
              error_code = NULL, error_message = NULL, error_details = NULL,
              next_retry_at = NULL, updated_at = NOW()
        WHERE id = $1`,
      [id, busyReference || null],
    );
  }

  async markAwaitingBusy(id, message) {
    await this.pool.query(
      `UPDATE busy_sync_queue
          SET status = 'AWAITING_BUSY', error_code = NULL, error_message = $2, error_details = NULL,
              next_retry_at = NULL, updated_at = NOW()
        WHERE id = $1`,
      [id, message || null],
    );
  }

  async markRetry(id, nextRetryAt, errorCode, errorMessage, errorDetails) {
    await this.pool.query(
      `UPDATE busy_sync_queue
          SET status = 'RETRY', next_retry_at = $2, error_code = $3, error_message = $4,
              error_details = $5, updated_at = NOW()
        WHERE id = $1`,
      [id, nextRetryAt, errorCode, errorMessage, errorDetails ? JSON.stringify(errorDetails) : null],
    );
  }

  async markFailed(id, errorCode, errorMessage, errorDetails) {
    await this.pool.query(
      `UPDATE busy_sync_queue
          SET status = 'FAILED', error_code = $2, error_message = $3, error_details = $4,
              next_retry_at = NULL, updated_at = NOW()
        WHERE id = $1`,
      [id, errorCode, errorMessage, errorDetails ? JSON.stringify(errorDetails) : null],
    );
  }

  async markManualReview(id, errorCode, errorMessage, errorDetails) {
    await this.pool.query(
      `UPDATE busy_sync_queue
          SET status = 'MANUAL_REVIEW', error_code = $2, error_message = $3, error_details = $4,
              next_retry_at = NULL, updated_at = NOW()
        WHERE id = $1`,
      [id, errorCode, errorMessage, errorDetails ? JSON.stringify(errorDetails) : null],
    );
  }

  /**
   * Supervisor-forced retry from the dashboard.
   *
   * Attempt count is deliberately NOT reset: the audit trail must keep showing
   * how many times this record has been tried in total. The job simply becomes
   * due again immediately.
   */
  async requeueForManualRetry(id) {
    const item = await this.findById(id);
    if (!item) return null;
    if (item.status === 'SUCCESS') return item; // never resend something BUSY booked
    await this.pool.query(
      `UPDATE busy_sync_queue
          SET status = 'PENDING', next_retry_at = NULL, error_code = NULL, error_message = NULL,
              error_details = NULL, updated_at = NOW()
        WHERE id = $1`,
      [id],
    );
    return this.findById(id);
  }

  /**
   * Release jobs stuck in PROCESSING because the backend was restarted
   * mid-flight. They go back to PENDING; idempotency (external reference plus
   * the BUSY-side status check) is what stops the retry creating a duplicate.
   */
  async releaseStaleProcessing(olderThan) {
    const { rowCount } = await this.pool.query(
      `UPDATE busy_sync_queue SET status = 'PENDING', updated_at = NOW()
        WHERE status = 'PROCESSING' AND updated_at < $1`,
      [olderThan],
    );
    return rowCount;
  }

  async counts() {
    const base = {
      PENDING: 0,
      PROCESSING: 0,
      AWAITING_BUSY: 0,
      SUCCESS: 0,
      FAILED: 0,
      RETRY: 0,
      MANUAL_REVIEW: 0,
    };
    const { rows } = await this.pool.query('SELECT status, COUNT(*)::int AS n FROM busy_sync_queue GROUP BY status');
    for (const r of rows) base[r.status] = r.n;
    return base;
  }

  async countToday() {
    const { rows } = await this.pool.query(
      'SELECT COUNT(*)::int AS n FROM busy_sync_queue WHERE created_at::date = CURRENT_DATE',
    );
    return rows[0].n;
  }

  async lastSuccessAt() {
    const { rows } = await this.pool.query(
      `SELECT MAX(updated_at) AS t FROM busy_sync_queue WHERE status = 'SUCCESS'`,
    );
    return rows[0].t;
  }

  async list(filter = {}) {
    const where = [];
    const params = [];
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter.entityType) {
      params.push(filter.entityType);
      where.push(`entity_type = $${params.length}`);
    }
    if (filter.search) {
      params.push(`%${filter.search}%`);
      const p = `$${params.length}`;
      where.push(`(external_reference ILIKE ${p} OR dhown_entity_id ILIKE ${p} OR busy_reference ILIKE ${p})`);
    }
    params.push(Math.min(filter.limit || 50, 200));
    params.push(filter.offset || 0);
    const sql =
      `SELECT * FROM busy_sync_queue${where.length ? ` WHERE ${where.join(' AND ')}` : ''}` +
      ` ORDER BY id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const { rows } = await this.pool.query(sql, params);
    return rows.map(toItem);
  }

  /** Recent transactions, for the reconciler's lookback window. */
  async recentCompleted(sinceDays, limit = 500) {
    const { rows } = await this.pool.query(
      `SELECT * FROM busy_sync_queue
        WHERE status IN ('SUCCESS','AWAITING_BUSY')
          AND created_at >= NOW() - ($1 || ' days')::interval
        ORDER BY id DESC LIMIT $2`,
      [String(sinceDays), limit],
    );
    return rows.map(toItem);
  }
}

module.exports = { QueueStore };
