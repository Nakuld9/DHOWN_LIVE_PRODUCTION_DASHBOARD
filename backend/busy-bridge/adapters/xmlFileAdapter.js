const fs = require('fs/promises');
const path = require('path');

const { classifyError } = require('../errors');
const { assertSafeReference } = require('../externalRef');
const { tagBlocks, tagNumber, tagValue } = require('./xmlRead');
const {
  customerToXml,
  vendorToXml,
  itemToXml,
  salesReferenceToXml,
  purchaseReferenceToXml,
  dispatchToXml,
  invoiceToXml,
} = require('../transform/busyXml');

/**
 * BUSY XML Data Export/Import over a watched file exchange.
 *
 * This is the default adapter, chosen because it is the only mechanism
 * confirmed to be first-party and available across BUSY editions — see
 * docs/BUSY_INTEGRATION.md.
 *
 * BUSY RUNS ON A DIFFERENT PC from this dashboard, so the exchange folders are
 * normally a Windows share (\\BUSY-PC\BusyExchange\...) or a mapped drive.
 * Two consequences drive the code below:
 *
 *  - The share can disappear at any moment (BUSY PC off, switch reboot, cable).
 *    Every failure mode must read as CONNECTION_ERROR so the queue holds
 *    rather than marching transactions to MANUAL_REVIEW during a normal outage.
 *  - A rename is atomic on SMB only within one share. Temp files are therefore
 *    written inside the outbox itself, never in the OS temp directory, so BUSY
 *    can never import a half-written voucher it caught mid-write.
 *
 * Asynchrony is the defining property. Writing the file does NOT mean BUSY
 * booked the voucher; it means BUSY has been handed the voucher. Sends return
 * ACCEPTED, and the BUSY reference is collected later from the ack directory.
 */
class BusyXmlFileAdapter {
  constructor(opts) {
    this.name = 'xml';
    this.opts = opts;
  }

  capabilities() {
    return {
      testConnection: true,
      // Inbound masters depend on BUSY being configured to drop scheduled
      // exports into the inbox. Supported here; may legitimately be empty
      // until the BUSY side is set up (checklist 6.3).
      getCustomers: true,
      getVendors: true,
      getItems: true,
      createOrUpdateCustomer: true,
      createOrUpdateVendor: true,
      createOrUpdateItem: true,
      sendSalesReference: true,
      sendPurchaseReference: true,
      sendDispatch: true,
      sendInvoice: true,
      getTransactionStatus: true,
      reconcileTransaction: true,
      synchronousSend: false,
    };
  }

  // ── connection ────────────────────────────────────────────────

  async testConnection() {
    try {
      await fs.mkdir(this.opts.outbox, { recursive: true });
      await fs.mkdir(this.opts.ack, { recursive: true });
      await fs.mkdir(this.opts.inbox, { recursive: true });
      await fs.mkdir(this.opts.archive, { recursive: true });

      // mkdir can succeed against a stale SMB handle without the share really
      // being writable. Actually write, so "online" means what a supervisor
      // thinks it means.
      const probe = path.join(this.opts.outbox, `.bridge-probe-${process.pid}`);
      await fs.writeFile(probe, 'ok', 'utf8');
      await fs.unlink(probe);

      const entries = await fs.readdir(this.opts.outbox);
      const pending = entries.filter((f) => f.toLowerCase().endsWith('.xml')).length;

      return {
        online: true,
        message: this.opts.hostLabel
          ? `BUSY exchange on ${this.opts.hostLabel} is reachable and writable.`
          : 'BUSY exchange folders are reachable and writable.',
        detail: {
          host: this.opts.hostLabel || null,
          outbox: this.opts.outbox,
          ack: this.opts.ack,
          filesAwaitingBusyImport: pending,
        },
      };
    } catch (err) {
      const be = classifyError(err);
      return {
        online: false,
        message: `BUSY exchange is not reachable: ${be.message}`,
        detail: { code: be.code, host: this.opts.hostLabel || null, outbox: this.opts.outbox },
      };
    }
  }

  // ── masters in ────────────────────────────────────────────────

