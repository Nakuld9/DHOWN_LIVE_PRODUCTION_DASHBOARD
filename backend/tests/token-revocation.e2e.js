// JWT revocation — blocklist (jti) + per-user cutoff, at the verifyToken boundary.
//
// Proves: a signed token passes; logout/revokeToken kills exactly that token;
// revokeAllForUser kills every token a user holds that was issued before the
// cutoff while a newer one still passes; and revocations persist to the DB and
// reload into the cache after a restart.
//
//   node tests/token-revocation.e2e.js

require('dotenv').config({ quiet: true });
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Pool } = require('pg');
const { verifyToken, JWT_SECRET } = require('../src/middleware/auth');
const revocation = require('../src/lib/token-revocation');

const pool = new Pool({ host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes', port: process.env.DB_PORT || 5432 });

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

const mint = (payload, opts = {}) => jwt.sign(payload, JWT_SECRET, { expiresIn: '8h', jwtid: crypto.randomUUID(), ...opts });

// Run verifyToken against a bearer token; returns 'next' or the HTTP status.
function check(token) {
  let outcome = 'next';
  const req = { headers: { authorization: 'Bearer ' + token }, baseUrl: '/api/x', path: '/', originalUrl: '/api/x' };
  const res = { status: (s) => ({ json: () => { outcome = s; return res; } }) };
  verifyToken(req, res, () => { outcome = 'next'; });
  return outcome;
}

(async () => {
  const TEST_UID = 999999;   // a non-existent user id, safe to stamp a cutoff on
  await revocation.init(pool);
  // clean slate for this test's user
  await pool.query(`DELETE FROM revoked_tokens WHERE user_id = $1`, [TEST_UID]);

  // 1. A fresh token passes.
  const t1 = mint({ id: TEST_UID, username: '__revtest', role: 'OPERATOR' });
  ok(check(t1) === 'next', 'a freshly signed token is accepted');

  // 2. Revoking that token's jti rejects it (and only it).
  const d1 = jwt.decode(t1);
  const t2 = mint({ id: TEST_UID, username: '__revtest', role: 'OPERATOR' });
  await revocation.revokeToken({ jti: d1.jti, exp: d1.exp, user_id: TEST_UID, username: '__revtest', reason: 'LOGOUT' });
  ok(check(t1) === 401, 'the revoked token is now rejected (401)');
  ok(check(t2) === 'next', 'a different token for the same user still works', '(jti blocklist is per-token)');

  // 3. Per-user cutoff kills every token issued before it; a newer one passes.
  await revocation.revokeAllForUser(TEST_UID, { revoked_by: '__revtest' });
  ok(check(t2) === 401, 'revoke-all-for-user kills a token issued before the cutoff');
  const cutMs = revocation._caches.userCutoff.get(TEST_UID);
  const tNew = mint({ id: TEST_UID, username: '__revtest', role: 'OPERATOR', iat: Math.floor(cutMs / 1000) + 2 });
  ok(check(tNew) === 'next', 'a token issued after the cutoff is accepted');

  // 4. Persistence: the jti revocation is in the DB and survives a cache reload.
  const row = (await pool.query(`SELECT reason FROM revoked_tokens WHERE jti = $1`, [d1.jti])).rows[0];
  ok(row && row.reason === 'LOGOUT', 'revocation persisted to revoked_tokens');
  revocation._caches.revokedJti.clear();
  await revocation.reload();
  ok(check(t1) === 401, 'after a cache reload (restart), the revoked token is still rejected');

  // 5. An unrelated user is unaffected.
  const other = mint({ id: TEST_UID + 1, username: '__other', role: 'OPERATOR' });
  ok(check(other) === 'next', 'another user\'s token is unaffected by the revocations above');

  // 6. users.service wiring: password change / deactivation / deletion revoke
  //    all of the user's sessions; a plain profile edit does not.
  const mockRepo = {
    findById: async (id) => ({ rows: [{ id, full_name: 'X', role: 'OPERATOR', active: true, password_hash: 'h', mobile: null }] }),
    updateUser: async (id, f) => ({ rows: [{ id, ...f }] }),
    auditUpdate: async () => {}, auditDelete: async () => {},
    findUsername: async () => ({ rows: [{ username: 'x' }] }),
    isLastSuperAdmin: async () => false, deleteUser: async () => {},
  };
  const svc = require('../src/services/users.service')(mockRepo);
  const uids = { pw: 999998, deact: 999997, plain: 999996, del: 999995 };
  for (const id of Object.values(uids)) revocation._caches.userCutoff.delete(id);

  await svc.update(uids.pw, { password: 'newsecret123' }, '__admintest');
  ok(revocation._caches.userCutoff.has(uids.pw), 'password change revokes all of the user\'s sessions');

  await svc.update(uids.deact, { active: false }, '__admintest');
  ok(revocation._caches.userCutoff.has(uids.deact), 'deactivating an account revokes its sessions');

  await svc.update(uids.plain, { full_name: 'New Name' }, '__admintest');
  ok(!revocation._caches.userCutoff.has(uids.plain), 'a plain profile edit does NOT revoke sessions');

  await svc.remove(uids.del, '__admintest');
  ok(revocation._caches.userCutoff.has(uids.del), 'deleting a user revokes their sessions');

  for (const id of Object.values(uids)) {
    revocation._caches.userCutoff.delete(id);
    await pool.query(`UPDATE users SET tokens_valid_from = NULL WHERE id = $1`, [id]).catch(() => {});
  }

  // cleanup
  await pool.query(`DELETE FROM revoked_tokens WHERE user_id = $1`, [TEST_UID]);
  await pool.query(`UPDATE users SET tokens_valid_from = NULL WHERE id = $1`, [TEST_UID]).catch(() => {});
  revocation._caches.userCutoff.delete(TEST_UID);

  console.log(fails ? `\nFAILED (${fails})` : '\nAll token-revocation tests passed.');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e.message, e.stack); process.exit(1); });
