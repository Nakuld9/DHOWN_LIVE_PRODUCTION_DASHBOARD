// RFID routes — tag lookup, events feed, and scan (attendance + assignment).
// Handlers moved VERBATIM from server.js; app.<m>('/api/rfid...') -> router.<m>('/rfid...').
// Mounted at /api. rfid/:tag + rfid-events: no auth; rfid-scan: verifyToken.
const express = require('express');

module.exports = ({ pool, verifyToken, io, requireRole}) => {
  const router = express.Router();

  router.get("/rfid/:tag", async (req, res) => {
  
    try {
  
      const { tag } = req.params;
  
      const result = await pool.query(
        `
        SELECT *
        FROM operators
        WHERE rfid_tag = $1
        `,
        [tag]
      );
      if (result.rows.length > 0) {
  
    await pool.query(
      `
      INSERT INTO rfid_events
      (
        rfid_tag,
        operator_id
      )
      VALUES
      (
        $1,
        $2
      )
      `,
      [
        result.rows[0].rfid_tag,
        result.rows[0].operator_id
      ]
    );
  
  }
  
      if (result.rows.length === 0) {
        return res.status(404).json({
          error: "RFID not found"
        });
      }
  
      res.json(result.rows[0]);
  
    } catch (err) {
  
      console.error(err);
  
      res.status(500).json({
        error: err.message
      });
  
    }
  
  });

  router.get("/rfid-events", async (req, res) => {
    try {
      const page  = parseInt(req.query.page  || '1')  || 1;
      const limit = Math.min(parseInt(req.query.limit || '50') || 50, 200);
      const offset = (page - 1) * limit;
  
      const [rows, cnt] = await Promise.all([
        pool.query(`SELECT * FROM rfid_events ORDER BY event_time DESC LIMIT $1 OFFSET $2`, [limit, offset]),
        pool.query(`SELECT COUNT(*) FROM rfid_events`),
      ]);
      const total = parseInt(cnt.rows[0].count);
      res.json({ data: rows.rows, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/rfid-scan", verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try {
      const { tag_id, rfid_tag, machine_id } = req.body;
      const scannedTag = tag_id || rfid_tag;
      if (!scannedTag) return res.status(400).json({ error: "rfid_tag is required" });
  
      const operatorRes = await pool.query(
        `SELECT * FROM operators WHERE rfid_tag = $1 AND COALESCE(status, 'ACTIVE') != 'INACTIVE'`,
        [scannedTag]
      );
      if (operatorRes.rows.length === 0) {
        return res.status(404).json({ error: "No active operator found for this RFID tag" });
      }
      const operator = operatorRes.rows[0];
  
      await pool.query(
        `INSERT INTO rfid_events (rfid_tag, operator_id, machine_id, event_time)
         VALUES ($1, $2, $3, NOW())`,
        [scannedTag, operator.operator_id, machine_id || null]
      );
  
      let assignment = null;
      if (machine_id) {
        await pool.query(
          `UPDATE operator_assignments
           SET status = 'RELEASED', released_at = NOW()
           WHERE (machine_id = $1 OR operator_id = $2)
             AND status = 'ACTIVE'`,
          [machine_id, operator.operator_id]
        );
  
        const assignmentRes = await pool.query(
          `INSERT INTO operator_assignments
             (operator_id, operator_name, machine_id, assigned_at, status)
           VALUES ($1, $2, $3, NOW(), 'ACTIVE')
           RETURNING *`,
          [operator.operator_id, operator.operator_name, machine_id]
        );
        assignment = assignmentRes.rows[0];
  
        await pool.query(
          `UPDATE machines SET active = true, machine_status = COALESCE(NULLIF(machine_status, ''), 'ACTIVE') WHERE machine_id = $1`,
          [machine_id]
        );
      }
  
      // Auto-log attendance â€" first scan = clock-in, subsequent = update last_seen + scan_count
      try {
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const hour = now.getHours();
        const shift = (hour >= 8 && hour < 20) ? 'D' : 'N';
        await pool.query(
          `INSERT INTO operator_attendance
             (operator_id, operator_name, work_date, shift, clock_in, last_seen, scan_count, status)
           VALUES ($1, $2, $3, $4, NOW(), NOW(), 1, 'PRESENT')
           ON CONFLICT (operator_id, work_date, shift) DO UPDATE SET
             last_seen  = NOW(),
             clock_out  = NOW(),
             scan_count = operator_attendance.scan_count + 1,
             updated_at = NOW()`,
          [operator.operator_id, operator.operator_name, today, shift]
        );
      } catch (attErr) {
        console.error('[ATTENDANCE] Failed to log:', attErr.message);
      }
  
      io.emit('rfid_scan', { operator, machine_id, tag_id: scannedTag, assignment });
      res.json({
        success: true,
        operator,
        operator_id: operator.operator_id,
        operator_name: operator.operator_name,
        machine_id: machine_id || null,
        assignment
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