  async readInboundMasters(kind, since) {
    try {
      await fs.mkdir(this.opts.inbox, { recursive: true });
      const files = (await fs.readdir(this.opts.inbox)).filter(
        (f) => f.toLowerCase().endsWith('.xml') && f.toUpperCase().includes(kind),
      );
      const records = [];
      for (const file of files) {
        const full = path.join(this.opts.inbox, file);
        if (since) {
          const stat = await fs.stat(full);
          if (stat.mtime.toISOString() < since) continue;
        }
        const xml = await fs.readFile(full, 'utf8');
        for (const block of tagBlocks(xml, kind === 'ITEM' ? 'STOCKITEM' : 'ACCOUNT')) {
          const busyId = tagValue(block, 'BUSYID') || tagValue(block, 'CODE');
          const name = tagValue(block, 'NAME');
          if (!busyId || !name) continue; // incomplete row: skip, do not invent
          const record = { busyId, name };
          const code = tagValue(block, 'CODE');
          if (code) record.busyCode = code;
          const gstin = tagValue(block, 'GSTIN');
          if (gstin) record.gstin = gstin;
          records.push(record);
        }
      }
      return records;
    } catch (err) {
      throw classifyError(err);
    }
  }

  getCustomers(since) {
    return this.readInboundMasters('CUSTOMER', since);
  }
  getVendors(since) {
    return this.readInboundMasters('VENDOR', since);
  }
  getItems(since) {
    return this.readInboundMasters('ITEM', since);
  }

  // ── writing ───────────────────────────────────────────────────

  /**
   * Write one XML file into the outbox, named for its external reference.
   *
   * Three things make this safe across a network share:
   *  - the filename IS the idempotency key, so a resend cannot create a second
   *    file for the same event;
   *  - an existing file (or an existing ack) short-circuits to DUPLICATE
   *    instead of overwriting;
   *  - temp-file-then-rename within the same share keeps the write atomic from
   *    BUSY's point of view.
   */
  async dropFile(externalReference, xml) {
    assertSafeReference(externalReference);
    try {
      await fs.mkdir(this.opts.outbox, { recursive: true });

      const existing = await this.getTransactionStatus(externalReference);
      if (existing.status !== 'UNKNOWN') {
        return {
          ...existing,
          status: existing.status === 'ACCEPTED' || existing.status === 'POSTED' ? 'DUPLICATE' : existing.status,
          message: `External reference ${externalReference} has already been handed to BUSY.`,
        };
      }

      const target = path.join(this.opts.outbox, `${externalReference}.xml`);
      const temp = path.join(this.opts.outbox, `.${externalReference}.tmp`);
      await fs.writeFile(temp, xml, 'utf8');
      try {
        await fs.rename(temp, target);
      } catch (renameErr) {
        // Leave nothing half-written on the BUSY share if the rename fails.
        await fs.unlink(temp).catch(() => {});
        throw renameErr;
      }

      return {
        status: 'ACCEPTED',
        message: `Written to the BUSY import folder as ${externalReference}.xml. Awaiting BUSY import.`,
        raw: target,
      };
    } catch (err) {
      throw classifyError(err);
    }
  }

  createOrUpdateCustomer(c, ctx) {
    return this.dropFile(ctx.externalReference, customerToXml(c, ctx, this.opts.companyName));
  }
  createOrUpdateVendor(v, ctx) {
    return this.dropFile(ctx.externalReference, vendorToXml(v, ctx, this.opts.companyName));
  }
  createOrUpdateItem(i, ctx) {
    return this.dropFile(ctx.externalReference, itemToXml(i, ctx, this.opts.companyName));
  }
  sendSalesReference(d, ctx) {
    return this.dropFile(ctx.externalReference, salesReferenceToXml(d, ctx, this.opts.companyName));
  }
  sendPurchaseReference(d, ctx) {
    return this.dropFile(ctx.externalReference, purchaseReferenceToXml(d, ctx, this.opts.companyName));
  }
  sendDispatch(d, ctx) {
    return this.dropFile(ctx.externalReference, dispatchToXml(d, ctx, this.opts.companyName));
  }
  sendInvoice(d, ctx) {
    return this.dropFile(ctx.externalReference, invoiceToXml(d, ctx, this.opts.companyName));
  }

  // ── status / reconcile ────────────────────────────────────────

