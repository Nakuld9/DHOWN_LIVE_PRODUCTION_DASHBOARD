const { after, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { makeBridge, testConfig, tempDir, cleanupTempDirs, dispatch, customer, seedMappings } = require('./helpers');
const { BusyXmlFileAdapter } = require('../adapters/xmlFileAdapter');
const { InMemoryBusyAdapter } = require('../adapters/memoryAdapter');
const { createAdapter } = require('../adapters');
const { buildExternalReference, deriveSequence, parseExternalReference } = require('../externalRef');
const { redactedConfig, resolveExchangePath } = require('../config');
const { BridgeError, classifyError } = require('../errors');
const { dispatchToXml, esc } = require('../transform/busyXml');
const { Bridge } = require('../bridge');

after(cleanupTempDirs);

// ───────────────────────────────────────────────────────────────

describe('Idempotency keys', () => {
  it('derives a stable reference from the document number', () => {
    const a = buildExternalReference('DISPATCH', 'DH-DSP-00091', '2026');
    assert.equal(a, 'DHOWN-DISPATCH-2026-000091');
    assert.equal(a, buildExternalReference('DISPATCH', 'DH-DSP-00091', '2026'));
  });

  it('distinguishes documents that differ only in sequence', () => {
    assert.notEqual(
      buildExternalReference('DISPATCH', 'DH-DSP-00091', '2026'),
      buildExternalReference('DISPATCH', 'DH-DSP-00092', '2026'),
    );
  });

  it('takes the last numeric group so year-bearing numbers still work', () => {
    assert.equal(deriveSequence('DH/INV/2026/0042'), '000042');
  });

  it('refuses a document number it cannot key deterministically', () => {
    assert.throws(() => buildExternalReference('DISPATCH', 'DISPATCH-NOTE', '2026'), /no digits/);
  });

  it('round-trips through the parser', () => {
    const parsed = parseExternalReference('DHOWN-SALES_REFERENCE-2026-000091');
    assert.equal(parsed.entityType, 'SALES_REFERENCE');
    assert.equal(parsed.year, '2026');
    assert.equal(parsed.sequence, '000091');
  });
});

// ───────────────────────────────────────────────────────────────

describe('BUSY on a separate machine', () => {
  it('passes a UNC share path through untouched', () => {
    // BUSY runs on another PC, so the exchange folder is normally a UNC path.
    // path.resolve() would rewrite it relative to this process's cwd and the
    // bridge would silently write to the wrong disk.
    const unc = '\\\\BUSY-PC\\BusyExchange\\Outbox';
    assert.equal(resolveExchangePath(unc), unc);
  });

  it('passes a mapped drive letter through untouched', () => {
    assert.equal(resolveExchangePath('Z:\\BusyExchange\\Outbox'), 'Z:\\BusyExchange\\Outbox');
  });

  it('still resolves a plain relative path for local development', () => {
    assert.ok(path.isAbsolute(resolveExchangePath('./busy-exchange/outbox')));
  });

  it('reads an unreachable share as a retryable connection error', () => {
    // These are how a disconnected SMB share actually fails on Windows. If any
    // of them classified as UNKNOWN the queue would still retry, but a
    // misclassified EACCES would look like a permissions bug to the operator.
    for (const code of ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ENETDOWN', 'EIO', 'EHOSTUNREACH']) {
      const classified = classifyError(Object.assign(new Error('share gone'), { code }));
      assert.equal(classified.code, 'CONNECTION_ERROR', `${code} must be a connection error`);
      assert.equal(classified.retryable, true, `${code} must be retryable`);
    }
  });
});

// ───────────────────────────────────────────────────────────────

describe('BUSY XML file adapter', () => {
  function xmlAdapter() {
    const dir = tempDir('busy-xml-');
    const opts = {
      outbox: path.join(dir, 'outbox'),
      ack: path.join(dir, 'ack'),
      inbox: path.join(dir, 'inbox'),
      archive: path.join(dir, 'archive'),
      companyName: 'DHOWN',
      hostLabel: 'BUSY-PC',
    };
    return { adapter: new BusyXmlFileAdapter(opts), opts };
  }

  const ctx = {
    externalReference: 'DHOWN-DISPATCH-2026-000091',
    partyBusyId: 'BUSY-CUST-11',
    itemBusyIds: { 'FC-00125': { busyId: 'BUSY-ITEM-4587', busyCode: 'BUSY-4587' } },
    attempt: 1,
  };

  it('reports online only when the exchange folder is really writable', async () => {
    const { adapter } = xmlAdapter();
    const status = await adapter.testConnection();
    assert.equal(status.online, true);
    assert.equal(status.detail.host, 'BUSY-PC');
  });

  it('reports offline when the BUSY share is unreachable', async () => {
    const adapter = new BusyXmlFileAdapter({
      // A path under a regular file can never be created: stands in for an
      // unmounted share on the BUSY PC.
      outbox: '/dev/null/outbox',
      ack: '/dev/null/ack',
      inbox: '/dev/null/inbox',
      archive: '/dev/null/archive',
      companyName: 'DHOWN',
      hostLabel: 'BUSY-PC',
    });
    const status = await adapter.testConnection();
    assert.equal(status.online, false);
    assert.match(status.message, /not reachable/i);
  });

  it('writes the voucher under its external reference and reports ACCEPTED, not POSTED', async () => {
    const { adapter, opts } = xmlAdapter();
    await adapter.testConnection();
    const result = await adapter.sendDispatch(dispatch(), ctx);

    // The hand-off is asynchronous: claiming POSTED here would put a reference
    // into the dashboard that BUSY has not issued.
    assert.equal(result.status, 'ACCEPTED');
    assert.equal(result.busyReference, undefined);

    const written = fs.readFileSync(path.join(opts.outbox, `${ctx.externalReference}.xml`), 'utf8');
    assert.match(written, /<VOUCHERTYPE>Delivery Challan<\/VOUCHERTYPE>/);
    assert.match(written, /<EXTERNALREFERENCE>DHOWN-DISPATCH-2026-000091<\/EXTERNALREFERENCE>/);
    // The BUSY item id must appear, never the DHOWN one.
    assert.match(written, /<ITEMID>BUSY-ITEM-4587<\/ITEMID>/);
    assert.ok(!written.includes('<ITEMID>FC-00125</ITEMID>'));
    // No partial temp files left on the BUSY share.
    assert.deepEqual(fs.readdirSync(opts.outbox).filter((f) => f.startsWith('.')), []);
  });

  it('carries no production data into BUSY', async () => {
    const { adapter, opts } = xmlAdapter();
    await adapter.testConnection();
    await adapter.sendDispatch(
      dispatch({ lines: [{ itemDhownId: 'FC-00125', quantity: 500, unit: 'MTR', rate: 180, remark: 'Rolls R-1121' }] }),
      ctx,
    );
    const written = fs.readFileSync(path.join(opts.outbox, `${ctx.externalReference}.xml`), 'utf8');

    // Roll numbers may ride along as a printed remark, but no machine,
    // shift, operator or WIP field may ever appear.
    assert.match(written, /Rolls R-1121/);
    for (const f of ['MACHINE', 'SHIFT', 'OPERATOR', 'OEE', 'DOWNTIME', 'WIP']) {
      assert.ok(!written.toUpperCase().includes(`<${f}`), `${f} must not be sent to BUSY`);
    }
  });

  it('refuses to write a second file for the same external reference', async () => {
    const { adapter, opts } = xmlAdapter();
    await adapter.testConnection();
    await adapter.sendDispatch(dispatch(), ctx);
    const second = await adapter.sendDispatch(dispatch(), ctx);

    assert.equal(second.status, 'DUPLICATE');
    assert.equal(fs.readdirSync(opts.outbox).filter((f) => f.endsWith('.xml')).length, 1);
  });

  it('reads the BUSY reference back out of an acknowledgement', async () => {
    const { adapter, opts } = xmlAdapter();
    await adapter.testConnection();
    await adapter.sendDispatch(dispatch(), ctx);

    fs.writeFileSync(
      path.join(opts.ack, `${ctx.externalReference}.ack.xml`),
      `<?xml version="1.0"?><ACK><STATUS>SUCCESS</STATUS><BUSYREFERENCE>DC/2026-27/00318</BUSYREFERENCE>
       <VOUCHERNO>DH-DSP-00091</VOUCHERNO><PARTYID>BUSY-CUST-11</PARTYID>
       <ITEMS><ITEM><ITEMID>BUSY-ITEM-4587</ITEMID><QTY>500</QTY><AMOUNT>90000</AMOUNT></ITEM></ITEMS>
       <TOTALAMOUNT>90000</TOTALAMOUNT></ACK>`,
      'utf8',
    );

    const status = await adapter.getTransactionStatus(ctx.externalReference);
    assert.equal(status.status, 'POSTED');
    assert.equal(status.busyReference, 'DC/2026-27/00318');

    const snapshot = await adapter.reconcileTransaction(ctx.externalReference);
    assert.equal(snapshot.totalQuantity, 500);
    assert.equal(snapshot.lines[0].busyItemId, 'BUSY-ITEM-4587');
  });

  it('surfaces a BUSY rejection verbatim instead of guessing', async () => {
    const { adapter, opts } = xmlAdapter();
    await adapter.testConnection();
    fs.writeFileSync(
      path.join(opts.ack, `${ctx.externalReference}.ack.xml`),
      '<ACK><STATUS>ERROR</STATUS><MESSAGE>Item code BUSY-4587 does not exist</MESSAGE></ACK>',
      'utf8',
    );
    const status = await adapter.getTransactionStatus(ctx.externalReference);
    assert.equal(status.status, 'REJECTED');
    assert.equal(status.message, 'Item code BUSY-4587 does not exist');
  });

  it('says UNKNOWN when BUSY has never seen the reference', async () => {
    const { adapter } = xmlAdapter();
    await adapter.testConnection();
    assert.equal((await adapter.getTransactionStatus('DHOWN-DISPATCH-2026-999999')).status, 'UNKNOWN');
  });

  it('refuses a reference that would escape the exchange folder', async () => {
    const { adapter } = xmlAdapter();
    await adapter.testConnection();
    await assert.rejects(
      () => adapter.getTransactionStatus('../../etc/passwd'),
      (err) => err.code === 'VALIDATION_ERROR',
    );
  });

  it('escapes XML metacharacters in free text', () => {
    assert.equal(esc('Sharma & Co <"quoted">'), 'Sharma &amp; Co &lt;&quot;quoted&quot;&gt;');
    const xml = dispatchToXml(dispatch({ notes: 'Rate revised <urgent> & confirmed' }), ctx, 'DHOWN');
    assert.match(xml, /Rate revised &lt;urgent&gt; &amp; confirmed/);
    assert.ok(!xml.includes('<urgent>'));
  });

  it('declares an asynchronous send in its capabilities', () => {
    const { adapter } = xmlAdapter();
    assert.equal(adapter.capabilities().synchronousSend, false);
    assert.equal(adapter.capabilities().sendDispatch, true);
  });
});

// ───────────────────────────────────────────────────────────────

describe('Adapter replaceability', () => {
  it('refuses the in-memory test double in production', () => {
    assert.throws(
      () => createAdapter(testConfig({ NODE_ENV: 'production', BUSY_ADAPTER: 'memory' })),
      /must not be used in production/,
    );
  });

  it('requires a base URL before the REST gateway can be selected', () => {
    assert.throws(() => testConfig({ BUSY_ADAPTER: 'rest', BUSY_REST_BASE_URL: '' }), /BUSY_REST_BASE_URL/);
  });

  it('forbids writes when the gateway is read-only', () => {
    const adapter = createAdapter(
      testConfig({ BUSY_ADAPTER: 'rest', BUSY_REST_BASE_URL: 'https://gw.example', BUSY_REST_READ_ONLY: 'true' }),
    );
    const caps = adapter.capabilities();
    // Direct writes to BUSY's database bypass its posting, numbering, GST and
    // stock-valuation logic. The rule is enforced here, not left to config.
    assert.equal(caps.sendDispatch, false);
    assert.equal(caps.createOrUpdateCustomer, false);
    assert.equal(caps.getCustomers, true, 'reads stay available');
  });

  it('refuses an unsupported operation rather than faking it', async () => {
    const h = await makeBridge();
    try {
      h.busy.unsupported.add('sendDispatch');
      await seedMappings(h);
      const submitted = await h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      await h.bridge.drain();

      const queued = await h.bridge.queue.findById(submitted.queueId);
      assert.equal(queued.status, 'MANUAL_REVIEW');
      assert.equal(queued.errorCode, 'UNSUPPORTED_OPERATION');
      // Crucially: nothing was invented on the BUSY side.
      assert.equal(h.busy.transactions.size, 0);
    } finally {
      await h.close();
    }
  });

  it('completes the loop when an asynchronous hand-off is later acknowledged', async () => {
    const h = await makeBridge();
    try {
      h.busy.synchronous = false; // behave like the file-drop transport
      await seedMappings(h);
      const submitted = await h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      await h.bridge.drain();

      // Handed over, but not yet booked — the dashboard must not say otherwise.
      let queued = await h.bridge.queue.findById(submitted.queueId);
      assert.equal(queued.status, 'AWAITING_BUSY');
      assert.equal(queued.busyReference, null);

      // BUSY finishes its import.
      const reference = h.busy.completeAsync(submitted.externalReference);
      await h.bridge.sync.pollAwaitingBusy();

      queued = await h.bridge.queue.findById(submitted.queueId);
      assert.equal(queued.status, 'SUCCESS');
      assert.equal(queued.busyReference, reference);
    } finally {
      await h.close();
    }
  });
});

// ───────────────────────────────────────────────────────────────

describe('Error classification', () => {
  it('marks transport faults retryable and data faults not', () => {
    assert.equal(new BridgeError('CONNECTION_ERROR', 'x').retryable, true);
    assert.equal(new BridgeError('TIMEOUT', 'x').retryable, true);
    assert.equal(new BridgeError('VALIDATION_ERROR', 'x').retryable, false);
    assert.equal(new BridgeError('MASTER_MAPPING_ERROR', 'x').retryable, false);
    assert.equal(new BridgeError('DUPLICATE_ERROR', 'x').retryable, false);
    assert.equal(new BridgeError('AUTHENTICATION_ERROR', 'x').retryable, false);
  });

  it('never loses an unclassifiable failure', () => {
    const classified = classifyError(new Error('something odd'));
    assert.equal(classified.code, 'UNKNOWN_ERROR');
    assert.equal(classified.retryable, true, 'unknown failures get a bounded number of retries');
  });

  it('explains a mapping failure the way a supervisor needs it', () => {
    const err = new BridgeError('MASTER_MAPPING_ERROR', 'no mapping', { subject: 'FC-00125', entityType: 'ITEM' });
    const { reason, action } = err.explain();
    assert.equal(reason, 'DHOWN item "FC-00125" is not mapped to a BUSY item.');
    assert.match(action, /Map DHOWN item "FC-00125"/);
  });

  it('tells the operator to check the BUSY PC, not to panic, when it is offline', () => {
    const { action } = new BridgeError('CONNECTION_ERROR', 'share gone').explain();
    assert.match(action, /retried automatically/);
    assert.match(action, /BUSY PC/);
  });
});

// ───────────────────────────────────────────────────────────────

describe('Security', () => {
  it('never exposes BUSY credentials through the config view', () => {
    const config = testConfig({
      BUSY_ADAPTER: 'rest',
      BUSY_REST_BASE_URL: 'https://gw.example',
      BUSY_REST_API_KEY: 'super-secret-busy-key',
    });
    const view = JSON.stringify(redactedConfig(config));

    assert.ok(!view.includes('super-secret-busy-key'), 'the BUSY key must not be serialisable');
    assert.match(view, /"apiKeyConfigured":true/, 'operators still see that a key is set');
  });

  it('refuses an entity type that has not been enabled', async () => {
    const h = await makeBridge({ BUSY_ENABLED_ENTITY_TYPES: 'CUSTOMER,ITEM' });
    try {
      await assert.rejects(
        () => h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() }),
        (err) => err.code === 'VALIDATION_ERROR' && /not enabled/.test(err.message),
      );
    } finally {
      await h.close();
    }
  });

  it('will not let two DHOWN records claim the same BUSY ledger', async () => {
    const h = await makeBridge();
    try {
      await h.bridge.mappings.setManualMapping('CUSTOMER', 'CUST-00042', 'BUSY-CUST-11');
      await assert.rejects(
        () => h.bridge.mappings.setManualMapping('CUSTOMER', 'CUST-00099', 'BUSY-CUST-11'),
        /already mapped/,
      );
    } finally {
      await h.close();
    }
  });
});

