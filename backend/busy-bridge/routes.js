const express = require('express');
const { BridgeError, classifyError } = require('./errors');
const { redactedConfig, ALL_ENTITY_TYPES } = require('./config');

/**
 * BUSY Bridge routes, mounted on the dashboard's existing Express app.
 *
 * Authentication and roles are the dashboard's own — verifyToken and
 * requireRole are passed in, so there is one login and one role hierarchy, not
 * a second set of API keys to manage on the factory PC.
 *
 * Roles:
 *   read        any authenticated user
 *   write/act   SUPERVISOR and above (retry, fix mapping, reconcile)
 *   unmap       ADMIN and above (clearing a mapping is destructive)
 *
 * SECURITY: no route returns a BUSY credential. redactedConfig() is the only
 * config shape allowed out.
 */

const POST_ROUTES = {
  customers: 'CUSTOMER',
  vendors: 'VENDOR',
  items: 'ITEM',
  warehouses: 'WAREHOUSE',
  'sales-references': 'SALES_REFERENCE',
  'purchase-references': 'PURCHASE_REFERENCE',
  dispatches: 'DISPATCH',
  invoices: 'INVOICE',
};

/** Turn any thrown value into a response the operator can act on. */
function sendError(res, status, err) {
  const error = err instanceof BridgeError ? err : classifyError(err);
  const { reason, action } = error.explain();
  res.status(status).json({
    error: error.message,
    code: error.code,
    reason,
    action,
    retryable: error.retryable,
    ...(Array.isArray(error.details && error.details.issues) ? { issues: error.details.issues } : {}),
  });
}

/**
 * Attach the human-readable reason/action to a queue row for the UI.
 *
 * The stored details carry the real subject of the failure, which is often NOT
 * this row's own DHOWN id — an unmapped item on a dispatch, for instance.
 * Falling back to dhownEntityId would tell the supervisor to map the dispatch,
 * which is not a thing they can do.
 */
function explainRow(row) {
  if (!row.errorCode) return null;
  const details = row.errorDetails && typeof row.errorDetails === 'object' ? { ...row.errorDetails } : {};
  if (details.subject === undefined) details.subject = row.dhownEntityId;
  return new BridgeError(row.errorCode, row.errorMessage || '', details).explain();
}

/** The username from the dashboard JWT, for the audit trail. */
function actorOf(req) {
  return (req.user && (req.user.username || req.user.name || req.user.id)) || 'dashboard';
}

