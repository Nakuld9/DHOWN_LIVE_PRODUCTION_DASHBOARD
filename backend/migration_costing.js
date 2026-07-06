require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST||'localhost', port: process.env.DB_PORT||5432, database: process.env.DB_NAME||'dhown_mes', user: process.env.DB_USER||'postgres', password: process.env.DB_PASSWORD||'dhown123' });

async function run() {
  const client = await pool.connect();
  try {
    // 1. cost_rates — master rate card
    await client.query(`
      CREATE TABLE IF NOT EXISTS cost_rates (
        rate_id            SERIAL PRIMARY KEY,
        yarn_type          VARCHAR(100) NOT NULL,
        price_per_kg       NUMERIC(10,2) NOT NULL DEFAULT 0,
        labour_per_shift   NUMERIC(10,2) NOT NULL DEFAULT 0,
        machine_depreciation_per_hour NUMERIC(10,2) NOT NULL DEFAULT 0,
        notes              TEXT,
        updated_by         VARCHAR(80),
        updated_at         TIMESTAMP DEFAULT NOW(),
        UNIQUE(yarn_type)
      );
    `);
    console.log('cost_rates ready');

    // 2. cost_entries — one row per cost event
    await client.query(`
      CREATE TABLE IF NOT EXISTS cost_entries (
        entry_id         SERIAL PRIMARY KEY,
        reference_type   VARCHAR(30) NOT NULL,
        reference_id     VARCHAR(100) NOT NULL,
        cost_component   VARCHAR(40) NOT NULL,
        amount_rs        NUMERIC(12,2) NOT NULL DEFAULT 0,
        quantity_kg      NUMERIC(10,3),
        rate_used        NUMERIC(10,2),
        fabric_type      VARCHAR(100),
        color_name       VARCHAR(100),
        notes            TEXT,
        created_at       TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('cost_entries ready');

    // 3. cost_snapshots — daily summary
    await client.query(`
      CREATE TABLE IF NOT EXISTS cost_snapshots (
        snapshot_id      SERIAL PRIMARY KEY,
        snapshot_date    DATE NOT NULL,
        fabric_type      VARCHAR(100),
        color_name       VARCHAR(100),
        total_cost_rs    NUMERIC(12,2) DEFAULT 0,
        total_kg         NUMERIC(10,3) DEFAULT 0,
        cost_per_kg      NUMERIC(10,2) DEFAULT 0,
        selling_price_kg NUMERIC(10,2),
        margin_rs        NUMERIC(12,2),
        created_at       TIMESTAMP DEFAULT NOW(),
        UNIQUE(snapshot_date, fabric_type, color_name)
      );
    `);
    console.log('cost_snapshots ready');

    // 4. Seed default rates
    const defaults = [
      ['Cotton 40s', 180, 800, 25],
      ['Cotton 60s', 220, 800, 25],
      ['Polyester 40s', 120, 800, 20],
      ['Polyester 60s', 150, 800, 20],
      ['Cotton/Poly Blend', 160, 800, 22],
      ['Viscose', 200, 800, 28],
      ['Default', 170, 800, 25],
    ];
    for (const [yarn_type, price_per_kg, labour_per_shift, machine_depreciation_per_hour] of defaults) {
      await client.query(`
        INSERT INTO cost_rates (yarn_type, price_per_kg, labour_per_shift, machine_depreciation_per_hour, updated_by)
        VALUES ($1,$2,$3,$4,'system')
        ON CONFLICT (yarn_type) DO NOTHING
      `, [yarn_type, price_per_kg, labour_per_shift, machine_depreciation_per_hour]);
    }
    console.log('Default rates seeded');

    // 5. Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cost_entries_ref ON cost_entries(reference_type, reference_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cost_entries_date ON cost_entries(created_at);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cost_entries_fabric ON cost_entries(fabric_type);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cost_snapshots_date ON cost_snapshots(snapshot_date);`);
    console.log('Indexes created');

    console.log('\nCosting migration complete.');
  } finally { client.release(); await pool.end(); }
}
run().catch(e => { console.error(e.message); process.exit(1); });
