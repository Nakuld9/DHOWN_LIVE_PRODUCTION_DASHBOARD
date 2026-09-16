const { BridgeError, UnsupportedOperationError, classifyError } = require('./errors');
const { MASTER_TYPES } = require('./config');

/** Which adapter capability each entity type needs. */
const CAPABILITY_FOR = {
  CUSTOMER: 'createOrUpdateCustomer',
  VENDOR: 'createOrUpdateVendor',
  ITEM: 'createOrUpdateItem',
  WAREHOUSE: 'createOrUpdateItem', // warehouses ride the master path
  SALES_REFERENCE: 'sendSalesReference',
  PURCHASE_REFERENCE: 'sendPurchaseReference',
  DISPATCH: 'sendDispatch',
  INVOICE: 'sendInvoice',
};

/**
 * Processes one queue item: resolve mappings, guard idempotency, call BUSY,
 * classify the outcome, and write the audit trail.
 *
 * This module contains no production logic of any kind — no scheduling, no
 * capacity, no machine state, no roll tracking. It translates, validates,
 * sends and records.
 */
class SyncService {
  constructor({ adapter, queue, mappings, audit, retryPolicy, logger = console }) {
    this.adapter = adapter;
    this.queue = queue;
    this.mappings = mappings;
    this.audit = audit;
    this.retryPolicy = retryPolicy;
    this.logger = logger;
  }

  async process(item, actor = 'system') {
    await this.queue.recordAttempt(item.id);
    const attempt = item.attemptCount + 1;

    try {
      const capability = CAPABILITY_FOR[item.entityType];
      if (!this.adapter.capabilities()[capability]) {
        throw new UnsupportedOperationError(capability, this.adapter.name);
      }

      const payload = item.payload;

      // ── IDEMPOTENCY GUARD ────────────────────────────────────
      // Before creating anything, ask BUSY whether it already holds this
      // external reference. This is what makes a crash between "sent" and
      // "recorded" safe: we recover the existing reference instead of posting
      // a second voucher.
      const prior = await this.checkExisting(item);
      if (prior) return prior;

      const ctx = await this.buildContext(item, payload, attempt);
      const result = await this.send(item, payload, ctx);

      return await this.applyResult(item, result, attempt, actor);
    } catch (err) {
      return this.applyFailure(item, err, attempt, actor);
    }
  }

  /**
   * Ask BUSY whether this external reference already exists.
   *
   * A failure to ask is not a failure of the job — if the BUSY PC is
   * unreachable the send below will fail and be retried anyway. But we must
   * not treat "couldn't check" as "doesn't exist".
   */
  async checkExisting(item) {
    if (!this.adapter.capabilities().getTransactionStatus) return null;

    let existing;
    try {
      existing = await this.adapter.getTransactionStatus(item.externalReference);
    } catch (err) {
      const be = classifyError(err);
      if (be.retryable) return null; // cannot confirm; let the send path deal with it
      throw be;
    }

    if (existing.status === 'POSTED' || existing.status === 'DUPLICATE') {
      await this.queue.markSuccess(item.id, existing.busyReference || null);
      await this.recordMasterMappingFromResult(item, existing);
      await this.audit.record({
        queueId: item.id,
        entityType: item.entityType,
        dhownEntityId: item.dhownEntityId,
        externalReference: item.externalReference,
        operation: item.operation,
        payloadVersion: item.payloadVersion,
        attemptCount: item.attemptCount + 1,
        actor: 'system',
        busyResponse: existing.raw || existing.message || null,
        busyReference: existing.busyReference || null,
        finalStatus: 'SUCCESS',
        errorCode: 'DUPLICATE_SUPPRESSED',
        errorMessage: 'External reference already present in BUSY; no duplicate was created.',
      });
      return {
        queueId: item.id,
        externalReference: item.externalReference,
        status: 'SUCCESS',
        busyReference: existing.busyReference || null,
        deduplicated: true,
      };
    }

    if (existing.status === 'REJECTED') {
      throw new BridgeError('BUSY_TRANSACTION_ERROR', existing.message || 'BUSY previously rejected this transaction.', {
        busyResponse: existing.raw,
      });
    }

    // ACCEPTED means our own earlier hand-off is still in flight — do not send
    // it again, just wait for the acknowledgement.
    if (existing.status === 'ACCEPTED' && item.attemptCount > 0) {
      await this.queue.markAwaitingBusy(item.id, existing.message || 'Awaiting BUSY acknowledgement.');
      return {
        queueId: item.id,
        externalReference: item.externalReference,
        status: 'AWAITING_BUSY',
        deduplicated: true,
      };
    }

    return null;
  }

