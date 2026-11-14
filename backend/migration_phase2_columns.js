require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });

async function run() {
  const client = await pool.connect();
  try {
    // P2-11: Machine extra columns
    await client.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(100)`);
    console.log('✓ machines.manufacturer');
    await client.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS model VARCHAR(100)`);
    console.log('✓ machines.model');
    await client.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS serial_number VARCHAR(100)`);
    console.log('✓ machines.serial_number');
    await client.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS needles_count INTEGER`);
    console.log('✓ machines.needles_count');
    await client.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS cylinder_diameter NUMERIC(6,2)`);
    console.log('✓ machines.cylinder_diameter');
    await client.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS purchase_date DATE`);
    console.log('✓ machines.purchase_date');
    await client.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS installation_date DATE`);
    console.log('✓ machines.installation_date');

    // P2-12: Operator extra columns
    await client.query(`ALTER TABLE operators ADD COLUMN IF NOT EXISTS employee_id VARCHAR(50)`);
    console.log('✓ operators.employee_id');
    await client.query(`ALTER TABLE operators ADD COLUMN IF NOT EXISTS join_date DATE`);
    console.log('✓ operators.join_date');
    await client.query(`ALTER TABLE operators ADD COLUMN IF NOT EXISTS skill_level VARCHAR(20) DEFAULT 'BASIC' CHECK (skill_level IN ('BASIC','INTERMEDIATE','EXPERT'))`);
    console.log('✓ operators.skill_level');
    await client.query(`ALTER TABLE operators ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(20)`);
    console.log('✓ operators.emergency_contact');

    console.log('\nMigration P2 columns complete.');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    client.release();
    pool.end();
  }
}
run();
