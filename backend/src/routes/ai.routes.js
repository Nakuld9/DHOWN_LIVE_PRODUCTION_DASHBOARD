// AI agent fleet endpoints. Mounted at /api/ai.
//   POST /ask      — ask an agent a question (any authenticated user; the tools it
//                    can reach are still permission-checked per the caller's role).
//   GET  /actions  — recent agent actions (the audit log). SUPERVISOR+.
//
// Rate-limited with the shared AI limiter so a runaway loop cannot burn model quota.
const express = require('express');
const { buildFleet } = require('../ai/fleet');

module.exports = ({ pool, verifyToken, requireRole, aiLimiter }) => {
  const router = express.Router();
  const fleet = buildFleet({ pool });
  const insights = require('../lib/ai-insights')({ pool });
  const finance = require('../lib/finance')(pool);
  const audit = require('../lib/audit')(pool);

  // AI Accountant finance snapshot — cash/receivables/payables/sales/purchases/GST,
  // each figure tagged actual/estimate/unavailable. Financial data → SUPERVISOR+.
  router.get('/finance/snapshot', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json(await finance.snapshot()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Immutable AI audit trail (spec §21) — read-only. SUPERVISOR+/AUDITOR.
  router.get('/audit', verifyToken, requireRole('SUPERVISOR', { also: ['AUDITOR', 'ACCOUNTS'] }), async (req, res) => {
    try { res.json(await audit.list({ status: req.query.status, entity_type: req.query.entity_type, limit: req.query.limit })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Anomalies to review (spec §19) and the latest daily finance report (§29).
  const anomaly = require('../lib/anomaly')({ pool });
  const financeReport = require('../lib/finance-report')({ pool });
  router.get('/anomalies', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json(await anomaly.summary()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/finance/report', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json((await financeReport.latest()) || await financeReport.build()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // CFO analytics (spec §14/§16/§17) — read-only, SUPERVISOR+/ACCOUNTS.
  const cfo = require('../lib/cfo-analytics')(pool);
  router.get('/finance/profitability', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json(await cfo.customerProfitability({ limit: req.query.limit })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/finance/cashflow', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json(await cfo.cashFlowForecast({ days: req.query.days })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/finance/working-capital', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json(await cfo.workingCapital()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Month-end close readiness checklist — composes bank recon, approvals, anomalies,
  // receivables, GST and TDS into a "is the month clean to close?" report. Read-only.
  const monthEndClose = require('../lib/month-end-close')(pool);
  router.get('/finance/month-end-close', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json(await monthEndClose.run({ period: req.query.period || null })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Live bank cash position from the H2H statement feed: per-account balances,
  // 7-day money in/out, and the reconciliation gap. Read-only, real bank data.
  const bankFeed = require('../lib/bank-cashflow')(pool);
  router.get('/finance/bank-position', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json(await bankFeed.summary()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Purchase Invoice AI (spec §5) — OCR (if a document is sent) then validate +
  // price-check against MES. Suggests + prepares a draft; never posts. SUPERVISOR+.
  const purchaseInvoiceAi = require('../lib/purchase-invoice-ai')(pool);
  const invoiceOcr = require('../lib/invoice-ocr');
  router.post('/purchase-invoice/review', verifyToken, aiLimiter, requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), async (req, res) => {
    try {
      let extracted = req.body?.extracted || null;
      if (!extracted) {
        // OCR path — a digital PDF (pdf_base64) or a photo (image_base64 + mime).
        let o;
        if (req.body?.pdf_base64) o = await invoiceOcr.parseInvoice(req.body.pdf_base64);
        else if (req.body?.image_base64) o = await invoiceOcr.parseImage(req.body.image_base64, req.body.mime);
        else return res.status(400).json({ error: 'Provide extracted fields, pdf_base64, or image_base64.' });
        if (!o.ok) return res.status(400).json(o);
        extracted = o.extracted;
      }
      const out = await purchaseInvoiceAi.review(extracted, { by: req.user?.username });
      if (out.error) return res.status(400).json(out);
      res.json({ extracted, ...out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Busy read bridge (Phase 1) ──────────────────────────────────────────────
  // A read-only mirror of Busy figures. Import is ADMIN/ACCOUNTS (it changes what
  // the "In Busy" fields show); reads are SUPERVISOR+.
  const busyBridge = require('../lib/busy-bridge')(pool);
  const busyReconcile = require('../lib/busy-reconcile')(pool);
  router.get('/busy/status', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json(await busyBridge.status()); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/busy/import', verifyToken, requireRole('ADMIN', { also: ['ACCOUNTS'] }), async (req, res) => {
    try {
      const { kind, rows, as_of, source } = req.body || {};
      const out = await busyBridge.importRows(kind, rows, { as_of, source: source || 'manual-import', by: req.user?.username });
      if (out.error) return res.status(400).json(out);
      await audit.record({ actor: req.user?.username, actor_role: req.user?.role, action: 'IMPORT_BUSY_DATA',
        entity_type: 'busy_mirror', entity_id: kind, after: out, reason: `Imported ${out.imported} ${kind} rows from Busy`, status: 'POSTED' });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/busy/reconcile/receivables', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json(await busyReconcile.receivables()); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // TDS / statutory monitoring (spec §11) — 194C job-work heads-up, not tax advice.
  const tdsMonitor = require('../lib/tds-monitor')(pool);
  router.get('/tds-monitor', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json(await tdsMonitor.review()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // TDS section master (editable rates/thresholds) + per-invoice deduction calculator.
  // Reads/compute for SUPERVISOR+ACCOUNTS+AUDITOR; edits restricted to SUPERVISOR+ACCOUNTS.
  const tdsSections = require('../lib/tds-sections')(pool);
  tdsSections.ensure().catch(() => {});
  router.get('/tds/sections', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json(await tdsSections.list()); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.put('/tds/sections', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), async (req, res) => {
    try { res.json(await tdsSections.upsert(req.body || {}, req.user && req.user.username)); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.delete('/tds/sections/:code', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), async (req, res) => {
    try { res.json(await tdsSections.remove(req.params.code)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.post('/tds/compute', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json(await tdsSections.compute(req.body || {})); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // GST returns — GSTR-3B (outward from MES; ITC from an uploaded GSTR-2B) and the
  // GSTR-2B uploader. Prepares figures for review; never files or pays.
  const gstReturns = require('../lib/gst-returns')(pool);
  router.get('/gst/gstr3b', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json(await gstReturns.gstr3b({ period: req.query.period || null, from: req.query.from || null, to: req.query.to || null })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/gst/gstr2b', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try {
      const out = req.query.period ? await gstReturns.getGstr2b(req.query.period) : null;
      res.json(out || { available: false, note: 'No GSTR-2B uploaded for that period yet.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/gst/gstr2b/import', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), async (req, res) => {
    try {
      const b = req.body || {};
      const raw = b.content_base64 ? Buffer.from(b.content_base64, 'base64').toString('utf8') : (b.json || b.content);
      if (!raw) return res.status(400).json({ error: 'No GSTR-2B file content provided.' });
      const out = await gstReturns.importGstr2b(raw, { period: b.period || null, by: req.user?.username });
      if (out.error) return res.status(out.code || 400).json({ error: out.error });
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Collections — AR chase worklist + manual WhatsApp reminder (reuses the approved
  // payment_reminder template + consent, same as the daily job). Read-only on ledger.
  const { sendTemplate } = require('../lib/alerts');
  const waConsent = require('../lib/wa-consent')(pool);
  const collections = require('../lib/collections')(pool, { sendTemplate, consent: waConsent });
  router.get('/collections', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'SALES'] }), async (req, res) => {
    try {
      const [worklist, summary] = await Promise.all([collections.worklist({ limit: parseInt(req.query.limit || '200', 10) || 200 }), collections.summary()]);
      res.json({ summary, worklist });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/collections/:partnerId/activity', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'SALES'] }), async (req, res) => {
    try { res.json(await collections.listActivity(req.params.partnerId)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/collections/:partnerId/activity', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'SALES'] }), async (req, res) => {
    try {
      const b = req.body || {};
      const out = await collections.logActivity(req.params.partnerId, { type: b.type, note: b.note, promise_date: b.promise_date, by: req.user?.username });
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Sending a reminder is an outward message — SUPERVISOR/ACCOUNTS, operator-triggered.
  router.post('/collections/:partnerId/remind', verifyToken, aiLimiter, requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), async (req, res) => {
    try {
      const out = await collections.remind(req.params.partnerId, { by: req.user?.username });
      if (out.error) return res.status(out.code || 400).json({ error: out.error });
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Management alerts (spec §30) — the few things leadership should see now.
  const managementAlerts = require('../lib/management-alerts')(pool);
  router.get('/management-alerts', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json(await managementAlerts.compute()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Supplier intelligence (spec §15) — price alerts + purchase-volume ranking.
  const supplierIntel = require('../lib/supplier-intel')(pool);
  router.get('/supplier-intel', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
    try { res.json(await supplierIntel.summary()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Sales Invoice AI (spec §6) — pre-check a proposed sales invoice against the SO,
  // credit, authorised rate, dispatch and GST. Flags only; never creates it. SUP+.
  const salesInvoiceAi = require('../lib/sales-invoice-ai')(pool);
  router.post('/sales-invoice/check', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'SALES'] }), async (req, res) => {
    try {
      const out = await salesInvoiceAi.check(req.body || {}, { by: req.user?.username });
      if (out.error) return res.status(400).json(out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Bank statement reconciliation (spec §7) — accepts pasted/uploaded CSV or a
  // transactions array, returns AI-suggested customer + invoice matches. Suggests
  // only; nothing is allocated or posted. SUPERVISOR+/ACCOUNTS.
  const bankAi = require('../lib/bank-ai')(pool);
  router.post('/bank/reconcile', verifyToken, aiLimiter, requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), async (req, res) => {
    try {
      let { csv, transactions } = req.body || {};
      // OCR path — a digital-PDF statement or a photo of one.
      if (!csv && !(Array.isArray(transactions) && transactions.length)) {
        if (req.body?.pdf_base64) {
          const o = await bankAi.extractFromPdf(req.body.pdf_base64);
          if (!o.ok) return res.status(400).json(o);
          transactions = o.transactions;
        } else if (req.body?.image_base64) {
          const o = await bankAi.extractFromImage(req.body.image_base64, req.body.mime);
          if (!o.ok) return res.status(400).json(o);
          transactions = o.transactions;
        } else {
          return res.status(400).json({ error: 'Provide csv (statement text), a transactions array, pdf_base64, or image_base64.' });
        }
        if (!transactions.length) return res.status(400).json({ error: 'No transactions could be read from that statement.' });
      }
      res.json(await bankAi.reconcile({ csv, transactions, by: req.user?.username }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Proactive insight feed — deterministic rules over live data, cheap enough to
  // poll. Any authenticated user may read it (same as /ask).
  router.get('/insights', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await insights.compute()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Model providers — which are configured (has a key) and what they can do.
  const providers = require('../ai/providers');
  router.get('/providers', verifyToken, requireRole('SUPERVISOR', { also: ['ADMIN'] }), (req, res) => {
    res.json({ providers: providers.status(), routing: require('../ai/model').ROUTING });
  });

  // Image generation — for shade cards / mock-ups. Needs an image-capable provider
  // key (OpenAI or DashScope/Qwen). SUPERVISOR+.
  router.post('/image', verifyToken, aiLimiter, requireRole('SUPERVISOR', { also: ['ADMIN'] }), async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    const provider = req.body?.provider || process.env.IMAGE_PROVIDER || 'openai';
    try {
      const out = await providers.generateImage(provider, prompt, { size: req.body?.size || '1024x1024' });
      if (!out.ok) return res.status(400).json(out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/ask', verifyToken, aiLimiter, requireRole('OPERATOR'), async (req, res) => {
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: 'question is required' });
    try {
      const out = await fleet.ask({ question, user: req.user, agentName: req.body?.agent });
      if (out.error) return res.status(400).json(out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/actions', verifyToken, requireRole('SUPERVISOR', { also: ['AUDITOR'] }), async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT action_id, agent, username, question, answer, confidence, created_at
           FROM ai_agent_actions ORDER BY created_at DESC LIMIT 100`);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Approvals queue — agent write actions ──────────────────────────────────
  // Anyone may see the queue; approving/rejecting is checked against each item's
  // required_role inside the service (independent of who proposed it).
  const fail = (res, o) => res.status(o.code || 400).json({ error: o.error });

  router.get('/approvals', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try { res.json(await fleet.approvals.list({ status: req.query.status })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/approvals/:id/approve', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), async (req, res) => {
    try { const o = await fleet.approvals.approve(req.params.id, req.user); if (o.error) return fail(res, o); res.json(o); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/approvals/:id/reject', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), async (req, res) => {
    try { const o = await fleet.approvals.reject(req.params.id, req.user, req.body?.reason); if (o.error) return fail(res, o); res.json(o); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
