require('dotenv').config();

const pool = require('./config/database');

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const PDFDocument = require("pdfkit");
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const JWT_SECRET = process.env.JWT_SECRET || 'dhown_mes_jwt_secret_2026';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const PG_BIN = process.env.PG_BIN || 'C:\\Program Files\\PostgreSQL\\18\\bin';

// Machine sort helper (SJ → RB → IL → TV)
const MACHINE_SORT_SQL = `CASE SUBSTRING(m.machine_id, 1, 2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END, m.machine_id`;

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests from localhost, any 192.168.x.x device, and no-origin (curl/apps)
    if (!origin || origin.includes('localhost') || /^https?:\/\/192\.168\./.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS: origin not allowed'));
    }
  },
  credentials: true,
}));
app.use(express.json());

// Serve React build for network PCs
const FRONTEND_BUILD = path.join(__dirname, '..', 'frontend', 'build');
if (fs.existsSync(FRONTEND_BUILD)) {
  app.use(express.static(FRONTEND_BUILD));
}

// ── Auth middleware ─────────────────────────────────────────────
function verifyToken(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Login rate limiter (10 attempts / 15 min per IP) ───────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// ── Supervisor PIN rate limiter (5 attempts / 5 min per IP) ────
const pinLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many PIN attempts. Try again in 5 minutes.' },
});

// ── Role-based access control ───────────────────────────────────
const ROLE_HIERARCHY = { VIEWER: 1, OPERATOR: 2, SUPERVISOR: 3, ADMIN: 4, SUPER_ADMIN: 5 };
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if ((ROLE_HIERARCHY[req.user.role] || 0) < (ROLE_HIERARCHY[minRole] || 99)) {
      return res.status(403).json({ error: `Requires ${minRole} role or higher` });
    }
    next();
  };
}


const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

// ==========================
// GET MACHINES (LIVE STATUS)
// ==========================
app.get('/api/machines', async (req, res) => {

  try {

    const shiftCfg    = await getShiftSettings();
    const currentShift = detectCurrentShift(shiftCfg);

    const result = await pool.query(`
      SELECT
        m.*,
        ft.name AS fabric_name,
        COALESCE(ld.rpm, 0) AS rpm,
        COALESCE(ld.production_counter, 0) AS production_counter,
        (COALESCE(ld.production_counter, 0) * COALESCE(m.kg_per_counter, 0)) AS production_kg,
        COALESCE(ld.session_production_kg, 0) AS session_production_kg,
        COALESCE(ld.operator_name, 'N/A') AS operator_name,
        COALESCE(ld.operator_id, '') AS live_operator_id,
        COALESCE(ld.dc_status, 'offline') AS dc_status,
        COALESCE(ld.shift, '') AS live_shift,
        ld.timestamp AS last_data_at,
        dc.ip_address AS dc_ip,
        COALESCE(dc.status, 'UNREGISTERED') AS dc_network_status,
        dc.last_seen AS dc_last_seen,
        dt.id AS downtime_id,
        dt.reason AS downtime_reason,
        dt.start_time AS downtime_start_time,
        ROUND(EXTRACT(EPOCH FROM(NOW()-dt.start_time))/60, 1) AS downtime_duration_minutes,
        COALESCE(pr_today.today_kg, 0) AS today_production_kg,
        COALESCE(pr_shift.shift_kg, 0) AS shift_production_kg,
        CASE
          WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
          WHEN LOWER(COALESCE(ld.dc_status, 'offline')) <> 'online' THEN 'OFFLINE'
          WHEN COALESCE(ld.rpm, 0) > 0 THEN 'RUNNING'
          ELSE 'STOPPED'
        END AS live_status
      FROM machines m
      LEFT JOIN machine_live_data ld ON m.machine_id = ld.machine_id
      LEFT JOIN data_collectors dc ON m.dc_id = dc.dc_id
      LEFT JOIN fabric_types ft ON m.fabric_code = ft.code
      LEFT JOIN LATERAL (
        SELECT id, reason, start_time
        FROM machine_downtime
        WHERE machine_id = m.machine_id AND status = 'OPEN'
        ORDER BY start_time DESC
        LIMIT 1
      ) dt ON true
      LEFT JOIN (
        SELECT machine_id, ROUND(SUM(production_kg)::NUMERIC, 3) AS today_kg
        FROM production_records
        WHERE record_date = CURRENT_DATE
        GROUP BY machine_id
      ) pr_today ON pr_today.machine_id = m.machine_id
      LEFT JOIN (
        SELECT machine_id, ROUND(SUM(production_kg)::NUMERIC, 3) AS shift_kg
        FROM production_records
        WHERE record_date = CURRENT_DATE AND shift = $1
        GROUP BY machine_id
      ) pr_shift ON pr_shift.machine_id = m.machine_id
      ORDER BY CASE SUBSTRING(m.machine_id, 1, 2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END, m.machine_id
    `, [currentShift]);

    res.json(result.rows);

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: err.message });

  }

});

// ==========================
// UPDATE MACHINE
// ==========================
app.put('/api/machines/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {

  const { id } = req.params;

  const {
    machine_name,
    machine_type,
    diameter,
    gauge,
    feeders,
    fabric,
    dc_id,
    rpm_target,
    kg_per_counter,
    machine_status,
    active
  } = req.body;

  try {

    await pool.query(
      `
      UPDATE machines
      SET
        machine_name = $1,
        machine_type = $2,
        diameter = $3,
        gauge = $4,
        feeders = $5,
        fabric = $6,
        dc_id = $7,
        rpm_target = $8,
        kg_per_counter = $9,
        machine_status = $10,
        active = $11
      WHERE machine_id = $12
      `,
      [
        machine_name,
        machine_type,
        diameter,
        gauge,
        feeders,
        fabric,
        dc_id,
        rpm_target,
        kg_per_counter,
        machine_status,
        active,
        id
      ]
    );

    res.json({
      success: true,
      message: "Machine Updated"
    });

  } catch (err) {

    console.error("UPDATE ERROR:", err);

    res.status(500).json({
      error: "Update Failed"
    });

  }

});

// ==========================
// MACHINE DETAILS
// ==========================
app.get('/api/machines/:machineId/details', async (req, res) => {

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
        m.kg_per_counter,
        m.machine_status,
        m.dc_id,
        m.fabric_code,
        ft.name AS fabric_name,
        COALESCE(ld.rpm, 0) AS rpm,
        COALESCE(ld.production_counter, 0) AS production_counter,
        COALESCE(ld.operator_name, 'N/A') AS operator_name,
        COALESCE(ld.dc_status, 'offline') AS dc_status,
        ld.shift,
        ld.timestamp AS last_data_at,
        dc.ip_address AS dc_ip,
        COALESCE(dc.status, 'UNREGISTERED') AS dc_network_status,
        dc.last_seen AS dc_last_seen,
        dt.reason AS downtime_reason,
        dt.start_time AS downtime_start_time,
        ROUND(EXTRACT(EPOCH FROM(NOW()-dt.start_time))/60, 1) AS downtime_duration_minutes,
        CASE
          WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
          WHEN LOWER(COALESCE(ld.dc_status, 'offline')) <> 'online' THEN 'OFFLINE'
          WHEN COALESCE(ld.rpm, 0) > 0 THEN 'RUNNING'
          ELSE 'STOPPED'
        END AS live_status,
        r.roll_id,
        r.roll_weight_kg,
        r.status AS roll_status
      FROM machines m
      LEFT JOIN machine_live_data ld ON m.machine_id = ld.machine_id
      LEFT JOIN data_collectors dc ON m.dc_id = dc.dc_id
      LEFT JOIN fabric_types ft ON m.fabric_code = ft.code
      LEFT JOIN rolls r ON m.machine_id = r.machine_id AND r.status IN ('OPEN', 'PENDING')
      LEFT JOIN LATERAL (
        SELECT id, reason, start_time
        FROM machine_downtime
        WHERE machine_id = m.machine_id AND status = 'OPEN'
        ORDER BY start_time DESC LIMIT 1
      ) dt ON true
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

// ==========================
// GET LIVE DATA
// ==========================
app.get('/api/live-data', async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT *
      FROM machine_live_data
      ORDER BY id DESC
    `);

    res.json(result.rows);

  } catch (err) {

    console.error('LIVE DATA ERROR:', err);

    res.status(500).json({
      error: 'Live Data Error'
    });

  }

});


// ==========================
// SOCKET CONNECTION
// ==========================
io.on('connection', () => {});

app.put('/api/rolls/approve/:rollId', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {

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

    await pool.query(
      `INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1, 'APPROVE_ROLL', 'ROLLS', $2)`,
      [req.user.username, `roll_id=${rollId} weight=${actual_weight_kg}kg`]
    );
    res.json(result.rows[0]);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

});

// ==========================
// GET OPERATORS
// ==========================
app.get('/api/operators', async (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    const result = await pool.query(
      `SELECT * FROM operators
       ${includeInactive ? '' : "WHERE status != 'INACTIVE'"}
       ORDER BY operator_name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load operators' });
  }
});