  async readAck(externalReference) {
    const ackPath = path.join(this.opts.ack, `${externalReference}.ack.xml`);
    try {
      return await fs.readFile(ackPath, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      throw classifyError(err);
    }
  }

  async getTransactionStatus(externalReference) {
    assertSafeReference(externalReference);
    try {
      const ack = await this.readAck(externalReference);
      if (ack) {
        const status = (tagValue(ack, 'STATUS') || '').toUpperCase();
        const busyReference = tagValue(ack, 'BUSYREFERENCE') || tagValue(ack, 'VOUCHERID');
        const message = tagValue(ack, 'MESSAGE');

        if (status === 'SUCCESS' || status === 'POSTED' || status === 'IMPORTED') {
          const result = { status: 'POSTED', raw: ack };
          if (busyReference) result.busyReference = busyReference;
          const busyCode = tagValue(ack, 'BUSYCODE');
          if (busyCode) result.busyCode = busyCode;
          if (message) result.message = message;
          return result;
        }
        if (status === 'DUPLICATE') {
          const result = { status: 'DUPLICATE', raw: ack };
          if (busyReference) result.busyReference = busyReference;
          if (message) result.message = message;
          return result;
        }
        // Anything else in an ack file is a rejection. BUSY told us why; carry
        // that verbatim rather than paraphrasing it.
        return {
          status: 'REJECTED',
          raw: ack,
          message: message || `BUSY reported status "${status || 'UNKNOWN'}" for ${externalReference}.`,
        };
      }

      // No ack yet. Is the file still sitting in the outbox awaiting import?
      const outboxPath = path.join(this.opts.outbox, `${externalReference}.xml`);
      try {
        await fs.access(outboxPath);
        return { status: 'ACCEPTED', message: 'Handed to BUSY; not yet imported.' };
      } catch {
        // Neither an ack nor an outbox file. Check the archive: BUSY may have
        // collected and tidied it away.
        const archivePath = path.join(this.opts.archive, `${externalReference}.xml`);
        try {
          await fs.access(archivePath);
          return {
            status: 'ACCEPTED',
            message: 'File was collected by BUSY but no acknowledgement has been written yet.',
          };
        } catch {
          return { status: 'UNKNOWN', message: `BUSY has no record of ${externalReference}.` };
        }
      }
    } catch (err) {
      throw classifyError(err);
    }
  }

  async reconcileTransaction(externalReference) {
    assertSafeReference(externalReference);
    const ack = await this.readAck(externalReference);
    if (!ack) return null;

    const lines = tagBlocks(ack, 'ITEM')
      .map((block) => {
        const busyItemId = tagValue(block, 'ITEMID') || tagValue(block, 'ITEMCODE');
        const quantity = tagNumber(block, 'QTY');
        if (!busyItemId || quantity === undefined) return null;
        const line = { busyItemId, quantity };
        const amount = tagNumber(block, 'AMOUNT');
        if (amount !== undefined) line.amount = amount;
        return line;
      })
      .filter((l) => l !== null);

    const snapshot = { externalReference };
    const busyReference = tagValue(ack, 'BUSYREFERENCE') || tagValue(ack, 'VOUCHERID');
    if (busyReference) snapshot.busyReference = busyReference;
    const documentNumber = tagValue(ack, 'VOUCHERNO');
    if (documentNumber) snapshot.documentNumber = documentNumber;
    const documentDate = tagValue(ack, 'DATE');
    if (documentDate) snapshot.documentDate = documentDate;
    const partyBusyId = tagValue(ack, 'PARTYID');
    if (partyBusyId) snapshot.partyBusyId = partyBusyId;
    const totalAmount = tagNumber(ack, 'TOTALAMOUNT');
    if (totalAmount !== undefined) snapshot.totalAmount = totalAmount;

    if (lines.length > 0) {
      snapshot.lines = lines;
      snapshot.totalQuantity = lines.reduce((s, l) => s + l.quantity, 0);
    } else {
      const totalQuantity = tagNumber(ack, 'TOTALQTY');
      if (totalQuantity !== undefined) snapshot.totalQuantity = totalQuantity;
    }
    return snapshot;
  }
}

module.exports = { BusyXmlFileAdapter };
