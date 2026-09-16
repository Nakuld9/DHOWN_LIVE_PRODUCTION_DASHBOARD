const { BridgeError, UnsupportedOperationError } = require('../errors');

/**
 * In-process fake BUSY, for tests and local development on a PC that has no
 * BUSY installation.
 *
 * It is a real implementation of the contract, not a stub: it enforces
 * idempotency, can be taken offline, can be made to time out, and refuses
 * operations its capability matrix says it cannot do. That is what makes the
 * offline/retry/duplicate tests meaningful rather than decorative.
 *
 * Never select this adapter in production — adapters/index.js refuses to.
 */
class InMemoryBusyAdapter {
  constructor() {
    this.name = 'memory';

    /** Flip to simulate the BUSY PC being off. */
    this.online = true;
    /** Flip to simulate a hung BUSY. */
    this.timeoutNext = false;
    /** Number of times to fail with a connection error before succeeding. */
    this.failuresBeforeSuccess = 0;
    /** Operations to report as unsupported, to exercise capability handling. */
    this.unsupported = new Set();
    /** False makes sends behave like the async file-drop transport. */
    this.synchronous = true;

    this.transactions = new Map();
    this.customers = new Map();
    this.vendors = new Map();
    this.items = new Map();
    /** Every send attempt, so tests can assert no duplicate reached BUSY. */
    this.sendLog = [];
    this.sequence = 0;
  }

  capabilities() {
    const on = (op) => !this.unsupported.has(op);
    return {
      testConnection: true,
      getCustomers: on('getCustomers'),
      getVendors: on('getVendors'),
      getItems: on('getItems'),
      createOrUpdateCustomer: on('createOrUpdateCustomer'),
      createOrUpdateVendor: on('createOrUpdateVendor'),
      createOrUpdateItem: on('createOrUpdateItem'),
      sendSalesReference: on('sendSalesReference'),
      sendPurchaseReference: on('sendPurchaseReference'),
      sendDispatch: on('sendDispatch'),
      sendInvoice: on('sendInvoice'),
      getTransactionStatus: on('getTransactionStatus'),
      reconcileTransaction: on('reconcileTransaction'),
      synchronousSend: this.synchronous,
    };
  }

  /**
   * Availability guard, applied to every operation including read-only ones.
   * `online = false` means the BUSY PC is down, so nothing works.
   */
  guard(operation) {
    if (this.unsupported.has(operation)) throw new UnsupportedOperationError(operation, this.name);
    if (!this.online) throw new BridgeError('CONNECTION_ERROR', 'Simulated BUSY offline.');
  }

  /**
   * Write guard: availability, plus the injected faults.
   *
   * Faults are deliberately scoped to writes. The status probe that guards
   * idempotency runs before every send, and if it consumed the injected fault
   * the send itself would succeed — a network-interruption test would then
   * silently assert nothing.
   */
  guardWrite(operation) {
    this.guard(operation);
    if (this.timeoutNext) {
      this.timeoutNext = false;
      throw new BridgeError('TIMEOUT', 'Simulated BUSY timeout.');
    }
    if (this.failuresBeforeSuccess > 0) {
      this.failuresBeforeSuccess -= 1;
      throw new BridgeError('CONNECTION_ERROR', 'Simulated transient BUSY connection failure.');
    }
  }

  async testConnection() {
    return this.online
      ? { online: true, message: 'In-memory BUSY is online.' }
      : { online: false, message: 'In-memory BUSY is offline.' };
  }

  async getCustomers() {
    this.guard('getCustomers');
    return [...this.customers.values()];
  }
  async getVendors() {
    this.guard('getVendors');
    return [...this.vendors.values()];
  }
  async getItems() {
    this.guard('getItems');
    return [...this.items.values()];
  }

  record(operation, ctx, snapshot, store, master) {
    this.guardWrite(operation);
    this.sendLog.push({ operation, externalReference: ctx.externalReference });

