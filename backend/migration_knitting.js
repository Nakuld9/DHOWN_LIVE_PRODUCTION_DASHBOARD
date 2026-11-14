const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'dhown_mes',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Make batch_id nullable on subcontract_challans (knitting challans have no batch)
    await client.query(`
      ALTER TABLE subcontract_challans
        ALTER COLUMN batch_id DROP NOT NULL
    `);

    // 2. Add challan_type and job_work fields
    await client.query(`
      ALTER TABLE subcontract_challans
        ADD COLUMN IF NOT EXISTS challan_type   VARCHAR(20)  DEFAULT 'ROLL_BASED',
        ADD COLUMN IF NOT EXISTS is_job_work    BOOLEAN      DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS customer_name  VARCHAR(200)
    `);

    // 3. Mark existing challans as ROLL_BASED
    await client.query(`
      UPDATE subcontract_challans SET challan_type='ROLL_BASED' WHERE challan_type IS NULL
    `);

    // 4. Table for yarn lots sent on knitting challans
    await client.query(`
      CREATE TABLE IF NOT EXISTS sc_challan_yarn_items (
        item_id         SERIAL PRIMARY KEY,
        challan_id      INTEGER NOT NULL REFERENCES subcontract_challans(challan_id) ON DELETE CASCADE,
        lot_id          INTEGER REFERENCES yarn_lots(lot_id),
        lot_number      VARCHAR(50),
        yarn_type       VARCHAR(100),
        color           VARCHAR(100),
        sent_kg         NUMERIC(10,3) NOT NULL,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 5. Add knitting receipt fields to subcontract_receipts
    await client.query(`
      ALTER TABLE subcontract_receipts
        ADD COLUMN IF NOT EXISTS rolls_received_count   INTEGER     DEFAULT 0,
        ADD COLUMN IF NOT EXISTS balance_yarn_kg        NUMERIC(10,3) DEFAULT 0
    `);

    await client.query('COMMIT');
    console.log('✅ Knitting migration complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
