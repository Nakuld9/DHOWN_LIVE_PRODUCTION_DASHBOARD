// Processes one WhatsApp webhook envelope.
//
// Lifted out of the route so the durable queue worker owns it: the HTTP handler
// now only persists and acks, and this runs afterwards where it can be retried.
// Replaying a dead event calls exactly this same code path.
//
// Must be idempotent — a retry after a partial failure will run it again.

const { downloadMedia } = require('./wa-media');
const obs = require('./observability');

module.exports = ({ pool, crm, ai, consent, sendText, sendTemplate, handleInboundReply, buildStatusText, describeImage, staffAssistant }) => {
  // When a free-text reply fails because the customer's 24-hour service window has
  // closed (WhatsApp error 131047), WhatsApp only allows an APPROVED template. If one
  // is configured, send it so the customer is not left hanging; otherwise skip
  // honestly (nothing is sent, and the failure is logged).
  const REENGAGE_TEMPLATE = process.env.WA_REENGAGE_TEMPLATE || null;
  const REENGAGE_LANG = process.env.WA_REENGAGE_LANG || 'en';
  async function reengageIfWindowClosed(from, sendResult, conv) {
    if (!sendResult || !sendResult.error || sendResult.error.code !== 131047) return false;
    if (!REENGAGE_TEMPLATE || !sendTemplate) { obs.log('info', 'wa.reengage.skip', { phone: from, reason: 'no WA_REENGAGE_TEMPLATE configured' }); return false; }
    const name = conv.display_name || 'there';
    const tpl = await sendTemplate(from, REENGAGE_TEMPLATE, REENGAGE_LANG, [name]).catch(() => null);
    if (tpl && tpl.messages) {
      await crm.addMessage(conv.conversation_id, {
        direction: 'OUT', msg_type: 'template',
        body: `[Re-engagement template "${REENGAGE_TEMPLATE}" sent — the customer's 24h window had closed, so a template was used instead of a free-text reply.]`,
        wa_message_id: tpl.messages[0].id, sent_by: 'SYSTEM',
      });
      obs.log('info', 'wa.reengage.sent', { phone: from, template: REENGAGE_TEMPLATE });
      return true;
    }
    obs.log('error', 'wa.reengage.fail', { phone: from, template: REENGAGE_TEMPLATE, error: tpl?.error?.message });
    return false;
  }

  async function isStaff(phone) {
    return (await staffMember(phone)) !== null;
  }

  // Returns the staff member's role for a phone, or null if not staff. Numbers in
  // WHATSAPP_TO (the owner/supervisor alert numbers) that are not also app users
  // are treated as ADMIN so their WhatsApp questions can see management figures.
  async function staffMember(phone) {
    const last10 = String(phone || '').replace(/\D/g, '').slice(-10);
    if (pool) {
      try {
        const r = await pool.query(
          `SELECT role FROM users
            WHERE active = true AND deleted_at IS NULL
              AND RIGHT(regexp_replace(COALESCE(mobile,''), '\\D', '', 'g'), 10) = $1 LIMIT 1`, [last10]);
        if (r.rows.length) return { role: r.rows[0].role || 'OPERATOR' };
      } catch { /* fall through to env check */ }
    }
    const cfg = (process.env.WHATSAPP_TO || '').split(',').map(s => s.replace(/\D/g, '').slice(-10));
    if (cfg.includes(last10)) return { role: 'ADMIN' };
    return null;
  }

  // Delivery callbacks: sent / delivered / read / failed.
  async function handleStatuses(statuses) {
    for (const st of statuses) {
      if (!crm) return;
      const row = await crm.applyStatus(st);
      if (row && st.status === 'failed') {
        const e = (st.errors || [])[0] || {};
        obs.inc('wa_send_failed_total', { code: e.code || 'unknown' });
        obs.log('error', 'wa.send.failed', { wamid: st.id, code: e.code, title: e.title || e.message });
        await pool.query(
          `INSERT INTO crm_followups (conversation_id, partner_id, note, due_date, assigned_to, created_by, kind)
           SELECT c.conversation_id, c.partner_id, $2, CURRENT_DATE, c.assigned_to, 'AUTO', 'SEND_FAILED'
             FROM wa_conversations c
            WHERE c.conversation_id = $1
              AND NOT EXISTS (SELECT 1 FROM crm_followups f
                               WHERE f.conversation_id = c.conversation_id
                                 AND f.kind = 'SEND_FAILED' AND f.status = 'PENDING')`,
          [row.conversation_id,
           `WhatsApp delivery failed (${e.code || 'unknown'}: ${e.title || e.message || 'no detail'}) — the customer did not receive this message`]);
      }
    }
  }

  async function handleMessage(msg, profileName, eventId) {
    const from = msg.from;
    const text = msg.text?.body || '';
    const contextId = msg.context?.id || null;
    const cmd = text.trim().toLowerCase();

    // Idempotency claim — safe to re-run, which is what makes retry possible.
    if (crm && !(await crm.claimEvent(msg.id, 'worker', eventId))) {
      obs.inc('wa_duplicate_dropped_total');
      obs.log('info', 'wa.duplicate', { wamid: msg.id });
      return;
    }
    obs.inc('wa_inbound_total', { type: msg.type || 'text' });

    // ── Staff: alerts, and the management assistant ──
    const staff = await staffMember(from);
    if (staff) {
      if (msg.type !== 'text') return;
      if (buildStatusText && (cmd === 'status' || cmd === 'summary')) {
        await sendText(from, await buildStatusText());
        return;
      }
      // First try to treat it as an acknowledgement of a live machine alert.
      const machineId = await handleInboundReply(from, text, contextId);
      if (machineId) {
        await sendText(from, `✓ Acknowledged ${machineId}. Repeat alerts paused until it recovers. Thank you.`);
        return;
      }
      // Not an ack — route the question to the management assistant (same agent
      // fleet as the Ask-AI page), scoped to this staff member's role. Falls back
      // to the status hint only when the assistant has no grounded answer.
      if (staffAssistant && text.trim()) {
        const answer = await staffAssistant(text.trim(), { role: staff.role });
        if (answer) { await sendText(from, answer); return; }
      }
      await sendText(from, `No active machine alert to acknowledge. Ask me things like "production this week", "reject trend", or "who owes us" — or reply "status" for a live summary.`);
      return;
    }

    // ── Customer ──
    if (!crm) return;
    const conv = await crm.getOrCreateConversation(from, profileName);

    // Consent before the AI: an opt-out must never be answered by a bot.
    if (consent) {
      const body = text.trim();
      if (consent.isStopKeyword(body)) {
        await consent.optOut(from, { actor: 'CUSTOMER', reason: `Customer sent "${body}"`, proofRef: msg.id });
        await crm.addMessage(conv.conversation_id, { direction: 'IN', wa_message_id: msg.id, msg_type: 'text', body: text });
        const bye = 'You have been unsubscribed and will not receive further WhatsApp messages from us. Reply START at any time to resume.';
        await sendText(from, bye);
        await crm.addMessage(conv.conversation_id, { direction: 'OUT', msg_type: 'text', body: bye, sent_by: 'SYSTEM' });
        obs.log('info', 'wa.consent.optout', { phone: from });
        return;
      }
      // Dedicated marketing opt-in: the customer replied the keyword from an invite.
      // Records EXPLICIT marketing consent with the message as proof (DPDP).
      if (consent.isMarketingOptInKeyword && consent.isMarketingOptInKeyword(body)) {
        await consent.optIn(from, { actor: 'CUSTOMER', proofRef: msg.id, detail: `Customer replied "${body}" to marketing opt-in invite`, partnerId: conv.partner_id });
        await crm.addMessage(conv.conversation_id, { direction: 'IN', wa_message_id: msg.id, msg_type: 'text', body: text });
        const ok = 'Done ✓ You are subscribed to offers, new arrivals & festive deals from DHOWN Hosiery. Reply STOP any time to unsubscribe. How can we help you today?';
        await sendText(from, ok);
        await crm.addMessage(conv.conversation_id, { direction: 'OUT', msg_type: 'text', body: ok, sent_by: 'SYSTEM' });
        obs.log('info', 'wa.consent.marketing_optin', { phone: from });
        return;
      }
      if (consent.isStartKeyword(body)) {
        await consent.optIn(from, { actor: 'CUSTOMER', proofRef: msg.id, detail: `Customer sent "${body}"`, partnerId: conv.partner_id });
        await crm.addMessage(conv.conversation_id, { direction: 'IN', wa_message_id: msg.id, msg_type: 'text', body: text });
        const hi = 'Thank you — you are subscribed again. How can we help?';
        await sendText(from, hi);
        await crm.addMessage(conv.conversation_id, { direction: 'OUT', msg_type: 'text', body: hi, sent_by: 'SYSTEM' });
        return;
      }
      await consent.recordImplied(from, { partnerId: conv.partner_id, proofRef: msg.id });
    }

    // WhatsApp delivers type "unsupported" (error 131051) when the customer sent
    // something the Cloud API cannot pass to a business — a poll, view-once media,
    // a forwarded status/story, a payment, or a too-new message type. There is no
    // content to read, so record a readable note and nudge them to resend once.
    if (msg.type === 'unsupported' || (Array.isArray(msg.errors) && msg.errors.length && !msg.text && !msg.image && !msg.document && !msg.video && !msg.audio)) {
      const errTitle = msg.errors?.[0]?.title || msg.errors?.[0]?.error_data?.details || msg.errors?.[0]?.message || null;
      await crm.addMessage(conv.conversation_id, {
        direction: 'IN', wa_message_id: msg.id, msg_type: 'unsupported',
        body: `[Unsupported message — WhatsApp could not deliver its content${errTitle ? `: ${errTitle}` : ''}. Likely a poll, view-once, forwarded status or an unsupported attachment.]`,
      });
      obs.log('info', 'wa.unsupported', { phone: from, detail: errTitle });
      const allowed = consent ? (await consent.canSend(from, 'SERVICE')).allowed : true;
      if (allowed) {
        const nudge = "Sorry — WhatsApp couldn't deliver your last message to us (it may have been a poll, a view-once photo, or a forwarded status). Could you please resend it as a normal text or photo? We'll help right away.";
        const sent = await sendText(from, nudge).catch(() => null);
        await crm.addMessage(conv.conversation_id, { direction: 'OUT', msg_type: 'text', body: nudge, wa_message_id: sent?.messages?.[0]?.id || null, sent_by: 'SYSTEM' });
      }
      return;
    }

    const media = msg.image || msg.document || msg.video || msg.audio || null;
    let local = null;
    if (media?.id && downloadMedia) {
      try { local = await downloadMedia(media.id); }
      catch (e) { obs.log('error', 'wa.media.download', { error: e.message }); }
    }

    let vision = null;
    if (local?.file && (local.mime || '').startsWith('image/') && describeImage) {
      try { vision = await describeImage(local.file, media?.caption || text); }
      catch (e) { obs.log('error', 'wa.vision', { error: e.message }); }
    }

    await crm.addMessage(conv.conversation_id, {
      direction: 'IN', wa_message_id: msg.id, msg_type: msg.type || 'text',
      body: text || null, media_id: media?.id || null,
      media_mime: local?.mime || media?.mime_type || null,
      caption: media?.caption || null, local_file: local?.file || null,
      ai_description: vision || null,
    });

    const answerable = text.trim() || vision;
    if (ai && conv.ai_mode === 'AUTO' && answerable) {
      const out = await ai.run({
        conversationId: conv.conversation_id,
        text: text || media?.caption || '',
        imageDescription: vision, mode: 'AUTO', waMessageId: msg.id,
        ctx: { phone: from, partner_id: conv.partner_id, lead_id: conv.lead_id,
               conversation_id: conv.conversation_id, assigned_to: conv.assigned_to },
      });
      // AUTO replies are customer-initiated service messages, but honour an opt-out
      // that arrived in the meantime.
      const allowed = consent ? (await consent.canSend(from, 'SERVICE')).allowed : true;
      if (allowed) {
        // Send the AI's actual answer whenever it produced one — its content is already
        // guarded by the prompt (never invents prices/stock/dates, offers make-to-order,
        // and itself says "call us on +91 8360180643" when it genuinely can't help). Only
        // fall back to a bare handoff when the reply is truly empty, so a customer is
        // never left hanging. (canAuto still gates nothing here; low-confidence turns just
        // stay unread in the inbox for staff to review.)
        const body = (out.reply && out.reply.trim())
          ? out.reply
          : 'Thank you for your message. For this, please call us on +91 8360180643 and our team will help you right away.';
        const sent = await sendText(from, body);
        await crm.addMessage(conv.conversation_id, {
          direction: 'OUT', msg_type: 'text', body,
          wa_message_id: sent?.messages?.[0]?.id || null,
          sent_by: 'AI', ai_generated: true,
          status: sent?.messages ? 'sent' : 'failed',
        });
        // Window closed (131047): fall back to an approved re-engagement template.
        await reengageIfWindowClosed(from, sent, conv);
      }
    }
  }

  // Entry point for one webhook envelope.
  // NOTE: deliberately NOT named `process` — a module-scope binding with that
  // name shadows Node global `process`, so every process.env lookup in this
  // file would silently resolve to the function instead.
  async function processEnvelope(payload, eventId = null) {
    for (const entry of (payload.entry || [])) {
      for (const change of (entry.changes || [])) {
        const value = change.value || {};
        const profileName = value.contacts?.[0]?.profile?.name || null;
        if (value.statuses?.length) await handleStatuses(value.statuses);
        for (const msg of (value.messages || [])) await handleMessage(msg, profileName, eventId);
      }
    }
  }

  return { process: processEnvelope };
};
