// ERP Phase 0-B: Item Master
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

    // UOM
    await client.query(`
      CREATE TABLE IF NOT EXISTS uom (
        uom_id    SERIAL PRIMARY KEY,
        code      VARCHAR(20) UNIQUE NOT NULL,
        name      VARCHAR(50) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE
      )
    `);

    const uoms = [['KG','Kilogram'],['MTR','Metre'],['PCS','Pieces'],
                  ['CONE','Cone'],['ROLL','Roll'],['PKT','Packet'],['SET','Set']];
    for (const [code, name] of uoms) {
      await client.query(
        `INSERT INTO uom (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
        [code, name]
      );
    }

    // HSN Codes
    await client.query(`
      CREATE TABLE IF NOT EXISTS hsn_codes (
        hsn_id      SERIAL PRIMARY KEY,
        hsn_code    VARCHAR(20) UNIQUE NOT NULL,
        description TEXT,
        gst_rate    NUMERIC(5,2) DEFAULT 0
      )
    `);

    const hsns = [
      ['5205','Cotton yarn (not for retail sale)', 5],
      ['5509','Yarn of synthetic staple fibres', 12],
      ['6006','Other knitted or crocheted fabrics', 5],
      ['5407','Woven fabrics of synthetic filament yarn', 12],
      ['8445','Textile machinery — spinning', 18],
      ['9999','Services — Job Work on Textiles', 5],
    ];
    for (const [code, desc, rate] of hsns) {
      await client.query(
        `INSERT INTO hsn_codes (hsn_code, description, gst_rate) VALUES ($1, $2, $3) ON CONFLICT (hsn_code) DO NOTHING`,
        [code, desc, rate]
      );
    }

    // Item categories
    await client.query(`
      CREATE TABLE IF NOT EXISTS item_categories (
        category_id SERIAL PRIMARY KEY,
        code        VARCHAR(30) UNIQUE NOT NULL,
        name        VARCHAR(100) NOT NULL,
        description TEXT,
        parent_id   INTEGER REFERENCES item_categories(category_id),
        is_active   BOOLEAN DEFAULT TRUE
      )
    `);

    const cats = [
      ['YARN','Yarn','Raw material — yarn'],
      ['GREIGE_FABRIC','Greige Fabric','Knitted fabric before processing'],
      ['SEMI_FINISHED','Semi-Finished','Fabric after dyeing, before finishing'],
      ['FINISHED_FABRIC','Finished Fabric','Finished / ready fabric'],
      ['SPARES','Spares & Accessories','Machine spare parts'],
      ['CONSUMABLES','Consumables','General factory consumables'],
      ['CHEMICALS','Chemicals','Dyes and chemicals'],
      ['PACKING','Packing Material','Bags, cartons, labels'],
      ['SERVICES','Services','Job work and external services'],
    ];
    for (const [code, name, desc] of cats) {
      await client.query(
        `INSERT INTO item_categories (code, name, description) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
        [code, name, desc]
      );
    }

    // Items master table
    await client.query(`
      CREATE TABLE IF NOT EXISTS items (
        item_id        SERIAL PRIMARY KEY,
        item_code      VARCHAR(50) UNIQUE NOT NULL,
        item_name      VARCHAR(200) NOT NULL,
        category_id    INTEGER NOT NULL REFERENCES item_categories(category_id),
        brand          VARCHAR(100),
        description    TEXT,
        uom_id         INTEGER REFERENCES uom(uom_id),
        hsn_id         INTEGER REFERENCES hsn_codes(hsn_id),
        gst_rate       NUMERIC(5,2) DEFAULT 0,
        standard_cost  NUMERIC(15,2) DEFAULT 0,
        selling_price  NUMERIC(15,2),
        reorder_level  NUMERIC(12,3) DEFAULT 0,
        min_stock      NUMERIC(12,3) DEFAULT 0,
        max_stock      NUMERIC(12,3),
        barcode        VARCHAR(100),
        status         VARCHAR(20) DEFAULT 'ACTIVE',
        is_active      BOOLEAN DEFAULT TRUE,
        created_by     VARCHAR(80),
        created_at     TIMESTAMP DEFAULT NOW(),
        updated_at     TIMESTAMP DEFAULT NOW()
      )
    `);

    // Yarn-specific attributes
    await client.query(`
      CREATE TABLE IF NOT EXISTS item_yarn_attrs (
        item_id            INTEGER PRIMARY KEY REFERENCES items(item_id) ON DELETE CASCADE,
        count              VARCHAR(30),
        composition        VARCHAR(100),
        shade              VARCHAR(80),
        yarn_type          VARCHAR(80),
        default_partner_id INTEGER,
        pref_warehouse_id  INTEGER,
        pref_rack_id       INTEGER
      )
    `);

    // Fabric-specific attributes
    await client.query(`
      CREATE TABLE IF NOT EXISTS item_fabric_attrs (
        item_id           INTEGER PRIMARY KEY REFERENCES items(item_id) ON DELETE CASCADE,
        fabric_code       VARCHAR(50),
        structure         VARCHAR(100),
        gsm               NUMERIC(8,2),
        finished_gsm      NUMERIC(8,2),
        width_cm          NUMERIC(6,2),
        finished_width_cm NUMERIC(6,2),
        machine_type      VARCHAR(50),
        gauge             VARCHAR(20),
        dia_inches        NUMERIC(6,2),
        feeders           INTEGER,
        stitch_length_mm  NUMERIC(6,3),
        process_route_id  INTEGER
      )
    `);

    // Spare-specific attributes
    await client.query(`
      CREATE TABLE IF NOT EXISTS item_spare_attrs (
        item_id            INTEGER PRIMARY KEY REFERENCES items(item_id) ON DELETE CASCADE,
        oem_part_number    VARCHAR(100),
        compatible_machine VARCHAR(200),
        rack_bin           VARCHAR(50),
        warranty_months    INTEGER,
        default_partner_id INTEGER
      )
    `);

    await client.query('COMMIT');
    console.log('✅ Phase 0-B: Item Master tables created and seeded');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Phase 0-B failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
