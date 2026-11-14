require('dotenv').config();
const { Pool } = require('pg');

// No default for the password: a real one written into source is a credential in
// git, and a wrong-but-present default fails as a confusing auth error rather
// than as the missing configuration it actually is.
if (!process.env.DB_PASSWORD) {
  console.error('[db] DB_PASSWORD is not set — add it to .env');
}

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'dhown_mes',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD,

  // Postgres allows 100 connections; two instances share this host, so 25 each
  // leaves ample headroom while giving far more room than the pg default of 10.
  max: parseInt(process.env.DB_POOL_MAX || '25'),

  // Without this, a request that cannot get a connection waits FOREVER. A load
  // test found exactly that: code holding one connection while asking for a
  // second deadlocked the pool, and 20 concurrent receipts hung for 305 seconds
  // before failing. The underlying bug is fixed, but a timeout means the next
  // one of its kind surfaces as a fast, obvious error instead of a frozen
  // application.
  connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT_MS || '10000'),

  // Reclaim idle connections so a burst does not hold the ceiling all day.
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000'),
});

// A pool error with no listener crashes the process on some pg versions.
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

module.exports = pool;
