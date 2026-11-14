// Automated WhatsApp payment reminders.
//
// Once a day, finds customers with an OVERDUE balance (from v_partner_outstanding),
// whose overdue is at least MIN_OVERDUE_DAYS old, who have a WhatsApp number on file
// (via wa_conversations) and consent, and who haven't been reminded within the cooldown
// window — and sends the approved `payment_reminder` template with their name + amount.
//
// Fail-safe: the whole run is skipped unless the template is APPROVED at Meta, so we
// never fire failing sends while it is still pending review.

const https = require('https');
const obs = require('./observability');

const num = (v, d) => { const n = parseInt(process.env[v], 10); return Number.isFinite(n) ? n : d; };

module.exports = ({ pool, sendTemplate, consent }) => {
  const WABA = process.env.WHATSAPP_WABA_ID || '1085613544147491';
  const TEMPLATE = process.env.PAYMENT_REMINDER_TEMPLATE || 'payment_reminder';
  const LANG = process.env.PAYMENT_REMINDER_LANG || 'en_US';
  const MIN_OVERDUE_DAYS = num('PAYMENT_REMINDER_MIN_OVERDUE_DAYS', 7);
  const COOLDOWN_DAYS = num('PAYMENT_REMINDER_COOLDOWN_DAYS', 7);
  const ver = process.env.WHATSAPP_API_VERSION || 'v21.0';

  // Is the template APPROVED at Meta right now?
  function templateApproved() {
    return new Promise((resolve) => {
      if (!process.env.WHATSAPP_TOKEN) return resolve(false);
      https.get({ hostname: 'graph.facebook.com', path: `/${ver}/${WABA}/message_templates?fields=name,status&limit=100&access_token=${process.env.WHATSAPP_TOKEN}` }, (r) => {
        let d = ''; r.on('data', (c) => d += c);
        r.on('end', () => { try { const j = JSON.parse(d); resolve((j.data || []).some((t) => t.name === TEMPLATE && t.status === 'APPROVED')); } catch { resolve(false); } });
      }).on('error', () => resolve(false));
    });
  }

  async function run() {
    if (process.env.PAYMENT_REMINDER_ENABLED === 'false') return { skipped: 'disabled' };
    if (!(await templateApproved())) { obs.log('info', 'payment.reminders.skipped', { reason: 'template_pending', template: TEMPLATE }); return { skipped: 'template_pending' }; }

    // Overdue customers with a WhatsApp number and not reminded within the cooldown.
    const rows = (await pool.query(
      `SELECT o.partner_id, o.overdue, o.oldest_overdue_days, p.company_name,
              (SELECT phone FROM wa_conversations c
                WHERE c.partner_id = o.partner_id AND c.channel IS DISTINCT FROM 'WEB'
                ORDER BY c.last_message_at DESC NULLS LAST LIMIT 1) AS phone
         FROM v_partner_outstanding o
         JOIN partners p ON p.partner_id = o.partner_id
        WHERE o.overdue > 0 AND o.oldest_overdue_days >= $1
          AND NOT EXISTS (
            SELECT 1 FROM payment_reminder_log l
             WHERE l.partner_id = o.partner_id AND l.status = 'SENT'
               AND l.sent_at > NOW() - ($2 || ' days')::interval)`,
      [MIN_OVERDUE_DAYS, COOLDOWN_DAYS])).rows;

    let sent = 0;
    for (const r of rows) {
      if (!r.phone) continue;                                     // no WhatsApp number on file
      if (consent && !(await consent.canSend(r.phone, 'SERVICE')).allowed) continue;
      const amount = Math.round(Number(r.overdue)).toLocaleString('en-IN');
      try {
        const resp = await sendTemplate(r.phone, TEMPLATE, LANG, [r.company_name || 'Sir', amount]);
        const ok = resp && resp.messages && resp.messages[0];
        await pool.query(
          `INSERT INTO payment_reminder_log (partner_id, phone, amount_rs, overdue_days, template, status)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [r.partner_id, r.phone, Number(r.overdue), r.oldest_overdue_days, TEMPLATE, ok ? 'SENT' : 'FAILED']);
        if (ok) sent++;
      } catch (e) { console.error('[payment-reminders] send failed for', r.partner_id, e.message); }
    }
    if (sent) obs.log('info', 'payment.reminders.sent', { count: sent });
    return { sent, candidates: rows.length };
  }

  return { run };
};
