// Bank reconciliation API. Mounted at /api/bank.
//
// SUPERVISOR reads and matches; ADMIN creates accounts. Matching is a
// judgement about money that has or has not arrived, which is the collections
// job, so gating it at ADMIN would push it to the one person least likely to
// be doing it. Creating a bank account is rarer and more consequential.

const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  router.use(verifyToken);

  const bank = require('../lib/bank-recon')(pool);
  const files = require('../lib/bank-statement-files')(pool, bank);
  const payouts = require('../lib/bank-payments-out')(pool);
  // Reconciling the bank is the accounts job outright, so ACCOUNTS is granted
  // everything here except creating an account, which is rare and structural.
  const A = { also: ['ACCOUNTS'] };
  const fail = (res, out) => res.status(out.code || 400).json({ error: out.error });

  router.get('/accounts', requireRole('SUPERVISOR', A), async (req, res) => {
    try { res.json(await bank.listAccounts()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/accounts', requireRole('ADMIN'), async (req, res) => {
    try {
      const out = await bank.createAccount(req.body || {});
      if (out.error) return fail(res, out);
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Statement import. Rows arrive already parsed — every bank exports a
  // different CSV, so the shape is normalised in the browser where the user can
  // see the column mapping they chose.
  router.post('/accounts/:id/import', requireRole('SUPERVISOR', A), async (req, res) => {
    try {
      const out = await bank.importLines(req.params.id, req.body?.rows, { by: req.user?.username });
      if (out.error) return fail(res, out);
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // H2H statement FILE ingestion (Phase A, read-only). Accepts the raw statement
  // file as text (`content`) or base64 (`content_base64`) — MT940 / CAMT.053 / CSV.
  // It parses, imports and (by default) auto-matches in one call. Idempotent on the
  // file's content hash, so re-sending the same file is a no-op. Never sends money.
  router.post('/accounts/:id/ingest-file', requireRole('SUPERVISOR', A), async (req, res) => {
    try {
      const b = req.body || {};
      // Binary formats (.xls/.xlsx) must stay as a Buffer; text formats can be either
      // a plain string or base64. ingest() decides by format/filename/magic bytes.
      const content = b.content_base64 ? Buffer.from(b.content_base64, 'base64') : b.content;
      if (!content || (!Buffer.isBuffer(content) && !String(content).trim())) return res.status(400).json({ error: 'No statement file content provided' });
      const out = await files.ingest(req.params.id, content, {
        filename: b.filename || null,
        format: b.format || null,
        source: 'UPLOAD',
        autoMatch: b.auto_match !== false,
        days: Math.min(parseInt(b.days || '5', 10) || 5, 60),
        by: req.user?.username,
      });
      if (out.error) return fail(res, out);
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/accounts/:id/files', requireRole('SUPERVISOR', A), async (req, res) => {
    try { res.json(await files.recentFiles(req.params.id, { limit: parseInt(req.query.limit || '50', 10) || 50 })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Per-account H2H config: which file format the bank sends, optional local
  // drop-folder for auto-pickup, and the CSV column mapping. Structural → ADMIN.
  router.patch('/accounts/:id', requireRole('ADMIN'), async (req, res) => {
    try {
      const b = req.body || {};
      const fmt = b.statement_format ? String(b.statement_format).toUpperCase() : undefined;
      if (fmt && !['MT940', 'CAMT053', 'CSV', 'XLS', 'XLSX'].includes(fmt)) return res.status(400).json({ error: 'statement_format must be MT940, CAMT053, CSV, XLS or XLSX' });
      const r = await pool.query(
        `UPDATE bank_accounts SET
           statement_format = COALESCE($2, statement_format),
           inbox_dir        = COALESCE($3, inbox_dir),
           csv_mapping      = COALESCE($4::jsonb, csv_mapping)
         WHERE account_id=$1 RETURNING *`,
        [req.params.id, fmt ?? null, b.inbox_dir ?? null, b.csv_mapping ? JSON.stringify(b.csv_mapping) : null]);
      if (!r.rows.length) return res.status(404).json({ error: 'Bank account not found' });
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/accounts/:id/lines', requireRole('SUPERVISOR', A), async (req, res) => {
    try {
      res.json(await bank.lines(req.params.id, {
        from: req.query.from || null,
        to: req.query.to || null,
        state: ['all', 'matched', 'unmatched'].includes(req.query.state) ? req.query.state : 'all',
      }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/accounts/:id/summary', requireRole('SUPERVISOR', A), async (req, res) => {
    try {
      const out = await bank.summary(req.params.id, { from: req.query.from || null, to: req.query.to || null });
      if (out.error) return fail(res, out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/lines/:lineId/candidates', requireRole('SUPERVISOR', A), async (req, res) => {
    try {
      const out = await bank.candidatesFor(req.params.lineId, {
        days: Math.min(parseInt(req.query.days || '5', 10) || 5, 60),
      });
      if (out.error) return fail(res, out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/lines/:lineId/match', requireRole('SUPERVISOR', A), async (req, res) => {
    try {
      const out = await bank.match(req.params.lineId, req.body?.payment_id,
        { by: req.user?.username, note: req.body?.note });
      if (out.error) return fail(res, out);
      res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/lines/:lineId/match', requireRole('SUPERVISOR', A), async (req, res) => {
    try {
      const out = await bank.unmatch(req.params.lineId, { by: req.user?.username });
      if (out.error) return fail(res, out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/accounts/:id/auto-match', requireRole('SUPERVISOR', A), async (req, res) => {
    try {
      res.json(await bank.autoMatch(req.params.id, {
        days: Math.min(parseInt(req.body?.days || '5', 10) || 5, 60),
        by: req.user?.username,
      }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Outbound payments (H2H Phase B) — DRAFT-ONLY. The MES generates a file; the
  //    bank maker-checker approves the debit. Nothing is ever sent from here. ──────
  router.get('/beneficiaries', requireRole('SUPERVISOR', A), async (req, res) => {
    try { res.json(await payouts.listBeneficiaries({ partner_id: req.query.partner_id, approved: req.query.approved })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/beneficiaries', requireRole('SUPERVISOR', A), async (req, res) => {
    try { const out = await payouts.addBeneficiary(req.body || {}, req.user); if (out.error) return fail(res, out); res.status(201).json(out); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Approving a beneficiary makes it payable — a control, so ADMIN only.
  router.post('/beneficiaries/:id/approve', requireRole('ADMIN', { also: ['ACCOUNTS'] }), async (req, res) => {
    try { const out = await payouts.approveBeneficiary(req.params.id, req.user); if (out.error) return fail(res, out); res.json(out); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/payouts', requireRole('SUPERVISOR', A), async (req, res) => {
    try { res.json(await payouts.listBatches()); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/payouts/:id', requireRole('SUPERVISOR', A), async (req, res) => {
    try { const out = await payouts.getBatch(req.params.id); if (!out) return res.status(404).json({ error: 'Batch not found' }); res.json(out); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/payouts', requireRole('SUPERVISOR', A), async (req, res) => {
    try { const out = await payouts.createBatch(req.body || {}, req.user); if (out.error) return fail(res, out); res.status(201).json(out); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/payouts/:id/generate', requireRole('SUPERVISOR', A), async (req, res) => {
    try { const out = await payouts.generateFile(req.params.id, req.body?.format, req.user); if (out.error) return fail(res, out); res.json(out); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Releasing (handing the file to the bank) is consequential — ADMIN.
  router.post('/payouts/:id/release', requireRole('ADMIN', { also: ['ACCOUNTS'] }), async (req, res) => {
    try { const out = await payouts.release(req.params.id, req.user); if (out.error) return fail(res, out); res.json(out); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/payouts/:id/cancel', requireRole('SUPERVISOR', A), async (req, res) => {
    try { const out = await payouts.cancel(req.params.id, req.user); if (out.error) return fail(res, out); res.json(out); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
