// Phase 4 — MES auto-post via a transactional outbox.
//
// A MES operational event (GRN, dispatch/COGS, job-work, wastage) is first
// *enqueued* — idempotent on (company, event_type, source_ref), so a retried MES
// webhook can never create two rows. Processing then builds ONE voucher through
// the authoritative service, keyed by `MES:<event>:<source_ref>`, so even a
// concurrent double-process produces a single voucher. Everything defaults to
// shadow DRAFT while Busy is the book of record (ACCT_OPS_LINK_MODE=POST after
// cutover). Physical stock stays in the MES; this carries GL valuation only.
const R = require('./rules');
const { buildEventLines, EVENTS } = require('./mes-posting');

const DEFAULT_MODE = () => (String(process.env.ACCT_OPS_LINK_MODE || 'DRAFT').toUpperCase() === 'POST' ? 'POST' : 'DRAFT');
const SYS_CODES = ['INVENTORY', 'WIP', 'FINISHED_GOODS', 'COGS', 'WASTAGE', 'JOBWORK_CHARGES', 'CONVERSION_APPLIED',
  'GRN_CLEARING', 'PURCHASE', 'INPUT_CGST', 'INPUT_SGST', 'INPUT_IGST', 'ROUND_OFF'];

module.exports = (pool) => {
  const svc = require('./service')(pool);
  const ops = require('./ops-link')(pool);

  async function cid() { return svc.companyId(); }

  async function sysLedgers() {
    const c = await cid();
    const rows = (await pool.query(`SELECT code, ledger_id FROM acct.ledgers WHERE company_id=$1 AND code = ANY($2)`, [c, SYS_CODES])).rows;
    return Object.fromEntries(rows.map((r) => [r.code, r.ledger_id]));
  }

  async function activePolicy(eventType) {
    const c = await cid();
    const r = (await pool.query(
      `SELECT policy_id, version, voucher_type, rule FROM acct.posting_policies
        WHERE company_id=$1 AND event_type=$2 AND is_active AND approved_by IS NOT NULL`, [c, eventType])).rows[0];
    return r || null;
  }

  async function listPolicies() {
    const c = await cid();
    return (await pool.query(
      `SELECT policy_id, event_type, version, voucher_type, rule, is_active, approved_by, approved_at
         FROM acct.posting_policies WHERE company_id=$1 ORDER BY event_type, version DESC`, [c])).rows;
  }

  // Resolve the party ledger (supplier / job-worker) from the payload.
  async function partyFor(payload) {
    if (payload.party_ledger_id) return payload.party_ledger_id;
    if (payload.partner_id) return ops.ensurePartyLedger(payload.partner_id, 'CREDITOR');
    return null;
  }

  // Idempotent enqueue. Returns the (new or existing) outbox row.
  async function enqueue({ event_type, source_ref, payload, event_date }) {
    if (!EVENTS.includes(event_type)) throw new R.AccountingError(`Unknown MES event ${event_type}`, 'ACCT_INVALID');
    if (!source_ref) throw new R.AccountingError('source_ref is required (the MES document id)', 'ACCT_INVALID');
    const c = await cid();
    const r = (await pool.query(
      `INSERT INTO acct.mes_event_outbox (company_id, event_type, source_ref, event_date, payload)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (company_id, event_type, source_ref) DO NOTHING
       RETURNING outbox_id, status`, [c, event_type, String(source_ref), event_date || null, JSON.stringify(payload || {})])).rows[0];
    if (r) return { ...r, created: true };
    const ex = (await pool.query(
      `SELECT outbox_id, status, voucher_id FROM acct.mes_event_outbox WHERE company_id=$1 AND event_type=$2 AND source_ref=$3`,
      [c, event_type, String(source_ref)])).rows[0];
    return { ...ex, created: false };
  }

  // Build the balanced lines + voucher meta for an outbox row (no DB write).
  async function buildVoucher(row, sys) {
    const policy = await activePolicy(row.event_type);
    if (!policy) throw new R.AccountingError(`No approved posting policy for ${row.event_type} — event not posted`, 'ACCT_CONFLICT');
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const party = await partyFor(payload);
    const lines = buildEventLines(row.event_type, payload, policy.rule, sys, party);
    const date = row.event_date ? (row.event_date instanceof Date ? row.event_date.toISOString().slice(0, 10) : String(row.event_date).slice(0, 10)) : new Date().toISOString().slice(0, 10);
    return { policy, lines, date, party, voucher_type: policy.voucher_type || 'JOURNAL' };
  }

  async function preview({ event_type, payload, event_date }) {
    const sys = await sysLedgers();
    const built = await buildVoucher({ event_type, payload, event_date }, sys);
    return { event_type, voucher_type: built.voucher_type, policy_version: built.policy.version, lines: built.lines };
  }

  // Process one outbox row into a voucher. Concurrency-safe: a row lock + the
  // voucher idempotency key both guarantee exactly one voucher.
  async function process(outboxId, { mode } = {}, user) {
    const m = (mode || DEFAULT_MODE()).toUpperCase();
    const c = await cid();
    const sys = await sysLedgers();
    const actor = user || { username: 'mes-outbox' };

    // Lock the row so concurrent processors serialise on it (and bump attempts
    // atomically). The row stays locked only for this short transaction; the
    // voucher idempotency key is the real double-post guard.
    const lock = await pool.connect();
    let row;
    try {
      await lock.query('BEGIN');
      row = (await lock.query(`SELECT * FROM acct.mes_event_outbox WHERE outbox_id=$1 AND company_id=$2 FOR UPDATE`, [outboxId, c])).rows[0];
      if (!row) throw new R.AccountingError(`Outbox row ${outboxId} not found`, 'ACCT_NOT_FOUND');
      await lock.query(`UPDATE acct.mes_event_outbox SET attempts = attempts + 1 WHERE outbox_id=$1`, [outboxId]);
      await lock.query('COMMIT');
    } catch (e) { await lock.query('ROLLBACK').catch(() => {}); throw e; } finally { lock.release(); }

    const key = `MES:${row.event_type}:${row.source_ref}`;
    try {
      const built = await buildVoucher(row, sys);
      const draft = await svc.createDraft({
        voucher_type: built.voucher_type, voucher_date: built.date, party_ledger_id: built.party || null,
        narration: `${row.event_type.replace(/_/g, ' ')} — ${row.source_ref}`,
        source_module: 'mes.outbox', source_ref: String(row.source_ref), idempotency_key: key, lines: built.lines,
      }, actor);

      let voucher = draft;
      const canPost = m === 'POST' && ['DRAFT', 'VALIDATED', 'APPROVED'].includes(draft.status);
      if (canPost) {
        const v = await svc.validateVoucher(draft.voucher_id, actor);
        if (!v.ok) throw new R.AccountingError(`Validation failed: ${(v.errors || []).join('; ')}`, 'ACCT_INVALID');
        voucher = await svc.postVoucher(draft.voucher_id, actor);
      }
      await pool.query(
        `UPDATE acct.mes_event_outbox SET status='PROCESSED', voucher_id=$2, processed_at=now(), last_error=NULL WHERE outbox_id=$1`,
        [outboxId, draft.voucher_id]);
      return { outbox_id: outboxId, action: canPost ? 'posted' : 'drafted', mode: m, voucher_id: draft.voucher_id,
        voucher_no: voucher.voucher_no || null, status: voucher.status, replay: !!draft.idempotent_replay };
    } catch (e) {
      await pool.query(`UPDATE acct.mes_event_outbox SET status='FAILED', last_error=$2 WHERE outbox_id=$1`, [outboxId, e.message]).catch(() => {});
      throw e;
    }
  }

  // Enqueue + immediately process (the common path from a MES hook).
  async function emit({ event_type, source_ref, payload, event_date }, opts, user) {
    const en = await enqueue({ event_type, source_ref, payload, event_date });
    const res = await process(en.outbox_id, opts, user);
    return { ...res, enqueued: en.created };
  }

  // Process every PENDING / FAILED row (bounded). Errors are isolated per row.
  async function drain({ mode, limit = 200 } = {}, user) {
    const c = await cid();
    const rows = (await pool.query(
      `SELECT outbox_id FROM acct.mes_event_outbox WHERE company_id=$1 AND status IN ('PENDING','FAILED') ORDER BY outbox_id LIMIT $2`,
      [c, limit])).rows;
    const out = { total: rows.length, processed: 0, failed: 0, details: [] };
    for (const r of rows) {
      try { const res = await process(r.outbox_id, { mode }, user); out.processed++; out.details.push(res); }
      catch (e) { out.failed++; out.details.push({ outbox_id: r.outbox_id, error: e.message }); }
    }
    return out;
  }

  async function list({ status, event_type, limit = 200 } = {}) {
    const c = await cid();
    const p = [c]; const w = ['company_id=$1'];
    if (status) { p.push(status); w.push(`status=$${p.length}`); }
    if (event_type) { p.push(event_type); w.push(`event_type=$${p.length}`); }
    p.push(limit);
    return (await pool.query(
      `SELECT outbox_id, event_type, source_ref, event_date, status, voucher_id, attempts, last_error, created_at, processed_at
         FROM acct.mes_event_outbox WHERE ${w.join(' AND ')} ORDER BY outbox_id DESC LIMIT $${p.length}`, p)).rows;
  }

  return { enqueue, process, emit, drain, preview, list, listPolicies, DEFAULT_MODE, EVENTS };
};
