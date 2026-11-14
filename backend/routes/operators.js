const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM operators ORDER BY operator_id"
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {

    const {
      operator_code,
      operator_name,
      rfid_tag,
      mobile
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO operators
      (
        operator_code,
        operator_name,
        rfid_tag,
        mobile,
        status
      )
      VALUES
      (
        $1,$2,$3,$4,'ACTIVE'
      )
      RETURNING *
      `,
      [
        operator_code,
        operator_name,
        rfid_tag,
        mobile
      ]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message
    });
  }
});

module.exports = router;