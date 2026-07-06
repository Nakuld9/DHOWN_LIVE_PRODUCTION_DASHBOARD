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

    const cols = [
      ['yarn_lots', 'source'],
      ['rolls', 'source'],
      ['subcontract_challans', 'source'],
      ['finished_goods', 'source'],
      ['yarn_issues', 'source'],
    ];

    for (const [table, col] of cols) {
      const check = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [table, col]);
      if (!check.rows.length) {
        await client.query(`ALTER TABLE ${table} ADD COLUMN ${col} VARCHAR(20) DEFAULT 'REGULAR'`);
        console.log(`Added ${col} to ${table}`);
      } else {
        console.log(`${table}.${col} already exists`);
      }
    }

    await client.query('COMMIT');
    console.log('Migration complete');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', e.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
