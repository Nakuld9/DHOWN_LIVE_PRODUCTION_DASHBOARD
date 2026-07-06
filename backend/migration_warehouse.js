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
    // 1. Add warehouse_status to rolls
    await client.query(`
      ALTER TABLE rolls ADD COLUMN IF NOT EXISTS warehouse_status VARCHAR(30) DEFAULT 'GREIGE';
    `);
    // Backfill: approved rolls get GREIGE status
    await client.query(`
      UPDATE rolls SET warehouse_status = 'GREIGE' WHERE status = 'APPROVED' AND warehouse_status IS NULL;
    `);
    console.log('rolls.warehouse_status added');

    // 2. Batches
    await client.query(`
      CREATE TABLE IF NOT EXISTS batches (
        batch_id     SERIAL PRIMARY KEY,
        batch_number VARCHAR(30) UNIQUE NOT NULL,
        fabric_type  VARCHAR(50),
        color_code   VARCHAR(50),
        color_name   VARCHAR(100),
        total_weight_kg NUMERIC(10,3) DEFAULT 0,
        roll_count   INTEGER DEFAULT 0,
        status       VARCHAR(20) DEFAULT 'OPEN',
        notes        TEXT,
        created_by   VARCHAR(50),
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('batches table created');

    // 3. Batch rolls (roll_id is VARCHAR in rolls table)
    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_rolls (
        id         SERIAL PRIMARY KEY,
        batch_id   INTEGER NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
        roll_id    VARCHAR(100) NOT NULL,
        added_at   TIMESTAMP DEFAULT NOW(),
        added_by   VARCHAR(50),
        UNIQUE(roll_id)
      );
    `);
    console.log('batch_rolls table created');

    // 4. Subcontract challans
    await client.query(`
      CREATE TABLE IF NOT EXISTS subcontract_challans (
        challan_id           SERIAL PRIMARY KEY,
        challan_number       VARCHAR(30) UNIQUE NOT NULL,
        batch_id             INTEGER REFERENCES batches(batch_id),
        vendor_name          VARCHAR(100) NOT NULL,
        vendor_contact       VARCHAR(50),
        job_type             VARCHAR(30) NOT NULL,
        sent_date            DATE NOT NULL,
        expected_return_date DATE,
        sent_weight_kg       NUMERIC(10,3),
        roll_count           INTEGER DEFAULT 0,
        rate_per_kg          NUMERIC(10,2),
        status               VARCHAR(20) DEFAULT 'SENT',
        notes                TEXT,
        created_by           VARCHAR(50),
        created_at           TIMESTAMP DEFAULT NOW(),
        updated_at           TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('subcontract_challans table created');

    // 5. Subcontract receipts
    await client.query(`
      CREATE TABLE IF NOT EXISTS subcontract_receipts (
        receipt_id         SERIAL PRIMARY KEY,
        challan_id         INTEGER NOT NULL REFERENCES subcontract_challans(challan_id),
        received_date      DATE NOT NULL,
        received_weight_kg NUMERIC(10,3),
        quality_status     VARCHAR(20) DEFAULT 'PASS',
        rejected_weight_kg NUMERIC(10,3) DEFAULT 0,
        notes              TEXT,
        received_by        VARCHAR(50),
        created_at         TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('subcontract_receipts table created');

    // 6. Finished goods
    await client.query(`
      CREATE TABLE IF NOT EXISTS finished_goods (
        fg_id       SERIAL PRIMARY KEY,
        receipt_id  INTEGER REFERENCES subcontract_receipts(receipt_id),
        batch_id    INTEGER REFERENCES batches(batch_id),
        fabric_type VARCHAR(50),
        color_code  VARCHAR(50),
        color_name  VARCHAR(100),
        weight_kg   NUMERIC(10,3),
        roll_count  INTEGER DEFAULT 0,
        status      VARCHAR(20) DEFAULT 'IN_STOCK',
        location    VARCHAR(100),
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('finished_goods table created');

    // 7. Dispatch challans
    await client.query(`
      CREATE TABLE IF NOT EXISTS dispatch_challans (
        dispatch_id      SERIAL PRIMARY KEY,
        dispatch_number  VARCHAR(30) UNIQUE NOT NULL,
        customer_name    VARCHAR(100) NOT NULL,
        customer_contact VARCHAR(50),
        dispatch_date    DATE NOT NULL,
        total_weight_kg  NUMERIC(10,3) DEFAULT 0,
        status           VARCHAR(20) DEFAULT 'DISPATCHED',
        notes            TEXT,
        created_by       VARCHAR(50),
        created_at       TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('dispatch_challans table created');

    // 8. Dispatch items
    await client.query(`
      CREATE TABLE IF NOT EXISTS dispatch_items (
        item_id      SERIAL PRIMARY KEY,
        dispatch_id  INTEGER NOT NULL REFERENCES dispatch_challans(dispatch_id) ON DELETE CASCADE,
        fg_id        INTEGER NOT NULL REFERENCES finished_goods(fg_id),
        weight_kg    NUMERIC(10,3),
        fabric_type  VARCHAR(50),
        color_name   VARCHAR(100)
      );
    `);
    console.log('dispatch_items table created');

    // 9. Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_batch_rolls_batch ON batch_rolls(batch_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_challans_batch   ON subcontract_challans(batch_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_challans_status  ON subcontract_challans(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fg_status        ON finished_goods(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_dispatch_items   ON dispatch_items(dispatch_id);`);
    console.log('Indexes created');

    console.log('\nWarehouse migration complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
