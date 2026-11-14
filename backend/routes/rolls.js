router.put("/approve/:rollId", async (req, res) => {
  try {
    const { rollId } = req.params;

    const {
      actual_weight_kg,
      supervisor_name
    } = req.body;

    const result = await pool.query(
      `
      UPDATE rolls
      SET
        actual_weight_kg = $1,
        supervisor_name = $2,
        approved_at = NOW(),
        status = 'APPROVED'
      WHERE roll_id = $3
      RETURNING *
      `,
      [
        actual_weight_kg,
        supervisor_name,
        rollId
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