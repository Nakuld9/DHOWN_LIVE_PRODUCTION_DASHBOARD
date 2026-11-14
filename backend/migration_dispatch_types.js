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

    // 1. dispatch_type on challans
    await client.query(`
      ALTER TABLE dispatch_challans
        ADD COLUMN IF NOT EXISTS dispatch_type VARCHAR(20) DEFAULT 'FG',
        ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(50)
    `);
    await client.query(`UPDATE dispatch_challans SET dispatch_type='FG' WHERE dispatch_type IS NULL`);

    // 2. Extend dispatch_items to support greige rolls and yarn lots
    await client.query(`
      ALTER TABLE dispatch_items
        ALTER COLUMN fg_id DROP NOT NULL
    `);
    await client.query(`
      ALTER TABLE dispatch_items
        ADD COLUMN IF NOT EXISTS item_type        VARCHAR(20) DEFAULT 'FG',
        ADD COLUMN IF NOT EXISTS roll_id          INTEGER,
        ADD COLUMN IF NOT EXISTS lot_id           INTEGER,
        ADD COLUMN IF NOT EXISTS item_description VARCHAR(300),
        ADD COLUMN IF NOT EXISTS lot_number       VARCHAR(100),
        ADD COLUMN IF NOT EXISTS yarn_type        VARCHAR(100),
        ADD COLUMN IF NOT EXISTS color            VARCHAR(100)
    `);
    await client.query(`UPDATE dispatch_items SET item_type='FG' WHERE item_type IS NULL`);

    await client.query('COMMIT');
    console.log('✅ Dispatch types migration complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
