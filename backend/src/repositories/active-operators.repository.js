// Active-operators repository — currently-assigned operators. SQL verbatim.
module.exports = (pool) => ({
  listActive() {
    return pool.query(`
      SELECT
        oa.assignment_id,
        oa.operator_id,
        oa.machine_id,
        oa.assigned_at,
        oa.operator_name,
        m.machine_name,
        m.machine_type,
        m.fabric
      FROM operator_assignments oa
      LEFT JOIN machines m ON oa.machine_id = m.machine_id
      WHERE oa.status = 'ACTIVE'
      ORDER BY oa.assigned_at DESC
    `);
  },
});
