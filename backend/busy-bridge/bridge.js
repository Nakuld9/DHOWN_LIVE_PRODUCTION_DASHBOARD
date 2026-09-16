const { createAdapter } = require('./adapters');
const { MappingStore } = require('./store/mappingStore');
const { QueueStore } = require('./store/queueStore');
const { AuditLog } = require('./store/auditLog');
const { RetryPolicy } = require('./retryPolicy');
const { SyncService } = require('./syncService');
const { QueueWorker } = require('./worker');
const { Reconciler } = require('./reconciler');
const { validatePayload } = require('./validators');
const { buildExternalReference, buildMasterExternalReference } = require('./externalRef');
const { BridgeError } = require('./errors');
const { PAYLOAD_VERSION } = require('./transform/busyXml');
const { MASTER_TYPES } = require('./config');

/**
 * Composition root and the bridge's own public surface.
 *
 * The dashboard calls submit(). Everything after that — validation, mapping,
 * queueing, retrying, reconciling — happens asynchronously, without the caller
 * waiting on the BUSY PC.
 */
class Bridge {
  constructor(config, pool, adapter, logger = console) {
    this.config = config;
    this.pool = pool;
    this.logger = logger;
    this.adapter = adapter || createAdapter(config);
    this.mappings = new MappingStore(pool);
    this.queue = new QueueStore(pool);
    this.audit = new AuditLog(pool);
    this.retryPolicy = new RetryPolicy({
      maxAttempts: config.queue.maxAttempts,
      baseDelayMs: config.queue.retryBaseDelayMs,
      maxDelayMs: config.queue.retryMaxDelayMs,
    });
    this.sync = new SyncService({
      adapter: this.adapter,
      queue: this.queue,
      mappings: this.mappings,
      audit: this.audit,
      retryPolicy: this.retryPolicy,
      logger,
    });
    this.worker = new QueueWorker(
      pool,
      this.queue,
      this.sync,
      this.adapter,
      { pollIntervalMs: config.queue.pollIntervalMs, batchSize: config.queue.batchSize },
      logger,
    );
    this.reconciler = new Reconciler(pool, this.adapter, this.queue, this.mappings, logger);
    this.reconcileTimer = null;
  }

  /**
   * Accept a commercial record from the dashboard.
   *
   * Synchronous work is limited to validation and queueing, both of which are
   * local to this PC. The caller is never blocked on BUSY — that is what keeps
   * production running during a BUSY outage.
   */
  async submit(input) {
    const { entityType, payload } = input;

    // The transaction list is configurable; anything not enabled is refused
    // here rather than silently dropped later.
    if (!this.config.enabledEntityTypes.has(entityType)) {
      throw new BridgeError('VALIDATION_ERROR', `Entity type "${entityType}" is not enabled for BUSY synchronisation.`, {
        action: 'CONTACT_SUPPORT',
        subject: entityType,
        enabled: [...this.config.enabledEntityTypes],
      });
    }

    validatePayload(entityType, payload);

    const dhownEntityId = String(payload.dhownId);
    const externalReference =
      input.externalReference ||
      (MASTER_TYPES.has(entityType)
        ? buildMasterExternalReference(entityType, dhownEntityId)
        : buildExternalReference(entityType, String(payload.documentNumber), payload.fiscalYear));

    await this.registerMappingPlaceholders(entityType, payload, dhownEntityId);

    const { item, created } = await this.queue.enqueue({
      entityType,
      dhownEntityId,
      operation: input.operation || (MASTER_TYPES.has(entityType) ? 'UPSERT' : 'SEND'),
      payload,
      payloadVersion: PAYLOAD_VERSION,
      externalReference,
      createdBy: input.createdBy,
    });

    if (created) {
      await this.audit.record({
        queueId: item.id,
        entityType,
        dhownEntityId,
        externalReference,
        operation: item.operation,
        payloadVersion: PAYLOAD_VERSION,
        payloadSnapshot: item.payload,
        actor: input.createdBy || 'DASHBOARD',
        finalStatus: 'QUEUED',
      });
    }
    // If not created this is an idempotent re-submission: the caller retried
    // and we already hold the record. Returning the existing state lets them
    // converge rather than treating it as an error.

    return {
      accepted: true,
      queueId: item.id,
      externalReference,
      status: item.status,
      created,
      busyReference: item.busyReference,
    };
  }

  /**
   * Make sure every DHOWN id referenced by this payload has a mapping row,
   * even an unmapped one. Without this a supervisor has nothing to click "Fix
   * Mapping" on — the gap would only exist as an error message.
   */
  async registerMappingPlaceholders(entityType, payload, dhownEntityId) {
    if (MASTER_TYPES.has(entityType)) {
      await this.mappings.upsertPending(entityType, dhownEntityId, payload.name);
    }
    if (typeof payload.customerDhownId === 'string') await this.mappings.upsertPending('CUSTOMER', payload.customerDhownId);
    if (typeof payload.vendorDhownId === 'string') await this.mappings.upsertPending('VENDOR', payload.vendorDhownId);
    if (typeof payload.warehouseDhownId === 'string') await this.mappings.upsertPending('WAREHOUSE', payload.warehouseDhownId);
    if (Array.isArray(payload.lines)) {
      for (const line of payload.lines) {
        if (line && line.itemDhownId) await this.mappings.upsertPending('ITEM', line.itemDhownId);
      }
    }
  }

  /** Force one queue item through immediately. Used by manual retry and tests. */
  async processOne(queueId, actor = 'system') {
    const item = await this.queue.findById(queueId);
    if (!item) throw new BridgeError('VALIDATION_ERROR', `Queue item ${queueId} does not exist.`);
    return this.sync.process(item, actor);
  }

  /** Drain the queue until nothing is due. Used by tests and "Process queue now". */
  async drain(maxPasses = 20) {
    let processed = 0;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const batch = await this.queue.claimBatch(this.config.queue.batchSize);
      if (batch.length === 0) break;
      for (const item of batch) {
        await this.sync.process(item);
        processed += 1;
      }
    }
    await this.sync.pollAwaitingBusy();
    return processed;
  }

  start() {
    if (!this.config.enabled) {
      this.logger.warn('[BUSY] bridge is disabled (BUSY_BRIDGE_ENABLED=false); routes are mounted but nothing will sync');
      return;
    }
    this.worker.start();
    if (this.config.reconcile.intervalMs > 0) {
      this.reconcileTimer = setInterval(() => {
        this.reconciler.run(this.config.reconcile.lookbackDays).catch((err) => {
          this.logger.error(`[BUSY] scheduled reconciliation failed: ${err && err.message}`);
        });
      }, this.config.reconcile.intervalMs);
      if (this.reconcileTimer.unref) this.reconcileTimer.unref();
    }
  }

  async stop() {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    await this.worker.stop();
    if (this.adapter.close) await this.adapter.close();
  }
}

module.exports = { Bridge };
