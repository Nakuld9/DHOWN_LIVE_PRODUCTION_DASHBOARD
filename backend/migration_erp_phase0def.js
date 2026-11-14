// ERP Phase 0-D, 0-E, 0-F: Locations + Other Masters + Process Routes
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

    // ── 0-D: Location Master ──────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS warehouses (
        warehouse_id SERIAL PRIMARY KEY,
        code         VARCHAR(20) UNIQUE NOT NULL,
        name         VARCHAR(100) NOT NULL,
        type         VARCHAR(30) DEFAULT 'INTERNAL',
        address      TEXT,
        is_active    BOOLEAN DEFAULT TRUE
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS racks (
        rack_id      SERIAL PRIMARY KEY,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
        code         VARCHAR(30) NOT NULL,
        name         VARCHAR(100),
        is_active    BOOLEAN DEFAULT TRUE,
        UNIQUE(warehouse_id, code)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bins (
        bin_id    SERIAL PRIMARY KEY,
        rack_id   INTEGER NOT NULL REFERENCES racks(rack_id),
        code      VARCHAR(30) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        UNIQUE(rack_id, code)
      )
    `);

    // Seed default warehouses
    const wh = [
      ['YARN-STORE',  'Yarn Store',        'INTERNAL'],
      ['GREIGE-STORE','Greige Store',       'INTERNAL'],
      ['FG-STORE',    'Finished Goods Store','INTERNAL'],
      ['DYE-HOUSE',   'Dye House',          'EXTERNAL'],
      ['FINISHING',   'Finishing Unit',     'EXTERNAL'],
      ['TRANSIT',     'In Transit',         'TRANSIT'],
    ];
    for (const [code, name, type] of wh) {
      const r = await client.query(
        `INSERT INTO warehouses (code, name, type) VALUES ($1,$2,$3)
         ON CONFLICT (code) DO NOTHING RETURNING warehouse_id`,
        [code, name, type]
      );
      // Add default racks for internal warehouses
      if (r.rows.length && type === 'INTERNAL') {
        for (let i = 1; i <= 3; i++) {
          const rr = await client.query(
            `INSERT INTO racks (warehouse_id, code, name) VALUES ($1,$2,$3)
             ON CONFLICT (warehouse_id, code) DO NOTHING RETURNING rack_id`,
            [r.rows[0].warehouse_id, `R${i}`, `Rack ${i}`]
          );
          if (rr.rows.length) {
            for (let j = 1; j <= 4; j++) {
              await client.query(
                `INSERT INTO bins (rack_id, code) VALUES ($1,$2)
                 ON CONFLICT (rack_id, code) DO NOTHING`,
                [rr.rows[0].rack_id, `B${j}`]
              );
            }
          }
        }
      }
    }

    // ── 0-E: Other Masters ──────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS financial_years (
        fy_id      SERIAL PRIMARY KEY,
        label      VARCHAR(9) UNIQUE NOT NULL,
        start_date DATE NOT NULL,
        end_date   DATE NOT NULL,
        is_active  BOOLEAN DEFAULT FALSE,
        is_closed  BOOLEAN DEFAULT FALSE
      )
    `);
    await client.query(`
      INSERT INTO financial_years (label, start_date, end_date, is_active)
      VALUES ('2025-26','2025-04-01','2026-03-31',TRUE)
      ON CONFLICT (label) DO NOTHING
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS departments (
        dept_id   SERIAL PRIMARY KEY,
        code      VARCHAR(20) UNIQUE NOT NULL,
        name      VARCHAR(100) NOT NULL,
        head_user VARCHAR(80),
        is_active BOOLEAN DEFAULT TRUE
      )
    `);
    const depts = [
      ['KNITTING','Knitting'],['DYEHOUSE','Dye House'],
      ['FINISHING','Finishing'],['QA','Quality Assurance'],
      ['WAREHOUSE','Warehouse'],['ACCOUNTS','Accounts'],
      ['ADMIN','Administration'],
    ];
    for (const [code, name] of depts) {
      await client.query(
        `INSERT INTO departments (code, name) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING`,
        [code, name]
      );
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS cost_centres (
        cc_id     SERIAL PRIMARY KEY,
        code      VARCHAR(20) UNIQUE NOT NULL,
        name      VARCHAR(100) NOT NULL,
        dept_id   INTEGER REFERENCES departments(dept_id),
        is_active BOOLEAN DEFAULT TRUE
      )
    `);
    const ccs = [
      ['CC-KNIT','Knitting Cost Centre','KNITTING'],
      ['CC-DYE','Dye House Cost Centre','DYEHOUSE'],
      ['CC-FIN','Finishing Cost Centre','FINISHING'],
      ['CC-WH','Warehouse Cost Centre','WAREHOUSE'],
      ['CC-OVHD','Overheads','ADMIN'],
    ];
    for (const [code, name, deptCode] of ccs) {
      const d = await client.query('SELECT dept_id FROM departments WHERE code=$1', [deptCode]);
      const dept_id = d.rows[0]?.dept_id || null;
      await client.query(
        `INSERT INTO cost_centres (code, name, dept_id) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING`,
        [code, name, dept_id]
      );
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS tax_rates (
        tax_id    SERIAL PRIMARY KEY,
        code      VARCHAR(20) UNIQUE NOT NULL,
        name      VARCHAR(50) NOT NULL,
        cgst      NUMERIC(5,2) DEFAULT 0,
        sgst      NUMERIC(5,2) DEFAULT 0,
        igst      NUMERIC(5,2) DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE
      )
    `);
    const taxes = [
      ['GST0','Exempt / Nil Rated',0,0,0],
      ['GST5','GST 5%',2.5,2.5,5],
      ['GST12','GST 12%',6,6,12],
      ['GST18','GST 18%',9,9,18],
      ['GST28','GST 28%',14,14,28],
    ];
    for (const [code, name, cgst, sgst, igst] of taxes) {
      await client.query(
        `INSERT INTO tax_rates (code,name,cgst,sgst,igst) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO NOTHING`,
        [code, name, cgst, sgst, igst]
      );
    }

    // ── 0-F: Process Routes ──────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS process_routes (
        route_id      SERIAL PRIMARY KEY,
        code          VARCHAR(30) UNIQUE NOT NULL,
        name          VARCHAR(100) NOT NULL,
        description   TEXT,
        item_category VARCHAR(50),
        is_active     BOOLEAN DEFAULT TRUE,
        created_by    VARCHAR(80),
        created_at    TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS process_route_steps (
        step_id           SERIAL PRIMARY KEY,
        route_id          INTEGER NOT NULL REFERENCES process_routes(route_id) ON DELETE CASCADE,
        step_order        INTEGER NOT NULL,
        step_code         VARCHAR(30) NOT NULL,
        step_name         VARCHAR(100) NOT NULL,
        location_type     VARCHAR(30) DEFAULT 'INTERNAL',
        dept_id           INTEGER REFERENCES departments(dept_id),
        generates_document VARCHAR(50),
        is_optional       BOOLEAN DEFAULT FALSE,
        UNIQUE(route_id, step_order)
      )
    `);

    // Seed default knitted fabric route
    const routeR = await client.query(`
      INSERT INTO process_routes (code, name, description, item_category, created_by)
      VALUES ('KNIT-STD','Standard Knitting Route','Default route: Yarn → Knitting → Greige → Dye → Finish → Dispatch','FINISHED_FABRIC','system')
      ON CONFLICT (code) DO NOTHING RETURNING route_id
    `);

    if (routeR.rows.length) {
      const route_id = routeR.rows[0].route_id;
      const getDeptId = async (code) => {
        const r = await client.query('SELECT dept_id FROM departments WHERE code=$1', [code]);
        return r.rows[0]?.dept_id || null;
      };
      const steps = [
        [1,'YARN_RECEIPT',  'Yarn Receipt',       'INTERNAL', 'WAREHOUSE',  'GRN',      false],
        [2,'KNITTING',      'Knitting',            'INTERNAL', 'KNITTING',   null,       false],
        [3,'ROLL_APPROVAL', 'Roll QC & Approval',  'INTERNAL', 'QA',         null,       false],
        [4,'BATCHING',      'Batching for Dye',    'INTERNAL', 'WAREHOUSE',  'BATCH_SLIP',false],
        [5,'DYE_DISPATCH',  'Dispatch to Dye House','EXTERNAL','WAREHOUSE',  'SC_CHALLAN',false],
        [6,'DYE_RECEIPT',   'Receipt from Dye',    'INTERNAL', 'WAREHOUSE',  'GRN',      false],
        [7,'FINISHING',     'Finishing & QA',      'INTERNAL', 'FINISHING',  null,       true ],
        [8,'FG_ENTRY',      'Finished Goods Entry','INTERNAL', 'WAREHOUSE',  null,       false],
        [9,'DISPATCH',      'Customer Dispatch',   'INTERNAL', 'WAREHOUSE',  'DC',       false],
      ];
      for (const [order, code, name, locType, deptCode, doc, optional] of steps) {
        const dept_id = await getDeptId(deptCode);
        await client.query(`
          INSERT INTO process_route_steps (route_id,step_order,step_code,step_name,location_type,dept_id,generates_document,is_optional)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (route_id, step_order) DO NOTHING
        `, [route_id, order, code, name, locType, dept_id, doc, optional]);
      }
    }

    await client.query('COMMIT');
    console.log('✅ Phase 0-D/E/F: Locations, Other Masters, Process Routes created and seeded');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Phase 0-D/E/F failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
