// machine-settings routes — per-machine settings (layered architecture).
// Handlers moved VERBATIM; app.<m>('/api/machine-settings...') -> router.<m>('/...'). Mounted at /api/machine-settings.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole}) => {
  const router = express.Router();

  // Every route below requires a session. Applied at router level so a route
  // added later is guarded by default.
  router.use(verifyToken);


  router.get("/", async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT m.machine_id, m.machine_name, m.machine_type, m.diameter, m.gauge, m.feeders,
               m.fabric, m.fabric_code, m.dc_id, m.rpm_target, m.kg_per_counter, m.machine_status, m.active,
               m.manufacturer, m.model, m.serial_number, m.needles_count, m.cylinder_diameter, m.purchase_date, m.installation_date,
               ft.name AS fabric_name
        FROM machines m
        LEFT JOIN fabric_types ft ON m.fabric_code = ft.code
        ORDER BY CASE SUBSTRING(m.machine_id, 1, 2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END, m.machine_id
      `);
      res.json(r.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  router.put("/:machineId", verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const { machineId } = req.params;
      const { fabric_code, gauge, rpm_target, kg_per_counter, manufacturer, model, serial_number, needles_count, cylinder_diameter, purchase_date, installation_date } = req.body;
      const existing = await pool.query(`SELECT * FROM machines WHERE machine_id = $1`, [machineId]);
      if (existing.rows.length === 0) return res.status(404).json({ error: "Machine not found" });
      const cur = existing.rows[0];
      const r = await pool.query(
        `UPDATE machines
         SET fabric_code = $1, gauge = $2, rpm_target = $3, kg_per_counter = $4,
             manufacturer = $5, model = $6, serial_number = $7, needles_count = $8,
             cylinder_diameter = $9, purchase_date = $10, installation_date = $11
         WHERE machine_id = $12
         RETURNING *`,
        [
          fabric_code !== undefined ? (fabric_code || null) : cur.fabric_code,
          gauge !== undefined ? parseInt(gauge) : cur.gauge,
          rpm_target !== undefined ? parseInt(rpm_target) : cur.rpm_target,
          kg_per_counter !== undefined ? parseFloat(kg_per_counter) : cur.kg_per_counter,
          manufacturer !== undefined ? (manufacturer || null) : cur.manufacturer,
          model !== undefined ? (model || null) : cur.model,
          serial_number !== undefined ? (serial_number || null) : cur.serial_number,
          needles_count !== undefined ? (needles_count ? parseInt(needles_count) : null) : cur.needles_count,
          cylinder_diameter !== undefined ? (cylinder_diameter ? parseFloat(cylinder_diameter) : null) : cur.cylinder_diameter,
          purchase_date !== undefined ? (purchase_date || null) : cur.purchase_date,
          installation_date !== undefined ? (installation_date || null) : cur.installation_date,
          machineId
        ]
      );
      await pool.query(
        `INSERT INTO audit_logs (username, action, module, old_value, new_value)
         VALUES ($1, 'UPDATE_MACHINE_SETTINGS', 'MACHINE_SETTINGS', $2, $3)`,
        [req.user.username,
         `fabric_code=${cur.fabric_code} gauge=${cur.gauge} rpm_target=${cur.rpm_target} kg_per_counter=${cur.kg_per_counter}`,
         `fabric_code=${fabric_code ?? cur.fabric_code} gauge=${gauge ?? cur.gauge} rpm_target=${rpm_target ?? cur.rpm_target} kg_per_counter=${kg_per_counter ?? cur.kg_per_counter}`
        ]
      );
      res.json(r.rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  return router;
};
