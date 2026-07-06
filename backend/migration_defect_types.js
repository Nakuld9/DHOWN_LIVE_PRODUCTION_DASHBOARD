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

    // Create defect_types table
    await client.query(`
      CREATE TABLE IF NOT EXISTS defect_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Created defect_types table');

    // Insert some default defect types if the table is empty
    const countResult = await client.query('SELECT COUNT(*) FROM defect_types');
    const count = parseInt(countResult.rows[0].count);
    if (count === 0) {
      const defectTypes = [
        { name: 'Hole', description: 'Hole in the fabric', sort_order: 1 },
        { name: 'Stain', description: 'Stain or discoloration', sort_order: 2 },
        { name: 'Misprint', description: 'Incorrect printing or pattern', sort_order: 3 },
        { name: 'Wrong Color', description: 'Fabric color does not match specification', sort_order: 4 },
        { name: 'Snag', description: 'Snag or pulled thread', sort_order: 5 },
        { name: 'Drop Stitch', description: 'Missing stitch in knitting', sort_order: 6 },
        { name: 'Barre', description: 'Horizontal streaks or bands', sort_order: 7 },
        { name: 'Crease', description: 'Unwanted crease or fold', sort_order: 8 },
        { name: 'Oil Spot', description: 'Oil or lubricant stain', sort_order: 9 },
        { name: 'Other', description: 'Other defect types', sort_order: 10 }
      ];
      for (const dt of defectTypes) {
        await client.query(
          `INSERT INTO defect_types (name, description, sort_order) VALUES ($1, $2, $3)`,
          [dt.name, dt.description, dt.sort_order]
        );
      }
      console.log('Inserted default defect types');
    }

    // Add updated_at trigger
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS update_defect_types_updated_at ON defect_types;
      CREATE TRIGGER update_defect_types_updated_at
      BEFORE UPDATE ON defect_types
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
    `);
    console.log('Added updated_at trigger for defect_types');

    await client.query('COMMIT');
    console.log('Defect types migration completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

run().catch(console.error);