    // Idempotency, enforced on the BUSY side too — this is what the duplicate
    // test actually proves.
    const existing = this.transactions.get(ctx.externalReference);
    if (existing) {
      const result = {
        status: 'DUPLICATE',
        message: `External reference ${ctx.externalReference} already exists in BUSY.`,
      };
      if (existing.busyReference) result.busyReference = existing.busyReference;
      return result;
    }

    this.sequence += 1;
    const busyReference = `BUSY-${String(this.sequence).padStart(5, '0')}`;
    const stored = { externalReference: ctx.externalReference, busyReference, ...snapshot };

    if (this.synchronous) {
      this.transactions.set(ctx.externalReference, { ...stored, status: 'POSTED' });
      if (store && master) {
        store.set(master.dhownId, { busyId: busyReference, busyCode: busyReference, name: master.name });
      }
      return { status: 'POSTED', busyReference, busyCode: busyReference, raw: JSON.stringify(stored) };
    }

    this.transactions.set(ctx.externalReference, { ...stored, status: 'ACCEPTED' });
    return { status: 'ACCEPTED', message: 'Queued inside the in-memory BUSY.' };
  }

  async createOrUpdateCustomer(c, ctx) {
    return this.record('createOrUpdateCustomer', ctx, { documentNumber: c.code || c.dhownId }, this.customers, {
      dhownId: c.dhownId,
      name: c.name,
    });
  }
  async createOrUpdateVendor(v, ctx) {
    return this.record('createOrUpdateVendor', ctx, { documentNumber: v.code || v.dhownId }, this.vendors, {
      dhownId: v.dhownId,
      name: v.name,
    });
  }
  async createOrUpdateItem(i, ctx) {
    return this.record('createOrUpdateItem', ctx, { documentNumber: i.code || i.dhownId }, this.items, {
      dhownId: i.dhownId,
      name: i.name,
    });
  }

  document(operation, doc, ctx) {
    const lines = doc.lines.map((l) => {
      const resolved = ctx.itemBusyIds[l.itemDhownId];
      const line = { busyItemId: resolved ? resolved.busyId : l.itemDhownId, quantity: l.quantity };
      const amount = l.amount !== undefined ? l.amount : l.rate !== undefined ? l.rate * l.quantity : undefined;
      if (amount !== undefined) line.amount = amount;
      return line;
    });

    const snapshot = {
      documentNumber: doc.documentNumber,
      documentDate: doc.documentDate,
      lines,
      totalQuantity: lines.reduce((s, l) => s + l.quantity, 0),
      totalAmount: lines.reduce((s, l) => s + (l.amount || 0), 0),
    };
    if (ctx.partyBusyId) snapshot.partyBusyId = ctx.partyBusyId;
    return this.record(operation, ctx, snapshot);
  }

  async sendSalesReference(d, ctx) {
    return this.document('sendSalesReference', d, ctx);
  }
  async sendPurchaseReference(d, ctx) {
    return this.document('sendPurchaseReference', d, ctx);
  }
  async sendDispatch(d, ctx) {
    return this.document('sendDispatch', d, ctx);
  }
  async sendInvoice(d, ctx) {
    return this.document('sendInvoice', d, ctx);
  }

  async getTransactionStatus(externalReference) {
    this.guard('getTransactionStatus');
    const tx = this.transactions.get(externalReference);
    if (!tx) return { status: 'UNKNOWN', message: `No record of ${externalReference}.` };
    const result = { status: tx.status, raw: JSON.stringify(tx) };
    if (tx.busyReference) result.busyReference = tx.busyReference;
    return result;
  }

  async reconcileTransaction(externalReference) {
    this.guard('reconcileTransaction');
    return this.transactions.get(externalReference) || null;
  }

  /** Test helper: pretend BUSY finished importing a previously ACCEPTED file. */
  completeAsync(externalReference) {
    const tx = this.transactions.get(externalReference);
    if (!tx) return null;
    tx.status = 'POSTED';
    return tx.busyReference || null;
  }
}

module.exports = { InMemoryBusyAdapter };
