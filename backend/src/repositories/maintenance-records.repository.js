// Maintenance-records repository — data access for maintenance_records.
// Extracted verbatim from the inline /api/maintenance handlers in server.js.
module.exports = (pool) => ({
  findAll() {
    return pool.query(`
      SELECT mr.*, m.machine_name, m.machine_type
      FROM maintenance_records mr
      LEFT JOIN machines m ON mr.machine_id = m.machine_id
      ORDER BY mr.maintenance_date DESC
    `);
  },

  insert(b) {
    return pool.query(
      `INSERT INTO maintenance_records
         (machine_id, maintenance_type, technician, remarks, maintenance_date, next_service_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [b.machine_id, b.maintenance_type, b.technician, b.remarks,
       b.maintenance_date || new Date(), b.next_service_date || null, b.status || 'DONE']
    );
  },

  update(id, b) {
    return pool.query(
      `UPDATE maintenance_records
       SET maintenance_type = $1, technician = $2, remarks = $3, next_service_date = $4, status = $5
       WHERE id = $6
       RETURNING *`,
      [b.maintenance_type, b.technician, b.remarks, b.next_service_date || null, b.status, id]
    );
  },

  remove(id) {
    return pool.query(`DELETE FROM maintenance_records WHERE id = $1 RETURNING id`, [id]);
  },
});
