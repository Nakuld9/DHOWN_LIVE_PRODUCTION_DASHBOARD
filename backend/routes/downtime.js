const express = require("express");
const router = express.Router();
const pool = require("../db");


// GET ALL DOWNTIME RECORDS
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM machine_downtime
      ORDER BY start_time DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// ADD DOWNTIME
router.post("/", async (req, res) => {
  try {
    const {
      machine_id,
      reason,
      operator_name,
      remarks
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO machine_downtime
      (
        machine_id,
        reason,
        operator_name,
        remarks,
        start_time,
        status
      )
      VALUES
      ($1,$2,$3,$4,NOW(),'OPEN')
      RETURNING *
      `,
      [
        machine_id,
        reason,
        operator_name,
        remarks
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// CLOSE DOWNTIME
router.put("/:id/close", async (req, res) => {
  try {
    const id = req.params.id;

    const result = await pool.query(
      `
      UPDATE machine_downtime
      SET
        end_time = NOW(),
        status = 'CLOSED'
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;