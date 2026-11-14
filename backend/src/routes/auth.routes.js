// Auth routes — login (rate-limited), supervisor PIN, logout.
// Handlers moved VERBATIM from server.js; app.<m>('/api/auth...') -> router.<m>('/...').
// Mounted at /api/auth. Auth/middleware preserved exactly.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const revocation = require('../lib/token-revocation');

module.exports = ({ pool, verifyToken, requireRole, loginLimiter, pinLimiter, JWT_SECRET, JWT_EXPIRES }) => {
  const router = express.Router();

  // Every token carries a unique jti so a single session can be revoked. See
  // src/lib/token-revocation.js. jwt also stamps iat, which the per-user cutoff uses.
  const sign = (payload, expiresIn) =>
    jwt.sign(payload, JWT_SECRET, { expiresIn, jwtid: crypto.randomUUID() });

  router.post("/login", loginLimiter, async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }
      const r = await pool.query(
        `SELECT * FROM users WHERE username = $1 AND active = true AND deleted_at IS NULL`, [username]
      );
      if (r.rows.length === 0) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const user = r.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: "Invalid credentials" });
  
      const payload = { id: user.id, username: user.username, role: user.role };
      const token = sign(payload, JWT_EXPIRES);

      res.json({
        token,
        id:        user.id,
        username:  user.username,
        full_name: user.full_name,
        role:      user.role,
        mobile:    user.mobile || null,
        active:    user.active,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Login failed. Database connection error." });
    }
  });

  router.post("/supervisor-pin", pinLimiter, async (req, res) => {
    try {
      const { pin } = req.body;
      if (!pin || !/^\d{4}$/.test(String(pin))) {
        return res.status(400).json({ error: "PIN must be 4 digits" });
      }
      const r = await pool.query(
        `SELECT * FROM users WHERE active = true AND pin_hash IS NOT NULL AND deleted_at IS NULL
         AND role IN ('SUPERVISOR', 'ADMIN', 'SUPER_ADMIN')`
      );
      for (const user of r.rows) {
        const match = await bcrypt.compare(String(pin), user.pin_hash);
        if (match) {
          const payload = { id: user.id, username: user.username, role: user.role };
          const token = sign(payload, '12h');
          return res.json({ token, id: user.id, username: user.username, full_name: user.full_name, role: user.role });
        }
      }
      return res.status(401).json({ error: "Invalid PIN" });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // A credential for a wall-mounted screen. The TV has nobody logged into it and
  // no way to log back in, so the token is long-lived — and therefore scoped:
  // verifyToken restricts scope:'display' to the live dashboard alone, so a token
  // copied off that screen cannot read invoices, costing or staff records.
  router.post('/display-token', verifyToken, requireRole('ADMIN'), (req, res) => {
    const days = Math.min(Math.max(parseInt(req.body?.days, 10) || 365, 1), 730);
    const token = sign(
      { id: 0, username: 'tv-display', role: 'VIEWER', scope: 'display' }, `${days}d`);
    res.json({
      token, expires_days: days,
      note: 'Open /tv-dashboard on the screen and paste this once. It reads the live dashboard only.',
    });
  });

  // Logout now actually ends the session: the presented token's jti is added to
  // the revocation blocklist so it is rejected for the rest of its lifetime.
  router.post("/logout", verifyToken, async (req, res) => {
    try {
      await revocation.revokeToken({
        jti: req.user.jti, exp: req.user.exp, user_id: req.user.id,
        username: req.user.username, reason: 'LOGOUT', revoked_by: req.user.username,
      });
    } catch (e) { console.error('logout revoke failed:', e.message); }
    res.json({ success: true });
  });

  // Admin: "log out everywhere" for one user — kills every token they currently
  // hold (issued before now). Use for a departing employee, a suspected leak, or
  // after a forced password reset. For a leaked wall-display token, revoke user 0
  // (the shared tv-display id) and issue a fresh display token.
  router.post("/revoke-user/:id", verifyToken, requireRole('ADMIN'), async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid user id' });
      await revocation.revokeAllForUser(id, { revoked_by: req.user.username });
      res.json({ success: true, user_id: id, note: 'All existing tokens for this user are now rejected.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Admin: current revocation blocklist (non-expired) + cache stats.
  router.get("/revocations", verifyToken, requireRole('ADMIN'), async (req, res) => {
    try {
      res.json({ revoked_tokens: await revocation.list(), stats: revocation.stats() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