// ───────────────────────────────────────────────────────────────

describe('Audit trail', () => {
  it('records every attempt, including the ones that failed', async () => {
    const h = await makeBridge();
    try {
      await seedMappings(h);
      const submitted = await h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });

      h.busy.failuresBeforeSuccess = 1;
      await h.bridge.processOne(submitted.queueId);
      h.busy.failuresBeforeSuccess = 0;
      await h.bridge.queue.requeueForManualRetry(submitted.queueId);
      await h.bridge.processOne(submitted.queueId, 'supervisor1');

      const entries = await h.bridge.audit.forQueueItem(submitted.queueId);
      const statuses = entries.map((e) => e.finalStatus);

      assert.ok(statuses.includes('QUEUED'));
      assert.ok(statuses.includes('RETRY'), 'the failure must survive in the trail');
      assert.ok(statuses.includes('SUCCESS'));

      const failure = entries.find((e) => e.finalStatus === 'RETRY');
      assert.equal(failure.errorCode, 'CONNECTION_ERROR');
      assert.ok(failure.payloadSnapshot, 'the payload we sent must be recoverable');

      const success = entries.find((e) => e.finalStatus === 'SUCCESS');
      assert.equal(success.actor, 'supervisor1', 'the trail must say who forced the retry');
      assert.ok(success.busyReference);
    } finally {
      await h.close();
    }
  });

  it('records a master sync against the mapping it created', async () => {
    const h = await makeBridge();
    try {
      const submitted = await h.bridge.submit({ entityType: 'CUSTOMER', payload: customer() });
      await h.bridge.drain();
      const entries = await h.bridge.audit.forExternalReference(submitted.externalReference);
      assert.ok(entries.some((e) => e.finalStatus === 'SUCCESS' && e.busyReference));
    } finally {
      await h.close();
    }
  });
});
