// Downtime routes — list/create/close + open/stats/reason (layered arch).
// Handlers moved VERBATIM; app.<m>('/api/downtime...') -> router.<m>('/...').
// Mounted at /api/downtime. list/open/stats/reason no auth; POST/close OPERATOR.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole, io, getShiftSettings, detectCurrentShift }) => {
  const router = express.Router();

  // Every route below requires a valid session. Applied at router level so a
  // route added later is guarded by default; individual routes add requireRole
  // on top where a specific role is needed.
  router.use(verifyToken);


  router.get("/", async (req, res) => {
    try {
      const { date, machine_id, status, source } = req.query;
      const conditions = [];
      const params = [];
      let p = 1;
      if (date)       { conditions.push(`DATE(md.start_time) = $${p++}`); params.push(date); }
      if (machine_id) { conditions.push(`md.machine_id = $${p++}`);       params.push(machine_id); }
      if (status)     { conditions.push(`md.status = $${p++}`);           params.push(status); }
      if (source)     { conditions.push(`md.source = $${p++}`);           params.push(source); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  
      const baseQuery = `
        SELECT md.*,
               m.machine_name,
               m.machine_type,
               ROUND(CASE WHEN md.end_time IS NULL
                 THEN EXTRACT(EPOCH FROM(NOW()-md.start_time))/60
                 ELSE md.duration_minutes END, 1) AS current_minutes
        FROM machine_downtime md
        LEFT JOIN machines m ON md.machine_id = m.machine_id
        ${where}
        ORDER BY md.start_time DESC`;
      // Backward-compatible optional pagination: ?page=N (else full array as before)
      const page = req.query.page ? (parseInt(req.query.page) || 1) : null;
      if (!page) {
        const result = await pool.query(baseQuery, params);
        return res.json(result.rows);
      }
      const limit  = Math.min(parseInt(req.query.limit || '50') || 50, 200);
      const offset = (page - 1) * limit;
      const [rows, cnt] = await Promise.all([
        pool.query(`${baseQuery} LIMIT $${p} OFFSET $${p + 1}`, [...params, limit, offset]),
        pool.query(`SELECT COUNT(*) FROM machine_downtime md ${where}`, params),
      ]);
      const total = parseInt(cnt.rows[0].count);
      res.json({ data: rows.rows, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/", verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try {
      const { machine_id, reason, shift } = req.body;
      if (!machine_id) return res.status(400).json({ error: "machine_id is required" });
      const shiftSettings = await getShiftSettings();
      const currentShift  = shift || detectCurrentShift(shiftSettings);
      const result = await pool.query(
        `INSERT INTO machine_downtime (machine_id, reason, start_time, status, source, shift)
         VALUES ($1, $2, NOW(), 'OPEN', 'MANUAL', $3)
         RETURNING *`,
        [machine_id, reason || 'Manual Entry', currentShift]
      );
      await pool.query(`UPDATE machines SET machine_status='STOPPED' WHERE machine_id=$1`, [machine_id]);
      await pool.query(
        `INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1, 'OPEN_DOWNTIME', 'DOWNTIME', $2)`,
        [req.user?.username || 'system', `machine=${machine_id} reason=${reason || 'Manual Entry'}`]
      );
      io.emit('downtime_opened', result.rows[0]);
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/:id/close", verifyToken, requireRole('OPERATOR'), async (req, res) => {
  
    try {
  
      const { id } = req.params;
  
      const result = await pool.query(
        `UPDATE machine_downtime
         SET end_time = NOW(),
             duration_minutes = EXTRACT(EPOCH FROM(NOW()-start_time))/60,
             status = 'CLOSED'
         WHERE id = $1
         RETURNING *`,
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Downtime record not found" });
      }
  
      await pool.query(
        `INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1, 'CLOSE_DOWNTIME', 'DOWNTIME', $2)`,
        [req.user.username, `downtime_id=${id}`]
      );
      io.emit('downtime_closed', result.rows[0]);
      res.json(result.rows[0]);
  
    } catch (err) {
  
      console.error(err);
  
      res.status(500).json({
        error: err.message
      });
  
    }
  
  });

  router.get("/open", async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT md.*,
               m.machine_name,
               m.machine_type,
               ROUND(EXTRACT(EPOCH FROM(NOW()-md.start_time))/60, 1) AS current_minutes
        FROM machine_downtime md
        LEFT JOIN machines m ON md.machine_id = m.machine_id
        WHERE md.status = 'OPEN'
        ORDER BY md.start_time ASC
      `);
      res.json(r.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  router.get("/stats", async (req, res) => {
    try {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const [openR, todayR, reasonsR, machineR] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) AS open_count,
                  COUNT(*) FILTER (WHERE reason='Reason Pending' OR reason IS NULL) AS pending_reason_count
           FROM machine_downtime WHERE status='OPEN'`
        ),
        pool.query(
          `SELECT COUNT(*) AS incidents,
                  COALESCE(SUM(CASE WHEN end_time IS NULL
                    THEN EXTRACT(EPOCH FROM(NOW()-start_time))/60
                    ELSE duration_minutes END),0) AS total_minutes
           FROM machine_downtime WHERE DATE(start_time)=$1`, [date]
        ),
        pool.query(
          `SELECT COALESCE(reason,'Unassigned') AS reason,
                  COUNT(*) AS occurrences,
                  ROUND(SUM(CASE WHEN end_time IS NULL
                    THEN EXTRACT(EPOCH FROM(NOW()-start_time))/60
                    ELSE duration_minutes END),1) AS total_minutes
           FROM machine_downtime
           WHERE DATE(start_time)=$1
           GROUP BY reason ORDER BY total_minutes DESC LIMIT 8`, [date]
        ),
        pool.query(
          `SELECT md.machine_id,
                  COALESCE(m.machine_name, md.machine_id) AS machine_name,
                  COUNT(*) AS incidents,
                  ROUND(SUM(CASE WHEN md.end_time IS NULL
                    THEN EXTRACT(EPOCH FROM(NOW()-md.start_time))/60
                    ELSE md.duration_minutes END),1) AS total_minutes
           FROM machine_downtime md
           LEFT JOIN machines m ON md.machine_id=m.machine_id
           WHERE DATE(md.start_time)=$1
           GROUP BY md.machine_id, m.machine_name
           ORDER BY total_minutes DESC`, [date]
        )
      ]);
      const open  = openR.rows[0];
      const today = todayR.rows[0];
      res.json({
        date,
        open_count:           parseInt(open.open_count),
        pending_reason_count: parseInt(open.pending_reason_count),
        today_incidents:      parseInt(today.incidents),
        today_minutes:        Math.round(parseFloat(today.total_minutes) * 10) / 10,
        top_reasons:          reasonsR.rows,
        machine_ranking:      machineR.rows
      });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  router.put("/:id/reason", requireRole('OPERATOR'), async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      if (!reason || !reason.trim()) return res.status(400).json({ error: "reason is required" });
      const r = await pool.query(
        `UPDATE machine_downtime SET reason=$1 WHERE id=$2 RETURNING *`,
        [reason.trim(), id]
      );
      if (r.rows.length === 0) return res.status(404).json({ error: "Record not found" });
      res.json(r.rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  return router;
};
