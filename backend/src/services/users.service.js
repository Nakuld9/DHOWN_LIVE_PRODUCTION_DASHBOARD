// Users service — validation, password/PIN hashing, audit writes.
// Behaviour kept verbatim from the original inline /api/users handlers.
const bcrypt = require('bcryptjs');
const revocation = require('../lib/token-revocation');

// SALES and ACCOUNTS are not rungs above OPERATOR — see ROLE_HIERARCHY in
// middleware/auth.js. Each carries operator-level authority plus explicit
// access to its own job, and neither can do the other's.
const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'SALES', 'ACCOUNTS', 'QC', 'OPERATOR', 'AUDITOR', 'VIEWER'];

module.exports = (repo) => ({
  async list() {
    return (await repo.findAllPublic()).rows;
  },

  async create(body, actor) {
    const { username, full_name, password, role, mobile } = body;
    if (!username || !full_name || !password || !role)
      return { badRequest: 'username, full_name, password, role are required' };
    if (!VALID_ROLES.includes(role)) return { badRequest: 'Invalid role' };
    const hash = await bcrypt.hash(password, 10);
    let r;
    try {
      r = await repo.insertUser({ username, full_name, hash, role, mobile });
    } catch (err) {
      if (err.code === '23505') return { conflict: 'Username already exists' };
      throw err;
    }
    await repo.auditCreate(actor, `Created user ${username} (${role})`);
    return { row: r.rows[0] };
  },

  async update(id, body, actor) {
    const { full_name, role, active, password, mobile } = body;
    if (role && !VALID_ROLES.includes(role)) return { badRequest: 'Invalid role' };
    const existing = await repo.findById(id);
    if (existing.rows.length === 0) return { notFound: true };
    const cur = existing.rows[0];
    const newHash = password ? await bcrypt.hash(password, 10) : cur.password_hash;
    const r = await repo.updateUser(id, {
      full_name: full_name ?? cur.full_name,
      role: role ?? cur.role,
      active: active ?? cur.active,
      newHash,
      mobile: mobile !== undefined ? mobile : cur.mobile,
    });
    await repo.auditUpdate(actor,
      `role=${cur.role} active=${cur.active}`,
      `role=${role ?? cur.role} active=${active ?? cur.active}`);

    // End existing sessions when the account's access changes: a new password, or
    // the account being deactivated, must not leave old tokens working. The user
    // (or anyone holding a stolen token) has to re-authenticate.
    const passwordChanged = !!password;
    const deactivated = active === false && cur.active !== false;
    if (passwordChanged || deactivated) {
      try { await revocation.revokeAllForUser(id, { revoked_by: actor }); }
      catch (e) { console.error('revoke-on-update failed:', e.message); }
    }
    return { row: r.rows[0] };
  },

  async remove(id, actor) {
    const existing = await repo.findUsername(id);
    if (existing.rows.length === 0) return { notFound: true };

    // Never remove the last way in.
    //
    // Deletion is soft now, which makes this MORE important rather than less:
    // a hard delete at least let seedDefaultAdmin() create a fresh admin at the
    // next boot, but a soft-deleted row still exists, so the seed sees an
    // 'admin' and does nothing. Removing the only super admin would lock
    // everyone out permanently, with the restore button on the other side of
    // the login screen.
    const last = await repo.isLastSuperAdmin(id);
    if (last) {
      return { badRequest: 'This is the only active super admin. Create another one before removing this account.' };
    }

    await repo.deleteUser(id);
    // A deleted account's tokens must stop working immediately, even before they expire.
    try { await revocation.revokeAllForUser(id, { revoked_by: actor }); }
    catch (e) { console.error('revoke-on-delete failed:', e.message); }
    await repo.auditDelete(actor, `Deleted user ${existing.rows[0].username} (recoverable from Trash)`);
    return { ok: true };
  },

  async setPin(id, pin) {
    if (!pin || !/^\d{4}$/.test(String(pin)))
      return { badRequest: 'PIN must be exactly 4 digits' };
    const hash = await bcrypt.hash(String(pin), 6);
    const r = await repo.setPin(id, hash);
    if (r.rows.length === 0) return { notFound: true };
    return { user: r.rows[0] };
  },

  async clearPin(id) {
    await repo.clearPin(id);
    return { ok: true };
  },
});
