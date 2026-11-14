// Accounting engine — HTTP routes, mounted at /api/acct.
// Thin: validate input, check role, call the service. No posting logic here.
//
// Roles (existing ladder — see src/middleware/auth.js):
//   read, masters, drafts, post : SUPERVISOR+, or ACCOUNTS     (AUDITOR: read-only, automatic)
//   approve, reverse            : SUPERVISOR+
//   open/close periods          : ADMIN+
const express = require('express');
const { AccountingError } = require('../lib/accounting/rules');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const acct = require('../lib/accounting/service')(pool);
  const ops = require('../lib/accounting/ops-link')(pool);
  const docs = require('../lib/accounting/documents')(pool);
  const outbox = require('../lib/accounting/outbox')(pool);
  const migration = require('../lib/accounting/migration')(pool);
  const busy = require('../lib/accounting/busy-mirror')(pool);
  const busyInbox = require('../lib/accounting/busy-inbox')(pool);
  const busyMasters = require('../lib/accounting/busy-masters-import')(pool);
  const mesEvents = require('../lib/accounting/mes-events')(pool);
  const stockVal = require('../lib/accounting/stock-valuation')(pool);
  const interest = require('../lib/accounting/interest')(pool);
  const depreciation = require('../lib/accounting/depreciation')(pool);
  const alloc = require('../lib/accounting/allocations')(pool);
  const ai = require('../lib/accounting/ai-accountant')(pool);
  const READ = requireRole('SUPERVISOR', { also: ['ACCOUNTS'] });
  const WRITE = requireRole('SUPERVISOR', { also: ['ACCOUNTS'] });
  const SENIOR = requireRole('SUPERVISOR');
  const ADMIN = requireRole('ADMIN');

  const h = (fn) => async (req, res) => {
    try { res.json(await fn(req)); } catch (e) {
      if (e instanceof AccountingError) return res.status(e.status).json({ error: e.message, code: e.code, details: e.details });
      console.error('[acct]', e.message);
      res.status(500).json({ error: 'Accounting error — see server log' });
    }
  };
  const id = (req, name = 'id') => {
    const v = req.params[name];
    if (!UUID.test(v)) throw new AccountingError('Invalid id', 'ACCT_INVALID');
    return v;
  };
  const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

  router.use(verifyToken);

  router.get('/company', READ, h(() => acct.company()));
  router.get('/voucher-types', READ, h(() => acct.voucherTypes()));

  // Masters
  router.get('/groups', READ, h(() => acct.listGroups()));
  router.post('/groups', WRITE, h((req) => acct.createGroup(body(req), req.user)));
  router.get('/ledgers', READ, h((req) => acct.listLedgers(req.query)));
  router.post('/ledgers', WRITE, h((req) => acct.saveLedger(null, body(req), req.user)));
  router.put('/ledgers/:id', WRITE, h((req) => acct.saveLedger(id(req), body(req), req.user)));
  router.put('/ledgers/:id/opening', WRITE, h((req) => acct.setOpening(id(req), body(req), req.user)));
  router.get('/ledgers/:id/balance', READ, h((req) => acct.ledgerBalance(id(req), req.query.as_of)));
  router.get('/next-voucher-no', READ, h((req) => {
    const vt = String(req.query.voucher_type || '').trim();
    if (!vt) throw new AccountingError('voucher_type is required', 'ACCT_INVALID');
    return acct.nextVoucherNo(vt, req.query.as_of);
  }));

  // Vouchers
  router.get('/vouchers', READ, h((req) => acct.listVouchers(req.query)));
  router.get('/vouchers/:id', READ, h((req) => acct.getVoucher(id(req))));
  router.post('/vouchers', WRITE, h((req) => {
    const b = body(req);
    const key = req.get('Idempotency-Key') || b.idempotency_key;
    return acct.createDraft({ ...b, idempotency_key: key, source_module: b.source_module || 'acct.ui' }, req.user);
  }));
  router.put('/vouchers/:id', WRITE, h((req) => acct.updateDraft(id(req), body(req), req.user)));
  router.post('/vouchers/:id/validate', WRITE, h((req) => acct.validateVoucher(id(req), req.user)));
  router.post('/vouchers/:id/approve', SENIOR, h((req) => acct.approveVoucher(id(req), req.user)));
  router.post('/vouchers/:id/post', WRITE, h((req) => acct.postVoucher(id(req), req.user)));
  router.post('/vouchers/:id/reverse', SENIOR, h((req) => acct.reverseVoucher(id(req), body(req), req.user)));
  router.post('/vouchers/:id/cancel', WRITE, h((req) => acct.cancelDraft(id(req), req.user)));

  // Document vouchers (Sales/Purchase from item lines — GST computed by the engine)
  router.post('/documents/preview', READ, h((req) => docs.preview(body(req))));
  router.post('/documents', WRITE, h((req) => docs.create(body(req), req.user)));
  router.put('/documents/:id', WRITE, h((req) => docs.update(id(req), body(req), req.user)));

  // Reports
  router.get('/reports/trial-balance', READ, h((req) => acct.trialBalance(req.query)));
  router.get('/reports/pnl', READ, h((req) => acct.profitAndLoss(req.query)));
  router.get('/reports/balance-sheet', READ, h((req) => acct.balanceSheet(req.query)));
  router.get('/reports/ledger', READ, h((req) => acct.ledgerStatement(req.query)));
  router.get('/reports/day-book', READ, h((req) => acct.dayBook(req.query)));
  router.get('/reports/register', READ, h((req) => acct.salesPurchaseRegister(req.query)));
  router.get('/reports/cash-bank', READ, h((req) => acct.cashBankBook(req.query)));
  router.get('/reports/ageing', READ, h((req) => acct.ageing(req.query)));
  router.get('/reports/stock-valuation', READ, h((req) => stockVal.valuedStock(req.query)));
  router.get('/reports/interest', READ, h((req) => interest.compute(req.query)));
  // Fixed assets + Depreciation Chart
  router.get('/assets', READ, h(() => depreciation.listAssets()));
  router.post('/assets', WRITE, h((req) => depreciation.saveAsset(body(req), req.user)));
  router.delete('/assets/:aid', WRITE, h((req) => { const a = Number(req.params.aid); if (!Number.isInteger(a)) throw new AccountingError('Invalid asset id', 'ACCT_INVALID'); return depreciation.deleteAsset(a); }));
  router.get('/reports/depreciation', READ, h((req) => depreciation.schedule(req.query)));

  // Operations link (party sync + sales-invoice -> voucher).
  // Shadow by default (drafts for reconciliation); mode:'POST' only after Busy cutover.
  router.post('/link/parties/sync', WRITE, h((req) => ops.syncParties(body(req))));
  router.post('/link/sales/sync', WRITE, h((req) => ops.syncSalesInvoices(body(req), req.user)));
  router.post('/link/invoice/:iid', WRITE, h((req) => {
    const iid = Number(req.params.iid);
    if (!Number.isInteger(iid)) throw new AccountingError('Invalid invoice id', 'ACCT_INVALID');
    return ops.postSalesInvoice(iid, body(req), req.user);
  }));

  // MES auto-post (Phase 4) — transactional outbox + versioned posting policies.
  // Shadow DRAFT by default; mode:'POST' only after Busy cutover.
  const idNum = (req, name, label) => { const n = Number(req.params[name]); if (!Number.isInteger(n)) throw new AccountingError(`Invalid ${label}`, 'ACCT_INVALID'); return n; };
  router.get('/link/mes/policies', READ, h(() => outbox.listPolicies()));
  router.get('/link/mes/outbox', READ, h((req) => outbox.list(req.query)));
  router.post('/link/mes/preview', READ, h((req) => outbox.preview(body(req))));
  router.post('/link/mes/enqueue', WRITE, h((req) => outbox.enqueue(body(req))));
  router.post('/link/mes/emit', WRITE, h((req) => outbox.emit(body(req), body(req), req.user)));
  router.post('/link/mes/outbox/:oid/process', WRITE, h((req) => outbox.process(idNum(req, 'oid', 'outbox id'), body(req), req.user)));
  router.post('/link/mes/drain', WRITE, h((req) => outbox.drain(body(req), req.user)));
  // Bridge real MES tables (GRN / wastage / job-work) into the outbox.
  router.post('/link/mes/sync/grn', WRITE, h((req) => mesEvents.syncGrns(body(req), req.user)));
  router.post('/link/mes/sync/cost-entries', WRITE, h((req) => mesEvents.syncCostEntries(body(req), req.user)));
  router.post('/link/mes/sync/dispatch', WRITE, h((req) => mesEvents.syncDispatch(body(req), req.user)));
  router.post('/link/mes/sync/issues', WRITE, h((req) => mesEvents.syncIssues(body(req), req.user)));
  router.post('/link/mes/sync/production', WRITE, h((req) => mesEvents.syncProduction(body(req), req.user)));
  router.post('/link/mes/sync/all', WRITE, h((req) => mesEvents.syncAll(body(req), req.user)));

  // Busy XML migration (Phase 5) — dry-run (read), import/rollback (SUPERVISOR+).
  const xmlOf = (req) => { const b = body(req); const x = typeof b.xml === 'string' ? b.xml : (typeof req.body === 'string' ? req.body : ''); if (!x.trim()) throw new AccountingError('Provide the Busy XML export in the "xml" field', 'ACCT_INVALID'); return x; };
  router.get('/migration/batches', READ, h(() => migration.listBatches()));
  router.post('/migration/dry-run', READ, h((req) => migration.dryRun(xmlOf(req))));
  router.post('/migration/import', SENIOR, h((req) => migration.import(xmlOf(req), body(req), req.user)));
  router.get('/migration/:bid/reconcile', READ, h((req) => migration.reconcile(idNum(req, 'bid', 'batch id'), req.query)));
  router.post('/migration/:bid/rollback', SENIOR, h((req) => migration.rollback(idNum(req, 'bid', 'batch id'), req.user)));

  // Busy READ BRIDGE (Phase 1) — mirror of Busy masters + TB (ingested from the
  // Windows extractor's JSON) + reconciliation to the rupee. READ-ONLY w.r.t. Busy;
  // never touches the native books. Import = SENIOR; reads = READ.
  const extractOf = (req) => {
    const b = body(req);
    const x = (b && b.schema) ? b : (b && typeof b.extract === 'object' ? b.extract : null);
    if (!x) throw new AccountingError('Provide the Busy extract JSON (busy-mirror/v1) in the body or in "extract"', 'ACCT_INVALID');
    return x;
  };
  router.get('/busy/imports', READ, h(() => busy.listImports()));
  router.post('/busy/import', SENIOR, h((req) => busy.importExtract(extractOf(req), { filename: body(req).filename || null }, req.user)));
  router.post('/busy/poll', SENIOR, h(async () => { await busyInbox.pollOnce(); return { ok: true }; }));
  router.get('/busy/reconcile', READ, h((req) => busy.reconcile(req.query.import_id ? Number(req.query.import_id) : null)));
  router.get('/busy/reconcile/:bid', READ, h((req) => busy.reconcile(idNum(req, 'bid', 'import id'))));
  router.get('/busy/masters', READ, h((req) => busy.getMasters(req.query.import_id ? Number(req.query.import_id) : null, { groups_only: req.query.groups_only === 'true' })));
  // Copy Busy's chart of accounts into MES's own books (masters only). dry_run previews.
  router.post('/busy/import-masters', SENIOR, h((req) => busyMasters.importMasters(extractOf(req), { dry_run: !!body(req).dry_run }, req.user)));
  router.post('/busy/rollback-masters', SENIOR, h((req) => busyMasters.rollbackMasters(req.user)));

  // Bill-wise allocation (open-item receivables/payables).
  router.get('/allocations/outstanding', READ, h((req) => alloc.openItemsAll(req.query)));
  router.get('/allocations/open-bills', READ, h((req) => { const l = req.query.ledger_id; if (!UUID.test(l || '')) throw new AccountingError('Invalid ledger_id', 'ACCT_INVALID'); return alloc.openBills(l); }));
  router.get('/allocations/settlement', READ, h((req) => { const l = req.query.ledger_id, s = req.query.settle_voucher_id; if (!UUID.test(l || '') || !UUID.test(s || '')) throw new AccountingError('Invalid ids', 'ACCT_INVALID'); return alloc.settlementAvailable(l, s); }));
  router.get('/allocations/voucher/:id', READ, h((req) => alloc.listForVoucher(id(req))));
  router.post('/allocations', WRITE, h((req) => alloc.allocate(body(req), req.user)));
  router.delete('/allocations/:aid', WRITE, h((req) => { const a = Number(req.params.aid); if (!Number.isInteger(a)) throw new AccountingError('Invalid allocation id', 'ACCT_INVALID'); return alloc.unallocate(a, req.user); }));

  // AI accountant (Phase 6) — propose DRAFTs + explain balances only; never posts.
  router.post('/ai/propose', WRITE, h((req) => ai.proposeVoucher(body(req), req.user)));
  router.post('/ai/propose-document', WRITE, h((req) => ai.proposeDocument(body(req), req.user)));
  router.get('/ai/explain', READ, h((req) => { const l = req.query.ledger_id; if (!UUID.test(l || '')) throw new AccountingError('Invalid ledger_id', 'ACCT_INVALID'); return ai.explainBalance({ ledger_id: l, as_of: req.query.as_of }); }));

  // Periods & audit
  router.get('/periods', READ, h((req) => acct.listPeriods(req.query.fy_id ? Number(req.query.fy_id) : null)));
  router.put('/periods/:pid', ADMIN, h((req) => {
    const pid = Number(req.params.pid);
    if (!Number.isInteger(pid)) throw new AccountingError('Invalid period', 'ACCT_INVALID');
    return acct.setPeriodStatus(pid, body(req).status, body(req).reason, req.user);
  }));
  router.get('/audit', READ, h((req) => acct.auditTrail(req.query)));

  return router;
};
