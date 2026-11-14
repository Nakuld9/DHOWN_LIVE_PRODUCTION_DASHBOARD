// §12 CRM automation — raise follow-ups when a conversation goes quiet.
//
// Two situations the office actually loses money on:
//   1. A quotation was sent and the customer never replied.
//   2. A customer asked something and nobody on our side answered.
//
// Each follow-up is assigned to the conversation's salesperson (or left
// unassigned so it still shows in the pending list). Follow-ups are de-duplicated
// by (conversation, kind) while still PENDING, so a quiet chat produces ONE task,
// not a new one every scan.

const QUOTE_HOURS      = Number(process.env.FOLLOWUP_QUOTE_HOURS) || 48;
const UNANSWERED_HOURS = Number(process.env.FOLLOWUP_UNANSWERED_HOURS) || 6;
const SCAN_MS          = (Number(process.env.FOLLOWUP_SCAN_MIN) || 60) * 60 * 1000;
const obs = require('./observability');

module.exports = (pool, { jobLock } = {}) => {

  async function exists(conversationId, kind, quoteNo) {
    const r = await pool.query(
      `SELECT 1 FROM crm_followups
        WHERE conversation_id = $1 AND kind = $2 AND status = 'PENDING'
          AND ($3::text IS NULL OR quote_no = $3) LIMIT 1`,
      [conversationId, kind, quoteNo || null]);
    return r.rows.length > 0;
  }

  async function create({ conversationId, partnerId, leadId, kind, note, assignedTo, quoteNo }) {
    const r = await pool.query(
      `INSERT INTO crm_followups
         (partner_id, lead_id, conversation_id, note, due_date, assigned_to, created_by, kind, quote_no)
       VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,'AUTO',$6,$7) RETURNING *`,
      [partnerId || null, leadId || null, conversationId, note, assignedTo || null, kind, quoteNo || null]);
    return r.rows[0];
  }

  // 1. Quotation sent, no customer reply since.
  async function scanQuotes() {
    const rows = (await pool.query(
      `SELECT q.quote_no, q.conversation_id, q.partner_id, q.grand_total, q.product,
              c.lead_id, c.assigned_to,
              COALESCE(p.company_name, c.display_name, c.phone) AS who
         FROM wa_quotes q
         JOIN wa_conversations c ON c.conversation_id = q.conversation_id
         LEFT JOIN partners p ON p.partner_id = q.partner_id
        WHERE q.status = 'SENT'
          AND q.created_at < NOW() - ($1 || ' hours')::interval
          AND NOT EXISTS (
            SELECT 1 FROM wa_messages m
             WHERE m.conversation_id = q.conversation_id
               AND m.direction = 'IN' AND m.created_at > q.created_at)`,
      [QUOTE_HOURS])).rows;

    const made = [];
    for (const q of rows) {
      if (await exists(q.conversation_id, 'QUOTE_NO_RESPONSE', q.quote_no)) continue;
      made.push(await create({
        conversationId: q.conversation_id, partnerId: q.partner_id, leadId: q.lead_id,
        kind: 'QUOTE_NO_RESPONSE', quoteNo: q.quote_no, assignedTo: q.assigned_to,
        note: `Follow-up required — ${q.who} has not responded to quotation ${q.quote_no}`
            + (q.product ? ` (${q.product})` : '')
            + (Number(q.grand_total) > 0 ? `, value ${Math.round(Number(q.grand_total))}` : ''),
      }));
    }
    return made;
  }

  // 2. Customer's last message is still unanswered by us.
  async function scanUnanswered() {
    const rows = (await pool.query(
      `SELECT c.conversation_id, c.partner_id, c.lead_id, c.assigned_to,
              COALESCE(p.company_name, c.display_name, c.phone) AS who,
              m.body, m.created_at
         FROM wa_conversations c
         LEFT JOIN partners p ON p.partner_id = c.partner_id
         JOIN LATERAL (
           SELECT direction, body, created_at FROM wa_messages
            WHERE conversation_id = c.conversation_id
            ORDER BY created_at DESC LIMIT 1
         ) m ON true
        WHERE m.direction = 'IN'
          AND m.created_at < NOW() - ($1 || ' hours')::interval`,
      [UNANSWERED_HOURS])).rows;

    const made = [];
    for (const c of rows) {
      if (await exists(c.conversation_id, 'UNANSWERED')) continue;
      const gist = String(c.body || '').replace(/\s+/g, ' ').slice(0, 80);
      made.push(await create({
        conversationId: c.conversation_id, partnerId: c.partner_id, leadId: c.lead_id,
        kind: 'UNANSWERED', assignedTo: c.assigned_to,
        note: `Unanswered on WhatsApp — ${c.who}${gist ? `: "${gist}"` : ''}`,
      }));
    }
    return made;
  }

  async function scan() {
    const [quotes, unanswered] = [await scanQuotes(), await scanUnanswered()];
    const total = quotes.length + unanswered.length;
    if (total) obs.log('info', 'followup.raised', { total, quotes: quotes.length, unanswered: unanswered.length });
    return { quote_no_response: quotes, unanswered, total };
  }

  // Close any auto follow-up once the situation resolves — a chat that has been
  // answered should not keep nagging the salesperson.
  async function autoClose() {
    const r = await pool.query(
      `UPDATE crm_followups f SET status = 'DONE'
        WHERE f.status = 'PENDING' AND f.kind = 'UNANSWERED'
          AND EXISTS (
            SELECT 1 FROM wa_messages m
             WHERE m.conversation_id = f.conversation_id
               AND m.direction = 'OUT' AND m.created_at > f.created_at)
        RETURNING followup_id`);
    return r.rowCount;
  }

  function startScheduler() {
    const run = async () => { await autoClose(); await scan(); };
    // Lock-guarded so two instances cannot both raise the same follow-ups.
    if (jobLock) jobLock.schedule('followup-scan', run, SCAN_MS);
    else { setInterval(() => run().catch(e => console.error('[FOLLOWUP]', e.message)), SCAN_MS);
           setTimeout(() => run().catch(() => {}), 60 * 1000); }
    obs.log('info', 'followup.watcher_on', { quote_hours: QUOTE_HOURS, unanswered_hours: UNANSWERED_HOURS, every_min: SCAN_MS / 60000 });
  }

  return { scan, scanQuotes, scanUnanswered, autoClose, startScheduler };
};
