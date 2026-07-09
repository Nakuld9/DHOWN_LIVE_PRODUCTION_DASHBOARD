// Fabric-types repository — data access only. SQL preserved verbatim from server.js.
module.exports = (pool) => ({
  getAll() {
    return pool.query(`SELECT * FROM fabric_types ORDER BY code`);
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

  remove(code) {
    return pool.query(`DELETE FROM fabric_types WHERE code=$1`, [code]);
  },
});
