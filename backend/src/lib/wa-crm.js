// WhatsApp AI CRM — conversation/message persistence, customer matching (§5),
// and the inbound pipeline used by the webhook.

const digits = (s) => String(s || '').replace(/\D/g, '');

module.exports = (pool, { io } = {}) => {
  // Match a WhatsApp phone to a partner via partner_contacts (whatsapp or mobile).
  // Compares on the last 10 digits so +91/0 prefixes don't break the match.
  async function matchPartner(phone) {
    const last10 = digits(phone).slice(-10);
    if (last10.length < 10) return null;
    const r = await pool.query(
      `SELECT c.partner_id, p.company_name, c.name
         FROM partner_contacts c
         JOIN partners p ON p.partner_id = c.partner_id
        WHERE RIGHT(regexp_replace(COALESCE(c.whatsapp, c.mobile, ''), '\\D', '', 'g'), 10) = $1
        LIMIT 1`, [last10]);
    return r.rows[0] || null;
  }

  // Find or create the conversation for a phone, matching the customer once.
  async function getOrCreateConversation(phone, profileName) {
    const existing = await pool.query(`SELECT * FROM wa_conversations WHERE phone = $1`, [phone]);
    if (existing.rows.length) return existing.rows[0];

    const match = await matchPartner(phone);
    // New conversations inherit the org-wide default AI mode (Settings → WhatsApp),
    // so AUTO does not have to be toggled on each chat. Falls back to SUGGEST.
    const dm = await pool.query(`SELECT value FROM app_settings WHERE key='wa_default_ai_mode'`).catch(() => ({ rows: [] }));
    const defMode = ['OFF', 'SUGGEST', 'AUTO'].includes(dm.rows[0]?.value) ? dm.rows[0].value : 'SUGGEST';
    const created = await pool.query(
      `INSERT INTO wa_conversations (phone, display_name, partner_id, ai_mode)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [phone, match ? (match.name || match.company_name) : (profileName || null), match ? match.partner_id : null, defMode]
    );
    const conv = created.rows[0];

    // Unknown number -> open a CRM lead so nothing is lost (§5).
    if (!match) {
      const lead = await pool.query(
        `INSERT INTO crm_leads (phone, name, source) VALUES ($1,$2,'WHATSAPP') RETURNING lead_id`,
        [phone, profileName || null]);
      await pool.query(`UPDATE wa_conversations SET lead_id=$1 WHERE conversation_id=$2`,
        [lead.rows[0].lead_id, conv.conversation_id]);
      conv.lead_id = lead.rows[0].lead_id;
    }
    return conv;
  }

  // Claim a wamid for processing. Returns false if we have already handled it.
  //
  // The INSERT itself is the claim, so two concurrent redeliveries cannot both
  // proceed — a plain SELECT-then-act would let both through. Covers the staff
  // path too, which never writes to wa_messages.
  async function claimEvent(waMessageId, handledBy, queueEventId = null) {
    if (!waMessageId) return true; // nothing to dedupe on; let it through
    try {
      const r = await pool.query(
        `INSERT INTO wa_processed_events (wa_message_id, handled_by, queue_event_id)
         VALUES ($1,$2,$3) ON CONFLICT (wa_message_id) DO NOTHING RETURNING wa_message_id`,
        [waMessageId, handledBy || null, queueEventId]);
      if (r.rows.length) return true;

      // Already claimed. Distinguish two very different situations:
      //   * a genuine Meta redelivery of the same message -> skip;
      //   * a RETRY of the same queue event after a partial failure -> must be
      //     allowed through, or the retry silently drops the customer's message
      //     and the queue's whole purpose is defeated.
      if (queueEventId != null) {
        const prior = await pool.query(
          `SELECT queue_event_id FROM wa_processed_events WHERE wa_message_id = $1`, [waMessageId]);
        if (prior.rows.length && String(prior.rows[0].queue_event_id) === String(queueEventId)) return true;
      }
      return false;
    } catch (e) {
      // Never let the guard itself drop a real message.
      console.error('[wa-crm] claimEvent', e.message);
      return true;
    }
  }

  // Returns the stored row, or null when the message was a duplicate. A null
  // return means "already handled" — callers must not treat it as a failure.
  async function addMessage(conversationId, m) {
    const r = await pool.query(
      `INSERT INTO wa_messages (conversation_id, direction, wa_message_id, msg_type, body,
                                media_id, media_mime, caption, sent_by, ai_generated, status, local_file, ai_description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [conversationId, m.direction, m.wa_message_id || null, m.msg_type || 'text', m.body || null,
       m.media_id || null, m.media_mime || null, m.caption || null, m.sent_by || null,
       !!m.ai_generated, m.status || (m.direction === 'IN' ? 'received' : 'sent'), m.local_file || null, m.ai_description || null]
    );

    // Conflict: another delivery of the same message won the race. Every
    // side-effect below (unread count, last-message, response timing, socket
    // push) must be skipped or the duplicate corrupts the conversation anyway.
    if (!r.rows.length) return null;
    // An inbound message (re)opens the 24-hour customer service window.
    await pool.query(
      `UPDATE wa_conversations
          SET last_message = $1, last_message_at = NOW(),
              unread_count = CASE WHEN $2 = 'IN' THEN unread_count + 1 ELSE unread_count END,
              window_expires_at = CASE WHEN $2 = 'IN'
                                       THEN NOW() + INTERVAL '24 hours'
                                       ELSE window_expires_at END
        WHERE conversation_id = $3`,
      [(m.body || m.caption || `[${m.msg_type || 'media'}]`).slice(0, 300), m.direction, conversationId]
    );
    // First reply time (§17 average response time) — recorded once, on the first
    // outbound message that follows the customer's first inbound one.
    if (m.direction === 'OUT') {
      await pool.query(
        `UPDATE wa_conversations c
            SET first_response_secs = EXTRACT(EPOCH FROM (NOW() - (
                  SELECT MIN(created_at) FROM wa_messages
                   WHERE conversation_id = c.conversation_id AND direction = 'IN')))::int
          WHERE c.conversation_id = $1 AND c.first_response_secs IS NULL
            AND EXISTS (SELECT 1 FROM wa_messages
                         WHERE conversation_id = c.conversation_id AND direction = 'IN')`,
        [conversationId]);
    }

    const row = r.rows[0];
    if (io) io.emit('wa_message', { conversation_id: conversationId, message: row });
    return row;
  }

  // Is the 24-hour window open? Returns { open, expiresAt, minutesLeft }.
  // Computed server-side: the client must never decide whether a send is legal.
  async function windowState(conversationId) {
    const r = await pool.query(
      `SELECT window_expires_at,
              (window_expires_at > NOW()) AS open,
              GREATEST(0, EXTRACT(EPOCH FROM (window_expires_at - NOW()))/60)::int AS mins
         FROM wa_conversations WHERE conversation_id = $1`, [conversationId]);
    const row = r.rows[0];
    if (!row || !row.window_expires_at) {
      return { open: false, expiresAt: null, minutesLeft: 0, reason: 'no inbound message yet' };
    }
    return { open: !!row.open, expiresAt: row.window_expires_at, minutesLeft: Number(row.mins) };
  }

  // Record Meta's delivery callback against the message it refers to.
  // 'sent' never downgrades a row that already reached delivered/read, because
  // Meta does not guarantee callback ordering.
  async function applyStatus({ id, status, timestamp, errors, pricing }) {
    if (!id || !status) return null;
    const at = timestamp ? new Date(Number(timestamp) * 1000) : new Date();
    const err = Array.isArray(errors) && errors.length ? errors[0] : null;

    const r = await pool.query(
      `UPDATE wa_messages SET
         status = CASE
                    WHEN $2 = 'sent' AND status IN ('delivered','read') THEN status
                    ELSE $2 END,
         delivered_at = CASE WHEN $2 = 'delivered' AND delivered_at IS NULL THEN $3 ELSE delivered_at END,
         read_at      = CASE WHEN $2 = 'read'      AND read_at      IS NULL THEN $3 ELSE read_at END,
         failed_at    = CASE WHEN $2 = 'failed'    THEN $3 ELSE failed_at END,
         error_code   = COALESCE($4, error_code),
         error_title  = COALESCE($5, error_title),
         pricing_category = COALESCE($6, pricing_category)
       WHERE wa_message_id = $1
       RETURNING message_id, conversation_id, status, error_code, error_title`,
      [id, status, at,
       err ? String(err.code || '') : null,
       err ? (err.title || err.message || null) : null,
       pricing?.category || null]);

    const row = r.rows[0] || null;
    if (row && io) io.emit('wa_status', { conversation_id: row.conversation_id, ...row });
    return row;
  }

  // Conversation list for the inbox, enriched with live CRM figures (§1).
  async function listConversations() {
    const r = await pool.query(`
      SELECT c.*, p.company_name, p.credit_limit,
             (SELECT COALESCE(outstanding,0) FROM v_partner_outstanding v
               WHERE v.partner_id = c.partner_id)                                      AS outstanding,
             (SELECT COUNT(*) FROM sales_orders so
               WHERE so.partner_id = c.partner_id
                 AND so.status NOT IN ('DISPATCHED','CANCELLED','COMPLETED'))          AS open_orders,
             (SELECT MAX(order_date) FROM sales_orders so WHERE so.partner_id = c.partner_id) AS last_order_date,
             l.score AS lead_score, p.customer_category
        FROM wa_conversations c
        LEFT JOIN partners p  ON p.partner_id = c.partner_id
        LEFT JOIN crm_leads l ON l.lead_id    = c.lead_id
       ORDER BY c.last_message_at DESC NULLS LAST, c.conversation_id DESC
       LIMIT 200`);
    return r.rows;
  }

  async function getMessages(conversationId, limit = 100) {
    const r = await pool.query(
      `SELECT * FROM wa_messages WHERE conversation_id = $1
        ORDER BY created_at DESC LIMIT $2`, [conversationId, limit]);
    return r.rows.reverse();
  }

  // Customer 360 (§5) — every figure straight from the MES.
  async function customer360(conversationId) {
    const c = (await pool.query(`SELECT * FROM wa_conversations WHERE conversation_id=$1`, [conversationId])).rows[0];
    if (!c) return null;
    if (!c.partner_id) {
      const lead = c.lead_id
        ? (await pool.query(`SELECT * FROM crm_leads WHERE lead_id=$1`, [c.lead_id])).rows[0]
        : null;
      return { known: false, phone: c.phone, lead };
    }
    const [partner, addr, orders, fin, top, shades, complaints] = await Promise.all([
      pool.query(`SELECT * FROM partners WHERE partner_id=$1`, [c.partner_id]),
      pool.query(`SELECT city, state FROM partner_addresses WHERE partner_id=$1 AND is_default=true LIMIT 1`, [c.partner_id]),
      pool.query(`SELECT so_number, order_date, delivery_date, status, total_amount
                    FROM sales_orders WHERE partner_id=$1 ORDER BY order_date DESC LIMIT 10`, [c.partner_id]),
      // Overdue is invoices past their agreed credit period, not simply unpaid —
      // an invoice inside its terms is outstanding but NOT overdue (§5).
      pool.query(
        // Balances come from v_partner_outstanding so they net off payments and
        // agree with the credit gate. Total sales is billed value; last payment
        // is a real receipt date, not the date an invoice was marked paid.
        `SELECT COALESCE(v.outstanding,0)    AS outstanding,
                COALESCE(v.overdue,0)        AS overdue,
                COALESCE(v.open_invoices,0)  AS unpaid_count,
                COALESCE(v.oldest_overdue_days,0) AS oldest_overdue_days,
                COALESCE((SELECT SUM(grand_total) FROM tax_invoices t2
                           WHERE t2.partner_id=$1 AND t2.status <> 'CANCELLED'),0) AS total_sales,
                (SELECT MAX(payment_date) FROM payments pm
                  WHERE pm.partner_id=$1 AND pm.status='ACTIVE')                  AS last_payment,
                (SELECT MIN(invoice_date) FROM tax_invoices t3
                  WHERE t3.partner_id=$1)                                         AS first_invoice
           FROM (SELECT 1) x
           LEFT JOIN v_partner_outstanding v ON v.partner_id = $1`, [c.partner_id]),
      pool.query(`SELECT item_desc AS item, SUM(ABS(quantity)) AS qty
                    FROM stock_ledger WHERE partner_id=$1 AND movement_type='OUT'
                   GROUP BY item_desc ORDER BY qty DESC LIMIT 5`, [c.partner_id]),
      // Preferred shades come from what was actually dispatched to them.
      pool.query(
        `SELECT di.color_name AS shade, SUM(di.weight_kg) AS kg
           FROM dispatch_items di
           JOIN dispatch_challans dc ON dc.dispatch_id = di.dispatch_id
          WHERE dc.partner_id=$1 AND di.color_name IS NOT NULL
          GROUP BY di.color_name ORDER BY kg DESC LIMIT 5`, [c.partner_id]),
      // Complaints = conversations the AI classified as such (no complaints table yet).
      pool.query(
        `SELECT COUNT(*) n, MAX(created_at) last_at
           FROM wa_ai_actions
          WHERE conversation_id=$1 AND interpretation->>'intent' = 'complaint'`, [conversationId]),
    ]);

    const f = fin.rows[0];
    // Average monthly sales over the customer's actual billing lifetime.
    let avgMonthly = 0;
    if (f.first_invoice) {
      const months = Math.max(1, (Date.now() - new Date(f.first_invoice).getTime()) / (30.44 * 86400000));
      avgMonthly = Math.round((Number(f.total_sales) / months) * 100) / 100;
    }

    return {
      known: true,
      partner: partner.rows[0] || null,
      location: addr.rows[0] || null,
      salesperson: c.assigned_to || null,
      customer_category: partner.rows[0]?.customer_category || partner.rows[0]?.rating || null,
      orders: orders.rows,
      finance: { ...f, avg_monthly_sales: avgMonthly },
      frequently_bought: top.rows,
      preferred_shades: shades.rows,
      complaints: { count: Number(complaints.rows[0].n), last_at: complaints.rows[0].last_at },
    };
  }

  return { matchPartner, getOrCreateConversation, addMessage, claimEvent,
           windowState, applyStatus,
           listConversations, getMessages, customer360, digits };
};
