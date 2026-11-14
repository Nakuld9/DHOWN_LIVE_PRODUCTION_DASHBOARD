// JWT revocation — an in-memory blocklist backed by a DB table.
//
// Tokens are stateless: once signed, a valid signature is accepted until it
// expires, so a leaked token (especially a long-lived display token) could not
// be killed short of rotating JWT_SECRET, which logs EVERYONE out. This module
// adds targeted revocation without that blunt instrument.
//
// Two mechanisms:
//   1. Per-token (jti): one specific token is killed — logout, or a leaked token.
//   2. Per-user cutoff (users.tokens_valid_from): every token a user holds that
//      was issued before an instant is killed at once — "log out everywhere",
//      password change, or account deactivation.
//
// Why a cache, not a DB lookup per request: verifyToken runs on every API call
// and must stay synchronous and cheap. This is a single-node server, so the
// blocklist lives in-process (a Map); the DB table is the durable backing store
// that survives restarts. Writes update both; reads hit only memory.

const revokedJti = new Map();   // jti  -> token's own expiry (ms)
const userCutoff = new Map();   // user id -> cutoff (ms); tokens with iat before this are dead
let _pool = null;
let _timer = null;

const nowS = () => Math.floor(Date.now() / 1000);

async function ensureSchema() {
  await _pool.query(`
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti         VARCHAR(64) PRIMARY KEY,
      user_id     INTEGER,
      username    VARCHAR(120),
      reason      VARCHAR(40),
      revoked_by  VARCHAR(120),
      expires_at  TIMESTAMP NOT NULL,
      revoked_at  TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON revoked_tokens(expires_at);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_valid_from TIMESTAMP;
  `);
}

// Load non-expired revocations into the cache. Called at boot.
async function reload() {
  revokedJti.clear();
  userCutoff.clear();
  const r = await _pool.query(
    `SELECT jti, EXTRACT(EPOCH FROM expires_at) * 1000 AS exp_ms FROM revoked_tokens WHERE expires_at > NOW()`);
  for (const row of r.rows) revokedJti.set(row.jti, Number(row.exp_ms));
  const u = await _pool.query(
    `SELECT id, EXTRACT(EPOCH FROM tokens_valid_from) * 1000 AS cut_ms FROM users WHERE tokens_valid_from IS NOT NULL`);
  for (const row of u.rows) userCutoff.set(Number(row.id), Number(row.cut_ms));
}

async function init(pool) {
  _pool = pool;
  await ensureSchema();
  await reload();
  if (_timer) clearInterval(_timer);
  _timer = setInterval(() => { purge().catch(() => {}); }, 60 * 60 * 1000);
  if (_timer.unref) _timer.unref();   // never hold the process open just for the sweep
}

// Synchronous — called from verifyToken on every request.
function isRevoked(payload) {
  if (!payload) return false;
  if (payload.jti && revokedJti.has(payload.jti)) return true;
  const cut = userCutoff.get(Number(payload.id));
  if (cut && payload.iat && payload.iat * 1000 < cut) return true;
  return false;
}

// Revoke one token. `exp` is the token's own expiry (epoch seconds) so the row
// can be purged once the token would have expired anyway.
async function revokeToken({ jti, exp, user_id, username, reason, revoked_by } = {}) {
  if (!jti) return false;
  const expMs = (exp || nowS() + 12 * 3600) * 1000;
  revokedJti.set(jti, expMs);
  if (_pool) {
    await _pool.query(
      `INSERT INTO revoked_tokens (jti, user_id, username, reason, revoked_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6)) ON CONFLICT (jti) DO NOTHING`,
      [jti, user_id ?? null, username ?? null, reason || 'LOGOUT', revoked_by ?? null, Math.floor(expMs / 1000)]);
  }
  return true;
}

// Kill every token a user currently holds (issued before now).
async function revokeAllForUser(userId, { revoked_by } = {}) {
  if (userId === undefined || userId === null) return false;
  const cutMs = Date.now();
  userCutoff.set(Number(userId), cutMs);
  if (_pool) {
    await _pool.query(`UPDATE users SET tokens_valid_from = to_timestamp($2) WHERE id = $1`,
      [userId, Math.floor(cutMs / 1000)]);
  }
  return true;
}

async function list(limit = 200) {
  if (!_pool) return [];
  return (await _pool.query(
    `SELECT jti, user_id, username, reason, revoked_by, revoked_at, expires_at
       FROM revoked_tokens WHERE expires_at > NOW() ORDER BY revoked_at DESC LIMIT $1`, [limit])).rows;
}

async function purge() {
  const now = Date.now();
  for (const [jti, exp] of revokedJti) if (exp <= now) revokedJti.delete(jti);
  if (_pool) await _pool.query(`DELETE FROM revoked_tokens WHERE expires_at <= NOW()`);
}

function stats() {
  return { revoked_tokens: revokedJti.size, users_with_cutoff: userCutoff.size };
}

module.exports = {
  init, ensureSchema, reload, isRevoked, revokeToken, revokeAllForUser, list, purge, stats,
  _caches: { revokedJti, userCutoff },
};
