// ERP Phase 1: Additive FK columns + Unified Stock Ledger
// Idempotent — safe to run multiple times
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Additive FK columns on existing tables ──────────────
    // grn
    await client.query(`ALTER TABLE grn ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES partners(partner_id)`);
    await client.query(`ALTER TABLE grn ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(warehouse_id)`);

    // yarn_lots
    await client.query(`ALTER TABLE yarn_lots ADD COLUMN IF NOT EXISTS item_id INTEGER REFERENCES items(item_id)`);
    await client.query(`ALTER TABLE yarn_lots ADD COLUMN IF NOT EXISTS bin_id INTEGER REFERENCES bins(bin_id)`);

    // yarn_issues
    await client.query(`ALTER TABLE yarn_issues ADD COLUMN IF NOT EXISTS cost_centre_id INTEGER REFERENCES cost_centres(cc_id)`);

    // subcontract_challans
    await client.query(`ALTER TABLE subcontract_challans ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES partners(partner_id)`);

    // dispatch_challans
    await client.query(`ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES partners(partner_id)`);

    // rolls: add UUID for permanent traceability
    await client.query(`ALTER TABLE rolls ADD COLUMN IF NOT EXISTS roll_uuid UUID DEFAULT gen_random_uuid()`);

    // cost_rates: link to items
    await client.query(`ALTER TABLE cost_rates ADD COLUMN IF NOT EXISTS item_id INTEGER REFERENCES items(item_id)`);

    // ── Unified Stock Ledger ────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_ledger (
        ledger_id     BIGSERIAL PRIMARY KEY,
        txn_date      DATE NOT NULL DEFAULT CURRENT_DATE,
        txn_time      TIMESTAMP DEFAULT NOW(),
        doc_type      VARCHAR(30) NOT NULL,
        doc_id        VARCHAR(100) NOT NULL,
        item_id       INTEGER REFERENCES items(item_id),
        item_desc     VARCHAR(200),
        warehouse_id  INTEGER REFERENCES warehouses(warehouse_id),
        rack_id       INTEGER REFERENCES racks(rack_id),
        bin_id        INTEGER REFERENCES bins(bin_id),
        movement_type VARCHAR(20) NOT NULL,
        quantity      NUMERIC(12,3) NOT NULL,
        uom_code      VARCHAR(20) DEFAULT 'KG',
        unit_cost     NUMERIC(15,2),
        total_cost    NUMERIC(15,2),
        partner_id    INTEGER REFERENCES partners(partner_id),
        notes         TEXT,
        created_by    VARCHAR(80),
        created_at    TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_sl_doc    ON stock_ledger(doc_type, doc_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sl_item   ON stock_ledger(item_id, txn_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sl_wh     ON stock_ledger(warehouse_id, txn_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sl_date   ON stock_ledger(txn_date)`);

    await client.query('COMMIT');
    console.log('✅ Phase 1: Additive FKs + stock_ledger created');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Phase 1 failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
