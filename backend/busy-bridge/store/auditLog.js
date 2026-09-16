/**
 * Append-only audit trail.
 *
 * The rule is absolute: never silently discard an integration failure. Every
 * attempt — success, failure, duplicate, manual action — lands here with the
 * payload we sent and the response BUSY gave, so a disputed dispatch can
 * always be reconstructed months later.
 */

/** BUSY responses can be large; keep the trail useful without unbounded growth. */
const MAX_RESPONSE_CHARS = 20000;

function truncate(value) {
  if (value === undefined || value === null) return null;
  const s = String(value);
  return s.length > MAX_RESPONSE_CHARS
    ? `${s.slice(0, MAX_RESPONSE_CHARS)}\n...[truncated ${s.length - MAX_RESPONSE_CHARS} chars]`
    : s;
}

function toRow(row) {
  return {
    id: row.id,
    queueId: row.queue_id,
    entityType: row.entity_type,
    dhownEntityId: row.dhown_entity_id,
    externalReference: row.external_reference,
    operation: row.operation,
    payloadVersion: row.payload_version,
    payloadSnapshot: row.payload_snapshot,
    attemptCount: row.attempt_count,
    actor: row.actor,
    busyResponse: row.busy_response,
    busyReference: row.busy_reference,
    finalStatus: row.final_status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

class AuditLog {
  constructor(pool) {
    this.pool = pool;
  }

  async record(entry) {
    const { rows } = await this.pool.query(
      `INSERT INTO busy_audit_log
         (queue_id, entity_type, dhown_entity_id, external_reference, operation, payload_version,
          payload_snapshot, attempt_count, actor, busy_response, busy_reference,
          final_status, error_code, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        entry.queueId || null,
        entry.entityType,
        entry.dhownEntityId,
        entry.externalReference || null,
        entry.operation,
        entry.payloadVersion || 1,
        entry.payloadSnapshot ? JSON.stringify(entry.payloadSnapshot) : null,
        entry.attemptCount || 0,
        entry.actor || 'system',
        truncate(entry.busyResponse),
        entry.busyReference || null,
        entry.finalStatus,
        entry.errorCode || null,
        entry.errorMessage || null,
      ],
    );
    return rows[0].id;
  }

  async forQueueItem(queueId) {
    const { rows } = await this.pool.query('SELECT * FROM busy_audit_log WHERE queue_id = $1 ORDER BY id ASC', [
      queueId,
    ]);
    return rows.map(toRow);
  }

  async forExternalReference(externalReference) {
    const { rows } = await this.pool.query(
      'SELECT * FROM busy_audit_log WHERE external_reference = $1 ORDER BY id ASC',
      [externalReference],
    );
    return rows.map(toRow);
  }

  async recent(limit = 100) {
    const { rows } = await this.pool.query('SELECT * FROM busy_audit_log ORDER BY id DESC LIMIT $1', [
      Math.min(limit, 500),
    ]);
    return rows.map(toRow);
  }
}

module.exports = { AuditLog };
