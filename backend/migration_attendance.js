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
    await client.query(`
      CREATE TABLE IF NOT EXISTS operator_attendance (
        attendance_id  SERIAL PRIMARY KEY,
        operator_id    VARCHAR(50) NOT NULL,
        operator_name  VARCHAR(100),
        work_date      DATE NOT NULL,
        shift          CHAR(1),
        clock_in       TIMESTAMP,
        clock_out      TIMESTAMP,
        last_seen      TIMESTAMP,
        scan_count     INTEGER DEFAULT 1,
        status         VARCHAR(20) DEFAULT 'PRESENT',
        created_at     TIMESTAMP DEFAULT NOW(),
        updated_at     TIMESTAMP DEFAULT NOW(),
        UNIQUE(operator_id, work_date, shift)
      );
    `);
    console.log('operator_attendance table created');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_attendance_date
        ON operator_attendance(work_date, shift);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_attendance_operator
        ON operator_attendance(operator_id, work_date);
    `);
    console.log('Indexes created');
  } finally {
    client.release();
    await pool.end();
  }
}

run().then(() => {
  console.log('Migration complete');
  process.exit(0);
}).catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
