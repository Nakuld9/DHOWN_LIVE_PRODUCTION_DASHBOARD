require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS maintenance_schedule (
        schedule_id     SERIAL PRIMARY KEY,
        machine_id      VARCHAR(20) NOT NULL REFERENCES machines(machine_id),
        task_name       VARCHAR(200) NOT NULL,
        task_type       VARCHAR(50) NOT NULL DEFAULT 'PERIODIC',
        frequency_days  INTEGER,
        frequency_hours INTEGER,
        last_done_date  DATE,
        last_done_hours NUMERIC(10,2),
        next_due_date   DATE,
        next_due_hours  NUMERIC(10,2),
        assigned_to     VARCHAR(100),
        priority        VARCHAR(20) DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
        notes           TEXT,
        status          VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','COMPLETED')),
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✓ maintenance_schedule table created');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_maint_schedule_machine ON maintenance_schedule(machine_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_maint_schedule_due ON maintenance_schedule(next_due_date)`);
    console.log('✓ indexes created');

    // Shift handover notes table (P2-06)
    await client.query(`
      CREATE TABLE IF NOT EXISTS shift_handovers (
        handover_id     SERIAL PRIMARY KEY,
        shift_date      DATE NOT NULL,
        shift           VARCHAR(5) NOT NULL,
        supervisor_name VARCHAR(100),
        production_kg   NUMERIC(10,2),
        machines_down   INTEGER DEFAULT 0,
        issues          TEXT,
        actions_taken   TEXT,
        pending_actions TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✓ shift_handovers table created');

    console.log('\nPhase 2 maintenance migration complete.');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    client.release();
    pool.end();
  }
}
run();
