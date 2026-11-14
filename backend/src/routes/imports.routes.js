// Import Tracking & Control Tower — routes. Mounted at /api/imports.
// RBAC via the existing role hierarchy (no permission table): view = OPERATOR,
// create/edit/costing = SUPERVISOR (costing also ACCOUNTS), delete = ADMIN.
// Every route is authenticated by the global apiAuthGate; requireRole adds the floor.

const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  router.use(verifyToken);
  const svc = require('../lib/imports')(pool);
  const costing = require('../lib/import-costing')(pool);
  const grn = require('../lib/import-grn')(pool);
  const clr = require('../lib/import-clearance')(pool);
  const tracking = require('../lib/import-tracking')(pool);
  const trackingSync = require('../lib/import-tracking-sync')(pool);
  const exceptions = require('../lib/import-exceptions')(pool);
  const shortage = require('../lib/import-shortage')(pool);
  const reports = require('../lib/import-reports')(pool);
  const vessels = require('../lib/import-vessels')(pool);
  const busy = require('../lib/import-busy')(pool);
  const docsAi = require('../lib/import-docs-ai')(pool);
  const payments = require('../lib/import-payments')(pool);
  const COST = { also: ['ACCOUNTS', 'AUDITOR'] };

  const send = (res, out, okStatus = 200) => {
    if (out && out.error) return res.status(out.code || 400).json({ error: out.error });
    return res.status(okStatus).json(out);
  };
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(500).json({ error: e.message }); } };

  // ── Control Tower KPIs (+ exception summary) ───────────────────────────────
  router.get('/control-tower', requireRole('OPERATOR'), wrap(async (req, res) => {
    const ct = await svc.controlTower();
    res.json({ ...ct, exceptions: await exceptions.summary() });
  }));

  // ── Exceptions (spec §23-24). List/scan OPERATOR-view, manage SUPERVISOR. ──
  router.get('/exceptions', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await exceptions.list(req.query))));
  router.post('/exceptions/scan', requireRole('SUPERVISOR'), wrap(async (req, res) => res.json(await exceptions.scan())));
  router.patch('/exceptions/:excId', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await exceptions.setStatus(req.params.excId, req.body?.status, req.body, req.user))));

  // ── Reports (§48) + management view (§49) + cost variance (§32) ────────────
  router.get('/management-summary', requireRole('SUPERVISOR', COST), wrap(async (req, res) => res.json(await reports.managementSummary())));
  router.get('/reports/register', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await reports.register())));
  router.get('/reports/shipments', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await reports.shipmentReport())));
  router.get('/reports/pending-customs', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await reports.pendingCustoms())));
  router.get('/reports/pending-documents', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await reports.pendingDocuments())));
  router.get('/reports/expected-arrival', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await reports.expectedArrival())));
  router.get('/reports/delayed', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await reports.delayed())));
  router.get('/reports/landed-cost', requireRole('SUPERVISOR', COST), wrap(async (req, res) => res.json(await reports.landedCost())));
  router.get('/reports/cost-variance', requireRole('SUPERVISOR', COST), wrap(async (req, res) => res.json(await reports.costVariance())));

  // ── Import Document AI (spec §34) — analyse shipment PDFs → draft proposal;
  //    apply (create import + attach docs + seed costing) on human approval only. ──
  router.post('/ai/analyze-docs', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await docsAi.analyzeDocs(req.body?.files, req.body || {}))));
  router.post('/ai/apply', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await docsAi.applyProposal(req.body, req.user), 201)));

  // ── Busy posting readiness (spec §33) — finance-sensitive; MES NEVER writes to
  //    Busy. Preview + record the human's Busy voucher reference only. ──
  router.get('/busy/readiness', requireRole('SUPERVISOR', COST), wrap(async (req, res) => res.json(await busy.readinessList())));
  router.get('/:id/busy/preview', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), wrap(async (req, res) => send(res, await busy.postingPreview(req.params.id))));
  router.post('/:id/busy/posted', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), wrap(async (req, res) => send(res, await busy.recordPosting(req.params.id, req.body?.busy_posted_ref, req.user))));

  // ── Vessel master (spec §9) + honest map feed (last verified position only). ──
  // Literal paths declared before /:id so they match first.
  router.get('/vessels', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await vessels.list(req.query))));
  router.post('/vessels', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await vessels.create(req.body, req.user), 201)));
  router.post('/vessels/bulk', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await vessels.bulkImport(req.body?.rows, req.user))));
  router.get('/map/positions', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await vessels.mapPositions())));
  router.get('/vessels/:vesselId', requireRole('OPERATOR'), wrap(async (req, res) => {
    const v = await vessels.get(req.params.vesselId);
    if (!v) return res.status(404).json({ error: 'Vessel not found' });
    res.json(v);
  }));
  router.patch('/vessels/:vesselId', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await vessels.update(req.params.vesselId, req.body, req.user))));
  router.delete('/vessels/:vesselId', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await vessels.softDelete(req.params.vesselId, req.user))));

  // ── AI material-shortage analysis (spec §25) — analysis only, never purchases. ──
  router.get('/shortage-analysis', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await shortage.analyzeAll())));
  router.get('/shortage-analysis/:materialId', requireRole('OPERATOR'), wrap(async (req, res) => send(res, await shortage.analyze(req.params.materialId))));

  // ── Tracking (manual + provider sync + ETA history) ────────────────────────
  router.get('/tracking/provider-status', requireRole('OPERATOR'), wrap(async (req, res) => res.json(tracking.providerStatus())));
  router.post('/:id/tracking/manual', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await tracking.manualEvent(req.params.id, req.body, req.user), 201)));
  router.post('/:id/sync-tracking', requireRole('SUPERVISOR'), wrap(async (req, res) => res.json(await trackingSync.syncImport(req.params.id))));
  router.post('/tracking/sync-all', requireRole('SUPERVISOR'), wrap(async (req, res) => res.json(await trackingSync.runAll())));
  router.get('/:id/eta-history', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await tracking.etaHistory(req.params.id))));
  router.get('/:id/position', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await vessels.importPosition(req.params.id) || { available: false, reason: 'No verified position recorded for this import.' })));

  // ── Imports ────────────────────────────────────────────────────────────────
  router.get('/', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await svc.list(req.query))));
  router.post('/', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await svc.create(req.body, req.user), 201)));

  // Costing (sensitive — SUPERVISOR/ACCOUNTS). Declared before /:id so the literal
  // path is matched first.
  router.get('/:id/costing', requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), wrap(async (req, res) => send(res, await costing.getCosting(req.params.id))));
  router.patch('/:id/costing', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), wrap(async (req, res) => send(res, await costing.saveCosting(req.params.id, req.body, req.user))));

  // GRN integration — link/unlink existing GRNs to an import (received qty reads
  // live from the GRN; inventory stays authoritative). View OPERATOR, link SUPERVISOR.
  router.get('/:id/grn', requireRole('OPERATOR'), wrap(async (req, res) => res.json({
    linked: await grn.linkedGrns(req.params.id), available: await grn.availableGrns(req.params.id),
  })));
  router.post('/:id/grn/link', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await grn.link(req.params.id, req.body, req.user), 201)));
  router.post('/:id/grn/unlink', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await grn.unlink(req.params.id, req.body?.grn_id, req.user))));

  // Payments (spec §35) — advance/balance TTs, each at its own rate. View OPERATOR,
  // add/delete SUPERVISOR/ACCOUNTS. analyze-tt reads a bank TT advice PDF into a draft.
  router.get('/payments/all', requireRole('SUPERVISOR', COST), wrap(async (req, res) => res.json(await payments.listAll())));
  router.get('/payments/payables', requireRole('SUPERVISOR', COST), wrap(async (req, res) => res.json(await payments.payables())));
  router.post('/payments', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), wrap(async (req, res) => send(res, await payments.addPayment(req.body, req.user), 201)));
  router.post('/payments/analyze-tt', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), wrap(async (req, res) => send(res, await docsAi.analyzeTT(req.body?.file, null, req.body?.password))));
  router.get('/:id/payments', requireRole('OPERATOR'), wrap(async (req, res) => res.json({ payments: await payments.listForImport(req.params.id), summary: await payments.summary(req.params.id) })));
  router.post('/:id/payments', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), wrap(async (req, res) => send(res, await payments.addPayment(req.body, req.user, req.params.id), 201)));
  router.post('/:id/payments/analyze-tt', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), wrap(async (req, res) => send(res, await docsAi.analyzeTT(req.body?.file, req.params.id, req.body?.password))));
  router.post('/:id/costing/analyze-debit-note', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), wrap(async (req, res) => send(res, await docsAi.analyzeDebitNote(req.body?.file, req.params.id, req.body?.password))));
  router.get('/payments/:pid', requireRole('SUPERVISOR', COST), wrap(async (req, res) => { const p = await payments.getPayment(req.params.pid); return p ? res.json(p) : res.status(404).json({ error: 'Payment not found' }); }));
  router.patch('/payments/:pid/allocations', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), wrap(async (req, res) => send(res, await payments.reallocate(req.params.pid, req.body?.allocations, req.user))));
  router.delete('/payments/:pid', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), wrap(async (req, res) => send(res, await payments.deletePayment(req.params.pid, req.user))));

  // Customs (spec §27) — view OPERATOR, edit SUPERVISOR/ACCOUNTS.
  router.get('/:id/customs', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await clr.getCustoms(req.params.id))));
  router.patch('/:id/customs', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), wrap(async (req, res) => send(res, await clr.saveCustoms(req.params.id, req.body, req.user))));
  router.post('/:id/customs/analyze-boe', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), wrap(async (req, res) => send(res, await docsAi.analyzeBoe(req.body?.file, req.params.id, req.body?.password))));

  // Documents (spec §26) — view OPERATOR, upload/verify SUPERVISOR.
  router.get('/:id/documents', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await clr.listDocuments(req.params.id))));
  router.post('/:id/documents', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await clr.upsertDocument(req.params.id, req.body, req.user), 201)));
  router.patch('/:id/documents/:docId', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await clr.setDocumentStatus(req.params.id, req.params.docId, req.body?.status, req.user))));
  router.get('/:id/documents/:docId/file', requireRole('OPERATOR'), wrap(async (req, res) => {
    const f = await clr.getDocumentFile(req.params.id, req.params.docId);
    if (!f || !f.file_data) return res.status(404).json({ error: 'No file' });
    res.setHeader('Content-Type', f.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${f.file_name || f.doc_type}"`);
    res.send(Buffer.from(f.file_data, 'base64'));
  }));
  router.delete('/:id/documents/:docId', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await clr.deleteDocument(req.params.id, req.params.docId, req.user))));

  // Post-port logistics (spec §28) — view OPERATOR, edit SUPERVISOR.
  router.get('/:id/logistics', requireRole('OPERATOR'), wrap(async (req, res) => res.json(await clr.listLogistics(req.params.id))));
  router.post('/:id/logistics', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await clr.addLogistics(req.params.id, req.body, req.user), 201)));
  router.patch('/:id/logistics/:legId', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await clr.updateLogistics(req.params.id, req.params.legId, req.body, req.user))));

  // Shipments / containers.
  router.post('/:id/shipments', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await svc.addShipment(req.params.id, req.body, req.user), 201)));
  router.post('/shipments/:shipmentId/containers', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await svc.addContainer(req.params.shipmentId, req.body, req.user), 201)));
  router.patch('/shipments/:shipmentId/vessel', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await svc.setShipmentVessel(req.params.shipmentId, req.body?.vessel_id, req.user))));

  router.get('/:id', requireRole('OPERATOR'), wrap(async (req, res) => {
    const imp = await svc.get(req.params.id);
    if (!imp) return res.status(404).json({ error: 'Import not found' });
    res.json(imp);
  }));
  router.patch('/:id', requireRole('SUPERVISOR'), wrap(async (req, res) => send(res, await svc.update(req.params.id, req.body, req.user))));
  router.delete('/:id', requireRole('ADMIN'), wrap(async (req, res) => send(res, await svc.softDelete(req.params.id, req.user))));

  return router;
};
