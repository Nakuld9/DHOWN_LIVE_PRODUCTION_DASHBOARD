require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
pool.query(`SELECT * FROM machines WHERE machine_id='SJ01'`).then(r => {
  console.log(JSON.stringify(r.rows[0], null, 2));
  pool.end();
});
