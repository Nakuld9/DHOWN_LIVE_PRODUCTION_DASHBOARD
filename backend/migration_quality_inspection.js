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
    await client.query('BEGIN');

    // 1. Create quality_inspections table
    await client.query(`
      CREATE TABLE IF NOT EXISTS quality_inspections (
        inspection_id SERIAL PRIMARY KEY,
        roll_id VARCHAR(50) REFERENCES rolls(roll_id) ON DELETE CASCADE,
        inspection_type VARCHAR(50) NOT NULL, -- 'incoming', 'in_process', 'final', 'fabric'
        inspection_stage VARCHAR(50), -- 'yarn_issue', 'roll_production', 'dyeing', 'finishing', etc.
        inspector VARCHAR(100), -- references operators.operator_name or users.username
        inspection_date TIMESTAMP DEFAULT NOW(),

        -- Grading
        grade VARCHAR(1) CHECK (grade IN ('A', 'B', 'C', 'R')), -- A=Excellent, B=Good, C=Acceptable, R=Reject

        -- Measurements
        width_mm NUMERIC(8,2),
        gsm NUMERIC(8,2),
        length_m NUMERIC(10,2),
        weight_kg NUMERIC(10,3),

        -- Defect tracking
        defect_type VARCHAR(100), -- e.g., 'hole', 'stain', 'misprint', 'wrong_color'
        defect_description TEXT,
        defect_location VARCHAR(100), -- e.g., 'edge', 'center', 'corner'
        defect_severity VARCHAR(20) CHECK (defect_severity IN ('minor', 'major', 'critical')),
        defect_count INTEGER DEFAULT 0,

        -- Overall assessment
        passed BOOLEAN, -- true if grade A/B/C and no critical defects
        notes TEXT,

        -- Metadata
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Created quality_inspections table');

    // 2. Create index for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_quality_inspections_roll_id ON quality_inspections(roll_id);
    `);
    console.log('Created index on quality_inspections.roll_id');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_quality_inspections_inspection_date ON quality_inspections(inspection_date);
    `);
    console.log('Created index on quality_inspections.inspection_date');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_quality_inspections_grade ON quality_inspections(grade);
    `);
    console.log('Created index on quality_inspections.grade');

    // 3. Add quality_grade column to rolls table if it doesn't exist
    const gradeCheck = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='rolls' AND column_name='quality_grade'`);
    if (!gradeCheck.rows.length) {
      await client.query(`
        ALTER TABLE rolls ADD COLUMN quality_grade VARCHAR(1);
      `);
      console.log('Added quality_grade column to rolls table');
    }

    // 4. Add latest_inspection_id to rolls table for quick reference
    const latestCheck = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='rolls' AND column_name='latest_inspection_id'`);
    if (!latestCheck.rows.length) {
      await client.query(`
        ALTER TABLE rolls ADD COLUMN latest_inspection_id INTEGER;
      `);
      console.log('Added latest_inspection_id column to rolls table');
    }

    // 5. Add foreign key constraint for latest_inspection_id
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'fk_rolls_latest_inspection'
        ) THEN
          ALTER TABLE rolls
          ADD CONSTRAINT fk_rolls_latest_inspection
          FOREIGN KEY (latest_inspection_id)
          REFERENCES quality_inspections(inspection_id)
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    console.log('Added foreign key constraint for latest_inspection_id');

    await client.query('COMMIT');
    console.log('Quality inspection migration completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

run().catch(console.error);