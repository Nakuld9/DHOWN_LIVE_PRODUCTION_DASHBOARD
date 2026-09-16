const { BridgeError, UnsupportedOperationError, classifyError } = require('../errors');

/**
 * Adapter for a third-party / in-house REST gateway in front of BUSY.
 *
 * BUSY has no native public REST API (see the audit). This adapter is for
 * installations where a gateway has been licensed or built, and is strictly
 * opt-in via BUSY_ADAPTER=rest.
 *
 * Read-only deployments (a gateway sitting on the BUSY SQL database) set
 * BUSY_REST_READ_ONLY=true. Per the audit decision: direct writes to BUSY's
 * database bypass its posting, numbering, GST and stock-valuation logic and can
 * silently corrupt a statutory system, so every write then throws. The rule is
 * enforced in code, not left to whoever configures the gateway.
 */
class BusyRestAdapter {
  constructor(opts) {
    this.name = 'rest';
    this.opts = opts;
    this.baseUrl = String(opts.baseUrl).replace(/\/+$/, '');
  }

  capabilities() {
    const writable = !this.opts.readOnly;
    return {
      testConnection: true,
      getCustomers: true,
      getVendors: true,
      getItems: true,
      createOrUpdateCustomer: writable,
      createOrUpdateVendor: writable,
      createOrUpdateItem: writable,
      sendSalesReference: writable,
      sendPurchaseReference: writable,
      sendDispatch: writable,
      sendInvoice: writable,
      getTransactionStatus: true,
      reconcileTransaction: true,
      // A gateway answers synchronously, so a send can return a real BUSY
      // reference immediately instead of parking in AWAITING_BUSY.
      synchronousSend: writable,
    };
  }

  assertWritable(operation) {
    if (this.opts.readOnly) {
      throw new UnsupportedOperationError(`${operation} (gateway is configured read-only)`, this.name);
    }
  }

