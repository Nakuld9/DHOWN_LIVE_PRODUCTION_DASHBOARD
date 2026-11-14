require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'dhown_mes',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'dhown123',
});

async function run() {
  const client = await pool.connect();
  try {
    // 1. GRN (Goods Receipt Notes) — yarn coming from suppliers
    await client.query(`
      CREATE TABLE IF NOT EXISTS grn (
        grn_id          SERIAL PRIMARY KEY,
        grn_number      VARCHAR(40) UNIQUE NOT NULL,
        supplier_name   VARCHAR(150) NOT NULL,
        supplier_invoice VARCHAR(100),
        receipt_date    DATE NOT NULL DEFAULT CURRENT_DATE,
        vehicle_number  VARCHAR(50),
        received_by     VARCHAR(80),
        status          VARCHAR(20) DEFAULT 'DRAFT',
        qr_image        TEXT,
        notes           TEXT,
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('grn table ready');

    // 2. Yarn lots — individual lots within a GRN
    await client.query(`
      CREATE TABLE IF NOT EXISTS yarn_lots (
        lot_id          SERIAL PRIMARY KEY,
        lot_number      VARCHAR(40) UNIQUE NOT NULL,
        grn_id          INTEGER NOT NULL REFERENCES grn(grn_id) ON DELETE CASCADE,
        yarn_type       VARCHAR(100) NOT NULL,
        count           VARCHAR(30),
        color           VARCHAR(80) DEFAULT 'Grey',
        supplier_lot_no VARCHAR(80),
        gross_weight_kg NUMERIC(10,3) NOT NULL,
        net_weight_kg   NUMERIC(10,3) NOT NULL,
        cones           INTEGER DEFAULT 0,
        rate_per_kg     NUMERIC(10,2),
        current_stock_kg NUMERIC(10,3) DEFAULT 0,
        status          VARCHAR(20) DEFAULT 'IN_STORE',
        location        VARCHAR(100),
        qr_image        TEXT,
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('yarn_lots table ready');

    // 3. Yarn lot movements — every stock change
    await client.query(`
      CREATE TABLE IF NOT EXISTS yarn_lot_movements (
        movement_id   SERIAL PRIMARY KEY,
        lot_id        INTEGER NOT NULL REFERENCES yarn_lots(lot_id),
        movement_type VARCHAR(30) NOT NULL,
        quantity_kg   NUMERIC(10,3) NOT NULL,
        before_kg     NUMERIC(10,3),
        after_kg      NUMERIC(10,3),
        reference_id  INTEGER,
        reference_type VARCHAR(30),
        notes         TEXT,
        created_by    VARCHAR(80),
        created_at    TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('yarn_lot_movements table ready');

    // 4. Yarn issues — issue slips to machines
    await client.query(`
      CREATE TABLE IF NOT EXISTS yarn_issues (
        issue_id      SERIAL PRIMARY KEY,
        issue_number  VARCHAR(40) UNIQUE NOT NULL,
        issue_date    DATE NOT NULL DEFAULT CURRENT_DATE,
        machine_id    INTEGER,
        machine_name  VARCHAR(100),
        issued_by     VARCHAR(80),
        received_by   VARCHAR(80),
        status        VARCHAR(20) DEFAULT 'ISSUED',
        notes         TEXT,
        created_at    TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('yarn_issues table ready');

    // 5. Yarn issue items
    await client.query(`
      CREATE TABLE IF NOT EXISTS yarn_issue_items (
        item_id      SERIAL PRIMARY KEY,
        issue_id     INTEGER NOT NULL REFERENCES yarn_issues(issue_id) ON DELETE CASCADE,
        lot_id       INTEGER NOT NULL REFERENCES yarn_lots(lot_id),
        issued_kg    NUMERIC(10,3) NOT NULL,
        returned_kg  NUMERIC(10,3) DEFAULT 0,
        consumed_kg  NUMERIC(10,3) GENERATED ALWAYS AS (issued_kg - returned_kg) STORED
      );
    `);
    console.log('yarn_issue_items table ready');

    // 6. Finishing records — dyeing/finishing details after subcontract receipt
    await client.query(`
      CREATE TABLE IF NOT EXISTS finishing_records (
        finishing_id   SERIAL PRIMARY KEY,
        receipt_id     INTEGER REFERENCES subcontract_receipts(receipt_id),
        batch_id       INTEGER REFERENCES batches(batch_id),
        shade          VARCHAR(80),
        gsm            NUMERIC(8,2),
        moisture_pct   NUMERIC(5,2),
        shrinkage_pct  NUMERIC(5,2),
        damage_kg      NUMERIC(10,3) DEFAULT 0,
        qa_passed      BOOLEAN DEFAULT TRUE,
        qa_notes       TEXT,
        finished_by    VARCHAR(80),
        finished_at    TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('finishing_records table ready');

    // 7. ALTER rolls — add inventory linkage columns
    await client.query(`ALTER TABLE rolls ADD COLUMN IF NOT EXISTS lot_id INTEGER REFERENCES yarn_lots(lot_id);`);
    await client.query(`ALTER TABLE rolls ADD COLUMN IF NOT EXISTS issue_id INTEGER REFERENCES yarn_issues(issue_id);`);
    await client.query(`ALTER TABLE rolls ADD COLUMN IF NOT EXISTS gsm NUMERIC(8,2);`);
    await client.query(`ALTER TABLE rolls ADD COLUMN IF NOT EXISTS width_cm NUMERIC(6,2);`);
    await client.query(`ALTER TABLE rolls ADD COLUMN IF NOT EXISTS qr_image TEXT;`);
    console.log('rolls columns added');

    // 8. ALTER batches — add QR
    await client.query(`ALTER TABLE batches ADD COLUMN IF NOT EXISTS qr_image TEXT;`);
    console.log('batches.qr_image added');

    // 9. ALTER subcontract_receipts — add QC details
    await client.query(`ALTER TABLE subcontract_receipts ADD COLUMN IF NOT EXISTS shade VARCHAR(80);`);
    await client.query(`ALTER TABLE subcontract_receipts ADD COLUMN IF NOT EXISTS gsm NUMERIC(8,2);`);
    await client.query(`ALTER TABLE subcontract_receipts ADD COLUMN IF NOT EXISTS moisture_pct NUMERIC(5,2);`);
    await client.query(`ALTER TABLE subcontract_receipts ADD COLUMN IF NOT EXISTS damage_kg NUMERIC(10,3) DEFAULT 0;`);
    console.log('subcontract_receipts columns added');

    // 10. ALTER dispatch_challans — add transport details
    await client.query(`ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(50);`);
    await client.query(`ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS driver_name VARCHAR(100);`);
    await client.query(`ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(80);`);
    await client.query(`ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS gate_pass_number VARCHAR(80);`);
    console.log('dispatch_challans columns added');

    // 11. Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_grn_date ON grn(receipt_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_grn_status ON grn(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_yarn_lots_grn ON yarn_lots(grn_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_yarn_lots_status ON yarn_lots(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_lot ON yarn_lot_movements(lot_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_issues_machine ON yarn_issues(machine_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_issue_items_issue ON yarn_issue_items(issue_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_issue_items_lot ON yarn_issue_items(lot_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rolls_lot ON rolls(lot_id);`);
    console.log('Indexes created');

    console.log('\nInventory v2 migration complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
