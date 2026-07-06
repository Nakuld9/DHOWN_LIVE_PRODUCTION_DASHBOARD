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

    // SC receipt: vendor invoice tracking
    await client.query(`
      ALTER TABLE subcontract_receipts
        ADD COLUMN IF NOT EXISTS vendor_invoice_no VARCHAR(100),
        ADD COLUMN IF NOT EXISTS vendor_bill_amount NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'PENDING'
    `);

    // Yarn lots: per-lot low stock threshold (kg)
    await client.query(`
      ALTER TABLE yarn_lots
        ADD COLUMN IF NOT EXISTS low_stock_threshold_kg NUMERIC(10,3)
    `);

    await client.query('COMMIT');
    console.log('Migration complete: SC invoice fields + low_stock_threshold_kg');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
