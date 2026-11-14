// Fabric-types repository — data access only. SQL preserved verbatim from server.js.
module.exports = (pool) => ({
  getAll() {
    return pool.query(`SELECT * FROM fabric_types WHERE deleted_at IS NULL ORDER BY code`);
  },

  insert(code, name, description) {
    return pool.query(
      `INSERT INTO fabric_types (code, name, description) VALUES ($1, $2, $3) RETURNING *`,
      [code, name, description || null]
    );
  },

  update(code, name, description) {
    return pool.query(
      `UPDATE fabric_types SET name=$1, description=$2 WHERE code=$3 RETURNING *`,
      [name, description || null, code]
    );
  },

  countMachinesUsing(code) {
    return pool.query(`SELECT COUNT(*) FROM machines WHERE fabric_code=$1`, [code]);
  },

  // Soft delete — recoverable from Trash. `code` is the primary key, so a
  // deleted fabric type still holds its code; recreating that code means
  // restoring it rather than inserting a second one, which is the honest
  // behaviour for a natural key.
  remove(code) {
    return pool.query(
      `UPDATE fabric_types SET deleted_at = NOW() WHERE code=$1 AND deleted_at IS NULL`, [code]);
  },
});