  async request(method, route, body) {
    const url = `${this.baseUrl}${route}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const init = {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          // Credentials come from .env and are never echoed to any caller.
          authorization: `Bearer ${this.opts.apiKey}`,
        },
        signal: controller.signal,
      };
      if (body !== undefined) init.body = JSON.stringify(body);

      const response = await fetch(url, init);
      const text = await response.text();
      const snippet = text.slice(0, 2000);

      if (response.status === 401 || response.status === 403) {
        throw new BridgeError('AUTHENTICATION_ERROR', `BUSY gateway rejected our credentials (HTTP ${response.status}).`, {
          action: 'CHECK_CREDENTIALS',
          busyResponse: snippet,
        });
      }
      if (response.status === 409) {
        throw new BridgeError('DUPLICATE_ERROR', 'BUSY already holds this external reference.', {
          action: 'RECONCILE',
          busyResponse: snippet,
        });
      }
      if (response.status === 408 || response.status === 504) {
        throw new BridgeError('TIMEOUT', `BUSY gateway timed out (HTTP ${response.status}).`, { busyResponse: snippet });
      }
      if (response.status >= 500) {
        // Server-side faults are transport problems from our side: retryable.
        throw new BridgeError('CONNECTION_ERROR', `BUSY gateway returned HTTP ${response.status}.`, {
          action: 'CHECK_CONNECTION',
          busyResponse: snippet,
        });
      }
      if (response.status === 404) {
        // Distinguishable below, so idempotency recovery can read it as "BUSY
        // has never seen this" rather than a failure.
        throw new BridgeError('BUSY_TRANSACTION_ERROR', 'Not found on the BUSY gateway.', {
          busyResponse: snippet,
          notFound: true,
        });
      }
      if (response.status >= 400) {
        // A 4xx that is not auth/conflict/timeout means BUSY refused the
        // transaction on business grounds. Not retryable.
        throw new BridgeError('BUSY_TRANSACTION_ERROR', `BUSY rejected the transaction (HTTP ${response.status}).`, {
          busyResponse: snippet,
        });
      }

      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        throw new BridgeError('UNKNOWN_ERROR', 'BUSY gateway returned a response that was not valid JSON.', {
          busyResponse: snippet,
        });
      }
    } catch (err) {
      throw classifyError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection() {
    try {
      const info = await this.request('GET', '/health');
      return { online: true, message: 'BUSY gateway reachable.', detail: info };
    } catch (err) {
      const be = classifyError(err);
      return { online: false, message: be.message, detail: { code: be.code } };
    }
  }

  toResult(res) {
    const raw = JSON.stringify(res);
    const reference = res.busyReference || res.reference;
    const code = res.busyCode || res.code;
    const declared = String(res.status || '').toUpperCase();
    let status;
    if (declared === 'DUPLICATE') status = 'DUPLICATE';
    else if (declared === 'REJECTED' || declared === 'FAILED') status = 'REJECTED';
    else if (declared === 'PENDING' || declared === 'ACCEPTED') status = 'ACCEPTED';
    else status = reference ? 'POSTED' : 'ACCEPTED';

    const result = { status, raw };
    if (reference) result.busyReference = reference;
    if (code) result.busyCode = code;
    if (res.message) result.message = res.message;
    return result;
  }

  async fetchMasters(route, since) {
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    const body = await this.request('GET', `${route}${query}`);
    const rows = Array.isArray(body.data) ? body.data : [];
    return rows
      .map((r) => {
        const busyId = r.busyId !== undefined ? r.busyId : r.id !== undefined ? r.id : r.code;
        if (typeof busyId !== 'string' && typeof busyId !== 'number') return null;
        if (typeof r.name !== 'string') return null;
        const record = { busyId: String(busyId), name: r.name, raw: r };
        if (typeof r.code === 'string') record.busyCode = r.code;
        if (typeof r.gstin === 'string') record.gstin = r.gstin;
        return record;
      })
      .filter((r) => r !== null);
  }

  getCustomers(since) {
    return this.fetchMasters('/customers', since);
  }
  getVendors(since) {
    return this.fetchMasters('/vendors', since);
  }
  getItems(since) {
    return this.fetchMasters('/items', since);
  }

  async post(route, operation, payload, ctx) {
    this.assertWritable(operation);
    const res = await this.request('POST', route, {
      // The gateway is expected to treat this as its own idempotency key.
      externalReference: ctx.externalReference,
      partyBusyId: ctx.partyBusyId,
      partyBusyCode: ctx.partyBusyCode,
      warehouseBusyId: ctx.warehouseBusyId,
      itemBusyIds: ctx.itemBusyIds,
      attempt: ctx.attempt,
      payload,
    });
    return this.toResult(res);
  }

  createOrUpdateCustomer(c, ctx) {
    return this.post('/customers', 'createOrUpdateCustomer', c, ctx);
  }
  createOrUpdateVendor(v, ctx) {
    return this.post('/vendors', 'createOrUpdateVendor', v, ctx);
  }
  createOrUpdateItem(i, ctx) {
    return this.post('/items', 'createOrUpdateItem', i, ctx);
  }
  sendSalesReference(d, ctx) {
    return this.post('/sales-references', 'sendSalesReference', d, ctx);
  }
  sendPurchaseReference(d, ctx) {
    return this.post('/purchase-references', 'sendPurchaseReference', d, ctx);
  }
  sendDispatch(d, ctx) {
    return this.post('/dispatches', 'sendDispatch', d, ctx);
  }
  sendInvoice(d, ctx) {
    return this.post('/invoices', 'sendInvoice', d, ctx);
  }

  async getTransactionStatus(externalReference) {
    try {
      const res = await this.request('GET', `/transactions/${encodeURIComponent(externalReference)}`);
      return this.toResult(res);
    } catch (err) {
      const be = classifyError(err);
      // "BUSY has never seen this" is an answer, not a failure — and it is the
      // answer idempotency recovery depends on after a crash.
      if (be.code === 'BUSY_TRANSACTION_ERROR' && be.details && be.details.notFound) {
        return { status: 'UNKNOWN', message: `BUSY has no record of ${externalReference}.` };
      }
      throw be;
    }
  }

  async reconcileTransaction(externalReference) {
    let res;
    try {
      res = await this.request('GET', `/transactions/${encodeURIComponent(externalReference)}/detail`);
    } catch (err) {
      const be = classifyError(err);
      if (be.code === 'BUSY_TRANSACTION_ERROR' && be.details && be.details.notFound) return null;
      throw be;
    }
    if (!res || Object.keys(res).length === 0) return null;

    const snapshot = { externalReference, raw: res };
    if (typeof res.busyReference === 'string') snapshot.busyReference = res.busyReference;
    if (typeof res.documentNumber === 'string') snapshot.documentNumber = res.documentNumber;
    if (typeof res.documentDate === 'string') snapshot.documentDate = res.documentDate;
    if (typeof res.partyBusyId === 'string') snapshot.partyBusyId = res.partyBusyId;
    if (typeof res.totalQuantity === 'number') snapshot.totalQuantity = res.totalQuantity;
    if (typeof res.totalAmount === 'number') snapshot.totalAmount = res.totalAmount;
    if (Array.isArray(res.lines)) {
      snapshot.lines = res.lines
        .map((l) => {
          const busyItemId = l.busyItemId !== undefined ? l.busyItemId : l.itemId;
          if (typeof busyItemId !== 'string' || typeof l.quantity !== 'number') return null;
          const line = { busyItemId, quantity: l.quantity };
          if (typeof l.amount === 'number') line.amount = l.amount;
          return line;
        })
        .filter((l) => l !== null);
    }
    return snapshot;
  }
}

module.exports = { BusyRestAdapter };
