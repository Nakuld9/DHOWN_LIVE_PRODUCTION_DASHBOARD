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

    // Per-line commercial fields (optional — filled only for sale / job-work dispatches)
    await client.query(`
      ALTER TABLE dispatch_items
        ADD COLUMN IF NOT EXISTS rate_per_kg   NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS gst_rate      NUMERIC(5,2),
        ADD COLUMN IF NOT EXISTS taxable_value NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS gst_amount    NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS line_total    NUMERIC(12,2)
    `);

    // Challan-level totals
    await client.query(`
      ALTER TABLE dispatch_challans
        ADD COLUMN IF NOT EXISTS total_taxable_value NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS total_gst           NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS grand_total         NUMERIC(12,2)
    `);

    await client.query('COMMIT');
    console.log('Migration complete: pricing fields on dispatch_items + totals on dispatch_challans');
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
