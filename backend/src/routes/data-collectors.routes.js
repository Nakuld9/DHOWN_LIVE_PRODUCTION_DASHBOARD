// data-collectors routes — DC registration/list/update/delete (layered architecture).
// Handlers moved VERBATIM; app.<m>('/api/data-collectors...') -> router.<m>('/...'). Mounted at /api/data-collectors.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();

  // Every route below requires a session. Applied at router level so a route
  // added later is guarded by default.
  router.use(verifyToken);


  router.post("/", requireRole('ADMIN'), async (req, res) => {
    try {
      const { dc_id, machine_id, ip_address } = req.body;
      if (!dc_id || !machine_id) return res.status(400).json({ error: "dc_id and machine_id are required" });
  
      const result = await pool.query(
        `INSERT INTO data_collectors (dc_id, machine_id, ip_address, status, last_seen)
         VALUES ($1, $2, $3, 'OFFLINE', NULL)
         ON CONFLICT (dc_id) DO UPDATE SET
           machine_id = EXCLUDED.machine_id,
           ip_address = EXCLUDED.ip_address
         RETURNING *`,
        [dc_id, machine_id, ip_address || null]
      );
  
      // Link dc_id back to the machine record
      await pool.query(
        `UPDATE machines SET dc_id = $1 WHERE machine_id = $2`,
        [dc_id, machine_id]
      );
  
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/", async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT dc.*, m.machine_name
        FROM data_collectors dc
        LEFT JOIN machines m ON dc.machine_id = m.machine_id
        ORDER BY dc.dc_id
      `);
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/:dcId", verifyToken, requireRole('ADMIN'), async (req, res) => {
    try {
      const { dcId } = req.params;
      const { ip_address, status } = req.body;
      const result = await pool.query(
        `UPDATE data_collectors SET ip_address = $1, status = $2 WHERE dc_id = $3 RETURNING *`,
        [ip_address, status, dcId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: "Data collector not found" });
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete("/:dcId", verifyToken, requireRole('ADMIN'), async (req, res) => {
    try {
      const { dcId } = req.params;
  
      const existing = await pool.query(
        `SELECT dc_id, machine_id, status FROM data_collectors WHERE dc_id = $1 AND deleted_at IS NULL`,
        [dcId]
      );
      if (existing.rows.length === 0) return res.status(404).json({ error: "Data collector not found" });
  
      const dc = existing.rows[0];
      if ((dc.status || "").toUpperCase() === "ONLINE") {
        return res.status(409).json({ error: "Cannot delete an actively connected collector. It must be OFFLINE first." });
      }
  
      if (dc.machine_id) {
        await pool.query(`UPDATE machines SET dc_id = NULL WHERE machine_id = $1`, [dc.machine_id]);
      }
  
      await pool.query(
        `UPDATE data_collectors SET deleted_at = NOW() WHERE dc_id = $1 AND deleted_at IS NULL`, [dcId]);
  
      res.json({ success: true, message: `Data collector ${dcId} deleted` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
