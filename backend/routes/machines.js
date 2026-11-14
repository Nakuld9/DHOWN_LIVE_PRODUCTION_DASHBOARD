router.get("/:machineId/details", async (req, res) => {
  try {

    const { machineId } = req.params;

    const result = await pool.query(
      `
      SELECT
        m.machine_id,
        m.machine_name,
        m.machine_type,
        m.diameter,
        m.gauge,
        m.fabric,
        m.rpm_target,
        m.machine_status,
        m.dc_status,

        ld.rpm,
        ld.operator_name,
        ld.shift,
        ld.production_counter,

        r.roll_id,
        r.roll_weight_kg,
        r.status AS roll_status

      FROM machines m

      LEFT JOIN machine_live_data ld
      ON m.machine_id = ld.machine_id

      LEFT JOIN rolls r
      ON m.machine_id = r.machine_id
      AND r.status IN ('OPEN','PENDING')

      WHERE m.machine_id = $1

      LIMIT 1
      `,
      [machineId]
    );

    res.json(result.rows[0]);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }
});