  /** Resolve every DHOWN id in the payload to its BUSY counterpart. */
  async buildContext(item, payload, attempt) {
    const ctx = { externalReference: item.externalReference, itemBusyIds: {}, attempt };

    if (payload.customerDhownId) {
      const resolved = await this.mappings.resolve('CUSTOMER', payload.customerDhownId);
      ctx.partyBusyId = resolved.busyId;
      if (resolved.busyCode) ctx.partyBusyCode = resolved.busyCode;
    } else if (payload.vendorDhownId) {
      const resolved = await this.mappings.resolve('VENDOR', payload.vendorDhownId);
      ctx.partyBusyId = resolved.busyId;
      if (resolved.busyCode) ctx.partyBusyCode = resolved.busyCode;
    }

    if (payload.warehouseDhownId) {
      ctx.warehouseBusyId = (await this.mappings.resolve('WAREHOUSE', payload.warehouseDhownId)).busyId;
    }

    if (Array.isArray(payload.lines)) {
      for (const line of payload.lines) {
        // resolve() throws MASTER_MAPPING_ERROR naming the DHOWN item, which
        // is what surfaces as "Map DHOWN item FC-00125 to a BUSY item".
        ctx.itemBusyIds[line.itemDhownId] = await this.mappings.resolve('ITEM', line.itemDhownId);
      }
    }

    // A master being (re)sent may already have a BUSY identity; pass it so the
    // adapter can update rather than create.
    if (MASTER_TYPES.has(item.entityType)) {
      const existing = await this.mappings.find(item.entityType, item.dhownEntityId);
      if (existing && existing.busyId) {
        if (item.entityType === 'ITEM') {
          ctx.itemBusyIds[item.dhownEntityId] = {
            busyId: existing.busyId,
            ...(existing.busyCode ? { busyCode: existing.busyCode } : {}),
          };
        } else {
          ctx.partyBusyId = existing.busyId;
          if (existing.busyCode) ctx.partyBusyCode = existing.busyCode;
        }
      }
    }

    return ctx;
  }

  send(item, payload, ctx) {
    switch (item.entityType) {
      case 'CUSTOMER':
        return this.adapter.createOrUpdateCustomer(payload, ctx);
      case 'VENDOR':
        return this.adapter.createOrUpdateVendor(payload, ctx);
      case 'ITEM':
      case 'WAREHOUSE':
        return this.adapter.createOrUpdateItem(payload, ctx);
      case 'SALES_REFERENCE':
        return this.adapter.sendSalesReference(payload, ctx);
      case 'PURCHASE_REFERENCE':
        return this.adapter.sendPurchaseReference(payload, ctx);
      case 'DISPATCH':
        return this.adapter.sendDispatch(payload, ctx);
      case 'INVOICE':
        return this.adapter.sendInvoice(payload, ctx);
      default:
        throw new BridgeError('VALIDATION_ERROR', `Unsupported entity type "${item.entityType}".`);
    }
  }

  /** When BUSY returns an identity for a master record, store the mapping. */
  async recordMasterMappingFromResult(item, result) {
    if (!MASTER_TYPES.has(item.entityType)) return;
    const busyId = result.busyReference || result.busyCode;
    if (!busyId) return;
    await this.mappings.markSynced(item.entityType, item.dhownEntityId, busyId, result.busyCode || undefined);
  }

  async applyResult(item, result, attempt, actor) {
    const auditBase = {
      queueId: item.id,
      entityType: item.entityType,
      dhownEntityId: item.dhownEntityId,
      externalReference: item.externalReference,
      operation: item.operation,
      payloadVersion: item.payloadVersion,
      payloadSnapshot: item.payload,
      attemptCount: attempt,
      actor,
      busyResponse: result.raw || result.message || null,
      busyReference: result.busyReference || null,
    };

    switch (result.status) {
      case 'POSTED': {
        await this.queue.markSuccess(item.id, result.busyReference || null);
        await this.recordMasterMappingFromResult(item, result);
        await this.audit.record({ ...auditBase, finalStatus: 'SUCCESS' });
        return {
          queueId: item.id,
          externalReference: item.externalReference,
          status: 'SUCCESS',
          busyReference: result.busyReference || null,
        };
      }

      case 'DUPLICATE': {
        // BUSY already had it. That is a success for the DHOWN record; what we
        // must not do is send it again.
        await this.queue.markSuccess(item.id, result.busyReference || null);
        await this.recordMasterMappingFromResult(item, result);
        await this.audit.record({
          ...auditBase,
          finalStatus: 'SUCCESS',
          errorCode: 'DUPLICATE_SUPPRESSED',
          errorMessage: result.message || 'BUSY already held this external reference.',
        });
        return {
          queueId: item.id,
          externalReference: item.externalReference,
          status: 'SUCCESS',
          busyReference: result.busyReference || null,
          deduplicated: true,
        };
      }

      case 'ACCEPTED': {
        // Handed over but not booked. Parking in AWAITING_BUSY keeps the
        // distinction honest — the dashboard is not told a reference exists
        // when it does not yet.
        await this.queue.markAwaitingBusy(item.id, result.message || 'Awaiting BUSY acknowledgement.');
        await this.audit.record({ ...auditBase, finalStatus: 'AWAITING_BUSY' });
        return { queueId: item.id, externalReference: item.externalReference, status: 'AWAITING_BUSY' };
      }

      default: {
        const error = new BridgeError('BUSY_TRANSACTION_ERROR', result.message || 'BUSY rejected the transaction.', {
          busyResponse: result.raw,
        });
        return this.applyFailure(item, error, attempt, actor);
      }
    }
  }

