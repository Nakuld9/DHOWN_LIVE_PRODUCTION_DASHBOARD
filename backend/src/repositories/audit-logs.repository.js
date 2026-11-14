// Audit-logs repository — paginated audit_logs. SQL verbatim from /api/audit-logs.
module.exports = (pool) => ({
  page({ module, limit, offset }) {
    const conds = []; const params = []; let p = 1;
    if (module) { conds.push(`module = $${p++}`); params.push(module); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return Promise.all([
      pool.query(`SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC LIMIT $${p} OFFSET $${p + 1}`, [...params, limit, offset]),
      pool.query(`SELECT COUNT(*) FROM audit_logs ${where}`, params),
    ]);
  },
});
