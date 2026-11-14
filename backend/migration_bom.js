const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'dhown_mes',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS bom_lines (
        bom_line_id   SERIAL PRIMARY KEY,
        fabric_item_id INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
        yarn_item_id   INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
        percentage     NUMERIC(6,2) NOT NULL CHECK (percentage > 0 AND percentage <= 100),
        sort_order     INTEGER DEFAULT 0,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        updated_at     TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(fabric_item_id, yarn_item_id)
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_bom_fabric ON bom_lines(fabric_item_id);`);

    await client.query('COMMIT');
    console.log('Migration complete: bom_lines table created');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', e.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