  async applyFailure(item, err, attempt, actor) {
    const error = classifyError(err);
    const retry = this.retryPolicy.shouldRetry(attempt, error.retryable);

    // Keep the classified details with the row. The dashboard rebuilds the
    // remediation message from these, and the subject it names (the unmapped
    // item, say) is not the queue row's own DHOWN id.
    const details = error.details || {};

    let status;
    if (retry) {
      await this.queue.markRetry(item.id, this.retryPolicy.nextRetryAt(attempt), error.code, error.message, details);
      status = 'RETRY';
    } else {
      // Either the attempt budget is exhausted, or the failure cannot be fixed
      // by retrying (mapping gaps, bad data, BUSY rejections). Both need a
      // person, so both park in MANUAL_REVIEW where they are visible.
      await this.queue.markManualReview(item.id, error.code, error.message, details);
      status = 'MANUAL_REVIEW';
    }

    if (error.code === 'MASTER_MAPPING_ERROR' && typeof details.subject === 'string') {
      await this.mappings.markFailed(details.entityType || 'ITEM', details.subject, error.message, 'MANUAL_REVIEW');
    }

    await this.audit.record({
      queueId: item.id,
      entityType: item.entityType,
      dhownEntityId: item.dhownEntityId,
      externalReference: item.externalReference,
      operation: item.operation,
      payloadVersion: item.payloadVersion,
      payloadSnapshot: item.payload,
      attemptCount: attempt,
      actor,
      busyResponse: details.busyResponse || null,
      finalStatus: status,
      errorCode: error.code,
      errorMessage: error.message,
    });

    this.logger.warn(
      `[BUSY] sync attempt failed ${item.externalReference} ${error.code} attempt=${attempt} -> ${status}: ${error.message}`,
    );

    return { queueId: item.id, externalReference: item.externalReference, status, errorCode: error.code };
  }

  /**
   * Poll BUSY for jobs we handed over asynchronously.
   *
   * This is how the XML file-drop flow eventually learns its BUSY reference
   * and completes the loop back into the dashboard.
   */
  async pollAwaitingBusy(limit = 100) {
    if (!this.adapter.capabilities().getTransactionStatus) return [];
    const outcomes = [];

    for (const item of await this.queue.awaitingBusy(limit)) {
      try {
        const result = await this.adapter.getTransactionStatus(item.externalReference);
        if (result.status === 'POSTED' || result.status === 'DUPLICATE') {
          await this.queue.markSuccess(item.id, result.busyReference || null);
          await this.recordMasterMappingFromResult(item, result);
          await this.audit.record({
            queueId: item.id,
            entityType: item.entityType,
            dhownEntityId: item.dhownEntityId,
            externalReference: item.externalReference,
            operation: item.operation,
            payloadVersion: item.payloadVersion,
            attemptCount: item.attemptCount,
            actor: 'system',
            busyResponse: result.raw || result.message || null,
            busyReference: result.busyReference || null,
            finalStatus: 'SUCCESS',
          });
          outcomes.push({
            queueId: item.id,
            externalReference: item.externalReference,
            status: 'SUCCESS',
            busyReference: result.busyReference || null,
          });
        } else if (result.status === 'REJECTED') {
          outcomes.push(
            await this.applyFailure(
              item,
              new BridgeError('BUSY_TRANSACTION_ERROR', result.message || 'BUSY rejected the imported file.', {
                busyResponse: result.raw,
              }),
              item.attemptCount,
              'system',
            ),
          );
        }
        // ACCEPTED / UNKNOWN: still in flight, leave it parked.
      } catch (err) {
        // A polling failure is not a job failure — try again next tick.
        classifyError(err);
      }
    }
    return outcomes;
  }
}

module.exports = { SyncService, CAPABILITY_FOR };
