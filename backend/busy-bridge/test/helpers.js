const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');

const { loadConfig } = require('../config');
const { Bridge } = require('../bridge');
const { InMemoryBusyAdapter } = require('../adapters/memoryAdapter');

/**
 * Tests run against a REAL PostgreSQL database, not a mock.
 *
 * The queue's safety properties (the UNIQUE index that enforces idempotency,
 * FOR UPDATE SKIP LOCKED that stops two workers claiming the same job) live in
 * the database. Mocking it would test nothing that matters.
 *
 * Point BUSY_TEST_DATABASE_URL at a scratch database. Each harness gets its
 * own schema so tests do not see each other's rows.
 */
const DATABASE_URL =
  process.env.BUSY_TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:55432/busy_bridge_test';

const MIGRATION = path.join(__dirname, '..', '..', '..', 'migration_phase11_busy_bridge.sql');

const tempDirs = [];
let schemaCounter = 0;

function tempDir(prefix = 'busy-bridge-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function cleanupTempDirs() {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

function testConfig(overrides = {}) {
  const dir = tempDir();
  return loadConfig({
    NODE_ENV: 'test',
    BUSY_ADAPTER: 'memory',
    BUSY_XML_OUTBOX: path.join(dir, 'outbox'),
    BUSY_XML_ACK: path.join(dir, 'ack'),
    BUSY_XML_INBOX: path.join(dir, 'inbox'),
    BUSY_XML_ARCHIVE: path.join(dir, 'archive'),
    BUSY_MAX_ATTEMPTS: '4',
    BUSY_RETRY_BASE_DELAY_MS: '1000',
    BUSY_RETRY_MAX_DELAY_MS: '60000',
    BUSY_QUEUE_BATCH_SIZE: '10',
    BUSY_RECONCILE_INTERVAL_MS: '0',
    ...overrides,
  });
}

const QUIET = { log() {}, warn() {}, error() {} };

/**
 * Build a bridge backed by its own PostgreSQL schema.
 * Always close() it — an open pool keeps the test process alive.
 */
async function makeBridge(overrides = {}) {
  schemaCounter += 1;
  const schema = `busy_test_${process.pid}_${schemaCounter}`;

  // search_path is set as a libpq connection option rather than in a 'connect'
  // handler: the handler's query races the first real query on the same
  // client, which pg warns about and which would leave some connections
  // pointing at the wrong schema.
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: `-c search_path=${schema}` });

  const admin = new Pool({ connectionString: DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  await admin.query(`SET search_path TO ${schema}; ${sql}`);
  await admin.end();

  const busy = new InMemoryBusyAdapter();
  const bridge = new Bridge(testConfig(overrides), pool, busy, QUIET);

  return {
    bridge,
    busy,
    pool,
    schema,
    async close() {
      const cleanup = new Pool({ connectionString: DATABASE_URL, max: 1 });
      await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
      await cleanup.end();
      await pool.end();
    },
  };
}

// ── fixtures ───────────────────────────────────────────────────

const customer = (over = {}) => ({
  dhownId: 'CUST-00042',
  name: 'Verma Textiles Pvt Ltd',
  code: 'CUST-00042',
  gstin: '03AABCV1234D1Z5',
  email: 'accounts@vermatextiles.example',
  phone: '+91 98765 43210',
  billingAddress: { line1: 'Plot 14, Focal Point', city: 'Ludhiana', state: 'Punjab', stateCode: '03', pincode: '141003' },
  creditDays: 30,
  ...over,
});

const vendor = (over = {}) => ({
  dhownId: 'VEND-00007',
  name: 'Nahar Yarns',
  gstin: '03AAACN1234F1Z2',
  ...over,
});

const item = (over = {}) => ({
  dhownId: 'FC-00125',
  name: 'Cotton Fleece 240 GSM',
  code: 'FC-00125',
  unit: 'MTR',
  hsnCode: '60063200',
  gstRate: 5,
  ...over,
});

const dispatch = (over = {}) => ({
  dhownId: 'DSP-91',
  documentNumber: 'DH-DSP-00091',
  documentDate: '2026-09-16',
  fiscalYear: '2026',
  customerDhownId: 'CUST-00042',
  lines: [{ itemDhownId: 'FC-00125', quantity: 500, unit: 'MTR', rate: 180, amount: 90000 }],
  vehicleNumber: 'PB10AB1234',
  ...over,
});

const invoice = (over = {}) => ({
  dhownId: 'INV-91',
  documentNumber: 'DH-INV-00091',
  documentDate: '2026-09-16',
  fiscalYear: '2026',
  customerDhownId: 'CUST-00042',
  dispatchDhownId: 'DSP-91',
  lines: [{ itemDhownId: 'FC-00125', quantity: 500, unit: 'MTR', rate: 180, amount: 90000 }],
  taxableAmount: 90000,
  taxAmount: 4500,
  totalAmount: 94500,
  ...over,
});

/** Map the fixtures' masters so document tests focus on the document. */
async function seedMappings(h) {
  await h.bridge.mappings.setManualMapping('CUSTOMER', 'CUST-00042', 'BUSY-CUST-11', 'VERMA');
  await h.bridge.mappings.setManualMapping('VENDOR', 'VEND-00007', 'BUSY-VEND-04', 'NAHAR');
  await h.bridge.mappings.setManualMapping('ITEM', 'FC-00125', 'BUSY-ITEM-4587', 'BUSY-4587');
}

module.exports = { makeBridge, testConfig, tempDir, cleanupTempDirs, customer, vendor, item, dispatch, invoice, seedMappings, QUIET };
