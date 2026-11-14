// WhatsApp AI CRM — inbox API for the MES UI. All routes require a JWT;
// commercial/AI actions are further gated by role. Mounted at /api/wa.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { sendMedia, MEDIA_DIR } = require('../lib/wa-media');
const { PIPELINE } = require('../lib/wa-score');
const { buildQuotePdf } = require('../lib/wa-pdf');
const { buildStatementPdf } = require('../lib/statement-pdf');
const { buildCreditNotePdf } = require('../lib/credit-note-pdf');
const ExcelJS = require('exceljs');
const { messageIdOf } = require('../lib/alerts');

module.exports = ({ pool, verifyToken, requireRole, aiLimiter, crm, ai, sendText, quotes, production, insights, followups, consent, queue, inventory, approvals, margin, payments }) => {
  const router = express.Router();
  router.use(verifyToken); // no anonymous access to customer conversations

  // Owning a customer conversation IS the sales job, so SALES is granted the
  // few SUPERVISOR-level routes that are sales work. It is deliberately NOT
  // granted the others on this router — /payments is accounts, /prices is a
  // management price list, /queue/* is operations. See ROLE_HIERARCHY.
  const SALES_TOO = { also: ['SALES'] };

  // Recording money, cancelling a receipt and applying credit are the accounts
  // job. They currently sit behind SUPERVISOR and ADMIN, which pushes them to
  // the people least likely to be doing them — so ACCOUNTS is granted these
  // explicitly. It is NOT granted quotes, prices or sales orders: the person
  // who agrees a price should not also be the person who records the payment.
  const ACCOUNTS_TOO = { also: ['ACCOUNTS'] };

  // Conversation list (with outstanding / open orders / last order date).
  router.get('/conversations', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await crm.listConversations()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/conversations/:id/messages', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await crm.getMessages(req.params.id, Math.min(parseInt(req.query.limit || '100') || 100, 500))); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/conversations/:id/customer', requireRole('OPERATOR'), async (req, res) => {
    try {
      const data = await crm.customer360(req.params.id);
      if (!data) return res.status(404).json({ error: 'Conversation not found' });
      res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/conversations/:id/read', requireRole('OPERATOR'), async (req, res) => {
    try {
      await pool.query(`UPDATE wa_conversations SET unread_count=0 WHERE conversation_id=$1`, [req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // AI mode per conversation: OFF | SUGGEST | AUTO (§14). AUTO is supervisor+.
  router.put('/conversations/:id/mode', requireRole('SUPERVISOR', SALES_TOO), async (req, res) => {
    const mode = String(req.body.mode || '').toUpperCase();
    if (!['OFF', 'SUGGEST', 'AUTO'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });
    try {
      await pool.query(`UPDATE wa_conversations SET ai_mode=$1 WHERE conversation_id=$2`, [mode, req.params.id]);
      res.json({ ok: true, mode });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Global default AI mode for NEW conversations (§14). Read: operator; set: supervisor+.
  router.get('/settings/default-mode', requireRole('OPERATOR'), async (req, res) => {
    try {
      const r = await pool.query(`SELECT value FROM app_settings WHERE key='wa_default_ai_mode'`);
      res.json({ mode: ['OFF', 'SUGGEST', 'AUTO'].includes(r.rows[0]?.value) ? r.rows[0].value : 'SUGGEST' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/settings/default-mode', requireRole('SUPERVISOR', SALES_TOO), async (req, res) => {
    const mode = String(req.body.mode || '').toUpperCase();
    if (!['OFF', 'SUGGEST', 'AUTO'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });
    try {
      await pool.query(`INSERT INTO app_settings (key, value, updated_at) VALUES ('wa_default_ai_mode',$1,NOW())
                        ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [mode]);
      res.json({ ok: true, mode });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Human send — the only path that puts text on the wire from the UI.
  router.post('/conversations/:id/send', requireRole('OPERATOR'), async (req, res) => {
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    try {
      const c = (await pool.query(`SELECT phone FROM wa_conversations WHERE conversation_id=$1`, [req.params.id])).rows[0];
      if (!c) return res.status(404).json({ error: 'Conversation not found' });

      // Web-chat (channel='WEB') threads are not WhatsApp: the consent gate, the
      // 24-hour window and the Cloud API send do not apply. Just persist the reply;
      // the visitor's widget polls /api/webchat/history and picks it up.
      if (String(c.phone).startsWith('web:')) {
        const msg = await crm.addMessage(req.params.id, {
          direction: 'OUT', msg_type: 'text', body: text,
          sent_by: req.user?.username || null, ai_generated: !!req.body.ai_generated,
        });
        return res.json(msg);
      }

      // Free-form text is only legal inside the 24-hour window. Refusing here is
      // far better than letting Meta reject it and showing the agent a message
      // that looks sent but never arrived.
      // Consent gate before the window gate: an opted-out customer must not be
      // messaged even inside an open window.
      const ok = await consent.guard(c.phone, 'SERVICE', req.user?.username);
      if (!ok.allowed) return res.status(403).json({ error: ok.reason, consent_blocked: true });

      const win = await crm.windowState(req.params.id);
      if (!win.open) {
        return res.status(409).json({
          error: 'The 24-hour reply window is closed. Send an approved template to reopen the conversation.',
          window_closed: true, expires_at: win.expiresAt,
        });
      }

      const sent = await sendText(c.phone, text);
      const msg = await crm.addMessage(req.params.id, {
        direction: 'OUT', msg_type: 'text', body: text,
        wa_message_id: messageIdOf(sent),
        sent_by: req.user?.username || null, ai_generated: !!req.body.ai_generated,
      });
      res.json(msg);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Window state for the composer (countdown / template mode).
  router.get('/conversations/:id/window', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await crm.windowState(req.params.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Messages that Meta reported as undelivered — the queue nobody had before.
  router.get('/messages/failed', requireRole('OPERATOR'), async (req, res) => {
    try {
      res.json((await pool.query(
        `SELECT m.message_id, m.conversation_id, m.body, m.caption, m.error_code, m.error_title,
                m.failed_at, c.phone, COALESCE(p.company_name, c.display_name) AS who
           FROM wa_messages m
           JOIN wa_conversations c ON c.conversation_id = m.conversation_id
           LEFT JOIN partners p ON p.partner_id = c.partner_id
          WHERE m.status = 'failed'
          ORDER BY m.failed_at DESC NULLS LAST LIMIT 100`)).rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // AI draft for the latest inbound message — never auto-sends from here (§14).
  router.post('/conversations/:id/suggest', aiLimiter, requireRole('OPERATOR'), async (req, res) => {
    try {
      const c = (await pool.query(`SELECT * FROM wa_conversations WHERE conversation_id=$1`, [req.params.id])).rows[0];
      if (!c) return res.status(404).json({ error: 'Conversation not found' });
      const last = (await pool.query(
        // wa_message_id is needed so conversation memory can exclude the very
        // message being answered, rather than showing it twice.
        `SELECT body, caption, ai_description, wa_message_id FROM wa_messages
          WHERE conversation_id=$1 AND direction='IN'
          ORDER BY created_at DESC LIMIT 1`, [req.params.id])).rows[0];
      const text = String(req.body.text || last?.body || last?.caption || '').trim();
      const imageDescription = last?.ai_description || null;
      // An image-only message is still answerable — the description carries it.
      if (!text && !imageDescription) {
        return res.status(400).json({ error: 'No customer message to answer' });
      }

      const out = await ai.run({
        conversationId: c.conversation_id, text, imageDescription, mode: 'SUGGEST',
        waMessageId: last?.wa_message_id || null,
        ctx: { phone: c.phone, partner_id: c.partner_id, lead_id: c.lead_id,
               conversation_id: c.conversation_id, assigned_to: c.assigned_to },
      });
      res.json({ intent: out.intent, reply: out.reply, tools: out.results, action_id: out.actionId,
                 confidence: out.confidence, confidence_reasons: out.confidence_reasons,
                 low_confidence: out.low_confidence });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── §1/§5 salesperson assignment ─────────────────────────────────────
  // Who can own a conversation. SALES users now exist and sort to the top;
  // admins and supervisors remain assignable so a conversation is never
  // stranded when the salesperson who owned it is away.
  router.get('/assignees', requireRole('OPERATOR'), async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT username, full_name, role FROM users
          WHERE active = true AND deleted_at IS NULL
            AND role IN ('SALES','SALESMAN','SALES_EXECUTIVE','SUPER_ADMIN','ADMIN','SUPERVISOR')
          ORDER BY CASE role
                     WHEN 'SALES' THEN 0 WHEN 'SALESMAN' THEN 0 WHEN 'SALES_EXECUTIVE' THEN 0
                     WHEN 'SUPER_ADMIN' THEN 1 WHEN 'ADMIN' THEN 2 ELSE 3 END,
                   COALESCE(full_name, username)`);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/conversations/:id/assign', requireRole('OPERATOR'), async (req, res) => {
    const to = req.body.assigned_to === null || req.body.assigned_to === ''
      ? null : String(req.body.assigned_to || '').trim();
    try {
      // Only a real, active, assignable user — never free text.
      if (to) {
        const ok = await pool.query(
          `SELECT 1 FROM users WHERE username=$1 AND active=true AND deleted_at IS NULL
            AND role IN ('SALES','SALESMAN','SALES_EXECUTIVE','SUPER_ADMIN','ADMIN','SUPERVISOR')`, [to]);
        if (!ok.rows.length) return res.status(400).json({ error: 'Not an assignable user' });
      }
      const r = await pool.query(
        `UPDATE wa_conversations SET assigned_to=$1 WHERE conversation_id=$2 RETURNING conversation_id, assigned_to`,
        [to, req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Conversation not found' });
      res.json({ ok: true, assigned_to: r.rows[0].assigned_to });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Customer category (§5) — free text label, SUPERVISOR+.
  router.put('/partners/:id/category', requireRole('SUPERVISOR', SALES_TOO), async (req, res) => {
    try {
      const r = await pool.query(
        `UPDATE partners SET customer_category=$1 WHERE partner_id=$2 RETURNING partner_id, customer_category`,
        [String(req.body.category || '').trim() || null, req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Partner not found' });
      res.json({ ok: true, ...r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Authorised customer price list (§8) — SUPERVISOR+ writes only ────
  router.get('/prices', requireRole('OPERATOR'), async (req, res) => {
    try {
      res.json((await pool.query(
        `SELECT cp.*, p.company_name FROM customer_prices cp
           LEFT JOIN partners p ON p.partner_id = cp.partner_id
          WHERE cp.is_active = true
            AND ($1::int IS NULL OR cp.partner_id = $1)
          ORDER BY p.company_name, cp.product, cp.shade`,
        [req.query.partner_id || null])).rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/prices', requireRole('SUPERVISOR'), async (req, res) => {
    const b = req.body || {};
    if (!b.partner_id || !b.product || !(Number(b.rate) > 0)) {
      return res.status(400).json({ error: 'partner_id, product and a positive rate are required' });
    }
    try {
      const r = await pool.query(
        `INSERT INTO customer_prices (partner_id, product, shade, gsm, rate, valid_from, valid_to, approved_by, notes)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,$8,$9) RETURNING *`,
        [b.partner_id, b.product, b.shade || null, b.gsm || null, Number(b.rate),
         b.valid_from || null, b.valid_to || null, req.user?.username || null, b.notes || null]);
      res.status(201).json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/prices/:id', requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const r = await pool.query(
        `UPDATE customer_prices SET is_active=false WHERE price_id=$1 RETURNING price_id`, [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Inbound queue (CRIT-01): depth, dead letters and replay ──────────
  router.get('/queue/stats', requireRole('SUPERVISOR'), async (req, res) => {
    try { res.json(await queue.stats()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Events that exhausted every retry — the messages that would previously have
  // vanished without trace.
  router.get('/queue/dead', requireRole('SUPERVISOR'), async (req, res) => {
    try { res.json(await queue.listDead()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/queue/dead/:id/replay', requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const out = await queue.replay(req.params.id);
      if (out.error) return res.status(out.code || 400).json({ error: out.error });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Payments, allocation, ageing ─────────────────────────────────────
  router.get('/payments', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await payments.list({ partner_id: req.query.partner_id })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Recording money is a supervisor action and is always audited.
  router.post('/payments', requireRole('SUPERVISOR', ACCOUNTS_TOO), async (req, res) => {
    try {
      const out = await payments.record({ ...req.body, created_by: req.user?.username });
      if (out.error) return res.status(out.code || 400).json({ error: out.error });
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Statement of account. JSON for the screen, PDF for the customer.
  //
  // SALES is granted this deliberately — chasing a customer for money they
  // dispute is the collections conversation, and a salesperson who cannot
  // produce the statement has to ask someone else every time.
  router.get('/customers/:id/statement', requireRole('OPERATOR'), async (req, res) => {
    try {
      const out = await payments.statement(req.params.id, { from: req.query.from || null, to: req.query.to || null });
      if (out.error) return res.status(out.code || 400).json({ error: out.error });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/customers/:id/statement.pdf', requireRole('OPERATOR'), async (req, res) => {
    try {
      const out = await payments.statement(req.params.id, { from: req.query.from || null, to: req.query.to || null });
      if (out.error) return res.status(out.code || 400).json({ error: out.error });
      const file = await buildStatementPdf(out);
      res.type('application/pdf');
      // inline so the browser previews it; the operator can still save or print.
      res.setHeader('Content-Disposition',
        `inline; filename="${file.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
      fs.createReadStream(path.join(MEDIA_DIR, file)).pipe(res);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Debtors ageing as a spreadsheet. The screen is for working the list; the
  // export is for the meeting where someone wants to sort it their own way.
  router.get('/ageing.xlsx', requireRole('OPERATOR'), async (req, res) => {
    try {
      const rows = await payments.ageingReport();
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Debtors ageing');
      ws.columns = [
        { header: 'Customer', key: 'company_name', width: 34 },
        { header: 'Credit limit', key: 'credit_limit', width: 14 },
        { header: 'Outstanding', key: 'outstanding', width: 14 },
        { header: 'Overdue', key: 'overdue', width: 14 },
        { header: 'Not due', key: 'current', width: 14 },
        { header: '1-30', key: 'd1_30', width: 12 },
        { header: '31-60', key: 'd31_60', width: 12 },
        { header: '61-90', key: 'd61_90', width: 12 },
        { header: '90+', key: 'd90_plus', width: 12 },
        { header: 'Open invoices', key: 'open_invoices', width: 14 },
        { header: 'Oldest overdue (days)', key: 'oldest_overdue_days', width: 20 },
      ];
      ws.getRow(1).font = { bold: true };
      rows.forEach(r => ws.addRow(r));

      // A total row, because the first thing anyone does with this is sum it,
      // and a hand-summed column is a column that disagrees with the dashboard.
      if (rows.length) {
        const t = ws.addRow({
          company_name: `TOTAL (${rows.length} customers)`,
          outstanding: rows.reduce((s2, r) => s2 + r.outstanding, 0),
          overdue: rows.reduce((s2, r) => s2 + r.overdue, 0),
          current: rows.reduce((s2, r) => s2 + r.current, 0),
          d1_30: rows.reduce((s2, r) => s2 + r.d1_30, 0),
          d31_60: rows.reduce((s2, r) => s2 + r.d31_60, 0),
          d61_90: rows.reduce((s2, r) => s2 + r.d61_90, 0),
          d90_plus: rows.reduce((s2, r) => s2 + r.d90_plus, 0),
        });
        t.font = { bold: true };
      }
      ['credit_limit','outstanding','overdue','current','d1_30','d31_60','d61_90','d90_plus']
        .forEach(k => { ws.getColumn(k).numFmt = '#,##0.00'; });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition',
        `attachment; filename="debtors-ageing-${new Date().toISOString().slice(0,10)}.xlsx"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The credit note as a document the customer's accounts team can file.
  router.get('/credit-notes/:id/pdf', requireRole('OPERATOR'), async (req, res) => {
    try {
      const n = (await pool.query(
        `SELECT cn.*, p.company_name, p.gstin, ti.invoice_number, sr.return_number
           FROM credit_notes cn
           LEFT JOIN partners p ON p.partner_id = cn.partner_id
           LEFT JOIN tax_invoices ti ON ti.invoice_id = cn.invoice_id
           LEFT JOIN sales_returns sr ON sr.return_id = cn.return_id
          WHERE cn.note_id = $1`, [req.params.id])).rows[0];
      if (!n) return res.status(404).json({ error: 'Credit note not found' });
      const file = await buildCreditNotePdf(n);
      res.type('application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${file}"`);
      fs.createReadStream(path.join(MEDIA_DIR, file)).pipe(res);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Credit limits and payment terms, in bulk ─────────────────────────
  // One-per-customer on the partner record meant setting them across a book
  // required opening each one, so in practice they were not set at all. The
  // list leads with who has NO limit, because that is the population where
  // the credit gate is silently doing nothing.
  const creditTerms = require('../lib/credit-terms')(pool);

  router.get('/credit-terms', requireRole('SUPERVISOR', ACCOUNTS_TOO), async (req, res) => {
    try {
      res.json(await creditTerms.list({
        q: req.query.q || null,
        missing_only: req.query.missing_only === 'true',
      }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Deciding who may owe how much is a management call, so writing is ADMIN
  // even though ACCOUNTS can read it.
  router.put('/credit-terms', requireRole('ADMIN'), async (req, res) => {
    try {
      const out = await creditTerms.bulkUpdate(req.body?.changes, { by: req.user?.username });
      if (out.error) return res.status(out.code || 400).json({ error: out.error, problems: out.problems });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/payments/:id/cancel', requireRole('ADMIN', ACCOUNTS_TOO), async (req, res) => {
    try {
      const out = await payments.cancel(req.params.id, { by: req.user?.username, reason: req.body?.reason });
      if (out.error) return res.status(out.code || 400).json({ error: out.error });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/customers/:id/outstanding', requireRole('OPERATOR'), async (req, res) => {
    try {
      res.json({ ...(await payments.outstanding(req.params.id)),
                 open_invoices_detail: await payments.openInvoices(req.params.id) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/customers/:id/ledger', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await payments.ledger(req.params.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Customers holding unapplied credit. Separate from /ageing, which only lists
  // customers who owe money — an advance with nothing outstanding shows nowhere else.
  router.get('/credit-on-account', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await payments.creditOnAccountAll()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // On-account credit (advances, overpayments) and applying it to open invoices.
  router.get('/customers/:id/credit-on-account', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await payments.creditOnAccount(req.params.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/customers/:id/apply-credit', requireRole('SUPERVISOR', ACCOUNTS_TOO), async (req, res) => {
    try { res.json(await payments.applyCredit(req.params.id, { by: req.user?.username })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The collections worklist.
  router.get('/ageing', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await payments.ageingReport()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Quote revisions, validity, margin (HIGH-12) ──────────────────────
  router.post('/quotes/:id/revise', requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const out = await quotes.revise(req.params.id, req.body || {}, req.user?.username);
      if (out.error) return res.status(out.code || 400).json({ error: out.error });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/quotes/:id/revisions', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await quotes.revisions(req.params.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Margin is confidential — SUPERVISOR+, and never sent to a customer.
  router.get('/quotes/:id/margin', requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const q = (await pool.query('SELECT * FROM wa_quotes WHERE quote_id=$1', [req.params.id])).rows[0];
      if (!q) return res.status(404).json({ error: 'Quote not found' });
      res.json(await margin.assess({ product: q.product, shade: q.shade, rate: q.rate, quantity_kg: q.quantity_kg }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Stock reservations / ATP (HIGH-02) ───────────────────────────────
  router.get('/stock/atp', requireRole('OPERATOR'), async (req, res) => {
    try {
      if (req.query.fabric_type || req.query.color_name) {
        return res.json(await inventory.atp({ fabric_type: req.query.fabric_type, color_name: req.query.color_name }));
      }
      res.json(await inventory.overview());
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/stock/reservations', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await inventory.list({ status: req.query.status || 'ACTIVE', ref_type: req.query.ref_type, ref_id: req.query.ref_id })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/stock/reserve', requireRole('OPERATOR'), async (req, res) => {
    try {
      // Only a supervisor may reserve beyond available-to-promise.
      const privileged = ['SUPERVISOR','ADMIN','SUPER_ADMIN'].includes(req.user?.role);
      const out = await inventory.reserve({ ...req.body, force: privileged && !!req.body.force, created_by: req.user?.username });
      if (out.error) return res.status(out.code || 400).json(out);
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/stock/reservations/:id/release', requireRole('OPERATOR'), async (req, res) => {
    try {
      const out = await inventory.release(req.params.id, { by: req.user?.username, reason: req.body?.reason });
      if (out.error) return res.status(out.code || 400).json({ error: out.error });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Approvals (HIGH-05) ──────────────────────────────────────────────
  router.get('/approvals', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await approvals.pending({ docType: req.query.doc_type })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/approvals/:id/decide', requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const out = await approvals.decide(req.params.id, {
        approve: req.body?.approve !== false, note: req.body?.note,
        user: req.user?.username, userRole: req.user?.role,
      });
      if (out.error) return res.status(out.code || 400).json({ error: out.error });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/approvals/matrix', requireRole('SUPERVISOR'), async (req, res) => {
    try { res.json((await pool.query('SELECT * FROM approval_matrix WHERE is_active=true ORDER BY doc_type, min_value')).rows); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Consent register (§24) ───────────────────────────────────────────
  router.get('/consent', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await consent.register({ status: req.query.status })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/consent/:phone', requireRole('OPERATOR'), async (req, res) => {
    try {
      res.json({ consent: await consent.get(req.params.phone), history: await consent.history(req.params.phone) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Staff-recorded opt-in needs evidence of how it was obtained (DPDP).
  router.post('/consent/:phone/opt-in', requireRole('SUPERVISOR'), async (req, res) => {
    if (!req.body.proof_ref) {
      return res.status(400).json({ error: 'proof_ref is required — record how consent was obtained' });
    }
    try {
      res.json(await consent.optIn(req.params.phone, {
        actor: req.user?.username, proofRef: req.body.proof_ref, detail: req.body.detail,
      }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/consent/:phone/opt-out', requireRole('OPERATOR'), async (req, res) => {
    try {
      res.json(await consent.optOut(req.params.phone, {
        actor: req.user?.username, reason: req.body.reason || 'Recorded by staff',
      }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Send a marketing opt-in INVITE to a conversation (in-window service message):
  // asks the customer to reply the opt-in keyword. Consent is only recorded when
  // THEY reply — the invite itself grants nothing.
  router.post('/conversations/:id/invite-offers', requireRole('OPERATOR', SALES_TOO), async (req, res) => {
    try {
      const conv = (await pool.query(`SELECT * FROM wa_conversations WHERE conversation_id=$1`, [req.params.id])).rows[0];
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });
      const ok = await consent.guard(conv.phone, 'SERVICE', req.user?.username);
      if (!ok.allowed) return res.status(403).json({ error: ok.reason, consent_blocked: true });
      const kw = consent.marketingKeyword ? consent.marketingKeyword() : 'OFFERS';
      const body = `Would you like offers, new arrivals & festive deals from DHOWN Hosiery on WhatsApp? Reply ${kw} to join. Reply STOP any time to unsubscribe.`;
      const sent = await sendText(conv.phone, body);
      await crm.addMessage(conv.conversation_id, { direction: 'OUT', msg_type: 'text', body, wa_message_id: sent?.messages?.[0]?.id || null, sent_by: req.user?.username || 'STAFF' });
      res.json({ ok: true, keyword: kw, sent: !!sent?.messages });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── §12 CRM follow-ups ───────────────────────────────────────────────
  router.get('/followups', requireRole('OPERATOR'), async (req, res) => {
    try {
      res.json((await pool.query(
        `SELECT f.*, p.company_name, c.phone
           FROM crm_followups f
           LEFT JOIN wa_conversations c ON c.conversation_id = f.conversation_id
           LEFT JOIN partners p ON p.partner_id = f.partner_id
          WHERE f.status = COALESCE($1,'PENDING')
          ORDER BY f.due_date NULLS LAST, f.created_at DESC LIMIT 200`,
        [req.query.status || null])).rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Manual trigger for the auto-scanner (§12); it also runs on a schedule.
  router.post('/followups/scan', requireRole('SUPERVISOR'), async (req, res) => {
    try {
      await followups.autoClose();
      res.json(await followups.scan());
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/followups', requireRole('OPERATOR'), async (req, res) => {
    const b = req.body || {};
    if (!b.note) return res.status(400).json({ error: 'note required' });
    try {
      let partnerId = b.partner_id || null, leadId = b.lead_id || null;
      if (b.conversation_id) {
        const c = (await pool.query(
          `SELECT partner_id, lead_id, assigned_to FROM wa_conversations WHERE conversation_id=$1`,
          [b.conversation_id])).rows[0];
        if (c) { partnerId = partnerId || c.partner_id; leadId = leadId || c.lead_id; }
      }
      const r = await pool.query(
        `INSERT INTO crm_followups (partner_id, lead_id, conversation_id, note, due_date, assigned_to, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [partnerId, leadId, b.conversation_id || null, b.note,
         b.due_date || null, b.assigned_to || req.user?.username || null, req.user?.username || null]);
      res.status(201).json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/followups/:id/done', requireRole('OPERATOR'), async (req, res) => {
    try {
      const r = await pool.query(
        `UPDATE crm_followups SET status='DONE' WHERE followup_id=$1 AND status='PENDING' RETURNING followup_id`,
        [req.params.id]);
      if (!r.rows.length) return res.status(409).json({ error: 'Follow-up not pending' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/conversations/:id/summaries', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await insights.summaries(req.params.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // §15 AI copilot — MES-derived summary + recommended actions.
  router.get('/conversations/:id/copilot', requireRole('OPERATOR'), async (req, res) => {
    try {
      const out = await insights.copilot(req.params.id);
      if (!out) return res.status(404).json({ error: 'Conversation not found' });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Phase 2: media ───────────────────────────────────────────────────
  // Serve a message attachment to the MES UI. JWT-gated (router.use above) and
  // resolved from the DB row, so the path can never be traversed by the client.
  router.get('/media/:messageId', requireRole('OPERATOR'), async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT local_file, media_mime FROM wa_messages WHERE message_id = $1`, [req.params.messageId]);
      const row = r.rows[0];
      if (!row || !row.local_file) return res.status(404).json({ error: 'No attachment' });
      const file = path.join(MEDIA_DIR, path.basename(row.local_file)); // basename = no traversal
      if (!fs.existsSync(file)) return res.status(404).json({ error: 'File missing' });
      res.type(row.media_mime || 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Send a shade card (or any library document) to the customer on WhatsApp.
  router.post('/conversations/:id/send-card', requireRole('OPERATOR'), async (req, res) => {
    try {
      const conv = (await pool.query(`SELECT phone FROM wa_conversations WHERE conversation_id=$1`, [req.params.id])).rows[0];
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });
      const card = (await pool.query(`SELECT * FROM shade_cards WHERE card_id=$1 AND is_active=true`, [req.body.card_id])).rows[0];
      if (!card || !card.file_name) return res.status(404).json({ error: 'Shade card or its file not found' });

      const file = path.join(MEDIA_DIR, path.basename(card.file_name));
      if (!fs.existsSync(file)) return res.status(404).json({ error: 'Card file missing on disk' });

      const okc = await consent.guard(conv.phone, 'TRANSACTIONAL', req.user?.username);
      if (!okc.allowed) return res.status(403).json({ error: okc.reason, consent_blocked: true });

      const caption = req.body.caption || `${card.product}${card.gsm ? ` · ${card.gsm} GSM` : ''} — shade card`;
      const sent = await sendMedia(conv.phone, file, card.mime_type || 'application/pdf', caption);
      if (!sent) return res.status(502).json({ error: 'WhatsApp send failed (check token/window)' });

      const msg = await crm.addMessage(req.params.id, {
        direction: 'OUT',
        msg_type: (card.mime_type || '').startsWith('image/') ? 'image' : 'document',
        caption, local_file: card.file_name, media_mime: card.mime_type,
        sent_by: req.user?.username || null,
      });
      res.json(msg);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Shade-card library (§4) ──────────────────────────────────────────
  router.get('/shade-cards', requireRole('OPERATOR'), async (req, res) => {
    try {
      res.json((await pool.query(
        `SELECT * FROM shade_cards WHERE is_active=true ORDER BY product`)).rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Create a card; the file arrives as base64 (same pattern as knitting-structure images).
  router.post('/shade-cards', requireRole('SUPERVISOR'), async (req, res) => {
    const b = req.body || {};
    if (!b.product) return res.status(400).json({ error: 'product required' });
    try {
      let fileName = null;
      if (b.file_base64 && b.mime_type) {
        const ext = (b.mime_type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
        fileName = `card_${Date.now()}.${ext}`;
        fs.writeFileSync(path.join(MEDIA_DIR, fileName),
          Buffer.from(String(b.file_base64).replace(/^data:[^;]+;base64,/, ''), 'base64'));
      }
      const r = await pool.query(
        `INSERT INTO shade_cards (product, construction, gsm, composition, width, finish, shades,
                                  moq_kg, lead_time_days, file_name, mime_type, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [b.product, b.construction || null, b.gsm || null, b.composition || null, b.width || null,
         b.finish || null, b.shades || null, b.moq_kg || null, b.lead_time_days || null,
         fileName, fileName ? b.mime_type : null, req.user?.username || null]);
      res.status(201).json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/shade-cards/:id', requireRole('ADMIN'), async (req, res) => {
    try {
      const r = await pool.query(
        `UPDATE shade_cards SET is_active=false WHERE card_id=$1 RETURNING card_id`, [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Phase 3: quotations (§8) ─────────────────────────────────────────
  router.get('/quotes', requireRole('OPERATOR'), async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT * FROM wa_quotes
          WHERE ($1::text IS NULL OR status = $1)
            AND ($2::bigint IS NULL OR conversation_id = $2)
          ORDER BY created_at DESC LIMIT 200`,
        [req.query.status || null, req.query.conversation_id || null]);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Draft a quote. Sales staff may create it; the rate is decided by the engine
  // (customer history) — a manager-supplied rate is only honoured for SUPERVISOR+.
  router.post('/quotes', requireRole('OPERATOR'), async (req, res) => {
    try {
      const body = { ...req.body };
      // SALES belongs here: quoting a price is the job. Without it a
      // salesperson's rate would be stripped silently and the quote would go
      // out at the list price — a wrong number, with no error to notice.
      const privileged = ['SALES', 'SUPERVISOR', 'ADMIN', 'SUPER_ADMIN'].includes(req.user?.role);
      if (!privileged) delete body.rate;   // operators can never inject a price
      const out = await quotes.createQuote(body, req.user?.username);
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Manager decision: APPROVE (optionally with an edited rate) or REJECT.
  router.post('/quotes/:id/act', requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const out = await quotes.act(req.params.id, req.body || {}, req.user?.username);
      if (out.error) return res.status(out.code || 400).json({ error: out.error });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/quotes/:id/approvals', requireRole('SUPERVISOR'), async (req, res) => {
    try {
      res.json((await pool.query(
        `SELECT * FROM wa_quote_approvals WHERE quote_id=$1 ORDER BY created_at DESC`, [req.params.id])).rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Send an approved quote on WhatsApp. Unapproved quotes can never be sent.
  router.post('/quotes/:id/send', requireRole('OPERATOR'), async (req, res) => {
    try {
      const q = (await pool.query(`SELECT * FROM wa_quotes WHERE quote_id=$1`, [req.params.id])).rows[0];
      if (!q) return res.status(404).json({ error: 'Quote not found' });
      if (q.status !== 'APPROVED') {
        return res.status(409).json({ error: `Quote is ${q.status} — only APPROVED quotes can be sent.` });
      }
      const conv = (await pool.query(
        `SELECT conversation_id, phone FROM wa_conversations WHERE conversation_id=$1`, [q.conversation_id])).rows[0];
      if (!conv) return res.status(404).json({ error: 'No conversation for this quote' });

      // Send the quotation as a PDF document, with the summary as the caption so
      // it still reads well on a phone. If the PDF or its upload fails we fall
      // back to text rather than leaving the customer with nothing.
      const okq = await consent.guard(conv.phone, 'TRANSACTIONAL', req.user?.username);
      if (!okq.allowed) return res.status(403).json({ error: okq.reason, consent_blocked: true });

      const text = quotes.quoteText(q);
      let msg = null;
      try {
        const file = await buildQuotePdf(q);
        const sent = await sendMedia(conv.phone, path.join(MEDIA_DIR, file), 'application/pdf',
          `Quotation ${q.quote_no}`);
        if (sent) {
          msg = await crm.addMessage(conv.conversation_id, {
            direction: 'OUT', msg_type: 'document', caption: `Quotation ${q.quote_no}`,
            body: text, local_file: file, media_mime: 'application/pdf',
            sent_by: req.user?.username || null,
          });
        }
      } catch (e) { console.error('[WA quote pdf]', e.message); }

      if (!msg) {
        const st = await sendText(conv.phone, text);
        msg = await crm.addMessage(conv.conversation_id, {
          direction: 'OUT', msg_type: 'text', body: text, wa_message_id: messageIdOf(st),
          sent_by: req.user?.username || null,
        });
      }
      await pool.query(`UPDATE wa_quotes SET status='SENT' WHERE quote_id=$1`, [req.params.id]);
      res.json({ ok: true, message: msg, pdf: msg.msg_type === 'document' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Preview the quotation PDF in the MES before sending it.
  router.get('/quotes/:id/pdf', requireRole('OPERATOR'), async (req, res) => {
    try {
      const q = (await pool.query(`SELECT * FROM wa_quotes WHERE quote_id=$1`, [req.params.id])).rows[0];
      if (!q) return res.status(404).json({ error: 'Quote not found' });
      const file = await buildQuotePdf(q);
      res.type('application/pdf');
      fs.createReadStream(path.join(MEDIA_DIR, file)).pipe(res);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // §1 / §22 send_document — send an MES document (invoice, dispatch challan) or
  // an uploaded file to the customer on WhatsApp. Documents are rendered by the
  // MES; the AI can request a send but a human triggers this route.
  router.post('/conversations/:id/send-document', requireRole('OPERATOR'), async (req, res) => {
    const { doc_type, doc_id, file_base64, mime_type, file_name, caption } = req.body || {};
    try {
      const conv = (await pool.query(
        `SELECT phone FROM wa_conversations WHERE conversation_id=$1`, [req.params.id])).rows[0];
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });

      const okd = await consent.guard(conv.phone, 'TRANSACTIONAL', req.user?.username);
      if (!okd.allowed) return res.status(403).json({ error: okd.reason, consent_blocked: true });

      let file = null, mime = mime_type || 'application/pdf', label = caption || '';

      if (doc_type === 'QUOTE' && doc_id) {
        const q = (await pool.query(`SELECT * FROM wa_quotes WHERE quote_id=$1`, [doc_id])).rows[0];
        if (!q) return res.status(404).json({ error: 'Quote not found' });
        if (q.status === 'PENDING_PRICE_APPROVAL') {
          return res.status(409).json({ error: 'Quote is not approved yet' });
        }
        file = await buildQuotePdf(q); mime = 'application/pdf';
        label = label || `Quotation ${q.quote_no}`;
      } else if (file_base64) {
        const ext = (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
        file = `doc_${Date.now()}.${ext}`;
        fs.writeFileSync(path.join(MEDIA_DIR, file),
          Buffer.from(String(file_base64).replace(/^data:[^;]+;base64,/, ''), 'base64'));
        label = label || file_name || 'Document';
      } else {
        return res.status(400).json({ error: 'Provide doc_type+doc_id, or file_base64' });
      }

      const sent = await sendMedia(conv.phone, path.join(MEDIA_DIR, file), mime, label);
      if (!sent) return res.status(502).json({ error: 'WhatsApp send failed (check token/24h window)' });

      const msg = await crm.addMessage(req.params.id, {
        direction: 'OUT', msg_type: mime.startsWith('image/') ? 'image' : 'document',
        caption: label, local_file: file, media_mime: mime, sent_by: req.user?.username || null,
      });
      res.json(msg);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Draft sales orders (§9) ──────────────────────────────────────────
  router.get('/draft-orders', requireRole('OPERATOR'), async (req, res) => {
    try {
      res.json((await pool.query(
        `SELECT * FROM wa_draft_orders WHERE ($1::text IS NULL OR status=$1)
          ORDER BY created_at DESC LIMIT 200`, [req.query.status || null])).rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/draft-orders', requireRole('OPERATOR'), async (req, res) => {
    try {
      const out = await quotes.createDraftOrder(req.body || {}, req.user?.username);
      if (out.error) return res.status(out.code || 400).json({ error: out.error });
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Confirmation is the ONLY path that creates a real MES sales order.
  router.post('/draft-orders/:id/confirm', requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const out = await quotes.confirmDraft(req.params.id, req.user?.username, { userRole: req.user?.role });
      if (out.error) {
        // Pass the approval details through — the UI needs to show WHICH approval
        // is required and who can give it, not just that something was refused.
        const { error, code, ...rest } = out;
        return res.status(code || 400).json({ error, ...rest });
      }

      // Tell the customer the order number, on the same thread.
      const d = (await pool.query(`SELECT * FROM wa_draft_orders WHERE draft_id=$1`, [req.params.id])).rows[0];
      if (d?.conversation_id) {
        const conv = (await pool.query(
          `SELECT phone FROM wa_conversations WHERE conversation_id=$1`, [d.conversation_id])).rows[0];
        if (conv) {
          const text = `Order confirmed.\nOrder No: ${out.so_number}`;
          await sendText(conv.phone, text);
          await crm.addMessage(d.conversation_id, {
            direction: 'OUT', msg_type: 'text', body: text, sent_by: req.user?.username || null,
          });
        }
      }
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/draft-orders/:id/reject', requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const r = await pool.query(
        `UPDATE wa_draft_orders SET status='REJECTED', confirmed_by=$1, confirmed_at=NOW()
          WHERE draft_id=$2 AND status='PENDING' RETURNING draft_id`, [req.user?.username || null, req.params.id]);
      if (!r.rows.length) return res.status(409).json({ error: 'Draft not pending' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Phase 4: production / dispatch / inventory (§10, §11) ────────────
  router.get('/conversations/:id/production', requireRole('OPERATOR'), async (req, res) => {
    try {
      const c = (await pool.query(
        `SELECT partner_id FROM wa_conversations WHERE conversation_id=$1`, [req.params.id])).rows[0];
      if (!c) return res.status(404).json({ error: 'Conversation not found' });
      const [prod, disp] = await Promise.all([
        production.orderProgress(c.partner_id, req.query.order_no || ''),
        production.dispatchStatus(c.partner_id, req.query.order_no || ''),
      ]);
      res.json({ production: prod, dispatch: disp });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/inventory', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await production.inventorySummary(req.query.q || '')); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Phase 5: sales intelligence (§17), scoring (§18), pipeline (§13),
  //    opportunities (§20), search (§16) ────────────────────────────────
  router.get('/dashboard', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await insights.dashboard()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/rescore', aiLimiter, requireRole('SUPERVISOR'), async (req, res) => {
    try { res.json({ scored: await insights.rescoreAll() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Pipeline board (§13) — stage lives on the conversation.
  router.put('/conversations/:id/stage', requireRole('OPERATOR'), async (req, res) => {
    const stage = String(req.body.stage || '');
    if (!PIPELINE.includes(stage)) return res.status(400).json({ error: 'Unknown pipeline stage' });
    try {
      await pool.query(`UPDATE wa_conversations SET pipeline_stage=$1 WHERE conversation_id=$2`,
        [stage, req.params.id]);
      res.json({ ok: true, stage });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/pipeline', requireRole('OPERATOR'), async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT c.conversation_id, c.phone, c.display_name, c.pipeline_stage,
                p.company_name, COALESCE(c.score, l.score) AS score,
                COALESCE(c.score_points, l.score_points) AS score_points
           FROM wa_conversations c
           LEFT JOIN partners p  ON p.partner_id = c.partner_id
           LEFT JOIN crm_leads l ON l.lead_id    = c.lead_id
          ORDER BY c.last_message_at DESC NULLS LAST LIMIT 300`);
      const board = {};
      for (const s of PIPELINE) board[s] = [];
      for (const row of r.rows) (board[row.pipeline_stage] || board['New Lead']).push(row);
      res.json({ stages: PIPELINE, board });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // §20 — internal suggestions; nothing is sent to a customer automatically.
  router.get('/opportunities', requireRole('OPERATOR'), async (req, res) => {
    try {
      res.json((await pool.query(
        `SELECT o.*, p.company_name FROM sales_opportunities o
           LEFT JOIN partners p ON p.partner_id = o.partner_id
          WHERE o.status = COALESCE($1,'OPEN') ORDER BY o.created_at DESC LIMIT 100`,
        [req.query.status || null])).rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/opportunities/scan', requireRole('SUPERVISOR'), async (req, res) => {
    try { res.json({ created: await insights.scanOpportunities() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/opportunities/:id/:action', requireRole('OPERATOR'), async (req, res) => {
    const map = { action: 'ACTIONED', dismiss: 'DISMISSED' };
    const status = map[req.params.action];
    if (!status) return res.status(400).json({ error: 'Unknown action' });
    try {
      await pool.query(
        `UPDATE sales_opportunities SET status=$1, actioned_by=$2, actioned_at=NOW() WHERE opportunity_id=$3`,
        [status, req.user?.username || null, req.params.id]);
      res.json({ ok: true, status });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // §16 — conversation search.
  router.get('/search', requireRole('OPERATOR'), async (req, res) => {
    try {
      res.json(await insights.search({ q: req.query.q, days: req.query.days, minQty: req.query.min_qty }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/dormant', requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await insights.dormant(req.query.days)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // AI audit trail (§23).
  router.get('/ai-actions', requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT * FROM wa_ai_actions
          WHERE ($1::bigint IS NULL OR conversation_id = $1)
          ORDER BY created_at DESC LIMIT 100`, [req.query.conversation_id || null]);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/leads', requireRole('OPERATOR'), async (req, res) => {
    try {
      const where = []; const params = [];
      if (req.query.source) { params.push(req.query.source); where.push(`source=$${params.length}`); }
      // Prospective-buyer view: all offline/exhibition/manual prospects, i.e. everything
      // except inbound chat leads (WhatsApp inbox / web-chat have their own screens).
      if (req.query.prospects) { where.push(`source NOT IN ('WHATSAPP','WEBCHAT')`); }
      if (req.query.sample_status) { params.push(req.query.sample_status); where.push(`sample_status=$${params.length}`); }
      const sql = `SELECT * FROM crm_leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 1000`;
      res.json((await pool.query(sql, params)).rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Create one lead (prospective buyer).
  const LEAD_COLS = ['phone', 'name', 'company', 'city', 'business_type', 'required_fabric', 'approx_qty', 'score', 'status', 'source', 'contact_person', 'phone2', 'address', 'state', 'pin', 'rate_quoted', 'remarks', 'sample_status', 'sample_note', 'sample_sent_date', 'sample_docket', 'assigned_to'];
  async function insertLead(b) {
    const cols = [], vals = [], params = [];
    for (const c of LEAD_COLS) if (b[c] !== undefined && b[c] !== null && b[c] !== '') { params.push(b[c]); cols.push(c); vals.push(`$${params.length}`); }
    if (!cols.length) return null;
    return (await pool.query(`INSERT INTO crm_leads (${cols.join(',')}) VALUES (${vals.join(',')}) RETURNING *`, params)).rows[0];
  }
  router.post('/leads', requireRole('SUPERVISOR'), async (req, res) => {
    try { const r = await insertLead({ source: 'MANUAL', ...req.body }); res.status(201).json(r || { error: 'empty' }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Bulk import (e.g. exhibition contacts). Dedups on phone within the same source.
  router.post('/leads/import', requireRole('SUPERVISOR'), async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'No rows' });
    let created = 0, skipped = 0;
    try {
      for (const b of rows) {
        const src = b.source || 'IMPORT';
        if (b.phone) {
          const dup = (await pool.query(`SELECT lead_id FROM crm_leads WHERE phone=$1 AND source=$2 LIMIT 1`, [b.phone, src])).rows[0];
          if (dup) { skipped++; continue; }
        }
        const r = await insertLead({ source: src, ...b });
        if (r) created++; else skipped++;
      }
      res.json({ ok: true, created, skipped });
    } catch (e) { res.status(500).json({ error: e.message, created, skipped }); }
  });
  // Update a lead — score/status, and sample dispatch (mark sample sent, docket, date).
  router.patch('/leads/:id', requireRole('OPERATOR'), async (req, res) => {
    const allow = ['score', 'status', 'sample_status', 'sample_sent_date', 'sample_docket', 'sample_note', 'assigned_to', 'rate_quoted', 'remarks', 'required_fabric', 'contact_person', 'phone2', 'city', 'state', 'pin'];
    const sets = [], params = [];
    for (const k of allow) if (k in (req.body || {})) { params.push(req.body[k] === '' ? null : req.body[k]); sets.push(`${k}=$${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    params.push(req.params.id);
    try {
      const r = (await pool.query(`UPDATE crm_leads SET ${sets.join(',')} WHERE lead_id=$${params.length} RETURNING *`, params)).rows[0];
      res.json(r || { error: 'not found' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/followups', requireRole('OPERATOR'), async (req, res) => {
    try {
      res.json((await pool.query(
        `SELECT * FROM crm_followups WHERE status='PENDING' ORDER BY due_date NULLS LAST, created_at DESC LIMIT 200`)).rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
