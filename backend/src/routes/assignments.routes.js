// assignments routes — operator assignments + release (layered architecture).
// Handlers moved VERBATIM; app.<m>('/api/assignments...') -> router.<m>('/...'). Mounted at /api/assignments.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();

  // Every route below requires a valid session. Applied at router level so a
  // route added later is guarded by default; individual routes add requireRole
  // on top where a specific role is needed.
  router.use(verifyToken);


  router.get("/", async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          a.assignment_id,
          o.operator_name,
          a.machine_id,
          a.assigned_at,
          a.released_at,
          a.status
        FROM operator_assignments a
        LEFT JOIN operators o
        ON a.operator_id = o.operator_id
        ORDER BY a.assigned_at DESC
      `);
  
      res.json(result.rows);
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/", verifyToken, requireRole('OPERATOR'), async (req, res) => {
  
    try {
  
      const {
        operator_id,
        machine_id
      } = req.body;
  
      if (!operator_id || !machine_id) {
        return res.status(400).json({ error: "operator_id and machine_id are required" });
      }
  
      // Release existing active assignment on this machine and this operator.
      // An operator can only be ACTIVE on one machine, and a machine can only have one ACTIVE operator.
      await pool.query(
        `
        UPDATE operator_assignments
        SET
          status = 'RELEASED',
          released_at = NOW()
        WHERE (machine_id = $1 OR operator_id = $2)
        AND status = 'ACTIVE'
        `,
        [machine_id, operator_id]
      );
  
      // Get operator name
  const operatorResult = await pool.query(
    `
    SELECT operator_name
    FROM operators
    WHERE operator_id = $1
    `,
    [operator_id]
  );
  
  const operator_name =
    operatorResult.rows[0].operator_name;
  
  // Create new assignment
  const result = await pool.query(
    `
    INSERT INTO operator_assignments
    (
      operator_id,
      operator_name,
      machine_id,
      assigned_at,
      status
    )
    VALUES
    (
      $1,
      $2,
      $3,
      NOW(),
      'ACTIVE'
    )
    RETURNING *
    `,
    [
      operator_id,
      operator_name,
      machine_id
    ]
  );
  
      await pool.query(
        `UPDATE machines SET active = true, machine_status = COALESCE(NULLIF(machine_status, ''), 'ACTIVE') WHERE machine_id = $1`,
        [machine_id]
      );
  
      res.json(result.rows[0]);
  
    } catch (err) {
  
      console.error(err);
  
      res.status(500).json({
        error: err.message
      });
  
    }
  
  });

  router.put('/:id/release', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try {
      const r = await pool.query(
        "UPDATE operator_assignments SET status='RELEASED', released_at=NOW() WHERE assignment_id=$1 AND status='ACTIVE' RETURNING *",
        [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Assignment not found or already released' });
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
