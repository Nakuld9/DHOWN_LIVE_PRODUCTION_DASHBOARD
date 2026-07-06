require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'dhown_mes',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'dhown123',
});

module.exports = pool;