// Users repository — data access for users + related audit_logs writes.
// SQL kept verbatim from the original inline /api/users handlers.
module.exports = (pool) => ({
  findAllPublic() {
    return pool.query(
      `SELECT id, username, full_name, role, mobile, active, created_at, updated_at
         FROM users WHERE deleted_at IS NULL ORDER BY id`
    );
  },

  insertUser({ username, full_name, hash, role, mobile }) {
    return pool.query(
      `INSERT INTO users (username, full_name, password_hash, role, mobile)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, full_name, role, mobile, active, created_at`,
      [username, full_name, hash, role, mobile || null]
    );
  },

  findById(id) { return pool.query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]); },
  findUsername(id) { return pool.query(`SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]); },

  updateUser(id, { full_name, role, active, newHash, mobile }) {
    return pool.query(
      `UPDATE users
       SET full_name = $1, role = $2, active = $3, password_hash = $4, mobile = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING id, username, full_name, role, mobile, active, updated_at`,
      [full_name, role, active, newHash, mobile, id]
    );
  },

  // Soft delete. A deleted user cannot log in (see auth.routes) and is gone
  // from every list, but the row survives so the account — and the audit trail
  // that references it — can be restored from Trash.
  deleteUser(id) {
    return pool.query(
      `UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  },

  // Is this user the only super admin still standing? Used to refuse a
  // delete that would lock everyone out.
  async isLastSuperAdmin(id) {
    const me = await pool.query(
      `SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!me.rows.length || me.rows[0].role !== 'SUPER_ADMIN') return false;
    const others = await pool.query(
      `SELECT COUNT(*)::int n FROM users
        WHERE role = 'SUPER_ADMIN' AND active = true AND deleted_at IS NULL AND id <> $1`, [id]);
    return others.rows[0].n === 0;
  },

  setPin(id, hash) {
    return pool.query(
      `UPDATE users SET pin_hash = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, username, full_name, role`,
      [hash, id]
    );
  },

  clearPin(id) {
    return pool.query(`UPDATE users SET pin_hash = NULL, updated_at = NOW() WHERE id = $1`, [id]);
  },

  // ── audit_logs writes (best-effort, matching the original inline inserts) ──
  auditCreate(actor, msg) {
    return pool.query(
      `INSERT INTO audit_logs (username, action, module, new_value)
       VALUES ($1, 'CREATE_USER', 'USER_MANAGEMENT', $2)`,
      [actor, msg]
    );
  },
  auditUpdate(actor, oldVal, newVal) {
    return pool.query(
      `INSERT INTO audit_logs (username, action, module, old_value, new_value)
       VALUES ($1, 'UPDATE_USER', 'USER_MANAGEMENT', $2, $3)`,
      [actor, oldVal, newVal]
    );
  },
  auditDelete(actor, oldVal) {
    return pool.query(
      `INSERT INTO audit_logs (username, action, module, old_value)
       VALUES ($1, 'DELETE_USER', 'USER_MANAGEMENT', $2)`,
      [actor, oldVal]
    );
  },
});
