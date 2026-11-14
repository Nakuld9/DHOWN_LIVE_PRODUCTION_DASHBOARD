// Immutable audit trail for the AI Accountant (spec §21).
//
// Append-only by contract: this module exposes record() and read helpers, never
// an update or delete. Every AI-prepared or AI-assisted financial action writes
// one row here BEFORE it is acted on — what was proposed, by which agent, from
// which source document, with what confidence, and (once a human decides) who
// approved it and the final result. Nothing financial is ever silently changed.
//
// This is the AI intelligence/workflow layer — NOT a second accounting ledger.
// Busy remains the book of accounts; this records what the assistant did.

let ensured = false;

module.exports = (pool) => {
  async function ensure() {
    if (ensured) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_audit_log (
        audit_id     BIGSERIAL PRIMARY KEY,
        ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor        TEXT,                    -- human username, or NULL for a pure AI step
        actor_role   TEXT,
        agent        TEXT,                    -- AI agent name, if AI-originated
        action       TEXT NOT NULL,           -- e.g. DRAFT_PURCHASE_VOUCHER, MATCH_BANK_TXN
        entity_type  TEXT,                    -- e.g. purchase_voucher, receipt, bank_txn
        entity_id    TEXT,
        source_doc   TEXT,                    -- uploaded doc id / reference, if any
        before_json  JSONB,                   -- prior state (NULL for a create)
        after_json   JSONB,                   -- proposed / resulting state
        reason       TEXT,
        confidence   NUMERIC(4,3),            -- 0..1, the grounding confidence
        status       TEXT NOT NULL DEFAULT 'AI_RECOMMENDED',  -- see spec §20 lifecycle
        approver     TEXT,
        approved_at  TIMESTAMPTZ,
        result       TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_audit_ts ON ai_audit_log(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_audit_entity ON ai_audit_log(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_ai_audit_status ON ai_audit_log(status);
    `);
    ensured = true;
  }

  // Write one audit row. Never throws to the caller — an audit-write failure is
  // logged but must not break the action being audited (the action's own
  // approval gate is the safety control; this is the record of it).
  async function record(entry = {}) {
    try {
      await ensure();
      const r = await pool.query(
        `INSERT INTO ai_audit_log
           (actor, actor_role, agent, action, entity_type, entity_id, source_doc,
            before_json, after_json, reason, confidence, status, approver, approved_at, result)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,'AI_RECOMMENDED'),$13,$14,$15)
         RETURNING audit_id`,
        [entry.actor || null, entry.actor_role || null, entry.agent || null,
         entry.action || 'UNKNOWN', entry.entity_type || null, entry.entity_id != null ? String(entry.entity_id) : null,
         entry.source_doc || null,
         entry.before ? JSON.stringify(entry.before) : null,
         entry.after ? JSON.stringify(entry.after) : null,
         entry.reason || null,
         entry.confidence != null ? entry.confidence : null,
         entry.status || null, entry.approver || null, entry.approved_at || null, entry.result || null]);
      return { ok: true, audit_id: r.rows[0].audit_id };
    } catch (e) {
      require('./observability').log('error', 'ai_audit.record.failed', { error: e.message, action: entry.action });
      return { ok: false, error: e.message };
    }
  }

  // Read the trail (newest first), optionally filtered. Read-only.
  async function list({ status, entity_type, limit = 100 } = {}) {
    await ensure();
    const where = [], params = [];
    if (status) { params.push(status); where.push(`status = $${params.length}`); }
    if (entity_type) { params.push(entity_type); where.push(`entity_type = $${params.length}`); }
    params.push(Math.min(Number(limit) || 100, 500));
    const r = await pool.query(
      `SELECT audit_id, ts, actor, actor_role, agent, action, entity_type, entity_id,
              reason, confidence, status, approver, approved_at, result
         FROM ai_audit_log
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY ts DESC LIMIT $${params.length}`, params);
    return r.rows;
  }

  return { ensure, record, list };
};