// ==========================
// ADD OPERATOR
// ==========================
app.post('/api/operators', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {

  const {
    operator_code,
    operator_name,
    rfid_tag,
    mobile,
    department,
    shift,
    employee_id,
    join_date,
    skill_level,
    emergency_contact
  } = req.body;

  try {

    const result = await pool.query(
      `INSERT INTO operators
       (operator_code, operator_name, rfid_tag, mobile, department, shift, employee_id, join_date, skill_level, emergency_contact)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        operator_code,
        operator_name,
        rfid_tag || null,
        mobile || null,
        department || null,
        shift || null,
        employee_id || null,
        join_date || null,
        skill_level || 'BASIC',
        emergency_contact || null
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

// ==========================
// EDIT OPERATOR
// ==========================
app.put('/api/operators/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const { operator_name, rfid_tag, mobile, department, shift, status, employee_id, join_date, skill_level, emergency_contact } = req.body;
    const existing = await pool.query(`SELECT * FROM operators WHERE operator_id = $1`, [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Operator not found' });
    const cur = existing.rows[0];
    const r = await pool.query(
      `UPDATE operators
       SET operator_name = $1, rfid_tag = $2, mobile = $3, department = $4, shift = $5, status = $6,
           employee_id = $7, join_date = $8, skill_level = $9, emergency_contact = $10
       WHERE operator_id = $11
       RETURNING *`,
      [
        operator_name     ?? cur.operator_name,
        rfid_tag          ?? cur.rfid_tag,
        mobile            ?? cur.mobile,
        department        ?? cur.department,
        shift             ?? cur.shift,
        status            ?? cur.status,
        employee_id       !== undefined ? (employee_id || null) : cur.employee_id,
        join_date         !== undefined ? (join_date || null)   : cur.join_date,
        skill_level       ?? cur.skill_level,
        emergency_contact !== undefined ? (emergency_contact || null) : cur.emergency_contact,
        id
      ]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// DEACTIVATE OPERATOR (soft delete)
// ==========================
app.delete('/api/operators/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query(`SELECT * FROM operators WHERE operator_id = $1`, [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Operator not found' });
    await pool.query(`UPDATE operators SET status = 'INACTIVE' WHERE operator_id = $1`, [id]);
    res.json({ success: true, message: 'Operator deactivated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// ASSIGNMENTS
// ==========================

app.get("/api/assignments", async (req, res) => {
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

app.get("/api/rfid/:tag", async (req, res) => {

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

app.post("/api/assignments", verifyToken, requireRole('OPERATOR'), async (req, res) => {

  try {

    const {
      operator_id,
      machine_id
    } = req.body;

    // Release existing active assignment on this machine
    await pool.query(
      `
      UPDATE operator_assignments
      SET
        status = 'RELEASED',
        released_at = NOW()
      WHERE machine_id = $1
      AND status = 'ACTIVE'
      `,
      [machine_id]
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

    res.json(result.rows[0]);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

});

// ==========================
// RFID EVENTS
// ==========================

app.get("/api/rfid-events", async (req, res) => {

  try {

    const result = await pool.query(
      `
      SELECT *
      FROM rfid_events
      ORDER BY event_time DESC
      `
    );

    res.json(result.rows);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

});

// ==========================
// GET DOWNTIME
// ==========================

app.get("/api/downtime", async (req, res) => {
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

    const result = await pool.query(`
      SELECT md.*,
             m.machine_name,
             m.machine_type,
             ROUND(CASE WHEN md.end_time IS NULL
               THEN EXTRACT(EPOCH FROM(NOW()-md.start_time))/60
               ELSE md.duration_minutes END, 1) AS current_minutes
      FROM machine_downtime md
      LEFT JOIN machines m ON md.machine_id = m.machine_id
      ${where}
      ORDER BY md.start_time DESC
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// ==========================
// START DOWNTIME
// ==========================

app.post("/api/downtime", verifyToken, requireRole('OPERATOR'), async (req, res) => {
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


// ==========================
// CLOSE DOWNTIME
// ==========================

app.put("/api/downtime/:id/close", verifyToken, requireRole('OPERATOR'), async (req, res) => {

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

// ==========================
// ALERTS
// ==========================

app.get("/api/alerts", async (req, res) => {

  try {

    const stoppedMachines = await pool.query(`
      SELECT m.*,
        CASE
          WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
          WHEN LOWER(COALESCE(ld.dc_status,'offline')) <> 'online' THEN 'OFFLINE'
          WHEN COALESCE(ld.rpm,0) > 0 THEN 'RUNNING'
          ELSE 'STOPPED'
        END AS live_status
      FROM machines m
      LEFT JOIN machine_live_data ld ON m.machine_id = ld.machine_id
      LEFT JOIN LATERAL (
        SELECT id FROM machine_downtime
        WHERE machine_id = m.machine_id AND status = 'OPEN'
        ORDER BY start_time DESC LIMIT 1
      ) dt ON true
      WHERE (
        CASE
          WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
          WHEN LOWER(COALESCE(ld.dc_status,'offline')) <> 'online' THEN 'OFFLINE'
          WHEN COALESCE(ld.rpm,0) > 0 THEN 'RUNNING'
          ELSE 'STOPPED'
        END
      ) IN ('STOPPED', 'DOWNTIME')
    `);

    const openDowntime = await pool.query(`
      SELECT md.*, m.machine_name,
        ROUND(EXTRACT(EPOCH FROM(NOW()-md.start_time))/60, 1) AS current_minutes
      FROM machine_downtime md
      LEFT JOIN machines m ON md.machine_id = m.machine_id
      WHERE md.status = 'OPEN'
      ORDER BY md.start_time ASC
    `);

    const activeAssignments = await pool.query(`
      SELECT machine_id
      FROM operator_assignments
      WHERE status='ACTIVE'
    `);

    res.json({
      stoppedMachines:
        stoppedMachines.rows,

      openDowntime:
        openDowntime.rows,

      activeAssignments:
        activeAssignments.rows
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

});

// ==========================
// REPORTS API
// ==========================
// PRODUCTION PDF
app.get("/api/reports", async (req, res) => {

  try {

    // MACHINES
    const machines = await pool.query(`
      SELECT
        machine_id,
        machine_name,
        machine_status
      FROM machines
      ORDER BY machine_id
    `);

    // OPERATORS
    const operators = await pool.query(`
      SELECT
        operator_id,
        operator_name,
        status
      FROM operators
      ORDER BY operator_name
    `);

    // ASSIGNMENTS
    const assignments = await pool.query(`
      SELECT
        oa.assignment_id,
        oa.machine_id,
        oa.assigned_at,
        oa.released_at,
        oa.status,
        o.operator_name
      FROM operator_assignments oa
      LEFT JOIN operators o
      ON oa.operator_id = o.operator_id
      ORDER BY oa.assigned_at DESC
    `);

    // DOWNTIME
    const downtime = await pool.query(`
      SELECT
        id,
        machine_id,
        reason,
        start_time,
        end_time,
        duration_minutes
      FROM machine_downtime
      ORDER BY start_time DESC
    `);

    res.json({
      machines: machines.rows,
      operators: operators.rows,
      assignments: assignments.rows,
      downtime: downtime.rows
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

});

// ==========================
// PDF REPORTS
// ==========================
app.get("/api/reports/production-pdf", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        roll_id,
        machine_id,
        fabric_type,
        shift,
        COALESCE(actual_weight_kg, weight_kg) AS weight,
        created_at
      FROM rolls
      ORDER BY created_at DESC
    `);

    const rows = result.rows;

    const doc = new PDFDocument({ margin: 40 });

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Production_Report.pdf"
    );

    doc.pipe(res);

    doc.fontSize(22)
      .text("DHOWN HOSIERY MILLS", {
        align: "center",
      });

    doc.moveDown();

    doc.fontSize(16)
      .text("Production Report", {
        align: "center",
      });

    doc.moveDown(2);

    doc.fontSize(12);

    doc.text(
      `Generated: ${new Date().toLocaleString()}`
    );

    doc.moveDown();

    let totalWeight = 0;

    rows.forEach((row) => {
      totalWeight += Number(row.weight || 0);

      doc.text(
        `${row.roll_id} | ${row.machine_id} | ${row.fabric_type} | Shift ${row.shift} | ${row.weight} Kg`
      );
    });

    doc.moveDown(2);

    doc.fontSize(16)
      .text(
        `Total Production: ${totalWeight.toFixed(
          2
        )} Kg`
      );

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message,
    });
  }
});
 // DOWNTIME PDF
 app.get("/api/reports/downtime-pdf", async (req, res) => {
  try {
    const PDFDocument = require("pdfkit");

    const result = await pool.query(`
      SELECT *
      FROM machine_downtime
      ORDER BY start_time DESC
    `);

    const doc = new PDFDocument({ margin: 40 });

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Downtime_Report.pdf"
    );

    doc.pipe(res);

    doc.fontSize(22)
      .text("DHOWN HOSIERY MILLS", {
        align: "center",
      });

    doc.moveDown();

    doc.fontSize(18)
      .text("Downtime Report", {
        align: "center",
      });

    doc.moveDown(2);

    result.rows.forEach((row) => {
      doc.text(
        `${row.machine_id} | ${row.reason} | ${row.duration_minutes || 0} Min`
      );
    });

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
//OPERATOR PDF
app.get("/api/reports/operator-pdf", async (req, res) => {
  try {
    const PDFDocument = require("pdfkit");

    const result = await pool.query(`
      SELECT *
      FROM operators
      ORDER BY operator_name
    `);

    const doc = new PDFDocument();

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Operator_Report.pdf"
    );

    doc.pipe(res);

    doc.fontSize(22)
      .text("DHOWN HOSIERY MILLS", {
        align: "center",
      });

    doc.moveDown();

    doc.fontSize(18)
      .text("Operator Report", {
        align: "center",
      });

    doc.moveDown(2);

    result.rows.forEach((row) => {
      doc.text(
        `${row.operator_id} | ${row.operator_name} | ${row.status}`
      );
    });

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//RFID EVENTS PDF
app.get("/api/reports/rfid-pdf", async (req, res) => {
  try {
    const PDFDocument = require("pdfkit");

    const result = await pool.query(`
      SELECT *
      FROM rfid_events
      ORDER BY event_time DESC
    `);

    const doc = new PDFDocument();

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=RFID_Report.pdf"
    );

    doc.pipe(res);

    doc.fontSize(22)
      .text("DHOWN HOSIERY MILLS", {
        align: "center",
      });

    doc.moveDown();

    doc.fontSize(18)
      .text("RFID Activity Report", {
        align: "center",
      });

    doc.moveDown(2);

    result.rows.forEach((row) => {
      doc.text(
        `${row.rfid_tag} | ${row.operator_id} | ${row.machine_id} | ${row.event_time}`
      );
    });

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
///ASSIGNMENTS PDF
app.get("/api/reports/assignments-pdf", async (req, res) => {
  try {
    const PDFDocument = require("pdfkit");

    const result = await pool.query(`
      SELECT *
      FROM operator_assignments
      ORDER BY assigned_at DESC
    `);

    const doc = new PDFDocument();

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Assignments_Report.pdf"
    );

    doc.pipe(res);

    doc.fontSize(22)
      .text("DHOWN HOSIERY MILLS", {
        align: "center",
      });

    doc.moveDown();

    doc.fontSize(18)
      .text("Assignments Report", {
        align: "center",
      });

    doc.moveDown(2);

    result.rows.forEach((row) => {
      doc.text(
        `${row.operator_name} | ${row.machine_id} | ${row.status}`
      );
    });

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FACTORY SUMMARY
app.get("/api/reports/summary-pdf", async (req, res) => {
  try {
    const PDFDocument = require("pdfkit");

    const machines = await pool.query(
      "SELECT COUNT(*) FROM machines"
    );

    const operators = await pool.query(
      "SELECT COUNT(*) FROM operators"
    );

    const assignments = await pool.query(
      "SELECT COUNT(*) FROM operator_assignments WHERE status='ACTIVE'"
    );

    const downtime = await pool.query(
      "SELECT COUNT(*) FROM machine_downtime"
    );

    const doc = new PDFDocument();

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Factory_Summary.pdf"
    );

    doc.pipe(res);

    doc.fontSize(24)
      .text("DHOWN HOSIERY MILLS", {
        align: "center",
      });

    doc.moveDown();

    doc.fontSize(18)
      .text("Factory Summary", {
        align: "center",
      });

    doc.moveDown(2);

    doc.text(
      `Total Machines: ${machines.rows[0].count}`
    );

    doc.text(
      `Total Operators: ${operators.rows[0].count}`
    );

    doc.text(
      `Active Assignments: ${assignments.rows[0].count}`
    );

    doc.text(
      `Downtime Records: ${downtime.rows[0].count}`
    );

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =============================
// DASHBOARD KPI API
// =============================

app.get("/api/dashboard/kpis", async (req, res) => {
  try {

    const shiftCfg    = await getShiftSettings();
    const currentShift = detectCurrentShift(shiftCfg);
    const today        = new Date().toISOString().slice(0, 10);

    // Total machine count from machines master table
    const totalResult = await pool.query(
      `SELECT COUNT(*) FROM machines`
    );
    const totalMachines = Number(totalResult.rows[0].count);

    // Full status breakdown + live counter sum
    const statusResult = await pool.query(`
      SELECT
        m.machine_id,
        ld.machine_id AS ld_machine_id,
        ld.rpm,
        ld.dc_status,
        COALESCE(ld.production_counter, 0) AS production_counter,
        m.kg_per_counter
      FROM machines m
      LEFT JOIN machine_live_data ld ON m.machine_id = ld.machine_id
    `);

    const rows = statusResult.rows;

    const running  = rows.filter(r => r.ld_machine_id !== null && (r.dc_status || "").toLowerCase() === "online" && Number(r.rpm || 0) > 0).length;
    const stopped  = rows.filter(r => r.ld_machine_id !== null && (r.dc_status || "").toLowerCase() === "online" && Number(r.rpm || 0) === 0).length;
    const offline  = rows.filter(r => r.ld_machine_id !== null && (r.dc_status || "").toLowerCase() !== "online").length;
    const noData   = rows.filter(r => r.ld_machine_id === null).length;

    const production = rows.reduce(
      (sum, r) => sum + Number(r.production_counter || 0) * Number(r.kg_per_counter || 0), 0
    );

    const totalLiveCounter = rows.reduce((sum, r) => sum + Number(r.production_counter || 0), 0);

    const liveRows = rows.filter(r => r.ld_machine_id !== null);
    const avgRpm = liveRows.length > 0
      ? Math.round(liveRows.reduce((sum, r) => sum + Number(r.rpm || 0), 0) / liveRows.length)
      : 0;

    // Today & shift production from production_records
    const [todayProd, shiftProd] = await Promise.all([
      pool.query(
        `SELECT ROUND(COALESCE(SUM(production_kg),0)::NUMERIC, 3) AS kg
         FROM production_records WHERE record_date = $1`, [today]
      ),
      pool.query(
        `SELECT ROUND(COALESCE(SUM(production_kg),0)::NUMERIC, 3) AS kg
         FROM production_records WHERE record_date = $1 AND shift = $2`, [today, currentShift]
      )
    ]);

    res.json({
      totalMachines,
      running,
      stopped,
      offline,
      noData,
      production:           Math.round(production * 1000) / 1000,
      efficiency:           avgRpm,
      total_live_counter:   totalLiveCounter,
      today_production_kg:  parseFloat(todayProd.rows[0].kg  || 0),
      shift_production_kg:  parseFloat(shiftProd.rows[0].kg  || 0),
      current_shift:        currentShift
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


//===========================
// TREND API
//===========================
app.get("/api/dashboard/oee", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const shiftSettings = await getShiftSettings();
    const shift = detectCurrentShift(shiftSettings);
    const r = await pool.query(
      `SELECT ROUND(AVG(oee),2) AS oee, ROUND(AVG(availability),2) AS availability,
              ROUND(AVG(performance),2) AS performance, ROUND(AVG(quality),2) AS quality
       FROM oee_records WHERE record_date=$1 AND shift=$2`,
      [today, shift]
    );
    const row = r.rows[0] || {};
    res.json({
      oee: row.oee || 0,
      availability: row.availability || 0,
      performance: row.performance || 0,
      quality: row.quality || 100,
      shift,
      date: today
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

//===================
// production trend api
//====================
app.get("/api/dashboard/production-trend", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ld.machine_id,
             COALESCE(ld.session_production_kg, 0) AS production_kg
      FROM machine_live_data ld
      ORDER BY production_kg DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
// ============================================================
// PHASE 5 — SHIFT CONFIG HELPERS  (read from app_settings, no hardcodes)
// ============================================================

async function getShiftSettings() {
  const r = await pool.query(
    `SELECT key, value FROM app_settings
     WHERE key IN ('day_shift','night_shift','shift_mode',
                   'shift_a_start','shift_a_end','shift_b_start','shift_b_end',
                   'shift_c_start','shift_c_end',
                   'planned_hours_per_shift','quality_target_pct',
                   'auto_downtime_enabled','auto_downtime_threshold_minutes')`
  );
  const s = {};
  r.rows.forEach(row => { s[row.key] = row.value; });
  return s;
}

function parseHHMM(str) {
  const parts = (str || '00:00').replace(/[^0-9:]/g,'').split(':');
  return parseInt(parts[0] || 0) + parseInt(parts[1] || 0) / 60;
}

function detectCurrentShift(s) {
  const now = new Date();
  const t = now.getHours() + now.getMinutes() / 60;
  const mode = s.shift_mode || '2-shift';

  if (mode === '3-shift') {
    const aS = parseHHMM(s.shift_a_start || '06:00');
    const aE = parseHHMM(s.shift_a_end   || '14:00');
    const bS = parseHHMM(s.shift_b_start || '14:00');
    const bE = parseHHMM(s.shift_b_end   || '22:00');
    if (t >= aS && t < aE) return 'D';
    if (t >= bS && t < bE) return 'N';
    return 'C';
  }

  // 2-shift: Day (D) 08:00-20:00, Night (N) 20:00-08:00
  const dayStr = s.day_shift || '08:00 - 20:00';
  const [dStart, dEnd] = dayStr.split(' - ').map(x => parseHHMM(x.trim()));
  if (t >= dStart && t < dEnd) return 'D';
  return 'N';
}

function computeLiveStatus(dcStatus, rpm) {
  if ((dcStatus || '').toLowerCase() !== 'online') return 'OFFLINE';
  return Number(rpm || 0) > 0 ? 'RUNNING' : 'STOPPED';
}

async function updateOEE(pool, machine_id, today, shift, rpm, rpmTarget, plannedMinutes, qualityTarget) {
  const [runR, stoppedR, prodR] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(
         CASE WHEN end_time IS NULL
              THEN EXTRACT(EPOCH FROM (NOW()-start_time))/60
              ELSE duration_minutes END
       ), 0) AS mins
       FROM machine_status_log
       WHERE machine_id=$1 AND DATE(start_time)=$2 AND shift=$3 AND status='RUNNING'`,
      [machine_id, today, shift]
    ),
    pool.query(
      `SELECT COALESCE(SUM(
         CASE WHEN end_time IS NULL
              THEN EXTRACT(EPOCH FROM (NOW()-start_time))/60
              ELSE duration_minutes END
       ), 0) AS mins
       FROM machine_status_log
       WHERE machine_id=$1 AND DATE(start_time)=$2 AND shift=$3 AND status='STOPPED'`,
      [machine_id, today, shift]
    ),
    pool.query(
      `SELECT COALESCE(SUM(production_kg),0) AS kg
       FROM production_records WHERE machine_id=$1 AND record_date=$2 AND shift=$3`,
      [machine_id, today, shift]
    )
  ]);

  const runMins     = parseFloat(runR.rows[0].mins || 0);
  const stoppedMins = parseFloat(stoppedR.rows[0].mins || 0);
  const prodKg      = parseFloat(prodR.rows[0].kg || 0);
  const avail       = plannedMinutes > 0 ? Math.min(100, Math.round(runMins / plannedMinutes * 10000) / 100) : 0;
  const perf        = rpmTarget > 0      ? Math.min(100, Math.round(Number(rpm || 0) / rpmTarget * 10000) / 100) : 0;
  const oee         = Math.round(avail * perf * qualityTarget / 10000 * 100) / 100;

  await pool.query(
    `INSERT INTO oee_records
       (machine_id,record_date,shift,planned_minutes,run_minutes,stopped_minutes,availability,performance,quality,oee,production_kg,rpm_avg,sample_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1)
     ON CONFLICT (machine_id,record_date,shift) DO UPDATE SET
       run_minutes     = $5,
       stopped_minutes = $6,
       availability    = $7,
       performance     = $8,
       quality         = $9,
       oee             = $10,
       production_kg   = $11,
       rpm_avg         = ROUND((oee_records.rpm_avg * oee_records.sample_count + $12) / (oee_records.sample_count + 1), 2),
       sample_count    = oee_records.sample_count + 1,
       updated_at      = NOW()`,
    [machine_id, today, shift, plannedMinutes, runMins, stoppedMins, avail, perf, qualityTarget, oee, prodKg, rpm || 0]
  );
}

// ==========================
// POST LIVE DATA (DC PUSH) — Phase 5 engine
// ==========================
app.post("/api/live-data", async (req, res) => {
  try {
    const { machine_id, rpm, dc_status, production_counter, operator_id, operator_name, shift: shiftOverride } = req.body;
    if (!machine_id) return res.status(400).json({ error: "machine_id is required" });

    // ── 1. Shift config from app_settings (no hardcodes) ─────────
    const shiftSettings  = await getShiftSettings();
    const currentShift   = shiftOverride || detectCurrentShift(shiftSettings);
    const plannedMinutes = parseFloat(shiftSettings.planned_hours_per_shift || '8') * 60;
    const qualityTarget  = parseFloat(shiftSettings.quality_target_pct || '100');

    // ── 2. Current row + machine config ──────────────────────────
    const [liveRow, machRow] = await Promise.all([
      pool.query('SELECT * FROM machine_live_data WHERE machine_id=$1', [machine_id]),
      pool.query('SELECT kg_per_counter, rpm_target FROM machines WHERE machine_id=$1', [machine_id])
    ]);
    const current    = liveRow.rows[0] || null;
    const machine    = machRow.rows[0] || {};
    const kpc        = parseFloat(machine.kg_per_counter || 0);
    const rpmTarget  = parseFloat(machine.rpm_target || 0);

    // ── 3. Production delta using kg_per_counter from machines ───
    const newCounter  = parseFloat(production_counter || 0);
    const oldCounter  = current ? parseFloat(current.production_counter || 0) : 0;
    const delta       = newCounter > oldCounter ? newCounter - oldCounter : newCounter;
    const prodDeltaKg = kpc > 0 ? Math.round(delta * kpc * 100000) / 100000 : 0;
    const sessionKg   = Math.round(((current ? parseFloat(current.session_production_kg || 0) : 0) + prodDeltaKg) * 100000) / 100000;

    // ── 4. Live status ────────────────────────────────────────────
    const newStatus  = computeLiveStatus(dc_status, rpm);
    const prevStatus = current ? current.last_status : null;

    // ── 5. Status-change log ──────────────────────────────────────
    if (prevStatus !== newStatus) {
      await pool.query(
        `UPDATE machine_status_log
         SET end_time=NOW(), duration_minutes=EXTRACT(EPOCH FROM(NOW()-start_time))/60
         WHERE machine_id=$1 AND end_time IS NULL`,
        [machine_id]
      );
      await pool.query(
        `INSERT INTO machine_status_log (machine_id, status, shift, start_time) VALUES ($1,$2,$3,NOW())`,
        [machine_id, newStatus, currentShift]
      );
    }

    // ── 5.5. Auto-downtime detection ─────────────────────────────
    // Reads auto_downtime_enabled + auto_downtime_threshold_minutes from shiftSettings.
    // Only creates/closes downtime records. Does NOT touch production_records, oee_records,
    // shift detection, RPM, counter, or any calculation logic.
    const autoEnabled   = shiftSettings.auto_downtime_enabled !== 'false';
    const autoThreshold = parseFloat(shiftSettings.auto_downtime_threshold_minutes || '2');

    if (autoEnabled) {
      if (newStatus === 'STOPPED') {
        // When machine is STOPPED, check how long it has been stopped.
        // The machine_status_log row for this STOPPED run was created in step 5.
        const stoppedRow = await pool.query(
          `SELECT start_time FROM machine_status_log
           WHERE machine_id=$1 AND status='STOPPED' AND end_time IS NULL
           ORDER BY start_time DESC LIMIT 1`,
          [machine_id]
        );
        if (stoppedRow.rows.length > 0) {
          const stoppedMinutes = (Date.now() - new Date(stoppedRow.rows[0].start_time)) / 60000;
          if (stoppedMinutes >= autoThreshold) {
            // Only create if no open downtime already exists for this machine
            const openDt = await pool.query(
              `SELECT id FROM machine_downtime WHERE machine_id=$1 AND status='OPEN' LIMIT 1`,
              [machine_id]
            );
            if (openDt.rows.length === 0) {
              await pool.query(
                `INSERT INTO machine_downtime (machine_id, reason, start_time, status, source, shift)
                 VALUES ($1, 'Reason Pending', $2, 'OPEN', 'AUTO', $3)`,
                [machine_id, stoppedRow.rows[0].start_time, currentShift]
              );
            }
          }
        }
      } else if (newStatus === 'RUNNING') {
        // Machine resumed — close all open downtime records for this machine
        await pool.query(
          `UPDATE machine_downtime
           SET end_time = NOW(),
               duration_minutes = EXTRACT(EPOCH FROM(NOW()-start_time))/60,
               status = 'CLOSED'
           WHERE machine_id=$1 AND status='OPEN'`,
          [machine_id]
        );
      }
    }

    // ── 6. UPSERT machine_live_data ───────────────────────────────
    const result = await pool.query(
      `INSERT INTO machine_live_data
         (machine_id, rpm, dc_status, production_counter, operator_id, operator_name, shift, timestamp,
          previous_counter, session_production_kg, last_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,$9,$10)
       ON CONFLICT (machine_id) DO UPDATE SET
         rpm                  = EXCLUDED.rpm,
         dc_status            = EXCLUDED.dc_status,
         production_counter   = EXCLUDED.production_counter,
         operator_id          = EXCLUDED.operator_id,
         operator_name        = EXCLUDED.operator_name,
         shift                = EXCLUDED.shift,
         timestamp            = NOW(),
         previous_counter     = COALESCE(machine_live_data.production_counter, 0),
         session_production_kg= $9,
         last_status          = $10
       RETURNING *`,
      [machine_id, rpm||0, dc_status||'online', production_counter||0, operator_id||null, operator_name||null,
       currentShift, oldCounter, sessionKg, newStatus]
    );

    // ── 7. Sync machines.dc_status ────────────────────────────────
    await pool.query('UPDATE machines SET dc_status=$1 WHERE machine_id=$2', [dc_status||'online', machine_id]);

    // ── 8. Data-collector heartbeat ───────────────────────────────
    await pool.query(
      `UPDATE data_collectors SET status='ONLINE', last_seen=NOW() WHERE machine_id=$1`,
      [machine_id]
    );

    // ── 9. Upsert production_records ──────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO production_records
         (machine_id, record_date, shift, counter_start, counter_end, production_kg, rpm_sum, sample_count)
       VALUES ($1,$2,$3,$4,$4,$5,$6,1)
       ON CONFLICT (machine_id,record_date,shift) DO UPDATE SET
         counter_end   = $4,
         production_kg = production_records.production_kg + $5,
         rpm_sum       = production_records.rpm_sum + $6,
         sample_count  = production_records.sample_count + 1,
         updated_at    = NOW()`,
      [machine_id, today, currentShift, newCounter, prodDeltaKg, rpm||0]
    );

    // ── 10. Compute and store OEE ─────────────────────────────────
    await updateOEE(pool, machine_id, today, currentShift, rpm, rpmTarget, plannedMinutes, qualityTarget);

    // ── 11. Upsert hourly production_history bucket ───────────────
    const nowDt   = new Date();
    const hBucket = nowDt.getHours();
    const hStart  = new Date(nowDt.getFullYear(), nowDt.getMonth(), nowDt.getDate(), hBucket, 0, 0);
    const hEnd    = new Date(hStart.getTime() + 3600000);
    await pool.query(
      `INSERT INTO production_history
         (machine_id, period_type, period_start, period_end, shift, record_date, hour_bucket,
          counter_start, counter_end, production_kg, rpm_avg, sample_count)
       VALUES ($1,'HOURLY',$2,$3,$4,$5,$6,$7,$8,$9,$10,1)
       ON CONFLICT (machine_id,period_type,record_date,hour_bucket,shift) DO UPDATE SET
         counter_end   = $8,
         production_kg = production_history.production_kg + $9,
         rpm_avg       = ROUND(
           (production_history.rpm_avg * production_history.sample_count + $10)::NUMERIC
           / (production_history.sample_count + 1), 2),
         sample_count  = production_history.sample_count + 1,
         updated_at    = NOW()`,
      [machine_id, hStart.toISOString(), hEnd.toISOString(), currentShift, today, hBucket,
       newCounter, newCounter, prodDeltaKg, rpm || 0]
    );

    // Emit real-time update so connected dashboards can refresh immediately
    io.emit('machine_update', { machine_id, status: result.rows[0]?.live_status });

    res.json({
      success: true,
      data: result.rows[0],
      shift: currentShift,
      production_delta_kg: prodDeltaKg
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// GET CHARTS — MACHINE TRENDS (hourly from production_history)
// GET /api/charts/trends?machine_id=SJ-01&hours=12
// ==========================
app.get("/api/charts/trends", async (req, res) => {
  try {
    const { machine_id, hours = 12 } = req.query;
    if (!machine_id) return res.status(400).json({ error: "machine_id required" });
    const h = Math.min(Math.max(parseInt(hours) || 12, 1), 48);
    const r = await pool.query(
      `SELECT
         TO_CHAR(period_start AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS label,
         ROUND(rpm_avg::NUMERIC, 1)                                    AS rpm_avg,
         (counter_end - counter_start)                                 AS counter_delta,
         ROUND(production_kg::NUMERIC, 3)                              AS production_kg
       FROM production_history
       WHERE machine_id  = $1
         AND period_type = 'HOURLY'
         AND period_start >= NOW() - ($2 || ' hours')::INTERVAL
       ORDER BY period_start ASC`,
      [machine_id, h]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// GET CHARTS — HOURLY PRODUCTION (all machines for a date)
// GET /api/charts/production-hourly?date=YYYY-MM-DD&machine_id=
// ==========================
app.get("/api/charts/production-hourly", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { date = today, machine_id } = req.query;
    const params = [date];
    let where = `period_type = 'HOURLY' AND record_date = $1`;
    if (machine_id) { where += ` AND machine_id = $2`; params.push(machine_id); }
    const r = await pool.query(
      `SELECT machine_id,
              hour_bucket,
              TO_CHAR(period_start AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS label,
              ROUND(production_kg::NUMERIC, 3) AS production_kg,
              ROUND(rpm_avg::NUMERIC, 1)        AS rpm_avg,
              (counter_end - counter_start)     AS counter_delta
       FROM production_history
       WHERE ${where}
       ORDER BY machine_id,
         CASE SUBSTRING(machine_id,1,2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END,
         hour_bucket ASC`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// POST REGISTER DATA COLLECTOR
// ==========================
app.post("/api/data-collectors", async (req, res) => {
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

// ==========================
// ROLLS — CREATE & CLOSE
// ==========================
app.post("/api/rolls", verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const { machine_id, fabric_type, shift, start_counter, operator_id, roll_id } = req.body;
    if (!machine_id) return res.status(400).json({ error: "machine_id is required" });
    if (!shift) return res.status(400).json({ error: "shift is required (A or B)" });

    // Auto-generate roll_id using prefix + fabric_code from machine master
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
    const [prefixRow, machineRow, seqRow] = await Promise.all([
      pool.query(`SELECT value FROM app_settings WHERE key='roll_prefix'`),
      pool.query(`SELECT fabric_code, fabric, gauge FROM machines WHERE machine_id=$1`, [machine_id]),
      pool.query(`SELECT COUNT(*) AS cnt FROM rolls WHERE machine_id=$1 AND DATE(created_at)=CURRENT_DATE`, [machine_id])
    ]);
    const prefix = (prefixRow.rows[0]?.value || 'DHM-').replace(/[-\s]+$/, '');
    const fabricCode = machineRow.rows[0]?.fabric_code || null;
    const resolvedFabricType = fabric_type || machineRow.rows[0]?.fabric || null;
    const gaugeVal = machineRow.rows[0]?.gauge ? `G${machineRow.rows[0].gauge}` : null;
    const seq = String(parseInt(seqRow.rows[0].cnt) + 1).padStart(3, '0');
    const fabricPart = fabricCode ? `-${fabricCode}` : '';
    const gaugePart = gaugeVal ? `-${gaugeVal}` : '';
    const shiftLabel = shift === 'D' ? 'D' : shift === 'N' ? 'N' : shift;
    const generatedId = roll_id || `${prefix}-${machine_id}${fabricPart}${gaugePart}-${datePart}-${shiftLabel}-${seq}`;

    // Check for existing open roll on this machine
    const existing = await pool.query(
      `SELECT roll_id FROM rolls WHERE machine_id = $1 AND status = 'OPEN' LIMIT 1`,
      [machine_id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `Machine ${machine_id} already has an open roll: ${existing.rows[0].roll_id}` });
    }

    const result = await pool.query(
      `INSERT INTO rolls (roll_id, machine_id, fabric_type, shift, start_counter, current_counter, status, created_at, operator_id)
       VALUES ($1, $2, $3, $4, $5, $5, 'OPEN', NOW(), $6)
       RETURNING *`,
      [generatedId, machine_id, resolvedFabricType, shift, start_counter || 0, operator_id || null]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/rolls/:rollId/close", verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const { rollId } = req.params;
    const { actual_weight_kg, current_counter } = req.body;

    const result = await pool.query(
      `UPDATE rolls
       SET status = 'CLOSED',
           actual_weight_kg = $1,
           current_counter = COALESCE($2, current_counter),
           closed_at = NOW()
       WHERE roll_id = $3
       RETURNING *`,
      [actual_weight_kg || null, current_counter || null, rollId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Roll not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/rolls", async (req, res) => {
  try {
    const { status, machine_id } = req.query;
    const conds = []; const vals = []; let p = 1;
    if (status)     { conds.push(`r.status = $${p++}`);     vals.push(status); }
    if (machine_id) { conds.push(`r.machine_id = $${p++}`); vals.push(machine_id); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(`
      SELECT r.*, m.machine_name, m.machine_type,
             COALESCE(ld.session_production_kg, 0) AS live_kg
      FROM rolls r
      LEFT JOIN machines m ON r.machine_id = m.machine_id
      LEFT JOIN machine_live_data ld ON r.machine_id = ld.machine_id
      ${where}
      ORDER BY r.created_at DESC
    `, vals);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ==========================
// ACTIVE OPERATORS
// ==========================
app.get("/api/active-operators", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        oa.assignment_id,
        oa.operator_id,
        oa.machine_id,
        oa.assigned_at,
        oa.operator_name,
        m.machine_name,
        m.machine_type,
        m.fabric
      FROM operator_assignments oa
      LEFT JOIN machines m ON oa.machine_id = m.machine_id
      WHERE oa.status = 'ACTIVE'
      ORDER BY oa.assigned_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// SETTINGS API
// ==========================

app.get("/api/settings", async (req, res) => {
  try {
    const result = await pool.query(`SELECT key, value FROM app_settings ORDER BY key`);
    const settings = {};
    result.rows.forEach(row => { settings[row.key] = row.value; });
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/settings", verifyToken, async (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, String(value)]
      );
    }
    res.json({ success: true, message: "Settings saved" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// MAINTENANCE API
// ==========================

app.get("/api/maintenance", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT mr.*, m.machine_name, m.machine_type
      FROM maintenance_records mr
      LEFT JOIN machines m ON mr.machine_id = m.machine_id
      ORDER BY mr.maintenance_date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/maintenance", verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const { machine_id, maintenance_type, technician, remarks, maintenance_date, next_service_date, status } = req.body;
    const result = await pool.query(
      `INSERT INTO maintenance_records
         (machine_id, maintenance_type, technician, remarks, maintenance_date, next_service_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [machine_id, maintenance_type, technician, remarks, maintenance_date || new Date(), next_service_date || null, status || 'DONE']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/maintenance/:id", verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const { maintenance_type, technician, remarks, next_service_date, status } = req.body;
    const result = await pool.query(
      `UPDATE maintenance_records
       SET maintenance_type = $1, technician = $2, remarks = $3, next_service_date = $4, status = $5
       WHERE id = $6
       RETURNING *`,
      [maintenance_type, technician, remarks, next_service_date || null, status, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Record not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/maintenance/:id", verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`DELETE FROM maintenance_records WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Record not found" });
    res.json({ success: true, message: "Record deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// DATA COLLECTORS API
// ==========================

app.get("/api/data-collectors", async (req, res) => {
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

app.put("/api/data-collectors/:dcId", verifyToken, requireRole('ADMIN'), async (req, res) => {
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

app.delete("/api/data-collectors/:dcId", verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const { dcId } = req.params;

    const existing = await pool.query(
      `SELECT dc_id, machine_id, status FROM data_collectors WHERE dc_id = $1`,
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

    await pool.query(`DELETE FROM data_collectors WHERE dc_id = $1`, [dcId]);

    res.json({ success: true, message: `Data collector ${dcId} deleted` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// SUPERVISORS API
// ==========================

app.get("/api/supervisors", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM supervisors WHERE active = true ORDER BY supervisor_name`);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/supervisors", async (req, res) => {
  try {
    const { supervisor_name, mobile, role } = req.body;
    const result = await pool.query(
      `INSERT INTO supervisors (supervisor_name, mobile, role, active) VALUES ($1, $2, $3, true) RETURNING *`,
      [supervisor_name, mobile, role]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PHASE 5 — PRODUCTION & OEE ANALYTICS ENDPOINTS
// ============================================================

// GET /api/production/current — live snapshot all machines
app.get("/api/production/current", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT m.machine_id, m.machine_name, m.machine_type,
             COALESCE(ld.rpm, 0) AS rpm,
             m.rpm_target,
             COALESCE(ld.production_counter, 0) AS production_counter,
             COALESCE(ld.session_production_kg, 0) AS session_production_kg,
             COALESCE(m.kg_per_counter, 0) AS kg_per_counter,
             COALESCE(ld.dc_status, 'offline') AS dc_status,
             ld.shift, ld.timestamp AS last_update,
             dt.reason AS downtime_reason,
             dt.start_time AS downtime_start_time,
             CASE
               WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
               WHEN ld.machine_id IS NULL THEN 'NO_DATA'
               WHEN LOWER(COALESCE(ld.dc_status,'offline')) <> 'online' THEN 'OFFLINE'
               WHEN COALESCE(ld.rpm,0) > 0 THEN 'RUNNING'
               ELSE 'STOPPED'
             END AS live_status
      FROM machines m
      LEFT JOIN machine_live_data ld ON m.machine_id = ld.machine_id
      LEFT JOIN LATERAL (
        SELECT id, reason, start_time
        FROM machine_downtime
        WHERE machine_id = m.machine_id AND status = 'OPEN'
        ORDER BY start_time DESC LIMIT 1
      ) dt ON true
      ORDER BY CASE SUBSTRING(m.machine_id, 1, 2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END, m.machine_id`);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/production/daily?date=YYYY-MM-DD
app.get("/api/production/daily", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const r = await pool.query(`
      SELECT pr.machine_id, m.machine_name, m.machine_type, pr.record_date,
             SUM(pr.production_kg) AS production_kg,
             SUM(pr.sample_count) AS sample_count,
             ROUND(SUM(pr.rpm_sum) / NULLIF(SUM(pr.sample_count),0), 2) AS avg_rpm,
             MAX(pr.counter_end) AS last_counter
      FROM production_records pr
      LEFT JOIN machines m ON pr.machine_id = m.machine_id
      WHERE pr.record_date = $1
      GROUP BY pr.machine_id, m.machine_name, m.machine_type, pr.record_date
      ORDER BY production_kg DESC`, [date]);
    res.json({ date, records: r.rows, total_kg: r.rows.reduce((s, x) => s + parseFloat(x.production_kg || 0), 0) });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/production/shift — current shift for today
app.get("/api/production/shift", async (req, res) => {
  try {
    const shiftSettings = await getShiftSettings();
    const shift = req.query.shift || detectCurrentShift(shiftSettings);
    const today = new Date().toISOString().slice(0, 10);
    const r = await pool.query(`
      SELECT pr.machine_id, m.machine_name, pr.shift,
             pr.production_kg, pr.counter_start, pr.counter_end, pr.sample_count,
             ROUND(pr.rpm_sum / NULLIF(pr.sample_count,0), 2) AS avg_rpm, pr.updated_at
      FROM production_records pr
      LEFT JOIN machines m ON pr.machine_id = m.machine_id
      WHERE pr.record_date = $1 AND pr.shift = $2
      ORDER BY pr.production_kg DESC`, [today, shift]);
    res.json({ date: today, shift, records: r.rows, total_kg: r.rows.reduce((s, x) => s + parseFloat(x.production_kg || 0), 0) });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/oee?date=&shift=
app.get("/api/oee", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const shiftSettings = await getShiftSettings();
    const shift = req.query.shift || detectCurrentShift(shiftSettings);
    const r = await pool.query(`
      SELECT o.machine_id, m.machine_name, m.machine_type,
             o.record_date, o.shift, o.planned_minutes, o.run_minutes, o.stopped_minutes,
             o.availability, o.performance, o.quality, o.oee,
             o.production_kg, o.rpm_avg, o.sample_count, o.updated_at
      FROM oee_records o
      LEFT JOIN machines m ON o.machine_id = m.machine_id
      WHERE o.record_date = $1 AND o.shift = $2
      ORDER BY o.oee DESC`, [date, shift]);
    const avg = r.rows.length > 0 ? Math.round(r.rows.reduce((s, x) => s + parseFloat(x.oee || 0), 0) / r.rows.length * 100) / 100 : 0;
    res.json({ date, shift, records: r.rows, avg_oee: avg });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/oee/:machineId?date=
app.get("/api/oee/:machineId", async (req, res) => {
  try {
    const { machineId } = req.params;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const [todayR, histR] = await Promise.all([
      pool.query(`SELECT o.*, m.machine_name, m.rpm_target FROM oee_records o LEFT JOIN machines m ON o.machine_id=m.machine_id WHERE o.machine_id=$1 AND o.record_date=$2 ORDER BY o.updated_at DESC LIMIT 1`, [machineId, date]),
      pool.query(`SELECT record_date, shift, oee, availability, performance, production_kg FROM oee_records WHERE machine_id=$1 ORDER BY record_date DESC, shift LIMIT 30`, [machineId])
    ]);
    res.json({ machine_id: machineId, today: todayR.rows[0] || null, history: histR.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/utilization?date=
app.get("/api/utilization", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const shiftSettings = await getShiftSettings();
    const plannedMinutes = parseFloat(shiftSettings.planned_hours_per_shift || '8') * 60;
    const r = await pool.query(`
      SELECT machine_id, status,
             SUM(COALESCE(duration_minutes, EXTRACT(EPOCH FROM(NOW()-start_time))/60)) AS total_minutes
      FROM machine_status_log
      WHERE DATE(start_time) = $1
      GROUP BY machine_id, status`, [date]);
    const byMachine = {};
    r.rows.forEach(row => {
      if (!byMachine[row.machine_id]) byMachine[row.machine_id] = { running: 0, stopped: 0, offline: 0 };
      const k = (row.status || '').toLowerCase();
      if (k in byMachine[row.machine_id]) byMachine[row.machine_id][k] = parseFloat(row.total_minutes || 0);
    });
    const machines = Object.entries(byMachine).map(([machine_id, m]) => ({
      machine_id,
      running_minutes: Math.round(m.running),
      stopped_minutes: Math.round(m.stopped),
      offline_minutes: Math.round(m.offline),
      utilization_pct: plannedMinutes > 0 ? Math.min(100, Math.round(m.running / plannedMinutes * 10000) / 100) : 0
    }));
    res.json({ date, planned_minutes: plannedMinutes, machines });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/utilization/:machineId?days=
app.get("/api/utilization/:machineId", async (req, res) => {
  try {
    const { machineId } = req.params;
    const days = parseInt(req.query.days || '7');
    const r = await pool.query(`
      SELECT DATE(start_time) AS date, shift, status,
             SUM(COALESCE(duration_minutes, EXTRACT(EPOCH FROM(NOW()-start_time))/60)) AS minutes
      FROM machine_status_log
      WHERE machine_id=$1 AND start_time >= NOW() - INTERVAL '1 day' * $2
      GROUP BY DATE(start_time), shift, status
      ORDER BY date DESC, shift`, [machineId, days]);
    res.json({ machine_id: machineId, days, records: r.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/analytics/shifts?date=
app.get("/api/analytics/shifts", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const shiftSettings = await getShiftSettings();
    const currentShift = detectCurrentShift(shiftSettings);
    const [prodR, oeeR, dtR] = await Promise.all([
      pool.query(`SELECT shift, SUM(production_kg) AS production_kg, COUNT(DISTINCT machine_id) AS machines_active, SUM(sample_count) AS samples FROM production_records WHERE record_date=$1 GROUP BY shift ORDER BY shift`, [date]),
      pool.query(`SELECT shift, ROUND(AVG(oee),2) AS avg_oee, ROUND(AVG(availability),2) AS avg_availability, ROUND(AVG(performance),2) AS avg_performance FROM oee_records WHERE record_date=$1 GROUP BY shift ORDER BY shift`, [date]),
      pool.query(`SELECT reason, COUNT(*) AS occurrences, ROUND(SUM(COALESCE(duration_minutes, EXTRACT(EPOCH FROM(COALESCE(end_time,NOW())-start_time))/60)),1) AS total_minutes FROM machine_downtime WHERE DATE(start_time)=$1 GROUP BY reason ORDER BY total_minutes DESC LIMIT 10`, [date])
    ]);
    const shiftNames = {
      D: shiftSettings.day_shift   || '08:00 - 20:00',
      N: shiftSettings.night_shift || '20:00 - 08:00',
      A: `${shiftSettings.shift_a_start || '06:00'} - ${shiftSettings.shift_a_end || '14:00'}`,
      B: `${shiftSettings.shift_b_start || '14:00'} - ${shiftSettings.shift_b_end || '22:00'}`,
      C: `${shiftSettings.shift_c_start || '22:00'} - ${shiftSettings.shift_c_end || '06:00'}`
    };
    res.json({ date, current_shift: currentShift, shift_timings: shiftNames, production_by_shift: prodR.rows, oee_by_shift: oeeR.rows, downtime_reasons: dtR.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/analytics/top-downtime?days=
app.get("/api/analytics/top-downtime", async (req, res) => {
  try {
    const days = parseInt(req.query.days || '7');
    const r = await pool.query(`
      SELECT reason, COUNT(*) AS occurrences,
             ROUND(SUM(COALESCE(duration_minutes, EXTRACT(EPOCH FROM(COALESCE(end_time,NOW())-start_time))/60)),1) AS total_minutes,
             ROUND(AVG(COALESCE(duration_minutes, EXTRACT(EPOCH FROM(COALESCE(end_time,NOW())-start_time))/60)),1) AS avg_minutes
      FROM machine_downtime
      WHERE start_time >= NOW() - INTERVAL '1 day' * $1
      GROUP BY reason ORDER BY total_minutes DESC LIMIT 10`, [days]);
    const totalMins = r.rows.reduce((s, x) => s + parseFloat(x.total_minutes || 0), 0);
    res.json({ days, total_minutes: Math.round(totalMins), reasons: r.rows.map(x => ({ ...x, percentage: totalMins > 0 ? Math.round(parseFloat(x.total_minutes) / totalMins * 1000) / 10 : 0 })) });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/dashboard/live — single-call comprehensive dashboard data
app.get("/api/dashboard/live", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const shiftSettings = await getShiftSettings();
    const currentShift = detectCurrentShift(shiftSettings);
    const [machR, prodR, shiftProdR, oeeR, dtR] = await Promise.all([
      pool.query(`SELECT m.machine_id, m.machine_name, m.machine_type,
          COALESCE(ld.rpm,0) AS rpm, m.rpm_target,
          COALESCE(ld.production_counter,0) AS production_counter,
          COALESCE(ld.session_production_kg,0) AS session_production_kg,
          COALESCE(ld.dc_status,'offline') AS dc_status, ld.shift, ld.timestamp AS last_update,
          dt.reason AS downtime_reason, dt.start_time AS downtime_start_time,
          ROUND(EXTRACT(EPOCH FROM(NOW()-dt.start_time))/60,1) AS downtime_duration_minutes,
          CASE WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
               WHEN ld.machine_id IS NULL THEN 'NO_DATA'
               WHEN LOWER(COALESCE(ld.dc_status,'offline'))<>'online' THEN 'OFFLINE'
               WHEN COALESCE(ld.rpm,0)>0 THEN 'RUNNING' ELSE 'STOPPED' END AS live_status
        FROM machines m
        LEFT JOIN machine_live_data ld ON m.machine_id=ld.machine_id
        LEFT JOIN LATERAL (
          SELECT id, reason, start_time FROM machine_downtime
          WHERE machine_id=m.machine_id AND status='OPEN'
          ORDER BY start_time DESC LIMIT 1
        ) dt ON true
        ORDER BY CASE SUBSTRING(m.machine_id, 1, 2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END, m.machine_id`),
      pool.query(`SELECT COALESCE(SUM(production_kg),0) AS total_kg FROM production_records WHERE record_date=$1`, [today]),
      pool.query(`SELECT COALESCE(SUM(production_kg),0) AS shift_kg FROM production_records WHERE record_date=$1 AND shift=$2`, [today, currentShift]),
      pool.query(`SELECT ROUND(AVG(oee),2) AS avg_oee, ROUND(AVG(availability),2) AS avg_avail, ROUND(AVG(performance),2) AS avg_perf, ROUND(AVG(quality),2) AS avg_quality FROM oee_records WHERE record_date=$1 AND shift=$2`, [today, currentShift]),
      pool.query(`SELECT reason, COUNT(*) AS occurrences FROM machine_downtime WHERE start_time>=NOW()-INTERVAL '7 days' GROUP BY reason ORDER BY occurrences DESC LIMIT 5`)
    ]);
    const machines = machR.rows;
    const running   = machines.filter(m => m.live_status === 'RUNNING').length;
    const stopped   = machines.filter(m => m.live_status === 'STOPPED').length;
    const offline   = machines.filter(m => m.live_status === 'OFFLINE').length;
    const noData    = machines.filter(m => m.live_status === 'NO_DATA').length;
    const inDowntime = machines.filter(m => m.live_status === 'DOWNTIME').length;
    const oee = oeeR.rows[0] || {};
    res.json({
      timestamp: new Date().toISOString(),
      current_shift: currentShift,
      kpis: { total_machines: machines.length, running, stopped, offline, no_data: noData, in_downtime: inDowntime, utilization_pct: machines.length > 0 ? Math.round(running / machines.length * 100) : 0, daily_production_kg: Math.round(parseFloat(prodR.rows[0]?.total_kg || 0) * 1000) / 1000, shift_production_kg: Math.round(parseFloat(shiftProdR.rows[0]?.shift_kg || 0) * 1000) / 1000 },
      oee_summary: { avg_oee: oee.avg_oee || 0, avg_availability: oee.avg_avail || 0, avg_performance: oee.avg_perf || 0, avg_quality: oee.avg_quality || 100 },
      machines, top_downtime: dtR.rows
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ── Replace hardcoded GET /api/dashboard/oee with real computation ──
// (original registered earlier; this new registration takes precedence via last-wins in Express)
app.get("/api/dashboard/oee/live", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const shiftSettings = await getShiftSettings();
    const shift = detectCurrentShift(shiftSettings);
    const r = await pool.query(`SELECT ROUND(AVG(oee),2) AS oee, ROUND(AVG(availability),2) AS availability, ROUND(AVG(performance),2) AS performance, ROUND(AVG(quality),2) AS quality FROM oee_records WHERE record_date=$1 AND shift=$2`, [today, shift]);
    const row = r.rows[0] || {};
    res.json({ oee: row.oee || 0, availability: row.availability || 0, performance: row.performance || 0, quality: row.quality || 100, shift, date: today });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ── JSON Report endpoints ─────────────────────────────────────

// GET /api/reports/daily-production-report?date=
app.get("/api/reports/daily-production-report", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const r = await pool.query(`
      SELECT pr.machine_id, m.machine_name, m.machine_type, pr.shift,
             pr.production_kg, pr.counter_start, pr.counter_end, pr.sample_count,
             ROUND(pr.rpm_sum/NULLIF(pr.sample_count,0),2) AS avg_rpm, pr.updated_at
      FROM production_records pr LEFT JOIN machines m ON pr.machine_id=m.machine_id
      WHERE pr.record_date=$1
      ORDER BY CASE SUBSTRING(pr.machine_id,1,2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END, pr.machine_id, pr.shift`, [date]);
    res.json({ report: 'daily-production', date, records: r.rows, total_kg: r.rows.reduce((s, x) => s + parseFloat(x.production_kg || 0), 0) });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/shift-production-report?date=
app.get("/api/reports/shift-production-report", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const r = await pool.query(`SELECT shift, SUM(production_kg) AS total_kg, COUNT(DISTINCT machine_id) AS machines, SUM(sample_count) AS total_samples FROM production_records WHERE record_date=$1 GROUP BY shift ORDER BY shift`, [date]);
    res.json({ report: 'shift-production', date, shifts: r.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/machine-performance-report?date=
app.get("/api/reports/machine-performance-report", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const r = await pool.query(`
      SELECT m.machine_id, m.machine_name, m.machine_type, m.rpm_target,
             COALESCE(o.oee,0) AS oee, COALESCE(o.availability,0) AS availability,
             COALESCE(o.performance,0) AS performance, COALESCE(o.quality,100) AS quality,
             COALESCE(o.rpm_avg,0) AS rpm_avg, COALESCE(o.run_minutes,0) AS run_minutes,
             COALESCE(pr.production_kg,0) AS production_kg,
             COALESCE(ld.rpm,0) AS current_rpm,
             CASE WHEN ld.machine_id IS NULL THEN 'NO_DATA'
                  WHEN LOWER(COALESCE(ld.dc_status,'offline'))<>'online' THEN 'OFFLINE'
                  WHEN COALESCE(ld.rpm,0)>0 THEN 'RUNNING' ELSE 'STOPPED' END AS live_status
      FROM machines m
      LEFT JOIN (SELECT machine_id, MAX(id) AS max_id FROM oee_records WHERE record_date=$1 GROUP BY machine_id) lo ON m.machine_id=lo.machine_id
      LEFT JOIN oee_records o ON o.id=lo.max_id
      LEFT JOIN (SELECT machine_id, SUM(production_kg) AS production_kg FROM production_records WHERE record_date=$1 GROUP BY machine_id) pr ON m.machine_id=pr.machine_id
      LEFT JOIN machine_live_data ld ON m.machine_id=ld.machine_id
      ORDER BY CASE SUBSTRING(m.machine_id, 1, 2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END, m.machine_id`, [date]);
    res.json({ report: 'machine-performance', date, records: r.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/oee-report?date=
app.get("/api/reports/oee-report", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const r = await pool.query(`SELECT o.machine_id, m.machine_name, o.shift, o.availability, o.performance, o.quality, o.oee, o.run_minutes, o.stopped_minutes, o.planned_minutes, o.rpm_avg, o.production_kg, o.updated_at FROM oee_records o LEFT JOIN machines m ON o.machine_id=m.machine_id WHERE o.record_date=$1 ORDER BY CASE SUBSTRING(o.machine_id,1,2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END, o.machine_id, o.shift`, [date]);
    const avg = r.rows.length > 0 ? Math.round(r.rows.reduce((s, x) => s + parseFloat(x.oee || 0), 0) / r.rows.length * 100) / 100 : 0;
    res.json({ report: 'oee', date, avg_oee: avg, records: r.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/downtime-analysis-report?start=&end=
app.get("/api/reports/downtime-analysis-report", async (req, res) => {
  try {
    const startDate = req.query.start || new Date().toISOString().slice(0, 10);
    const endDate   = req.query.end   || startDate;
    const r = await pool.query(`
      SELECT md.machine_id, m.machine_name, md.reason, md.start_time, md.end_time,
             ROUND(COALESCE(md.duration_minutes, EXTRACT(EPOCH FROM(COALESCE(md.end_time,NOW())-md.start_time))/60),1) AS duration_minutes,
             md.status, md.source
      FROM machine_downtime md LEFT JOIN machines m ON md.machine_id=m.machine_id
      WHERE DATE(md.start_time) BETWEEN $1 AND $2
      ORDER BY md.start_time DESC`, [startDate, endDate]);
    const totalMins = r.rows.reduce((s, x) => s + parseFloat(x.duration_minutes || 0), 0);
    res.json({ report: 'downtime-analysis', start: startDate, end: endDate, total_downtime_minutes: Math.round(totalMins), records: r.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// PHASE 9 — ADVANCED REPORTING SYSTEM
// ═══════════════════════════════════════════════════════════════

// GET /api/reports/filter-options
app.get('/api/reports/filter-options', async (req, res) => {
  try {
    const [machinesR, operatorsR, fabricsR, shiftsR] = await Promise.all([
      pool.query(
        `SELECT machine_id, machine_name FROM machines
         ORDER BY CASE SUBSTRING(machine_id,1,2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END, machine_id`
      ),
      pool.query(
        `SELECT operator_id, operator_name FROM operators WHERE status = 'ACTIVE' ORDER BY operator_name`
      ),
      pool.query(
        `SELECT DISTINCT COALESCE(fabric, machine_type) AS fabric FROM machines
         WHERE COALESCE(fabric, machine_type) IS NOT NULL ORDER BY 1`
      ),
      pool.query(
        `SELECT DISTINCT shift FROM production_records WHERE shift IS NOT NULL ORDER BY shift`
      ),
    ]);
    res.json({
      machines: machinesR.rows,
      operators: operatorsR.rows,
      fabrics: fabricsR.rows.map(r => r.fabric).filter(Boolean),
      shifts: shiftsR.rows.map(r => r.shift).filter(Boolean),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/production?from&to&shift&machine&fabric
app.get('/api/reports/production', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const fromDate = req.query.from || today;
    const toDate   = req.query.to   || today;
    const { shift, machine, fabric } = req.query;

    const baseParams = [fromDate, toDate];
    let pi = 3;
    let shiftSQL = '', machineSQL = '', fabricSQL = '';
    const filterParams = [...baseParams];
    if (shift)   { shiftSQL   = `AND pr.shift = $${pi++}`;                              filterParams.push(shift); }
    if (machine) { machineSQL = `AND pr.machine_id = $${pi++}`;                         filterParams.push(machine); }
    if (fabric)  { fabricSQL  = `AND COALESCE(m.fabric, m.machine_type) = $${pi++}`;   filterParams.push(fabric); }
    const joinFilter = `${shiftSQL} ${machineSQL} ${fabricSQL}`;

    const [summaryR, machineR, fabricR, shiftR] = await Promise.all([
      pool.query(`
        SELECT
          ROUND(COALESCE(SUM(pr.production_kg),0)::NUMERIC, 3)  AS total_kg,
          COUNT(DISTINCT pr.machine_id)                           AS active_machines,
          COUNT(DISTINCT pr.shift)                                AS shifts_worked
        FROM production_records pr
        LEFT JOIN machines m ON pr.machine_id = m.machine_id
        WHERE pr.record_date BETWEEN $1 AND $2 ${joinFilter}
      `, filterParams),

      pool.query(`
        SELECT
          m.machine_id, m.machine_name,
          COALESCE(m.fabric, m.machine_type, 'N/A') AS fabric,
          ROUND(COALESCE(SUM(pr.production_kg),0)::NUMERIC, 3)                           AS production_kg,
          ROUND((SUM(pr.rpm_sum) / NULLIF(SUM(pr.sample_count),0))::NUMERIC, 2)          AS rpm_avg,
          ROUND(COALESCE(SUM(o.run_minutes),0)::NUMERIC / 60.0, 2)                       AS running_hours
        FROM production_records pr
        LEFT JOIN machines m ON pr.machine_id = m.machine_id
        LEFT JOIN oee_records o
          ON pr.machine_id = o.machine_id AND pr.record_date = o.record_date AND pr.shift = o.shift
        WHERE pr.record_date BETWEEN $1 AND $2 ${joinFilter}
        GROUP BY m.machine_id, m.machine_name, m.fabric, m.machine_type
        ORDER BY CASE SUBSTRING(m.machine_id,1,2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END, m.machine_id
      `, filterParams),

      pool.query(`
        SELECT
          COALESCE(m.fabric, m.machine_type, 'N/A') AS fabric,
          ROUND(SUM(pr.production_kg)::NUMERIC, 3)  AS production_kg
        FROM production_records pr
        LEFT JOIN machines m ON pr.machine_id = m.machine_id
        WHERE pr.record_date BETWEEN $1 AND $2 ${joinFilter}
        GROUP BY COALESCE(m.fabric, m.machine_type, 'N/A')
        ORDER BY production_kg DESC
      `, filterParams),

      pool.query(`
        SELECT
          pr.shift,
          ROUND(SUM(pr.production_kg)::NUMERIC, 3) AS production_kg
        FROM production_records pr
        LEFT JOIN machines m ON pr.machine_id = m.machine_id
        WHERE pr.record_date BETWEEN $1 AND $2 ${joinFilter}
        GROUP BY pr.shift
        ORDER BY pr.shift
      `, filterParams),
    ]);

    res.json({
      summary:      summaryR.rows[0],
      machine_wise: machineR.rows,
      fabric_wise:  fabricR.rows,
      shift_wise:   shiftR.rows,
      filters: { from: fromDate, to: toDate, shift, machine, fabric },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/rolls?from&to&machine&operator&fabric
app.get('/api/reports/rolls', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const fromDate = req.query.from || today;
    const toDate   = req.query.to   || today;
    const { machine, operator, fabric } = req.query;

    const params = [fromDate, toDate];
    let pi = 3, clauses = [];
    if (machine)  { clauses.push(`r.machine_id = $${pi++}`);   params.push(machine); }
    if (operator) { clauses.push(`r.operator_id = $${pi++}`);  params.push(operator); }
    if (fabric)   { clauses.push(`r.fabric_type = $${pi++}`);  params.push(fabric); }
    const extra = clauses.length ? 'AND ' + clauses.join(' AND ') : '';

    const result = await pool.query(`
      SELECT
        r.roll_id, r.machine_id,
        COALESCE(m.machine_name, r.machine_id) AS machine_name,
        COALESCE(op.operator_name, 'N/A')       AS operator_name,
        COALESCE(r.fabric_type, 'N/A')           AS fabric_type,
        r.start_counter,
        r.current_counter,
        COALESCE(r.actual_weight_kg, 0)          AS weight_kg,
        r.status, r.created_at, r.closed_at
      FROM rolls r
      LEFT JOIN machines  m  ON r.machine_id  = m.machine_id
      LEFT JOIN operators op ON r.operator_id = op.operator_id
      WHERE DATE(r.created_at) BETWEEN $1 AND $2 ${extra}
      ORDER BY r.created_at DESC
    `, params);

    const total_weight = result.rows.reduce((s, r) => s + parseFloat(r.weight_kg || 0), 0);

    res.json({
      rolls:          result.rows,
      total_rolls:    result.rows.length,
      total_weight_kg: Math.round(total_weight * 1000) / 1000,
      filters: { from: fromDate, to: toDate, machine, operator, fabric },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/shifts?from&to&shift&machine
app.get('/api/reports/shifts', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const fromDate = req.query.from || today;
    const toDate   = req.query.to   || today;
    const { shift, machine } = req.query;

    const params = [fromDate, toDate];
    let pi = 3, clauses = [];
    if (shift)   { clauses.push(`pr.shift = $${pi++}`);       params.push(shift); }
    if (machine) { clauses.push(`pr.machine_id = $${pi++}`);  params.push(machine); }
    const extra = clauses.length ? 'AND ' + clauses.join(' AND ') : '';

    const result = await pool.query(`
      SELECT
        pr.shift,
        ROUND(SUM(pr.production_kg)::NUMERIC, 3)                  AS production_kg,
        COUNT(DISTINCT pr.machine_id)                              AS running_machines,
        ROUND(COALESCE(SUM(o.run_minutes),0)::NUMERIC, 0)         AS run_minutes,
        ROUND(COALESCE(SUM(dt.shift_dt),0)::NUMERIC, 0)           AS downtime_minutes,
        ROUND(COALESCE(AVG(o.oee),0)::NUMERIC, 2)                 AS avg_oee,
        ROUND(COALESCE(AVG(o.availability),0)::NUMERIC, 2)        AS avg_availability
      FROM production_records pr
      LEFT JOIN oee_records o
        ON pr.machine_id = o.machine_id AND pr.record_date = o.record_date AND pr.shift = o.shift
      LEFT JOIN (
        SELECT shift, SUM(COALESCE(duration_minutes,0)) AS shift_dt
        FROM machine_downtime
        WHERE DATE(start_time) BETWEEN $1 AND $2
        GROUP BY shift
      ) dt ON pr.shift = dt.shift
      WHERE pr.record_date BETWEEN $1 AND $2 ${extra}
      GROUP BY pr.shift
      ORDER BY pr.shift
    `, params);

    const opParams = [...params];
    let opPi = pi, opClauses = [];
    if (shift)   { opClauses.push(`oa_sub.shift = $${opPi++}`);      opParams.push(shift); }
    const opExtra = opClauses.length ? 'AND ' + opClauses.join(' AND ') : '';

    const opResult = await pool.query(`
      SELECT oa_sub.shift, COUNT(DISTINCT oa_sub.operator_id) AS active_operators
      FROM (
        SELECT COALESCE(oa.shift, 'N/A') AS shift, oa.operator_id
        FROM operator_assignments oa
        WHERE DATE(oa.assigned_at) BETWEEN $1 AND $2
      ) oa_sub
      WHERE 1=1 ${opExtra}
      GROUP BY oa_sub.shift
    `, opParams);

    const opMap = {};
    opResult.rows.forEach(r => { opMap[r.shift] = parseInt(r.active_operators); });

    res.json({
      shifts: result.rows.map(r => ({ ...r, active_operators: opMap[r.shift] || 0 })),
      filters: { from: fromDate, to: toDate, shift, machine },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/machines?from&to&machine
app.get('/api/reports/machines', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const fromDate = req.query.from || today;
    const toDate   = req.query.to   || today;
    const { machine } = req.query;

    const params = [fromDate, toDate];
    let machineSQL = '';
    if (machine) { machineSQL = `AND m.machine_id = $3`; params.push(machine); }

    const result = await pool.query(`
      SELECT
        m.machine_id, m.machine_name,
        COALESCE(m.rpm_target, 0)                                                             AS rpm_target,
        ROUND(COALESCE(SUM(pr.rpm_sum)/NULLIF(SUM(pr.sample_count),0), 0)::NUMERIC, 2)       AS rpm_avg,
        ROUND(COALESCE(SUM(o.run_minutes),0)::NUMERIC / 60.0, 2)                             AS running_hours,
        ROUND(COALESCE(SUM(dt.total_dt),0)::NUMERIC / 60.0, 2)                               AS downtime_hours,
        ROUND(COALESCE(SUM(pr.production_kg),0)::NUMERIC, 3)                                 AS production_kg,
        ROUND(COALESCE(AVG(o.availability),0)::NUMERIC, 2)                                   AS utilization_pct,
        ROUND(COALESCE(AVG(o.performance),0)::NUMERIC, 2)                                    AS efficiency_pct,
        ROUND(COALESCE(AVG(o.oee),0)::NUMERIC, 2)                                            AS oee
      FROM machines m
      LEFT JOIN production_records pr
        ON m.machine_id = pr.machine_id AND pr.record_date BETWEEN $1 AND $2
      LEFT JOIN oee_records o
        ON m.machine_id = o.machine_id AND o.record_date BETWEEN $1 AND $2
      LEFT JOIN (
        SELECT machine_id, SUM(COALESCE(duration_minutes,0)) AS total_dt
        FROM machine_downtime
        WHERE DATE(start_time) BETWEEN $1 AND $2
        GROUP BY machine_id
      ) dt ON m.machine_id = dt.machine_id
      WHERE 1=1 ${machineSQL}
      GROUP BY m.machine_id, m.machine_name, m.rpm_target
      ORDER BY CASE SUBSTRING(m.machine_id,1,2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END, m.machine_id
    `, params);

    res.json({
      machines: result.rows,
      filters: { from: fromDate, to: toDate, machine },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/downtime?from&to&machine&shift
app.get('/api/reports/downtime', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const fromDate = req.query.from || today;
    const toDate   = req.query.to   || today;
    const { machine, shift } = req.query;

    const evtParams = [fromDate, toDate];
    let ePi = 3, eClauses = [];
    if (machine) { eClauses.push(`md.machine_id = $${ePi++}`); evtParams.push(machine); }
    if (shift)   { eClauses.push(`md.shift = $${ePi++}`);      evtParams.push(shift); }
    const evtExtra = eClauses.length ? 'AND ' + eClauses.join(' AND ') : '';

    const reasonParams = [fromDate, toDate];
    let rPi = 3, rClauses = [];
    if (machine) { rClauses.push(`machine_id = $${rPi++}`); reasonParams.push(machine); }
    if (shift)   { rClauses.push(`shift = $${rPi++}`);      reasonParams.push(shift); }
    const reasonExtra = rClauses.length ? 'AND ' + rClauses.join(' AND ') : '';

    const [eventsR, reasonR] = await Promise.all([
      pool.query(`
        SELECT
          md.id, md.machine_id,
          COALESCE(m.machine_name, md.machine_id) AS machine_name,
          COALESCE(md.reason, 'Unknown')            AS reason,
          md.start_time, md.end_time,
          ROUND(COALESCE(md.duration_minutes,
            EXTRACT(EPOCH FROM(COALESCE(md.end_time,NOW()) - md.start_time))/60
          )::NUMERIC, 1) AS duration_minutes,
          COALESCE(md.shift, 'N/A') AS shift,
          md.status, md.source
        FROM machine_downtime md
        LEFT JOIN machines m ON md.machine_id = m.machine_id
        WHERE DATE(md.start_time) BETWEEN $1 AND $2 ${evtExtra}
        ORDER BY md.start_time DESC
      `, evtParams),

      pool.query(`
        SELECT
          COALESCE(reason, 'Unknown') AS reason,
          COUNT(*)                    AS event_count,
          ROUND(SUM(COALESCE(duration_minutes,
            EXTRACT(EPOCH FROM(COALESCE(end_time,NOW()) - start_time))/60
          ))::NUMERIC, 1) AS total_minutes
        FROM machine_downtime
        WHERE DATE(start_time) BETWEEN $1 AND $2 ${reasonExtra}
        GROUP BY reason
        ORDER BY total_minutes DESC
      `, reasonParams),
    ]);

    const totalMin = eventsR.rows.reduce((s, r) => s + parseFloat(r.duration_minutes || 0), 0);

    res.json({
      events:        eventsR.rows,
      by_reason:     reasonR.rows,
      total_events:  eventsR.rows.length,
      total_minutes: Math.round(totalMin * 10) / 10,
      filters: { from: fromDate, to: toDate, machine, shift },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/operators?from&to&operator
app.get('/api/reports/operators', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const fromDate  = req.query.from || today;
    const toDate    = req.query.to   || today;
    const { operator } = req.query;

    const params = [fromDate, toDate];
    let opSQL = '';
    if (operator) { opSQL = `AND o.operator_id = $3`; params.push(operator); }

    const result = await pool.query(`
      SELECT
        o.operator_id,
        o.operator_name,
        COALESCE(o.rfid_tag, 'N/A')       AS rfid,
        COALESCE(o.department, 'N/A')      AS department,
        COALESCE(o.shift, 'N/A')           AS shift,
        COALESCE(oa_sub.machines_worked, 0) AS machines_worked,
        ROUND(COALESCE(r_sub.production_kg, 0)::NUMERIC, 3) AS production_kg,
        ROUND(COALESCE(oa_sub.working_hours, 0)::NUMERIC, 2) AS working_hours
      FROM operators o
      LEFT JOIN (
        SELECT
          operator_id,
          COUNT(DISTINCT machine_id) AS machines_worked,
          SUM(EXTRACT(EPOCH FROM(COALESCE(released_at, NOW()) - assigned_at))/3600) AS working_hours
        FROM operator_assignments
        WHERE DATE(assigned_at) BETWEEN $1 AND $2
        GROUP BY operator_id
      ) oa_sub ON o.operator_id = oa_sub.operator_id
      LEFT JOIN (
        SELECT operator_id, SUM(COALESCE(actual_weight_kg, 0)) AS production_kg
        FROM rolls
        WHERE DATE(created_at) BETWEEN $1 AND $2
        GROUP BY operator_id
      ) r_sub ON o.operator_id = r_sub.operator_id
      WHERE o.status = 'ACTIVE' ${opSQL}
      ORDER BY COALESCE(r_sub.production_kg, 0) DESC
    `, params);

    res.json({
      operators: result.rows,
      filters: { from: fromDate, to: toDate, operator },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/rfid?from&to&operator
app.get('/api/reports/rfid', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const fromDate  = req.query.from || today;
    const toDate    = req.query.to   || today;
    const { operator } = req.query;

    const params = [fromDate, toDate];
    let opSQL = '';
    if (operator) { opSQL = `AND re.operator_id = $3`; params.push(operator); }

    const result = await pool.query(`
      SELECT
        re.rfid_tag,
        COALESCE(o.operator_name, 'Unknown') AS operator_name,
        re.event_time,
        COALESCE(re.machine_id, 'N/A')       AS machine_id
      FROM rfid_events re
      LEFT JOIN operators o ON re.operator_id = o.operator_id
      WHERE DATE(re.event_time) BETWEEN $1 AND $2 ${opSQL}
      ORDER BY re.event_time DESC
    `, params);

    res.json({
      events:       result.rows,
      total_events: result.rows.length,
      filters: { from: fromDate, to: toDate, operator },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/assignments?from&to&machine&operator
app.get('/api/reports/assignments', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const fromDate  = req.query.from || today;
    const toDate    = req.query.to   || today;
    const { machine, operator } = req.query;

    const params = [fromDate, toDate];
    let pi = 3, clauses = [];
    if (machine)  { clauses.push(`oa.machine_id = $${pi++}`);   params.push(machine); }
    if (operator) { clauses.push(`oa.operator_id = $${pi++}`);  params.push(operator); }
    const extra = clauses.length ? 'AND ' + clauses.join(' AND ') : '';

    const result = await pool.query(`
      SELECT
        oa.assignment_id,
        oa.machine_id,
        COALESCE(m.machine_name, oa.machine_id) AS machine_name,
        COALESCE(o.operator_name, oa.operator_name, 'Unknown') AS operator_name,
        oa.assigned_at, oa.released_at, oa.status
      FROM operator_assignments oa
      LEFT JOIN machines  m ON oa.machine_id  = m.machine_id
      LEFT JOIN operators o ON oa.operator_id = o.operator_id
      WHERE DATE(oa.assigned_at) BETWEEN $1 AND $2 ${extra}
      ORDER BY oa.assigned_at DESC
    `, params);

    res.json({
      assignments: result.rows,
      total:       result.rows.length,
      filters: { from: fromDate, to: toDate, machine, operator },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/summary?from&to
app.get('/api/reports/summary', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const fromDate = req.query.from || today;
    const toDate   = req.query.to   || today;

    const [machineStats, production, downtime, activeOps, oeeStats] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)                                                                                              AS total_machines,
          COUNT(CASE WHEN COALESCE(ld.rpm,0)>0 AND LOWER(COALESCE(ld.dc_status,'offline'))='online' THEN 1 END) AS running_machines,
          COUNT(CASE WHEN LOWER(COALESCE(ld.dc_status,'offline'))<>'online' OR ld.machine_id IS NULL THEN 1 END) AS offline_machines,
          ROUND(COALESCE(AVG(CASE WHEN LOWER(COALESCE(ld.dc_status,'offline'))='online' THEN ld.rpm END),0)::NUMERIC, 2) AS avg_rpm
        FROM machines m
        LEFT JOIN machine_live_data ld ON m.machine_id = ld.machine_id
      `),
      pool.query(`
        SELECT ROUND(COALESCE(SUM(production_kg),0)::NUMERIC, 3) AS total_kg
        FROM production_records
        WHERE record_date BETWEEN $1 AND $2
      `, [fromDate, toDate]),
      pool.query(`
        SELECT
          ROUND(COALESCE(SUM(COALESCE(duration_minutes,
            EXTRACT(EPOCH FROM(COALESCE(end_time,NOW())-start_time))/60
          )),0)::NUMERIC, 1) AS total_minutes,
          COUNT(*) AS total_events
        FROM machine_downtime
        WHERE DATE(start_time) BETWEEN $1 AND $2
      `, [fromDate, toDate]),
      pool.query(
        `SELECT COUNT(DISTINCT operator_id) AS cnt FROM operator_assignments WHERE status = 'ACTIVE'`
      ),
      pool.query(`
        SELECT
          ROUND(AVG(oee)::NUMERIC, 2)          AS avg_oee,
          ROUND(AVG(availability)::NUMERIC, 2)  AS avg_availability
        FROM oee_records
        WHERE record_date BETWEEN $1 AND $2
      `, [fromDate, toDate]),
    ]);

    res.json({
      total_machines:    parseInt(machineStats.rows[0].total_machines),
      running_machines:  parseInt(machineStats.rows[0].running_machines),
      offline_machines:  parseInt(machineStats.rows[0].offline_machines),
      avg_rpm:           parseFloat(machineStats.rows[0].avg_rpm || 0),
      production_kg:     parseFloat(production.rows[0].total_kg || 0),
      downtime_minutes:  parseFloat(downtime.rows[0].total_minutes || 0),
      downtime_events:   parseInt(downtime.rows[0].total_events || 0),
      active_operators:  parseInt(activeOps.rows[0].cnt || 0),
      avg_efficiency:    parseFloat(oeeStats.rows[0].avg_oee || 0),
      avg_availability:  parseFloat(oeeStats.rows[0].avg_availability || 0),
      filters: { from: fromDate, to: toDate },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/maintenance?from&to&machine&priority&status
app.get('/api/reports/maintenance', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const fromDate = req.query.from || new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const toDate   = req.query.to   || today;
    const { machine, priority } = req.query;

    let where = 'WHERE 1=1';
    const params = [];
    let pi = 1;
    if (machine)  { where += ` AND ms.machine_id = $${pi++}`;  params.push(machine); }
    if (priority) { where += ` AND ms.priority = $${pi++}`;    params.push(priority); }

    const [schedules, summary] = await Promise.all([
      pool.query(`
        SELECT
          ms.schedule_id, ms.machine_id, m.machine_name,
          ms.task_name, ms.task_type, ms.priority, ms.status,
          ms.frequency_days, ms.last_done_date, ms.next_due_date,
          ms.assigned_to, ms.notes,
          CASE
            WHEN ms.next_due_date IS NULL THEN 'OK'
            WHEN ms.next_due_date < CURRENT_DATE THEN 'OVERDUE'
            WHEN ms.next_due_date <= CURRENT_DATE + 7 THEN 'DUE_SOON'
            ELSE 'OK'
          END AS due_status
        FROM maintenance_schedule ms
        LEFT JOIN machines m ON ms.machine_id = m.machine_id
        ${where}
        ORDER BY
          CASE WHEN ms.next_due_date < CURRENT_DATE THEN 0 WHEN ms.next_due_date <= CURRENT_DATE + 7 THEN 1 ELSE 2 END,
          ms.next_due_date
      `, params),
      pool.query(`
        SELECT
          COUNT(*) AS total_tasks,
          COUNT(CASE WHEN next_due_date < CURRENT_DATE THEN 1 END) AS overdue,
          COUNT(CASE WHEN next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7 THEN 1 END) AS due_soon,
          COUNT(CASE WHEN next_due_date > CURRENT_DATE + 7 OR next_due_date IS NULL THEN 1 END) AS on_schedule,
          COUNT(CASE WHEN priority = 'CRITICAL' THEN 1 END) AS critical_tasks,
          COUNT(CASE WHEN priority = 'HIGH' THEN 1 END) AS high_tasks
        FROM maintenance_schedule
      `),
    ]);

    res.json({
      summary: summary.rows[0],
      tasks: schedules.rows,
      filters: { from: fromDate, to: toDate, machine, priority },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/shift-handover?from&to&shift
app.get('/api/reports/shift-handover', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const fromDate = req.query.from || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const toDate   = req.query.to   || today;
    const { shift } = req.query;

    let where = `WHERE shift_date BETWEEN $1 AND $2`;
    const params = [fromDate, toDate];
    if (shift) { where += ` AND shift = $3`; params.push(shift); }

    const [handovers, summary] = await Promise.all([
      pool.query(`
        SELECT
          handover_id, shift_date, shift, supervisor_name,
          production_kg, machines_down,
          issues, actions_taken, pending_actions,
          created_at
        FROM shift_handovers
        ${where}
        ORDER BY shift_date DESC, shift DESC
      `, params),
      pool.query(`
        SELECT
          COUNT(*) AS total_handovers,
          ROUND(COALESCE(SUM(production_kg),0)::NUMERIC, 2) AS total_production_kg,
          ROUND(COALESCE(AVG(production_kg),0)::NUMERIC, 2) AS avg_production_kg,
          COALESCE(SUM(machines_down),0) AS total_machines_down_incidents,
          COUNT(CASE WHEN shift='D' THEN 1 END) AS day_shifts,
          COUNT(CASE WHEN shift='N' THEN 1 END) AS night_shifts
        FROM shift_handovers
        ${where}
      `, params),
    ]);

    res.json({
      summary: summary.rows[0],
      handovers: handovers.rows,
      filters: { from: fromDate, to: toDate, shift },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ==========================
// PHASE 6 — USER MANAGEMENT
// ==========================

app.get("/api/users", verifyToken, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, username, full_name, role, mobile, active, created_at, updated_at FROM users ORDER BY id`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.post("/api/users", verifyToken, async (req, res) => {
  try {
    const { username, full_name, password, role, mobile } = req.body;
    if (!username || !full_name || !password || !role) {
      return res.status(400).json({ error: "username, full_name, password, role are required" });
    }
    const validRoles = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'OPERATOR', 'VIEWER'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (username, full_name, password_hash, role, mobile)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, full_name, role, mobile, active, created_at`,
      [username, full_name, hash, role, mobile || null]
    );
    await pool.query(
      `INSERT INTO audit_logs (username, action, module, new_value)
       VALUES ($1, 'CREATE_USER', 'USER_MANAGEMENT', $2)`,
      [req.user.username, `Created user ${username} (${role})`]
    );
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: "Username already exists" });
    console.error(err); res.status(500).json({ error: err.message });
  }
});

app.put("/api/users/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, role, active, password, mobile } = req.body;
    const validRoles = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'OPERATOR', 'VIEWER'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    const existing = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: "User not found" });
    const cur = existing.rows[0];
    const newHash = password ? await bcrypt.hash(password, 10) : cur.password_hash;
    const r = await pool.query(
      `UPDATE users
       SET full_name = $1, role = $2, active = $3, password_hash = $4, mobile = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING id, username, full_name, role, mobile, active, updated_at`,
      [full_name ?? cur.full_name, role ?? cur.role, active ?? cur.active, newHash, mobile !== undefined ? mobile : cur.mobile, id]
    );
    await pool.query(
      `INSERT INTO audit_logs (username, action, module, old_value, new_value)
       VALUES ($1, 'UPDATE_USER', 'USER_MANAGEMENT', $2, $3)`,
      [req.user.username, `role=${cur.role} active=${cur.active}`, `role=${role ?? cur.role} active=${active ?? cur.active}`]
    );
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.delete("/api/users/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query(`SELECT username FROM users WHERE id = $1`, [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: "User not found" });
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    await pool.query(
      `INSERT INTO audit_logs (username, action, module, old_value)
       VALUES ($1, 'DELETE_USER', 'USER_MANAGEMENT', $2)`,
      [req.user.username, `Deleted user ${existing.rows[0].username}`]
    );
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ==========================
// SUPERVISOR PIN MANAGEMENT
// ==========================
app.put("/api/users/:id/pin", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { pin } = req.body;
    if (!pin || !/^\d{4}$/.test(String(pin))) {
      return res.status(400).json({ error: "PIN must be exactly 4 digits" });
    }
    const hash = await bcrypt.hash(String(pin), 6);
    const r = await pool.query(
      `UPDATE users SET pin_hash = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, username, full_name, role`,
      [hash, id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json({ success: true, user: r.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.delete("/api/users/:id/pin", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE users SET pin_hash = NULL, updated_at = NOW() WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ==========================
// PHASE 6 — AUDIT LOGS
// ==========================

app.get("/api/audit-logs", verifyToken, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '100') || 100, 1), 1000);
    const module = req.query.module;
    let q = `SELECT * FROM audit_logs`;
    const params = [];
    if (module) { q += ` WHERE module = $1`; params.push(module); }
    params.push(limit);
    q += ` ORDER BY timestamp DESC LIMIT $${params.length}`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ==========================
// AUTH — LOGIN (rate-limited)
// ==========================
app.post("/api/auth/login", loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    const r = await pool.query(
      `SELECT * FROM users WHERE username = $1 AND active = true`, [username]
    );
    if (r.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const user = r.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const payload = { id: user.id, username: user.username, role: user.role };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    res.json({
      token,
      id:        user.id,
      username:  user.username,
      full_name: user.full_name,
      role:      user.role,
      mobile:    user.mobile || null,
      active:    user.active,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed. Database connection error." });
  }
});

// ==========================
// SUPERVISOR PIN LOGIN
// ==========================
app.post("/api/auth/supervisor-pin", pinLimiter, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || !/^\d{4}$/.test(String(pin))) {
      return res.status(400).json({ error: "PIN must be 4 digits" });
    }
    const r = await pool.query(
      `SELECT * FROM users WHERE active = true AND pin_hash IS NOT NULL
       AND role IN ('SUPERVISOR', 'ADMIN', 'SUPER_ADMIN')`
    );
    for (const user of r.rows) {
      const match = await bcrypt.compare(String(pin), user.pin_hash);
      if (match) {
        const payload = { id: user.id, username: user.username, role: user.role };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
        return res.json({ token, id: user.id, username: user.username, full_name: user.full_name, role: user.role });
      }
    }
    return res.status(401).json({ error: "Invalid PIN" });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ==========================
// LOGOUT
// ==========================
app.post("/api/auth/logout", verifyToken, (req, res) => {
  res.json({ success: true });
});

// ==========================
// RFID SCAN
// ==========================
app.post("/api/rfid-scan", verifyToken, async (req, res) => {
  try {
    const { tag_id, machine_id } = req.body;
    if (!tag_id) return res.status(400).json({ error: "tag_id is required" });

    const operatorRes = await pool.query(
      `SELECT * FROM operators WHERE rfid_tag = $1 AND active = true`,
      [tag_id]
    );
    if (operatorRes.rows.length === 0) {
      return res.status(404).json({ error: "No active operator found for this RFID tag" });
    }
    const operator = operatorRes.rows[0];

    await pool.query(
      `INSERT INTO rfid_events (tag_id, operator_id, operator_name, machine_id, event_time)
       VALUES ($1, $2, $3, $4, NOW())`,
      [tag_id, operator.operator_id, operator.operator_name, machine_id || null]
    );

    io.emit('rfid_scan', { operator, machine_id, tag_id });
    res.json({ operator, machine_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// BACKUP
// ==========================
app.post("/api/backup", verifyToken, async (req, res) => {
  try {
    const backupDir = path.join("D:", "DHOWN_LIVE_PRODUCTION_DASHBOARD", "backups");
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `dhown_mes_backup_${ts}.dump`;
    const fullPath = path.join(backupDir, filename);
    const pgDump = `"${PG_BIN}\\pg_dump.exe"`;
    const cmd = `${pgDump} -U ${process.env.DB_USER || 'postgres'} -F c -f "${fullPath}" ${process.env.DB_NAME || 'dhown_mes'}`;
    const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || 'dhown123' };
    exec(cmd, { env }, (error) => {
      if (error) {
        return res.status(500).json({ error: "Backup failed: " + error.message });
      }
      res.json({ success: true, filename, path: fullPath });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// ==========================
// FABRIC TYPES
// ==========================

app.get("/api/fabric-types", async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM fabric_types ORDER BY code`);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/fabric-types", verifyToken, async (req, res) => {
  try {
    const { code, name, description } = req.body;
    if (!code || !name) return res.status(400).json({ error: "code and name are required" });
    const r = await pool.query(
      `INSERT INTO fabric_types (code, name, description) VALUES ($1, $2, $3) RETURNING *`,
      [code.toUpperCase().replace(/\s+/g, ''), name, description || null]
    );
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Code "${req.body.code}" already exists` });
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/fabric-types/:code", verifyToken, async (req, res) => {
  try {
    const { name, description } = req.body;
    const r = await pool.query(
      `UPDATE fabric_types SET name=$1, description=$2 WHERE code=$3 RETURNING *`,
      [name, description || null, req.params.code]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "Fabric type not found" });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/fabric-types/:code", verifyToken, async (req, res) => {
  try {
    const inUse = await pool.query(`SELECT COUNT(*) FROM machines WHERE fabric_code=$1`, [req.params.code]);
    if (parseInt(inUse.rows[0].count) > 0)
      return res.status(409).json({ error: "Cannot delete — fabric is assigned to one or more machines" });
    await pool.query(`DELETE FROM fabric_types WHERE code=$1`, [req.params.code]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================
// PHASE 6 — MACHINE SETTINGS
// ==========================

app.get("/api/machine-settings", async (req, res) => {
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

// Editable fields only — DC ID is intentionally excluded
app.put("/api/machine-settings/:machineId", verifyToken, async (req, res) => {
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

// ==========================
// DOWNTIME — NEW ENDPOINTS
// ==========================

// GET /api/downtime/open — live open downtime records with machine names and live timer
app.get("/api/downtime/open", async (req, res) => {
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

// GET /api/downtime/stats?date= — KPIs, top reasons, machine ranking
app.get("/api/downtime/stats", async (req, res) => {
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

// PUT /api/downtime/:id/reason — assign or update reason on auto-created record
app.put("/api/downtime/:id/reason", async (req, res) => {
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

// ==========================
// STARTUP: seed default admin
// ==========================

async function seedDefaultAdmin() {
  try {
    const existing = await pool.query(`SELECT id FROM users WHERE username = 'admin'`);
    if (existing.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await pool.query(
        `INSERT INTO users (username, full_name, password_hash, role)
         VALUES ('admin', 'System Administrator', $1, 'SUPER_ADMIN')`,
        [hash]
      );
      console.log("Default admin user created (password: admin123)");
    }
  } catch (err) {
    console.error("Seed admin error:", err.message);
  }
}

// ==========================
// START SERVER
// ==========================

async function ensureProductionHistory() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS production_history (
        id            BIGSERIAL     PRIMARY KEY,
        machine_id    VARCHAR(20)   NOT NULL,
        period_type   VARCHAR(10)   NOT NULL,
        period_start  TIMESTAMPTZ   NOT NULL,
        period_end    TIMESTAMPTZ   NOT NULL,
        shift         VARCHAR(2)    NOT NULL DEFAULT '',
        record_date   DATE          NOT NULL,
        hour_bucket   SMALLINT      NOT NULL DEFAULT -1,
        counter_start NUMERIC(12,0) NOT NULL DEFAULT 0,
        counter_end   NUMERIC(12,0) NOT NULL DEFAULT 0,
        production_kg NUMERIC(10,4) NOT NULL DEFAULT 0,
        rpm_avg       NUMERIC(6,2)  NOT NULL DEFAULT 0,
        sample_count  INT           NOT NULL DEFAULT 1,
        created_at    TIMESTAMPTZ   DEFAULT NOW(),
        updated_at    TIMESTAMPTZ   DEFAULT NOW(),
        CONSTRAINT chk_period_type CHECK (period_type IN ('HOURLY','SHIFT','DAILY')),
        UNIQUE(machine_id, period_type, record_date, hour_bucket, shift)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prod_hist_machine_date ON production_history(machine_id, record_date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prod_hist_period_date  ON production_history(period_type, record_date)`);
    console.log("production_history table ready");
  } catch (err) {
    console.error("ensureProductionHistory error:", err.message);
  }
}

async function ensureUsersSchema() {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(100)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
    console.log("Users schema ready");
  } catch (err) { console.error("ensureUsersSchema error:", err.message); }
}

// ============================================================
// PHASE 2 — MAINTENANCE SCHEDULE
// ============================================================

app.get('/api/maintenance-schedule', verifyToken, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT ms.*, m.machine_name,
        CASE
          WHEN ms.next_due_date < CURRENT_DATE THEN 'OVERDUE'
          WHEN ms.next_due_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'DUE_SOON'
          ELSE 'OK'
        END AS due_status
      FROM maintenance_schedule ms
      JOIN machines m ON ms.machine_id = m.machine_id
      WHERE ms.status = 'ACTIVE'
      ORDER BY ms.next_due_date ASC NULLS LAST
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/maintenance-schedule', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { machine_id, task_name, task_type, frequency_days, last_done_date, assigned_to, priority, notes } = req.body;
    if (!machine_id || !task_name) return res.status(400).json({ error: 'machine_id and task_name are required' });
    const next_due_date = last_done_date && frequency_days
      ? new Date(new Date(last_done_date).getTime() + frequency_days * 86400000).toISOString().slice(0, 10)
      : null;
    const r = await pool.query(
      `INSERT INTO maintenance_schedule (machine_id, task_name, task_type, frequency_days, last_done_date, next_due_date, assigned_to, priority, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [machine_id, task_name, task_type || 'PERIODIC', frequency_days || null, last_done_date || null, next_due_date, assigned_to || null, priority || 'MEDIUM', notes || null]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/maintenance-schedule/:id/complete', verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const { done_date, notes } = req.body;
    const completedDate = done_date || new Date().toISOString().slice(0, 10);
    const existing = await pool.query(`SELECT * FROM maintenance_schedule WHERE schedule_id=$1`, [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' });
    const sch = existing.rows[0];
    const next_due_date = sch.frequency_days
      ? new Date(new Date(completedDate).getTime() + sch.frequency_days * 86400000).toISOString().slice(0, 10)
      : null;
    const r = await pool.query(
      `UPDATE maintenance_schedule SET last_done_date=$1, next_due_date=$2, notes=$3, updated_at=NOW() WHERE schedule_id=$4 RETURNING *`,
      [completedDate, next_due_date, notes || sch.notes, id]
    );
    await pool.query(
      `INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,'COMPLETE_MAINTENANCE_TASK','MAINTENANCE_SCHEDULE',$2)`,
      [req.user.username, `schedule_id=${id} task=${sch.task_name} machine=${sch.machine_id}`]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/maintenance-schedule/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    await pool.query(`UPDATE maintenance_schedule SET status='COMPLETED' WHERE schedule_id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// PHASE 2 — SHIFT HANDOVER NOTES
// ============================================================

app.get('/api/shift-handovers', verifyToken, async (req, res) => {
  try {
    const { limit = 30 } = req.query;
    const r = await pool.query(`SELECT * FROM shift_handovers ORDER BY shift_date DESC, created_at DESC LIMIT $1`, [limit]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/shift-handovers', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { shift_date, shift, supervisor_name, production_kg, machines_down, issues, actions_taken, pending_actions } = req.body;
    if (!shift_date || !shift) return res.status(400).json({ error: 'shift_date and shift are required' });
    const r = await pool.query(
      `INSERT INTO shift_handovers (shift_date, shift, supervisor_name, production_kg, machines_down, issues, actions_taken, pending_actions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [shift_date, shift, supervisor_name || req.user.username, production_kg || 0, machines_down || 0, issues || null, actions_taken || null, pending_actions || null]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── BUSY BRIDGE ─────────────────────────────────────────────────
// Integration middleware between this dashboard and BUSY accounting, which
// runs on a SEPARATE PC. The dashboard stays the source of truth for
// production; BUSY stays the source of truth for the books. Nothing about
// machines, rolls, downtime or scheduling crosses this boundary.
//
// Mounted here so it sits after the API routes and before the React catch-all.
// A BUSY misconfiguration must never stop machine monitoring from starting, so
// mountBusyBridge() logs and returns null rather than throwing.
const { mountBusyBridge } = require('./busy-bridge');
const busyBridge = mountBusyBridge(app, pool, { verifyToken, requireRole });

// React Router catch-all — must be after all API routes
if (fs.existsSync(path.join(__dirname, '..', 'frontend', 'build'))) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'build', 'index.html'));
  });
}

// ============================================================
// AUTO WHATSAPP ALERTS — CallMeBot
// ============================================================
const CALLMEBOT_APIKEY = process.env.CALLMEBOT_APIKEY || '';
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min between alerts per machine

// In-memory: { machine_id: { lastStatus, lastAlertAt } }
const machineAlertState = {};

async function getSupervisorMobile() {
  try {
    const r = await pool.query(
      `SELECT mobile FROM users WHERE role IN ('SUPERVISOR','ADMIN','SUPER_ADMIN') AND mobile IS NOT NULL AND active = true ORDER BY CASE role WHEN 'SUPERVISOR' THEN 1 WHEN 'ADMIN' THEN 2 ELSE 3 END LIMIT 1`
    );
    return r.rows[0]?.mobile ? String(r.rows[0].mobile) : null;
  } catch { return null; }
}

async function sendWhatsAppAlert(mobile, message) {
  if (!CALLMEBOT_APIKEY) return;
  const url = `https://api.callmebot.com/whatsapp.php?phone=91${mobile}&text=${encodeURIComponent(message)}&apikey=${CALLMEBOT_APIKEY}`;
  try {
    await new Promise((resolve, reject) => {
      https.get(url, (res) => {
        res.resume();
        res.on('end', resolve);
      }).on('error', reject);
    });
    console.log(`[ALERT] WhatsApp sent to ${mobile}: ${message}`);
  } catch (err) {
    console.error(`[ALERT] WhatsApp failed: ${err.message}`);
  }
}

async function checkMachineAlerts() {
  if (!CALLMEBOT_APIKEY) return;
  try {
    const { rows } = await pool.query(
      `SELECT machine_id, machine_name, dc_status, last_status FROM machine_live_data`
    );
    const supervisorMobile = await getSupervisorMobile();
    if (!supervisorMobile) return;

    const now = Date.now();
    for (const m of rows) {
      const id = m.machine_id;
      const status = m.last_status || m.dc_status || 'OFFLINE';
      const prev = machineAlertState[id] || {};
      const wasOk   = !['OFFLINE','STOPPED','DOWNTIME'].includes(prev.lastStatus);
      const isDown  = ['OFFLINE','STOPPED','DOWNTIME'].includes(status);
      const cooledDown = !prev.lastAlertAt || (now - prev.lastAlertAt) > ALERT_COOLDOWN_MS;

      if (isDown && (wasOk || cooledDown) && prev.lastStatus !== undefined) {
        const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        const msg = `DHOWN MES ALERT: Machine ${id} (${m.machine_name || id}) is ${status} as of ${time}. Please check immediately.`;
        await sendWhatsAppAlert(supervisorMobile, msg);
        machineAlertState[id] = { lastStatus: status, lastAlertAt: now };
      } else {
        machineAlertState[id] = { ...prev, lastStatus: status };
      }
    }
  } catch (err) {
    console.error('[ALERT] Check failed:', err.message);
  }
}

server.listen(4000, async () => {
  await ensureProductionHistory();
  await ensureUsersSchema();
  await seedDefaultAdmin();
  console.log('Backend running on port 4000');

  // Start machine alert polling every 60 seconds
  if (process.env.CALLMEBOT_APIKEY) {
    setInterval(checkMachineAlerts, 60 * 1000);
    console.log('[ALERT] WhatsApp auto-alerts enabled (CallMeBot)');
  } else {
    console.log('[ALERT] WhatsApp auto-alerts disabled — set CALLMEBOT_APIKEY in .env to enable');
  }
});

// Stop the BUSY queue worker cleanly so a transaction being written to the
// BUSY share is never abandoned half-way through.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (busyBridge) {
      busyBridge.stop().catch(() => {}).finally(() => process.exit(0));
      setTimeout(() => process.exit(1), 10000).unref();
    } else {
      process.exit(0);
    }
  });
}

// Data collectors push to port 8090 — same express app, separate HTTP server
const DC_PORT = parseInt(process.env.DC_PORT || '8090');
const dcServer = http.createServer(app);
dcServer.listen(DC_PORT, () => console.log(`DC endpoint listening on port ${DC_PORT}`));