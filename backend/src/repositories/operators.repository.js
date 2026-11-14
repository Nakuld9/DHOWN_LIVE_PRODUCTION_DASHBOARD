// Operators repository — data access only. SQL preserved verbatim from server.js.
// Dependency-injected pool (the monolith's own pool) so shared DB config stays untouched.
module.exports = (pool) => ({
  findAll(includeInactive) {
    return pool.query(
      `SELECT * FROM operators
       ${includeInactive ? '' : "WHERE status != 'INACTIVE'"}
       ORDER BY operator_name`
    );
  },

  // Highest numeric suffix used for the given code prefix (per worker type),
  // plus the highest company-wide EMP number. 0 if none. Prefix is passed as a
  // literal (from a fixed server-side map, never user input).
  nextSequences(codePrefix) {
    return pool.query(
      `SELECT
         COALESCE(MAX(CASE WHEN operator_code ~ ('^' || $1 || '[0-9]+$')
              THEN (regexp_replace(operator_code, '\\D', '', 'g'))::int END), 0) AS max_code,
         COALESCE(MAX(CASE WHEN employee_id ~ '^EMP[0-9]+$'
              THEN (regexp_replace(employee_id, '\\D', '', 'g'))::int END), 0) AS max_emp
       FROM operators`,
      [codePrefix]
    );
  },

  insert(b) {
    // shift intentionally NOT stored — shifts rotate weekly and are handled by
    // assignments/attendance, not fixed on the operator record.
    return pool.query(
      `INSERT INTO operators
       (operator_code, operator_name, rfid_tag, mobile, department, shift, employee_id, join_date, skill_level, emergency_contact, worker_type, wage_type, wage_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        b.operator_code,
        b.operator_name,
        b.rfid_tag || null,
        b.mobile || null,
        b.department || null,
        null,
        b.employee_id || null,
        b.join_date || null,
        b.skill_level || 'BASIC',
        b.emergency_contact || null,
        b.worker_type || 'OPERATOR',
        b.wage_type || 'DAILY',
        Number(b.wage_rate) || 0
      ]
    );
  },

  findById(id) {
    return pool.query(`SELECT * FROM operators WHERE operator_id = $1`, [id]);
  },

  update(id, cur, b) {
    return pool.query(
      `UPDATE operators
       SET operator_name = $1, rfid_tag = $2, mobile = $3, department = $4, shift = $5, status = $6,
           employee_id = $7, join_date = $8, skill_level = $9, emergency_contact = $10, worker_type = $11,
           wage_type = $12, wage_rate = $13
       WHERE operator_id = $14
       RETURNING *`,
      [
        b.operator_name     ?? cur.operator_name,
        b.rfid_tag          ?? cur.rfid_tag,
        b.mobile            ?? cur.mobile,
        b.department        ?? cur.department,
        b.shift             ?? cur.shift,
        b.status            ?? cur.status,
        b.employee_id       !== undefined ? (b.employee_id || null) : cur.employee_id,
        b.join_date         !== undefined ? (b.join_date || null)   : cur.join_date,
        b.skill_level       ?? cur.skill_level,
        b.emergency_contact !== undefined ? (b.emergency_contact || null) : cur.emergency_contact,
        b.worker_type       ?? cur.worker_type,
        b.wage_type         ?? cur.wage_type,
        b.wage_rate         !== undefined ? Number(b.wage_rate) : cur.wage_rate,
        id
      ]
    );
  },

  deactivate(id) {
    return pool.query(`UPDATE operators SET status = 'INACTIVE' WHERE operator_id = $1`, [id]);
  },
});
