// ERP Phase 0-A: Document Numbering Engine
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS doc_series (
        series_id    SERIAL PRIMARY KEY,
        series_code  VARCHAR(20) UNIQUE NOT NULL,
        prefix       VARCHAR(20) NOT NULL,
        suffix       VARCHAR(20) DEFAULT '',
        include_year BOOLEAN DEFAULT TRUE,
        include_month BOOLEAN DEFAULT FALSE,
        zero_pad     INTEGER DEFAULT 4,
        current_seq  INTEGER DEFAULT 0,
        fin_year     VARCHAR(9),
        reset_yearly BOOLEAN DEFAULT TRUE,
        last_reset   DATE,
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW()
      )
    `);

    // Seed existing series — ON CONFLICT DO NOTHING so re-runs are safe
    const series = [
      ['GRN',   'GRN',   '',  true,  false, 4, true],
      ['LOT',   'LOT',   '',  true,  false, 4, true],
      ['ISS',   'ISS',   '',  true,  false, 4, true],
      ['BATCH', 'BATCH', '',  true,  false, 4, true],
      ['SC',    'SC',    '',  true,  false, 4, true],
      ['DC',    'DC',    '',  true,  false, 4, true],
      ['ITEM',  'ITM',   '',  false, false, 5, false],
      ['PART',  'PART',  '',  false, false, 5, false],
      ['PO',    'PO',    '',  true,  false, 4, true],
    ];

    for (const [code, prefix, suffix, inc_year, inc_month, pad, reset] of series) {
      await client.query(`
        INSERT INTO doc_series (series_code, prefix, suffix, include_year, include_month, zero_pad, reset_yearly)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (series_code) DO NOTHING
      `, [code, prefix, suffix, inc_year, inc_month, pad, reset]);
    }

    await client.query('COMMIT');
    console.log('✅ Phase 0-A: doc_series table created and seeded');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Phase 0-A failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