function createBusyRoutes(bridge, { verifyToken, requireRole }) {
  const router = express.Router();
  const canRead = [verifyToken];
  const canAct = [verifyToken, requireRole('SUPERVISOR')];
  const canUnmap = [verifyToken, requireRole('ADMIN')];

  // ── Submission (dashboard -> BUSY) ────────────────────────────
  // 202 means the bridge has taken responsibility for the record. It does NOT
  // mean BUSY has booked it — the BUSY reference arrives later.
  for (const [route, entityType] of Object.entries(POST_ROUTES)) {
    router.post(`/${route}`, canAct, async (req, res) => {
      try {
        const result = await bridge.submit({ entityType, payload: req.body, createdBy: actorOf(req) });
        res.status(result.created ? 202 : 200).json(result);
      } catch (err) {
        sendError(res, err instanceof BridgeError && err.code === 'VALIDATION_ERROR' ? 422 : 400, err);
      }
    });
  }

  // ── Status lookup ─────────────────────────────────────────────
  router.get('/status/:externalReference', canRead, async (req, res) => {
    try {
      const item = await bridge.queue.findByExternalReference(req.params.externalReference);
      if (!item) return res.status(404).json({ error: `No transaction for ${req.params.externalReference}` });
      res.json({
        externalReference: item.externalReference,
        entityType: item.entityType,
        dhownEntityId: item.dhownEntityId,
        status: item.status,
        busyReference: item.busyReference,
        attemptCount: item.attemptCount,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage,
        explanation: explainRow(item),
        updatedAt: item.updatedAt,
      });
    } catch (err) {
      sendError(res, 500, err);
    }
  });

  // ── Overview (the dashboard tiles) ────────────────────────────
  router.get('/overview', canRead, async (req, res) => {
    try {
      const [connection, queue, mappings, reconciliation, todaysTransactions, lastSuccessfulSync] = await Promise.all([
        bridge.worker.connectionState(),
        bridge.queue.counts(),
        bridge.mappings.counts(),
        bridge.reconciler.summary(),
        bridge.queue.countToday(),
        bridge.queue.lastSuccessAt(),
      ]);
      res.json({
        connection: { ...connection, adapter: bridge.adapter.name, capabilities: bridge.adapter.capabilities() },
        queue,
        mappings,
        reconciliation,
        todaysTransactions,
        lastSuccessfulSync,
        config: redactedConfig(bridge.config),
      });
    } catch (err) {
      sendError(res, 500, err);
    }
  });

  router.post('/connection/test', canAct, async (req, res) => {
    try {
      res.json(await bridge.adapter.testConnection());
    } catch (err) {
      sendError(res, 502, err);
    }
  });

  // ── Queue ─────────────────────────────────────────────────────
  router.get('/queue', canRead, async (req, res) => {
    try {
      const items = await bridge.queue.list({
        status: req.query.status,
        entityType: req.query.entityType,
        search: req.query.search,
        limit: Number(req.query.limit) || 50,
        offset: Number(req.query.offset) || 0,
      });
      res.json({
        items: items.map((i) => {
          const { payload, ...rest } = i;
          return { ...rest, explanation: explainRow(i) };
        }),
      });
    } catch (err) {
      sendError(res, 500, err);
    }
  });

  // "View Payload" — includes the payload and the full audit trail.
  router.get('/queue/:id', canRead, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const item = await bridge.queue.findById(id);
      if (!item) return res.status(404).json({ error: 'Queue item not found' });
      res.json({ item, explanation: explainRow(item), audit: await bridge.audit.forQueueItem(id) });
    } catch (err) {
      sendError(res, 500, err);
    }
  });

  // "Retry"
  router.post('/queue/:id/retry', canAct, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const item = await bridge.queue.requeueForManualRetry(id);
      if (!item) return res.status(404).json({ error: 'Queue item not found' });
      if (item.status === 'SUCCESS') {
        // Never resend something BUSY already booked.
        return res.status(409).json({
          error: 'This transaction is already successful in BUSY and will not be resent.',
          code: 'DUPLICATE_ERROR',
          action: 'Use Reconcile if you believe BUSY and the dashboard disagree.',
        });
      }
      const actor = actorOf(req);
      await bridge.audit.record({
        queueId: id,
        entityType: item.entityType,
        dhownEntityId: item.dhownEntityId,
        externalReference: item.externalReference,
        operation: item.operation,
        attemptCount: item.attemptCount,
        actor,
        finalStatus: 'MANUAL_RETRY_REQUESTED',
      });
      res.json({ outcome: await bridge.processOne(id, actor) });
    } catch (err) {
      sendError(res, 502, err);
    }
  });

  // "Reconcile"
  router.post('/queue/:id/reconcile', canAct, async (req, res) => {
    try {
      const item = await bridge.queue.findById(Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'Queue item not found' });
      res.json({ reconciliation: await bridge.reconciler.reconcileItem(`manual-${Date.now()}`, item) });
    } catch (err) {
      sendError(res, 502, err);
    }
  });

  // "View BUSY Reference"
  router.get('/queue/:id/busy-reference', canRead, async (req, res) => {
    try {
      const item = await bridge.queue.findById(Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'Queue item not found' });
      const live = bridge.adapter.capabilities().getTransactionStatus
        ? await bridge.adapter.getTransactionStatus(item.externalReference)
        : null;
      res.json({ externalReference: item.externalReference, storedBusyReference: item.busyReference, live });
    } catch (err) {
      sendError(res, 502, err);
    }
  });

  // ── Mappings ──────────────────────────────────────────────────
  router.get('/mappings', canRead, async (req, res) => {
    try {
      res.json({
        items: await bridge.mappings.list({
          entityType: req.query.entityType,
          syncStatus: req.query.syncStatus,
          search: req.query.search,
          limit: Number(req.query.limit) || 200,
        }),
      });
    } catch (err) {
      sendError(res, 500, err);
    }
  });

  router.get('/mappings/unmapped', canRead, async (req, res) => {
    try {
      res.json({ items: await bridge.mappings.unmapped(req.query.entityType) });
    } catch (err) {
      sendError(res, 500, err);
    }
  });

  // "Fix Mapping"
  router.post('/mappings', canAct, async (req, res) => {
    const { entityType, dhownId, busyId, busyCode } = req.body || {};
    if (!entityType || !dhownId || !busyId) {
      return res.status(422).json({ error: 'entityType, dhownId and busyId are required.', code: 'VALIDATION_ERROR' });
    }
    try {
      const mapping = await bridge.mappings.setManualMapping(entityType, dhownId, busyId, busyCode);
      await bridge.audit.record({
        entityType,
        dhownEntityId: dhownId,
        operation: 'FIX_MAPPING',
        actor: actorOf(req),
        busyReference: busyId,
        finalStatus: 'MAPPING_SET',
      });
      res.json({ mapping });
    } catch (err) {
      if (err && err.conflict) return res.status(409).json({ error: err.message, code: 'DUPLICATE_ERROR' });
      sendError(res, 500, err);
    }
  });

  router.delete('/mappings/:entityType/:dhownId', canUnmap, async (req, res) => {
    try {
      const entityType = String(req.params.entityType).toUpperCase();
      await bridge.mappings.clearMapping(entityType, req.params.dhownId);
      await bridge.audit.record({
        entityType,
        dhownEntityId: req.params.dhownId,
        operation: 'CLEAR_MAPPING',
        actor: actorOf(req),
        finalStatus: 'MAPPING_CLEARED',
      });
      res.json({ ok: true });
    } catch (err) {
      sendError(res, 500, err);
    }
  });

  // ── Reconciliation ────────────────────────────────────────────
  router.get('/reconciliation', canRead, async (req, res) => {
    try {
      res.json({
        summary: await bridge.reconciler.summary(),
        items: await bridge.reconciler.list({
          result: req.query.result,
          resolved: req.query.resolved === 'true',
          limit: Number(req.query.limit) || 100,
        }),
      });
    } catch (err) {
      sendError(res, 500, err);
    }
  });

  router.post('/reconciliation/run', canAct, async (req, res) => {
    try {
      res.json({ summary: await bridge.reconciler.run(bridge.config.reconcile.lookbackDays) });
    } catch (err) {
      sendError(res, 502, err);
    }
  });

  router.post('/reconciliation/:id/resolve', canAct, async (req, res) => {
    try {
      await bridge.reconciler.markResolved(Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      sendError(res, 500, err);
    }
  });

  // ── Audit ─────────────────────────────────────────────────────
  router.get('/audit', canRead, async (req, res) => {
    try {
      const entries = req.query.externalReference
        ? await bridge.audit.forExternalReference(req.query.externalReference)
        : await bridge.audit.recent(Number(req.query.limit) || 100);
      res.json({ entries });
    } catch (err) {
      sendError(res, 500, err);
    }
  });

  // ── BUSY -> dashboard master sync ─────────────────────────────
  // Returns what BUSY holds so the dashboard can align its own lists. The
  // bridge does not push these anywhere: accounting logic stays in BUSY.
  router.get('/masters/:kind', canRead, async (req, res) => {
    const kind = String(req.params.kind).toLowerCase();
    const caps = bridge.adapter.capabilities();
    const since = req.query.since;
    try {
      if (kind === 'customers' && caps.getCustomers) return res.json({ data: await bridge.adapter.getCustomers(since) });
      if (kind === 'vendors' && caps.getVendors) return res.json({ data: await bridge.adapter.getVendors(since) });
      if (kind === 'items' && caps.getItems) return res.json({ data: await bridge.adapter.getItems(since) });
      res.status(501).json({
        error: `This BUSY installation cannot serve "${kind}" masters.`,
        code: 'UNSUPPORTED_OPERATION',
        action: 'See docs/BUSY_INTEGRATION.md for the capability matrix.',
      });
    } catch (err) {
      sendError(res, 502, err);
    }
  });

  // ── Worker control ────────────────────────────────────────────
  router.post('/worker/tick', canAct, async (req, res) => {
    try {
      res.json(await bridge.worker.tick());
    } catch (err) {
      sendError(res, 502, err);
    }
  });

  router.get('/entity-types', canRead, (req, res) => {
    res.json({ all: ALL_ENTITY_TYPES, enabled: [...bridge.config.enabledEntityTypes] });
  });

  return router;
}

module.exports = { createBusyRoutes, explainRow };
