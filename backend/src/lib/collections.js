// Collections — the AR chase worklist for the AI Accountant.
//
// The receivables AGEING already exists (payments.ageingReport, with 0-30/31-60/
// 61-90/90+ buckets) and reminders already go out automatically once a day
// (payment-reminders.js). What was missing is the operator's side of collections:
// a prioritised worklist of who to chase, who was last reminded and when, any
// promise-to-pay recorded, and a one-click "remind now" that reuses the SAME
// approved-template + consent path as the daily job — plus a running activity log.
//
// Read-only on the ledger: it never allocates money or posts anything. The only
// outward action is sending the approved WhatsApp reminder, which an operator
// triggers per customer and which is gated on consent + Meta template approval,
// exactly like the scheduled run.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ACT_TYPES = ['NOTE', 'CALL', 'PROMISE', 'DISPUTE', 'REMINDER_SENT'];

module.exports = (pool, { sendTemplate, consent } = {}) => {
  const payments = require('./payments')(pool);
  const cfo = require('./cfo-analytics')(pool);

  const { withDbRetry } = require('./boot-ensure');
  let ensured = null;   // run the DDL once; later calls await the same promise
  async function ensure() {
    if (ensured) return ensured;
    // On a transient boot-time connection timeout, retry with backoff; if it
    // ultimately fails, clear `ensured` so the next caller re-attempts rather
    // than caching a "done" promise over schema that was never created.
    ensured = withDbRetry('collections', () => pool.query(`
      CREATE TABLE IF NOT EXISTS collection_activity (
        activity_id  BIGSERIAL PRIMARY KEY,
        partner_id   INTEGER NOT NULL,
        type         VARCHAR(16) NOT NULL DEFAULT 'NOTE',   -- NOTE|CALL|PROMISE|DISPUTE|REMINDER_SENT
        note         TEXT,
        promise_date DATE,
        created_by   VARCHAR(60),
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ix_coll_activity_partner ON collection_activity (partner_id, created_at DESC);`))
      .catch((e) => { ensured = null; require('./observability').log('error', 'collections.ensure', { error: e.message }); });
    return ensured;
  }
  ensure();

  // The worklist: every customer who owes money, worst first, enriched with the
  // collections context an operator needs to act — phone, last reminder, last
  // activity / promise-to-pay — and a priority = overdue weighted by how old it is.
  async function worklist({ limit = 200 } = {}) {
    const aging = await payments.ageingReport();
    if (!aging.length) return [];
    const ids = aging.map(a => a.partner_id);

    const rem = (await pool.query(`
      SELECT DISTINCT ON (partner_id) partner_id, sent_at
        FROM payment_reminder_log
       WHERE partner_id = ANY($1) AND status = 'SENT'
       ORDER BY partner_id, sent_at DESC`, [ids])).rows;
    const remMap = new Map(rem.map(r => [r.partner_id, r.sent_at]));

    let actMap = new Map(), phMap = new Map();
    try {
      const acts = (await pool.query(`
        SELECT DISTINCT ON (partner_id) partner_id, type, note, promise_date, created_at
          FROM collection_activity WHERE partner_id = ANY($1)
         ORDER BY partner_id, created_at DESC`, [ids])).rows;
      actMap = new Map(acts.map(a => [a.partner_id, a]));
    } catch { /* table may not exist on first call */ }
    try {
      const ph = (await pool.query(`
        SELECT DISTINCT ON (partner_id) partner_id, phone
          FROM wa_conversations WHERE partner_id = ANY($1) AND channel IS DISTINCT FROM 'WEB'
         ORDER BY partner_id, last_message_at DESC NULLS LAST`, [ids])).rows;
      phMap = new Map(ph.map(p => [p.partner_id, p.phone]));
    } catch { /* ignore */ }

    return aging.map(a => {
      const act = actMap.get(a.partner_id) || null;
      return {
        ...a,
        phone: phMap.get(a.partner_id) || null,
        last_reminder: remMap.get(a.partner_id) || null,
        last_activity: act ? { type: act.type, note: act.note, at: act.created_at } : null,
        promise_date: act && act.promise_date ? act.promise_date : null,
        priority: r2(a.overdue * (1 + (a.oldest_overdue_days || 0) / 30)),
      };
    }).sort((x, y) => y.priority - x.priority).slice(0, limit);
  }

  // AR aging bucket totals + DSO/DPO for the panel header.
  async function summary() {
    const aging = await payments.ageingReport();
    const sum = (k) => r2(aging.reduce((s, a) => s + (a[k] || 0), 0));
    let wc = null; try { wc = await cfo.workingCapital(); } catch { /* estimate optional */ }
    return {
      buckets: { current: sum('current'), d1_30: sum('d1_30'), d31_60: sum('d31_60'), d61_90: sum('d61_90'), d90_plus: sum('d90_plus') },
      total_outstanding: sum('outstanding'), total_overdue: sum('overdue'),
      customers: aging.length, overdue_customers: aging.filter(a => a.overdue > 0).length,
      dso_days: wc?.dso_days ?? null, dpo_days: wc?.dpo_days ?? null,
    };
  }

  async function logActivity(partner_id, { type = 'NOTE', note = null, promise_date = null, by = null } = {}) {
    await ensure();
    const T = ACT_TYPES.includes(type) ? type : 'NOTE';
    const r = await pool.query(
      `INSERT INTO collection_activity (partner_id, type, note, promise_date, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`, [partner_id, T, note, promise_date || null, by || null]);
    return { ok: true, activity: r.rows[0] };
  }

  async function listActivity(partner_id) {
    try { return (await pool.query(`SELECT * FROM collection_activity WHERE partner_id=$1 ORDER BY created_at DESC LIMIT 50`, [partner_id])).rows; }
    catch { return []; }
  }

  // Manual "remind now" for one customer — same approved-template + consent path as
  // the scheduled job, logged to payment_reminder_log AND the activity trail.
  async function remind(partner_id, { by = null } = {}) {
    if (!sendTemplate) return { error: 'WhatsApp sending is not configured on this server.', code: 503 };
    const row = (await pool.query(`
      SELECT o.partner_id, o.overdue, o.oldest_overdue_days, p.company_name,
             (SELECT phone FROM wa_conversations c WHERE c.partner_id=o.partner_id AND c.channel IS DISTINCT FROM 'WEB'
               ORDER BY c.last_message_at DESC NULLS LAST LIMIT 1) AS phone
        FROM v_partner_outstanding o JOIN partners p ON p.partner_id=o.partner_id
       WHERE o.partner_id=$1`, [partner_id])).rows[0];
    if (!row) return { error: 'Customer not found or nothing outstanding.', code: 404 };
    if (!(Number(row.overdue) > 0)) return { error: 'This customer has nothing overdue to remind about.', code: 400 };
    if (!row.phone) return { error: 'No WhatsApp number on file for this customer.', code: 400 };
    if (consent) { const c = await consent.canSend(row.phone, 'SERVICE'); if (!c.allowed) return { error: `Cannot message this customer: ${c.reason || 'no consent on file'}.`, code: 403 }; }

    const TEMPLATE = process.env.PAYMENT_REMINDER_TEMPLATE || 'payment_reminder';
    const LANG = process.env.PAYMENT_REMINDER_LANG || 'en_US';
    const amount = Math.round(Number(row.overdue)).toLocaleString('en-IN');
    let ok = false, err = null;
    try { const resp = await sendTemplate(row.phone, TEMPLATE, LANG, [row.company_name || 'Sir', amount]); ok = !!(resp && resp.messages && resp.messages[0]); }
    catch (e) { err = e.message; }
    try {
      await pool.query(`INSERT INTO payment_reminder_log (partner_id, phone, amount_rs, overdue_days, template, status)
                        VALUES ($1,$2,$3,$4,$5,$6)`, [partner_id, row.phone, Number(row.overdue), row.oldest_overdue_days, TEMPLATE, ok ? 'SENT' : 'FAILED']);
    } catch { /* log table best-effort */ }
    if (ok) await logActivity(partner_id, { type: 'REMINDER_SENT', note: `Manual WhatsApp reminder for ₹${amount}`, by });
    if (!ok) return { error: err || 'WhatsApp send failed — the payment_reminder template may still be pending Meta approval.', code: 502 };
    return { ok: true, sent_to: row.phone, amount };
  }

  return { ensure, worklist, summary, logActivity, listActivity, remind };
};
