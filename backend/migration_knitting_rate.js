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

    // Add knitting_rate_per_kg to items
    await client.query(`
      ALTER TABLE items
        ADD COLUMN IF NOT EXISTS knitting_rate_per_kg NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS standard_loss_pct    NUMERIC(5,2) DEFAULT 1.00
    `);

    // Add fabric_item_id to rolls so we can look up the item's knitting rate
    await client.query(`
      ALTER TABLE rolls
        ADD COLUMN IF NOT EXISTS fabric_item_id INTEGER REFERENCES items(item_id)
    `);

    // cost_entries: add cost_component index for faster queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cost_entries_component ON cost_entries(cost_component)
    `);

    await client.query('COMMIT');
    console.log('Migration complete: knitting_rate_per_kg + standard_loss_pct on items, fabric_item_id on rolls');
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
