require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE INDEX IF NOT EXISTS idx_status_log_machine_date ON machine_status_log(machine_id, DATE(start_time), shift)`);
    console.log('✓ idx_status_log_machine_date');
    await client.query(`CREATE INDEX IF NOT EXISTS idx_downtime_machine_status ON machine_downtime(machine_id, status)`);
    console.log('✓ idx_downtime_machine_status');
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rfid_events_time ON rfid_events(event_time DESC)`);
    console.log('✓ idx_rfid_events_time');
    // Add unique constraint only if it doesn't exist
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_operators_code') THEN
          ALTER TABLE operators ADD CONSTRAINT uq_operators_code UNIQUE (operator_code);
        END IF;
      END $$;
    `);
    console.log('✓ uq_operators_code');
    console.log('\nMigration complete.');
  } catch (e) {
    console.error('Migration error:', e.message);
  } finally {
    client.release();
    pool.end();
  }
}

run();
