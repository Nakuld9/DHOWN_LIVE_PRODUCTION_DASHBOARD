// ERP Phase 0-C: Business Partner Master
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
      CREATE TABLE IF NOT EXISTS partners (
        partner_id    SERIAL PRIMARY KEY,
        partner_code  VARCHAR(30) UNIQUE NOT NULL,
        company_name  VARCHAR(200) NOT NULL,
        short_name    VARCHAR(80),
        gstin         VARCHAR(20),
        pan           VARCHAR(20),
        tan           VARCHAR(20),
        iec           VARCHAR(20),
        cin           VARCHAR(30),
        msme_number   VARCHAR(50),
        msme_category VARCHAR(10),
        payment_terms INTEGER DEFAULT 30,
        credit_limit  NUMERIC(15,2),
        credit_days   INTEGER DEFAULT 0,
        rating        INTEGER CHECK(rating BETWEEN 1 AND 5),
        notes         TEXT,
        is_active     BOOLEAN DEFAULT TRUE,
        created_by    VARCHAR(80),
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS partner_roles (
        role_id    SERIAL PRIMARY KEY,
        partner_id INTEGER NOT NULL REFERENCES partners(partner_id) ON DELETE CASCADE,
        role       VARCHAR(50) NOT NULL,
        is_primary BOOLEAN DEFAULT FALSE,
        UNIQUE(partner_id, role)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS partner_addresses (
        address_id   SERIAL PRIMARY KEY,
        partner_id   INTEGER NOT NULL REFERENCES partners(partner_id) ON DELETE CASCADE,
        address_type VARCHAR(30) DEFAULT 'PRIMARY',
        line1        VARCHAR(200),
        line2        VARCHAR(200),
        city         VARCHAR(100),
        state        VARCHAR(100),
        pincode      VARCHAR(10),
        country      VARCHAR(50) DEFAULT 'India',
        gstin        VARCHAR(20),
        is_default   BOOLEAN DEFAULT FALSE
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS partner_contacts (
        contact_id SERIAL PRIMARY KEY,
        partner_id INTEGER NOT NULL REFERENCES partners(partner_id) ON DELETE CASCADE,
        name       VARCHAR(100) NOT NULL,
        designation VARCHAR(100),
        mobile     VARCHAR(20),
        email      VARCHAR(100),
        whatsapp   VARCHAR(20),
        is_primary BOOLEAN DEFAULT FALSE
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS partner_bank (
        bank_id      SERIAL PRIMARY KEY,
        partner_id   INTEGER NOT NULL REFERENCES partners(partner_id) ON DELETE CASCADE,
        bank_name    VARCHAR(100),
        branch       VARCHAR(100),
        account_no   VARCHAR(50),
        ifsc         VARCHAR(20),
        account_type VARCHAR(30) DEFAULT 'CURRENT',
        is_default   BOOLEAN DEFAULT FALSE
      )
    `);

    // Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_partners_code ON partners(partner_code)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_partner_roles_pid ON partner_roles(partner_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_partner_roles_role ON partner_roles(role)`);

    await client.query('COMMIT');
    console.log('✅ Phase 0-C: Partner Master tables created');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Phase 0-C failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
