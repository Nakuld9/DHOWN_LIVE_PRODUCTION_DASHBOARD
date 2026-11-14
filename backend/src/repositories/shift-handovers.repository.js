// Shift-handovers repository — shift_handovers notes. SQL verbatim from the
// original inline /api/shift-handovers handlers.
module.exports = (pool) => ({
  list(limit) {
    return pool.query(`SELECT * FROM shift_handovers ORDER BY shift_date DESC, created_at DESC LIMIT $1`, [limit]);
  },

  insert(b, username) {
    return pool.query(
      `INSERT INTO shift_handovers (shift_date, shift, supervisor_name, production_kg, machines_down, issues, actions_taken, pending_actions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [b.shift_date, b.shift, b.supervisor_name || username, b.production_kg || 0, b.machines_down || 0, b.issues || null, b.actions_taken || null, b.pending_actions || null]
    );
  },
});
