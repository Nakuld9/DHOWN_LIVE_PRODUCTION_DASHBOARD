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

// Machine sort helper (SJ â†' RB â†' IL â†' TV)
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

// â"€â"€ Auth middleware â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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

// â"€â"€ Login rate limiter (10 attempts / 15 min per IP) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// â"€â"€ Supervisor PIN rate limiter (5 attempts / 5 min per IP) â"€â"€â"€â"€
const pinLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many PIN attempts. Try again in 5 minutes.' },
});

// â"€â"€ Role-based access control â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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
        oa.operator_name AS assigned_operator,
        oa.operator_id AS assigned_operator_id,
        oa.assigned_at,
        CASE
          WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
          WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
          WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
          WHEN LOWER(COALESCE(ld.dc_status, 'offline')) <> 'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
          WHEN LOWER(COALESCE(ld.dc_status, 'offline')) <> 'online' THEN 'OFFLINE'
          WHEN COALESCE(ld.rpm, 0) > 0 THEN 'RUNNING'
          ELSE 'STOPPED'
        END AS live_status
      FROM machines m
      LEFT JOIN machine_live_data ld ON m.machine_id = ld.machine_id
      LEFT JOIN data_collectors dc ON m.dc_id = dc.dc_id
      LEFT JOIN fabric_types ft ON m.fabric_code = ft.code
      LEFT JOIN LATERAL (
        SELECT assignment_id, operator_id, operator_name, assigned_at
        FROM operator_assignments
        WHERE machine_id = m.machine_id AND status = 'ACTIVE'
        ORDER BY assigned_at DESC LIMIT 1
      ) oa ON true
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
        oa.operator_name AS assigned_operator,
        oa.operator_id AS assigned_operator_id,
        oa.assigned_at,
        CASE
          WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
          WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
          WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
          WHEN LOWER(COALESCE(ld.dc_status, 'offline')) <> 'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
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
        SELECT assignment_id, operator_id, operator_name, assigned_at
        FROM operator_assignments
        WHERE machine_id = m.machine_id AND status = 'ACTIVE'
        ORDER BY assigned_at DESC LIMIT 1
      ) oa ON true
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

    // Auto: generate QR + move to greige store
    try {
      const qr = await generateQR(`ROLL:${rollId}`);
      await pool.query(
        `UPDATE rolls SET qr_image=$1, warehouse_status='GREIGE' WHERE roll_id=$2`,
        [qr, rollId]
      );
      io.emit('inventory:greige_update', { action: 'roll_approved', roll_id: rollId });
      io.emit('inventory:dashboard_update', { type: 'roll_approved' });

      // stock_ledger: greige roll IN to greige store
      const roll = result.rows[0];
      const greigeWh = await pool.query(`SELECT warehouse_id FROM warehouses WHERE code='GREIGE-STORE' LIMIT 1`);
      const slClient = await pool.connect();
      try {
        await postToLedger(slClient, {
          doc_type: 'ROLL', doc_id: rollId,
          item_desc: `${roll.fabric_type || ''} Roll ${rollId}`.trim(),
          warehouse_id: greigeWh.rows[0]?.warehouse_id || null,
          movement_type: 'IN',
          quantity: parseFloat(roll.actual_weight_kg || 0),
          uom_code: 'KG',
          notes: `Roll approved by ${supervisor_name || req.user?.username}`,
          created_by: req.user?.username || 'system',
        });
      } finally { slClient.release(); }
    } catch (qrErr) {
      console.error('QR gen error:', qrErr.message);
    }

    // Auto: KNITTING_COST entry from item master knitting_rate_per_kg
    try {
      const roll = result.rows[0];
      const weightKg = parseFloat(roll.actual_weight_kg || 0);
      if (weightKg > 0 && roll.fabric_item_id) {
        const itemR = await pool.query(
          `SELECT knitting_rate_per_kg, standard_loss_pct, item_name FROM items WHERE item_id=$1`,
          [roll.fabric_item_id]
        );
        const item = itemR.rows[0];
        if (item?.knitting_rate_per_kg && parseFloat(item.knitting_rate_per_kg) > 0) {
          const kRate = parseFloat(item.knitting_rate_per_kg);
          const client2 = await pool.connect();
          try {
            await addCostEntry(client2, {
              reference_type: 'ROLL', reference_id: rollId,
              cost_component: 'KNITTING_COST',
              amount_rs: (weightKg * kRate).toFixed(2),
              quantity_kg: weightKg, rate_used: kRate,
              fabric_type: roll.fabric_type,
              notes: `In-house knitting: ${item.item_name} @ ₹${kRate}/kg`,
            });
          } finally { client2.release(); }
        }
      }
    } catch (costErr) { console.error('Knitting cost entry error:', costErr.message); }

    // Write to production_records so dashboard reflects manual production
    try {
      const roll = result.rows[0];
      const weightKg = parseFloat(roll.actual_weight_kg || 0);
      if (weightKg > 0 && roll.machine_id) {
        const shiftCfg = await getShiftSettings();
        const shift = roll.shift || detectCurrentShift(shiftCfg);
        const today = new Date().toISOString().slice(0, 10);
        await pool.query(`
          INSERT INTO production_records (machine_id, record_date, shift, production_kg, sample_count)
          VALUES ($1, $2, $3, $4, 1)
          ON CONFLICT (machine_id, record_date, shift) DO UPDATE SET
            production_kg = production_records.production_kg + $4,
            sample_count  = production_records.sample_count + 1,
            updated_at    = NOW()`,
          [roll.machine_id, today, shift, weightKg]);
      }
    } catch (prErr) { console.error('Production record from roll approval:', prErr.message); }

    res.json(result.rows[0]);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

});

// DELETE Roll (OPEN only — not yet weighed)
app.delete('/api/rolls/:rollId', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT status FROM rolls WHERE roll_id=$1`, [req.params.rollId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Roll not found' });
    if (r.rows[0].status !== 'OPEN') return res.status(400).json({ error: 'Only OPEN rolls can be deleted' });
    await pool.query(`DELETE FROM rolls WHERE roll_id=$1`, [req.params.rollId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// CANCEL Roll (CLOSED/APPROVED) — marks CANCELLED
app.put('/api/rolls/:rollId/cancel', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT status, warehouse_status FROM rolls WHERE roll_id=$1`, [req.params.rollId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Roll not found' });
    if (r.rows[0].status === 'CANCELLED') return res.status(400).json({ error: 'Already cancelled' });
    if (r.rows[0].warehouse_status === 'SENT_OUT' || r.rows[0].warehouse_status === 'DISPATCHED') {
      return res.status(400).json({ error: 'Cannot cancel — roll is in subcontracting or dispatched' });
    }
    await pool.query(`UPDATE rolls SET status='CANCELLED', warehouse_status='CANCELLED' WHERE roll_id=$1`, [req.params.rollId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================
// OPERATORS — migrated to layered architecture (src/routes/operators.routes.js)
// Endpoints unchanged: GET/POST/PUT/DELETE /api/operators[/:id]
// Shared pool + auth injected so behavior is identical to the former inline handlers.
// ==========================
app.use('/api/operators', require('./src/routes/operators.routes')({ pool, verifyToken, requireRole }));

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

// ==========================
// RFID EVENTS
// ==========================

app.get("/api/rfid-events", async (req, res) => {
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
          WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
          WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
          WHEN LOWER(COALESCE(ld.dc_status,'offline')) <> 'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
          WHEN LOWER(COALESCE(ld.dc_status,'offline')) <> 'online' THEN 'OFFLINE'
          WHEN COALESCE(ld.rpm,0) > 0 THEN 'RUNNING'
          ELSE 'STOPPED'
        END AS live_status
      FROM machines m
      LEFT JOIN machine_live_data ld ON m.machine_id = ld.machine_id
      LEFT JOIN LATERAL (
        SELECT assignment_id FROM operator_assignments
        WHERE machine_id = m.machine_id AND status = 'ACTIVE'
        ORDER BY assigned_at DESC LIMIT 1
      ) oa ON true
      LEFT JOIN LATERAL (
        SELECT id FROM machine_downtime
        WHERE machine_id = m.machine_id AND status = 'OPEN'
        ORDER BY start_time DESC LIMIT 1
      ) dt ON true
      WHERE (
        CASE
          WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
          WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
          WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
          WHEN LOWER(COALESCE(ld.dc_status,'offline')) <> 'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
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
      quality: row.quality ?? 0,
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
// PHASE 5 â€" SHIFT CONFIG HELPERS  (read from app_settings, no hardcodes)
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
  const [runR, stoppedR, prodR, rollsR] = await Promise.all([
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
    ),
    // Quality = APPROVED rolls / (APPROVED + REJECTED) rolls this shift
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('APPROVED','COMPLETED')) AS good_rolls,
         COUNT(*) FILTER (WHERE status = 'REJECTED')               AS bad_rolls
       FROM rolls
       WHERE machine_id=$1 AND shift=$2 AND DATE(created_at)=$3
         AND status IN ('APPROVED','COMPLETED','REJECTED')`,
      [machine_id, shift, today]
    )
  ]);

  const runMins     = parseFloat(runR.rows[0].mins || 0);
  const stoppedMins = parseFloat(stoppedR.rows[0].mins || 0);
  const prodKg      = parseFloat(prodR.rows[0].kg || 0);
  const goodRolls   = parseInt(rollsR.rows[0].good_rolls || 0);
  const badRolls    = parseInt(rollsR.rows[0].bad_rolls  || 0);
  const totalRolls  = goodRolls + badRolls;

  // If no rolls completed yet this shift, fall back to configured quality target
  const quality = totalRolls > 0
    ? Math.round(goodRolls / totalRolls * 10000) / 100
    : qualityTarget;

  const avail = plannedMinutes > 0 ? Math.min(100, Math.round(runMins / plannedMinutes * 10000) / 100) : 0;
  const perf  = rpmTarget > 0      ? Math.min(100, Math.round(Number(rpm || 0) / rpmTarget * 10000) / 100) : 0;
  const oee   = Math.round(avail * perf * quality / 10000 * 100) / 100;

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
// POST LIVE DATA (DC PUSH) â€" Phase 5 engine
// ==========================
app.post("/api/live-data", async (req, res) => {
  try {
    const { machine_id, rpm, dc_status, production_counter, operator_id, operator_name, shift: shiftOverride } = req.body;
    if (!machine_id) return res.status(400).json({ error: "machine_id is required" });

    // â"€â"€ 1. Shift config from app_settings (no hardcodes) â"€â"€â"€â"€â"€â"€â"€â"€â"€
    const shiftSettings  = await getShiftSettings();
    const currentShift   = shiftOverride || detectCurrentShift(shiftSettings);
    const plannedMinutes = parseFloat(shiftSettings.planned_hours_per_shift || '8') * 60;
    const qualityTarget  = parseFloat(shiftSettings.quality_target_pct || '100');

    // â"€â"€ 2. Current row + machine config â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    const [liveRow, machRow] = await Promise.all([
      pool.query('SELECT * FROM machine_live_data WHERE machine_id=$1', [machine_id]),
      pool.query('SELECT kg_per_counter, rpm_target FROM machines WHERE machine_id=$1', [machine_id])
    ]);
    const current    = liveRow.rows[0] || null;
    const machine    = machRow.rows[0] || {};
    const kpc        = parseFloat(machine.kg_per_counter || 0);
    const rpmTarget  = parseFloat(machine.rpm_target || 0);

    // â"€â"€ 3. Production delta using kg_per_counter from machines â"€â"€â"€
    const newCounter  = parseFloat(production_counter || 0);
    const oldCounter  = current ? parseFloat(current.production_counter || 0) : 0;
    const delta       = newCounter > oldCounter ? newCounter - oldCounter : newCounter;
    const prodDeltaKg = kpc > 0 ? Math.round(delta * kpc * 100000) / 100000 : 0;
    const sessionKg   = Math.round(((current ? parseFloat(current.session_production_kg || 0) : 0) + prodDeltaKg) * 100000) / 100000;

    // â"€â"€ 4. Live status â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    const newStatus  = computeLiveStatus(dc_status, rpm);
    const prevStatus = current ? current.last_status : null;

    // â"€â"€ 5. Status-change log â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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

    // â"€â"€ 5.5. Auto-downtime detection â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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
        // Machine resumed â€" close all open downtime records for this machine
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

    // â"€â"€ 6. UPSERT machine_live_data â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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

    // â"€â"€ 7. Sync machines.dc_status â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    await pool.query('UPDATE machines SET dc_status=$1 WHERE machine_id=$2', [dc_status||'online', machine_id]);

    // â"€â"€ 8. Data-collector heartbeat â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    await pool.query(
      `UPDATE data_collectors SET status='ONLINE', last_seen=NOW() WHERE machine_id=$1`,
      [machine_id]
    );

    // â"€â"€ 9. Upsert production_records â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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

    // â"€â"€ 10. Compute and store OEE â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    await updateOEE(pool, machine_id, today, currentShift, rpm, rpmTarget, plannedMinutes, qualityTarget);

    // â"€â"€ 11. Upsert hourly production_history bucket â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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
// GET CHARTS â€" MACHINE TRENDS (hourly from production_history)
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
// GET CHARTS â€" HOURLY PRODUCTION (all machines for a date)
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
// ROLLS â€" CREATE & CLOSE
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

    // Auto-resolve fabric_item_id from machine's fabric_code → items.item_code
    const fabricCode = machineRow.rows[0]?.fabric_code || null;
    let fabric_item_id = null;
    if (fabricCode) {
      const itemRow = await pool.query(`SELECT item_id FROM items WHERE item_code=$1 LIMIT 1`, [fabricCode]);
      if (itemRow.rows.length) fabric_item_id = itemRow.rows[0].item_id;
    }
    const prefix = (prefixRow.rows[0]?.value || 'DHM-').replace(/[-\s]+$/, '');
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
      `INSERT INTO rolls (roll_id, machine_id, fabric_type, shift, start_counter, current_counter, status, created_at, operator_id, fabric_item_id)
       VALUES ($1, $2, $3, $4, $5, $5, 'OPEN', NOW(), $6, $7)
       RETURNING *`,
      [generatedId, machine_id, resolvedFabricType, shift, start_counter || 0, operator_id || null, fabric_item_id || null]
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
    const page  = req.query.page ? (parseInt(req.query.page) || 1) : null;
    const limit = Math.min(parseInt(req.query.limit || '50') || 50, 200);
    const conds = []; const vals = []; let p = 1;
    if (status)     { conds.push(`r.status = $${p++}`);     vals.push(status); }
    if (machine_id) { conds.push(`r.machine_id = $${p++}`); vals.push(machine_id); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const baseQuery = `
      SELECT r.*, m.machine_name, m.machine_type,
             COALESCE(ld.session_production_kg, 0) AS live_kg
      FROM rolls r
      LEFT JOIN machines m ON r.machine_id = m.machine_id
      LEFT JOIN machine_live_data ld ON r.machine_id = ld.machine_id
      ${where}
      ORDER BY r.created_at DESC`;
    if (!page) {
      const r = await pool.query(baseQuery, vals);
      return res.json(r.rows);
    }
    const offset = (page - 1) * limit;
    const countVals = [...vals];
    const [rows, cnt] = await Promise.all([
      pool.query(`${baseQuery} LIMIT $${p} OFFSET $${p + 1}`, [...vals, limit, offset]),
      pool.query(`SELECT COUNT(*) FROM rolls r ${where}`, countVals),
    ]);
    const total = parseInt(cnt.rows[0].count);
    res.json({ data: rows.rows, total, page, pages: Math.ceil(total / limit) });
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
// SETTINGS — migrated to layered architecture (src/routes/settings.routes.js)
// Endpoints unchanged: GET /api/settings (no auth), PUT /api/settings (verifyToken)
// ==========================
app.use('/api/settings', require('./src/routes/settings.routes')({ pool, verifyToken }));

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
// PHASE 5 â€" PRODUCTION & OEE ANALYTICS ENDPOINTS
// ============================================================

// GET /api/production/current â€" live snapshot all machines
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
             oa.operator_name AS assigned_operator,
             CASE
               WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
               WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
               WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
               WHEN LOWER(COALESCE(ld.dc_status,'offline')) <> 'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
               WHEN LOWER(COALESCE(ld.dc_status,'offline')) <> 'online' THEN 'OFFLINE'
               WHEN COALESCE(ld.rpm,0) > 0 THEN 'RUNNING'
               ELSE 'STOPPED'
             END AS live_status
      FROM machines m
      LEFT JOIN machine_live_data ld ON m.machine_id = ld.machine_id
      LEFT JOIN LATERAL (
        SELECT assignment_id, operator_name FROM operator_assignments
        WHERE machine_id = m.machine_id AND status = 'ACTIVE'
        ORDER BY assigned_at DESC LIMIT 1
      ) oa ON true
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

// GET /api/production/shift â€" current shift for today
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

// GET /api/dashboard/live â€" single-call comprehensive dashboard data
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
          oa.operator_name AS assigned_operator,
          CASE WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
               WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
               WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
               WHEN LOWER(COALESCE(ld.dc_status,'offline'))<>'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
               WHEN LOWER(COALESCE(ld.dc_status,'offline'))<>'online' THEN 'OFFLINE'
               WHEN COALESCE(ld.rpm,0)>0 THEN 'RUNNING' ELSE 'STOPPED' END AS live_status
        FROM machines m
        LEFT JOIN machine_live_data ld ON m.machine_id=ld.machine_id
        LEFT JOIN LATERAL (
          SELECT assignment_id, operator_name FROM operator_assignments
          WHERE machine_id=m.machine_id AND status='ACTIVE'
          ORDER BY assigned_at DESC LIMIT 1
        ) oa ON true
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
      oee_summary: { avg_oee: oee.avg_oee || 0, avg_availability: oee.avg_avail || 0, avg_performance: oee.avg_perf || 0, avg_quality: oee.avg_quality ?? 0 },
      machines, top_downtime: dtR.rows
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// â"€â"€ Replace hardcoded GET /api/dashboard/oee with real computation â"€â"€
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

// ── Command Center aggregate API ──────────────────────────────────
app.get("/api/command-center", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const shiftCfg = await getShiftSettings();
    const currentShift = detectCurrentShift(shiftCfg);

    const [
      machR, prodTodayR, prodShiftR, oeeR,
      grnTodayR, grnRecentR,
      dispTodayR, dispRecentR,
      scSentR, scRecvR, scRecentR,
      issueRecentR, issueTodayR,
      invR,
      rollRecentR,
      dtRecentR,
      topOperR,
      topFabricR,
      topYarnR,
      pendingSCR,
      pendingGRNR,
      pendingDispR,
    ] = await Promise.all([
      // machines live
      pool.query(`SELECT m.machine_id, m.machine_name,
          COALESCE(ld.rpm,0) AS rpm, COALESCE(ld.dc_status,'offline') AS dc_status,
          oa.operator_name,
          dt.id AS dt_id,
          CASE WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
               WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
               WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
               WHEN LOWER(COALESCE(ld.dc_status,'offline'))<>'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
               WHEN LOWER(COALESCE(ld.dc_status,'offline'))<>'online' THEN 'OFFLINE'
               WHEN COALESCE(ld.rpm,0)>0 THEN 'RUNNING' ELSE 'STOPPED' END AS live_status
        FROM machines m
        LEFT JOIN machine_live_data ld ON m.machine_id=ld.machine_id
        LEFT JOIN LATERAL (SELECT assignment_id, operator_name FROM operator_assignments WHERE machine_id=m.machine_id AND status='ACTIVE' ORDER BY assigned_at DESC LIMIT 1) oa ON true
        LEFT JOIN LATERAL (SELECT id FROM machine_downtime WHERE machine_id=m.machine_id AND status='OPEN' ORDER BY start_time DESC LIMIT 1) dt ON true
        ORDER BY m.machine_id`),
      // production today
      pool.query(`SELECT COALESCE(SUM(production_kg),0) AS kg FROM production_records WHERE record_date=$1`, [today]),
      // production this shift
      pool.query(`SELECT COALESCE(SUM(production_kg),0) AS kg FROM production_records WHERE record_date=$1 AND shift=$2`, [today, currentShift]),
      // OEE
      pool.query(`SELECT ROUND(AVG(oee),2) AS oee FROM oee_records WHERE record_date=$1 AND shift=$2`, [today, currentShift]),
      // GRN today count
      pool.query(`SELECT COUNT(*) AS cnt FROM grn WHERE DATE(receipt_date)=$1`, [today]),
      // recent GRNs
      pool.query(`SELECT g.grn_number, g.supplier_name, g.receipt_date, g.status FROM grn g ORDER BY g.receipt_date DESC LIMIT 3`),
      // dispatch today
      pool.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(total_weight_kg),0) AS kg FROM dispatch_challans WHERE DATE(dispatch_date)=$1`, [today]),
      // recent dispatch
      pool.query(`SELECT dispatch_number AS challan_number, customer_name, total_weight_kg, dispatch_date AS created_at FROM dispatch_challans ORDER BY dispatch_date DESC LIMIT 3`),
      // SC sent today
      pool.query(`SELECT COUNT(*) AS cnt FROM subcontract_challans WHERE DATE(sent_date)=$1 AND status='SENT'`, [today]),
      // SC received today
      pool.query(`SELECT COUNT(*) AS cnt FROM subcontract_challans WHERE status='RECEIVED'`),
      // recent SC
      pool.query(`SELECT challan_number, vendor_name, status, sent_date FROM subcontract_challans ORDER BY created_at DESC LIMIT 3`),
      // recent yarn issues
      pool.query(`SELECT yi.issue_number, yi.machine_id, yi.issue_date, COALESCE((SELECT SUM(issued_kg) FROM yarn_issue_items WHERE issue_id=yi.issue_id),0) AS total_kg FROM yarn_issues yi ORDER BY yi.issue_date DESC LIMIT 3`),
      // yarn issue today
      pool.query(`SELECT COUNT(*) AS cnt, COALESCE((SELECT SUM(yii.issued_kg) FROM yarn_issue_items yii JOIN yarn_issues yi2 ON yii.issue_id=yi2.issue_id WHERE DATE(yi2.issue_date)=$1),0) AS kg FROM yarn_issues WHERE DATE(issue_date)=$2`, [today, today]),
      // inventory value
      pool.query(`SELECT COALESCE(SUM(current_stock_kg * rate_per_kg),0) AS val, COALESCE(SUM(current_stock_kg),0) AS kg FROM yarn_lots WHERE current_stock_kg>0`),
      // recent rolls
      pool.query(`SELECT roll_id, machine_id, COALESCE(actual_weight_kg, weight_kg) AS net_weight_kg, COALESCE(closed_at, created_at) AS completed_at FROM rolls ORDER BY created_at DESC LIMIT 3`),
      // recent downtime
      pool.query(`SELECT machine_id, reason, start_time, ROUND(EXTRACT(EPOCH FROM COALESCE(end_time, NOW()) - start_time)/60) AS mins FROM machine_downtime ORDER BY start_time DESC LIMIT 3`),
      // top operators (last 7 days)
      pool.query(`SELECT oa.operator_name, oa.machine_id, COUNT(*) AS shifts FROM operator_assignments oa WHERE oa.status='ACTIVE' OR oa.assigned_at >= NOW()-INTERVAL '7 days' GROUP BY oa.operator_name, oa.machine_id ORDER BY shifts DESC LIMIT 4`),
      // top fabrics produced
      pool.query(`SELECT COALESCE(r.fabric_type,'Unknown') AS fabric, ROUND(SUM(COALESCE(r.actual_weight_kg, r.weight_kg, 0))::numeric,1) AS kg FROM rolls r GROUP BY fabric ORDER BY kg DESC LIMIT 5`),
      // top yarn consumed
      pool.query(`SELECT COALESCE(i.item_name, yl.yarn_type) AS yarn, ROUND(SUM(yii.issued_kg)::numeric,1) AS kg FROM yarn_issue_items yii JOIN yarn_lots yl ON yii.lot_id=yl.lot_id LEFT JOIN items i ON UPPER(i.item_code)=UPPER(yl.yarn_type) GROUP BY yarn ORDER BY kg DESC LIMIT 4`),
      // pending SC challans
      pool.query(`SELECT COUNT(*) AS cnt FROM subcontract_challans WHERE status='SENT'`),
      // pending GRN (draft)
      pool.query(`SELECT COUNT(*) AS cnt FROM grn WHERE status='DRAFT'`),
      // pending dispatch (draft)
      pool.query(`SELECT COUNT(*) AS cnt FROM dispatch_challans WHERE status='DRAFT'`),
    ]);

    const machines = machR.rows;
    const total = machines.length;
    const running = machines.filter(m => m.live_status === 'RUNNING').length;
    const stopped = machines.filter(m => m.live_status === 'STOPPED').length;
    const maintenance = machines.filter(m => m.live_status === 'DOWNTIME').length;
    const offline = total - running - stopped - maintenance;

    res.json({
      timestamp: new Date().toISOString(),
      current_shift: currentShift,
      machines: { total, running, stopped, maintenance, offline, list: machines },
      production: {
        today_kg: Math.round(parseFloat(prodTodayR.rows[0].kg) * 1000) / 1000,
        shift_kg: Math.round(parseFloat(prodShiftR.rows[0].kg) * 1000) / 1000,
      },
      oee: parseFloat(oeeR.rows[0]?.oee || 0),
      grn: { today_count: parseInt(grnTodayR.rows[0].cnt), today_value: 0, recent: grnRecentR.rows },
      dispatch: { today_count: parseInt(dispTodayR.rows[0].cnt), today_kg: parseFloat(dispTodayR.rows[0].kg), recent: dispRecentR.rows },
      sc: { sent_today: parseInt(scSentR.rows[0].cnt), recv_today: parseInt(scRecvR.rows[0].cnt), recent: scRecentR.rows },
      yarn_issue: { today_count: parseInt(issueTodayR.rows[0].cnt), today_kg: parseFloat(issueTodayR.rows[0].kg), recent: issueRecentR.rows },
      inventory: { value: parseFloat(invR.rows[0].val), total_kg: parseFloat(invR.rows[0].kg) },
      recent_rolls: rollRecentR.rows,
      recent_downtime: dtRecentR.rows,
      top_operators: topOperR.rows,
      top_fabrics: topFabricR.rows,
      top_yarn: topYarnR.rows,
      pending: {
        sc_challans: parseInt(pendingSCR.rows[0].cnt),
        grn_draft: parseInt(pendingGRNR.rows[0].cnt),
        dispatch_draft: parseInt(pendingDispR.rows[0].cnt),
      },
    });
  } catch (err) { console.error("command-center error:", err); res.status(500).json({ error: err.message }); }
});

// â"€â"€ JSON Report endpoints â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

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
             CASE WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
                  WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
                  WHEN LOWER(COALESCE(ld.dc_status,'offline'))<>'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
                  WHEN LOWER(COALESCE(ld.dc_status,'offline'))<>'online' THEN 'OFFLINE'
                  WHEN COALESCE(ld.rpm,0)>0 THEN 'RUNNING' ELSE 'STOPPED' END AS live_status
      FROM machines m
      LEFT JOIN (SELECT machine_id, MAX(id) AS max_id FROM oee_records WHERE record_date=$1 GROUP BY machine_id) lo ON m.machine_id=lo.machine_id
      LEFT JOIN oee_records o ON o.id=lo.max_id
      LEFT JOIN (SELECT machine_id, SUM(production_kg) AS production_kg FROM production_records WHERE record_date=$1 GROUP BY machine_id) pr ON m.machine_id=pr.machine_id
      LEFT JOIN machine_live_data ld ON m.machine_id=ld.machine_id
      LEFT JOIN LATERAL (
        SELECT assignment_id FROM operator_assignments
        WHERE machine_id=m.machine_id AND status='ACTIVE'
        ORDER BY assigned_at DESC LIMIT 1
      ) oa ON true
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PHASE 9 â€" ADVANCED REPORTING SYSTEM
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
    if (shift)   { opClauses.push(`oa_sub.shift = $${opPi++}`); opParams.push(shift); }
    const opExtra = opClauses.length ? 'AND ' + opClauses.join(' AND ') : '';

    const opResult = await pool.query(`
      SELECT oa_sub.shift, COUNT(DISTINCT oa_sub.operator_id) AS active_operators
      FROM (
        SELECT CASE WHEN EXTRACT(HOUR FROM oa.assigned_at) BETWEEN 6 AND 17 THEN 'D' ELSE 'N' END AS shift, oa.operator_id
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
        SELECT operator_id::INTEGER AS operator_id, SUM(COALESCE(actual_weight_kg, 0)) AS production_kg
        FROM rolls
        WHERE DATE(created_at) BETWEEN $1 AND $2 AND operator_id IS NOT NULL AND operator_id != ''
        GROUP BY operator_id::INTEGER
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

// GET /api/reports/daily-summary?date=YYYY-MM-DD
app.get('/api/reports/daily-summary', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const [machines, shifts, downtime, rolls, attendance] = await Promise.all([
      // Per-machine production for the day
      pool.query(`
        SELECT
          m.machine_id, m.machine_name, m.machine_type, m.fabric,
          ROUND(COALESCE(SUM(r.actual_weight_kg), 0)::NUMERIC, 3)  AS production_kg,
          COUNT(r.roll_id) FILTER (WHERE r.status = 'APPROVED')     AS rolls_approved,
          COUNT(r.roll_id) FILTER (WHERE r.status = 'OPEN')         AS rolls_open,
          ROUND(COALESCE(AVG(o.availability), 0)::NUMERIC, 1)       AS avg_availability,
          ROUND(COALESCE(AVG(o.performance), 0)::NUMERIC, 1)        AS avg_performance,
          ROUND(COALESCE(AVG(o.quality), 0)::NUMERIC, 1)            AS avg_quality,
          ROUND(COALESCE(AVG(o.oee), 0)::NUMERIC, 1)                AS avg_oee
        FROM machines m
        LEFT JOIN rolls r ON r.machine_id = m.machine_id AND DATE(r.created_at) = $1
        LEFT JOIN oee_metrics o ON o.machine_id = m.machine_id AND o.date = $1
        WHERE m.active = true
        GROUP BY m.machine_id, m.machine_name, m.machine_type, m.fabric
        ORDER BY production_kg DESC
      `, [date]),

      // Shift-wise totals
      pool.query(`
        SELECT
          shift,
          ROUND(COALESCE(SUM(r.actual_weight_kg), 0)::NUMERIC, 3) AS production_kg,
          COUNT(r.roll_id) FILTER (WHERE r.status = 'APPROVED')    AS rolls_approved,
          COUNT(DISTINCT r.machine_id)                              AS machines_active
        FROM rolls r
        WHERE DATE(r.created_at) = $1 AND r.shift IS NOT NULL
        GROUP BY shift
        ORDER BY shift
      `, [date]),

      // Downtime summary
      pool.query(`
        SELECT
          COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(end_time, NOW()) - start_time)) / 3600), 0)::NUMERIC AS total_downtime_hrs,
          COUNT(*) AS total_events,
          COUNT(DISTINCT machine_id) AS machines_affected
        FROM machine_downtime
        WHERE DATE(start_time) = $1
      `, [date]),

      // Roll summary
      pool.query(`
        SELECT
          COUNT(*) AS total_rolls,
          COUNT(*) FILTER (WHERE status = 'APPROVED')         AS approved,
          COUNT(*) FILTER (WHERE status = 'OPEN')             AS open,
          COUNT(*) FILTER (WHERE status = 'WAITING_WEIGHT')   AS pending,
          ROUND(COALESCE(SUM(actual_weight_kg), 0)::NUMERIC, 3) AS total_kg
        FROM rolls WHERE DATE(created_at) = $1
      `, [date]),

      // Attendance summary
      pool.query(`
        SELECT
          COUNT(DISTINCT operator_id) AS total_operators,
          COUNT(*) FILTER (WHERE shift = 'D') AS day_shift_ops,
          COUNT(*) FILTER (WHERE shift = 'N') AS night_shift_ops
        FROM operator_attendance WHERE work_date = $1
      `, [date]),
    ]);

    res.json({
      date,
      machines: machines.rows,
      shifts: shifts.rows,
      downtime: downtime.rows[0],
      rolls: rolls.rows[0],
      attendance: attendance.rows[0],
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ==========================
// PHASE 6 â€" USER MANAGEMENT
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
// PHASE 6 â€" AUDIT LOGS
// ==========================

app.get("/api/audit-logs", verifyToken, async (req, res) => {
  try {
    const page  = parseInt(req.query.page  || '1') || 1;
    const limit = Math.min(Math.max(parseInt(req.query.limit || '100') || 100, 1), 500);
    const offset = (page - 1) * limit;
    const { module } = req.query;
    const conds = []; const params = []; let p = 1;
    if (module) { conds.push(`module = $${p++}`); params.push(module); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [rows, cnt] = await Promise.all([
      pool.query(`SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC LIMIT $${p} OFFSET $${p + 1}`, [...params, limit, offset]),
      pool.query(`SELECT COUNT(*) FROM audit_logs ${where}`, params),
    ]);
    const total = parseInt(cnt.rows[0].count);
    res.json({ data: rows.rows, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ==========================
// AUTH â€" LOGIN (rate-limited)
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

// ==========================
// OPERATOR ATTENDANCE
// ==========================

// GET /api/attendance?date=&shift=
app.get('/api/attendance', async (req, res) => {
  try {
    const date  = req.query.date  || new Date().toISOString().slice(0, 10);
    const shift = req.query.shift || null;
    let q = `
      SELECT a.*, o.department, o.rfid_tag
      FROM operator_attendance a
      LEFT JOIN operators o ON a.operator_id = o.operator_id
      WHERE a.work_date = $1`;
    const params = [date];
    if (shift) { q += ` AND a.shift = $2`; params.push(shift); }
    q += ` ORDER BY a.clock_in`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/attendance/summary?from=&to=
app.get('/api/attendance/summary', async (req, res) => {
  try {
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const to   = req.query.to   || from;
    const r = await pool.query(`
      SELECT
        a.operator_id, a.operator_name,
        COUNT(*)                                          AS days_present,
        COUNT(CASE WHEN a.shift='D' THEN 1 END)          AS day_shifts,
        COUNT(CASE WHEN a.shift='N' THEN 1 END)          AS night_shifts,
        ROUND(AVG(a.scan_count),1)                       AS avg_scans_per_shift,
        MIN(a.clock_in)                                  AS first_seen,
        MAX(a.last_seen)                                 AS last_seen
      FROM operator_attendance a
      WHERE a.work_date BETWEEN $1 AND $2
      GROUP BY a.operator_id, a.operator_name
      ORDER BY days_present DESC, a.operator_name
    `, [from, to]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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

// FABRIC TYPES — migrated to layered architecture (src/routes/fabric-types.routes.js)
// Endpoints unchanged: GET (no auth), POST/PUT(:code)/DELETE(:code) (verifyToken)
app.use('/api/fabric-types', require('./src/routes/fabric-types.routes')({ pool, verifyToken }));

// ==========================
// PHASE 6 â€" MACHINE SETTINGS
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

// Editable fields only â€" DC ID is intentionally excluded
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
// DOWNTIME â€" NEW ENDPOINTS
// ==========================

// GET /api/downtime/open â€" live open downtime records with machine names and live timer
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

// GET /api/downtime/stats?date= â€" KPIs, top reasons, machine ranking
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

// PUT /api/downtime/:id/reason â€" assign or update reason on auto-created record
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
// PHASE 2 â€" MAINTENANCE SCHEDULE
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
// PHASE 2 â€" SHIFT HANDOVER NOTES
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

// React Router catch-all â€" moved to after warehouse routes below

// ============================================================
// AUTO WHATSAPP ALERTS â€" CallMeBot
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

// ============================================================
// DAILY AUTO-BACKUP â€" 7-day retention
// ============================================================
const BACKUP_DIR = path.join(__dirname, 'backups');

async function runDailyBackup() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const dateStr = new Date().toISOString().slice(0, 10);
    const backupFile = path.join(BACKUP_DIR, `dhown_mes_${dateStr}.sql`);

    const pgDump = path.join(process.env.PG_BIN || 'C:\\Program Files\\PostgreSQL\\18\\bin', 'pg_dump.exe');
    const dbName = process.env.DB_NAME || 'dhown_mes';
    const dbUser = process.env.DB_USER || 'postgres';
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = process.env.DB_PORT || '5432';

    const cmd = `"${pgDump}" -h ${dbHost} -p ${dbPort} -U ${dbUser} -F p -f "${backupFile}" ${dbName}`;
    const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' };

    await new Promise((resolve, reject) => {
      exec(cmd, { env }, (err, stdout, stderr) => {
        if (err) { reject(err); return; }
        resolve();
      });
    });

    console.log(`[BACKUP] Created: ${backupFile}`);

    // Delete backups older than 7 days
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('dhown_mes_') && f.endsWith('.sql'));
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const filePath = path.join(BACKUP_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        console.log(`[BACKUP] Deleted old backup: ${file}`);
      }
    }
  } catch (err) {
    console.error('[BACKUP] Failed:', err.message);
  }
}

function scheduleDailyBackup() {
  // Run at 02:00 AM every day
  const now = new Date();
  const next = new Date();
  next.setHours(2, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const msUntilNext = next - now;
  setTimeout(() => {
    runDailyBackup();
    setInterval(runDailyBackup, 24 * 60 * 60 * 1000);
  }, msUntilNext);
  console.log(`[BACKUP] Scheduled daily at 02:00 AM (next in ${Math.round(msUntilNext / 60000)} min)`);
}

// Manual backup trigger via API
app.post('/api/admin/backup', verifyToken, async (req, res) => {
  try {
    await runDailyBackup();
    const files = fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.sql')).sort().reverse()
      : [];
    res.json({ success: true, message: 'Backup created successfully', backups: files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/backups', verifyToken, async (req, res) => {
  try {
    const files = fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR)
          .filter(f => f.endsWith('.sql'))
          .map(f => {
            const stat = fs.statSync(path.join(BACKUP_DIR, f));
            return { name: f, size_kb: Math.round(stat.size / 1024), created_at: stat.mtime };
          })
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      : [];
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// WAREHOUSE MODULE
// ============================================================

// â"€â"€ Helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
async function nextSeq(prefix, table, col) {
  const r = await pool.query(`SELECT COUNT(*) FROM ${table}`);
  const n = parseInt(r.rows[0].count) + 1;
  const yr = new Date().getFullYear();
  return `${prefix}-${yr}-${String(n).padStart(3, '0')}`;
}

// â"€â"€ GREIGE WAREHOUSE â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

app.get('/api/greige', async (req, res) => {
  try {
    const { fabric_type, machine_id } = req.query;
    const conds = [`r.status = 'APPROVED'`, `(r.warehouse_status IS NULL OR r.warehouse_status = 'GREIGE')`];
    const vals = []; let p = 1;
    if (fabric_type) { conds.push(`r.fabric_type = $${p++}`); vals.push(fabric_type); }
    if (machine_id)  { conds.push(`r.machine_id = $${p++}`);  vals.push(machine_id); }
    const r = await pool.query(`
      SELECT r.*, m.machine_name, m.machine_type
      FROM rolls r
      LEFT JOIN machines m ON r.machine_id = m.machine_id
      WHERE ${conds.join(' AND ')}
      ORDER BY r.created_at DESC
    `, vals);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/greige/summary', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        COALESCE(fabric_type, 'Unknown') AS fabric_type,
        COUNT(*) AS roll_count,
        ROUND(COALESCE(SUM(actual_weight_kg), 0)::NUMERIC, 3) AS total_kg
      FROM rolls
      WHERE status = 'APPROVED' AND (warehouse_status IS NULL OR warehouse_status = 'GREIGE')
      GROUP BY fabric_type
      ORDER BY total_kg DESC
    `);
    const tot = await pool.query(`
      SELECT COUNT(*) AS roll_count,
             ROUND(COALESCE(SUM(actual_weight_kg),0)::NUMERIC,3) AS total_kg
      FROM rolls
      WHERE status='APPROVED' AND (warehouse_status IS NULL OR warehouse_status='GREIGE')`);
    res.json({ by_fabric: r.rows, totals: tot.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// â"€â"€ BATCHES â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

app.get('/api/batches', async (req, res) => {
  try {
    const { status } = req.query;
    const conds = []; const vals = []; let p = 1;
    if (status) { conds.push(`b.status = $${p++}`); vals.push(status); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(`
      SELECT b.*,
        COALESCE(br.roll_count, 0) AS roll_count,
        COALESCE(br.total_kg, 0)   AS total_weight_kg,
        fb.fabric_breakdown,
        dfb.dyed_breakdown
      FROM batches b
      LEFT JOIN (
        SELECT br.batch_id, COUNT(*) AS roll_count,
               ROUND(SUM(r.actual_weight_kg)::NUMERIC, 3) AS total_kg
        FROM batch_rolls br
        JOIN rolls r ON br.roll_id = r.roll_id
        GROUP BY br.batch_id
      ) br ON br.batch_id = b.batch_id
      LEFT JOIN LATERAL (
        SELECT json_agg(x) AS fabric_breakdown FROM (
          SELECT COALESCE(r.fabric_type, 'Unknown') AS fabric_type,
                 ROUND(SUM(COALESCE(r.actual_weight_kg, r.weight_kg, 0))::NUMERIC, 3) AS kg,
                 COUNT(*) AS rolls
          FROM batch_rolls br2 JOIN rolls r ON r.roll_id = br2.roll_id
          WHERE br2.batch_id = b.batch_id
          GROUP BY COALESCE(r.fabric_type, 'Unknown')
          ORDER BY 2 DESC
        ) x
      ) fb ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(x) AS dyed_breakdown FROM (
          SELECT ri.fabric_type,
                 ROUND(SUM(ri.weight_kg)::NUMERIC, 3) AS kg,
                 COALESCE(SUM(ri.roll_count), 0) AS rolls
          FROM subcontract_receipt_items ri
          JOIN subcontract_receipts sr ON sr.receipt_id = ri.receipt_id
          JOIN subcontract_challans sc ON sc.challan_id = sr.challan_id
          WHERE sc.batch_id = b.batch_id AND sc.job_type = 'DYEING'
          GROUP BY ri.fabric_type
          ORDER BY 2 DESC
        ) x
      ) dfb ON true
      ${where}
      ORDER BY b.created_at DESC
    `, vals);
    // DYED lots: show weights as received from dyeing, not the original greige weights
    r.rows.forEach(row => {
      if (row.status === 'DYED' && row.dyed_breakdown) {
        row.fabric_breakdown = row.dyed_breakdown;
        row.total_weight_kg = row.dyed_breakdown.reduce((s, f) => s + parseFloat(f.kg || 0), 0).toFixed(3);
      }
      delete row.dyed_breakdown;
    });
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Multi-fabric lots: label = all fabrics in the lot joined (e.g. "Rib + Fleece").
// Body fabric + rib + collar/cuffs knit from the same yarn are dyed together so shades match.
async function refreshBatchFabric(client, batch_id) {
  const fb = await client.query(`
    SELECT DISTINCT COALESCE(r.fabric_type, 'Unknown') AS ft
    FROM batch_rolls br JOIN rolls r ON r.roll_id = br.roll_id
    WHERE br.batch_id = $1 ORDER BY 1
  `, [batch_id]);
  const label = fb.rows.map(x => x.ft).join(' + ') || null;
  if (label) await client.query(`UPDATE batches SET fabric_type=$1, updated_at=NOW() WHERE batch_id=$2`, [label, batch_id]);
  return label;
}

app.post('/api/batches', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { fabric_type, color_code, color_name, notes, roll_ids } = req.body;
    await client.query('BEGIN');
    const batch_number = await nextDocNumber('LOT');
    const r = await client.query(
      `INSERT INTO batches (batch_number, fabric_type, color_code, color_name, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [batch_number, fabric_type || null, color_code || null, color_name || null, notes || null, req.user.username]
    );
    const batch_id = r.rows[0].batch_id;
    if (Array.isArray(roll_ids) && roll_ids.length) {
      for (const roll_id of roll_ids) {
        await client.query(
          `INSERT INTO batch_rolls (batch_id, roll_id, added_by) VALUES ($1,$2,$3) ON CONFLICT (roll_id) DO NOTHING`,
          [batch_id, roll_id, req.user.username]
        );
        await client.query(`UPDATE rolls SET warehouse_status='IN_BATCH' WHERE roll_id=$1`, [roll_id]);
      }
    }
    const label = await refreshBatchFabric(client, batch_id);
    await client.query(`INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,'CREATE_LOT','WAREHOUSE',$2)`,
      [req.user.username, `lot=${batch_number} fabric=${label || fabric_type} rolls=${(roll_ids||[]).length}`]);
    await client.query('COMMIT');
    res.json({ ...r.rows[0], fabric_type: label || r.rows[0].fabric_type, rolls_added: (roll_ids || []).length });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

app.get('/api/batches/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [batch, rolls] = await Promise.all([
      pool.query(`SELECT * FROM batches WHERE batch_id = $1`, [id]),
      pool.query(`
        SELECT r.*, m.machine_name, br.added_at, br.added_by
        FROM batch_rolls br
        JOIN rolls r ON br.roll_id = r.roll_id
        LEFT JOIN machines m ON r.machine_id = m.machine_id
        WHERE br.batch_id = $1
        ORDER BY br.added_at DESC
      `, [id]),
    ]);
    if (!batch.rows.length) return res.status(404).json({ error: 'Batch not found' });
    const fb = await pool.query(`
      SELECT COALESCE(r.fabric_type, 'Unknown') AS fabric_type,
             ROUND(SUM(COALESCE(r.actual_weight_kg, r.weight_kg, 0))::NUMERIC, 3) AS kg,
             COUNT(*) AS rolls
      FROM batch_rolls br JOIN rolls r ON r.roll_id = br.roll_id
      WHERE br.batch_id = $1
      GROUP BY COALESCE(r.fabric_type, 'Unknown')
      ORDER BY 2 DESC
    `, [id]);
    res.json({ ...batch.rows[0], rolls: rolls.rows, fabric_breakdown: fb.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/batches/:id/rolls', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { roll_ids } = req.body; // array of roll_id
    if (!Array.isArray(roll_ids) || !roll_ids.length) return res.status(400).json({ error: 'roll_ids array required' });

    const batch = await client.query(`SELECT * FROM batches WHERE batch_id = $1`, [id]);
    if (!batch.rows.length) return res.status(404).json({ error: 'Batch not found' });
    if (batch.rows[0].status !== 'OPEN') return res.status(400).json({ error: 'Batch is not open' });

    await client.query('BEGIN');
    for (const roll_id of roll_ids) {
      await client.query(
        `INSERT INTO batch_rolls (batch_id, roll_id, added_by) VALUES ($1,$2,$3) ON CONFLICT (roll_id) DO NOTHING`,
        [id, roll_id, req.user.username]
      );
      await client.query(`UPDATE rolls SET warehouse_status='IN_BATCH' WHERE roll_id=$1`, [roll_id]);
    }
    await refreshBatchFabric(client, id);
    await client.query('COMMIT');
    res.json({ added: roll_ids.length });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

app.delete('/api/batches/:id/rolls/:rollId', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id, rollId } = req.params;
    await client.query('BEGIN');
    await client.query(`DELETE FROM batch_rolls WHERE batch_id=$1 AND roll_id=$2`, [id, rollId]);
    await client.query(`UPDATE rolls SET warehouse_status='GREIGE' WHERE roll_id=$1`, [rollId]);
    await refreshBatchFabric(client, id);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

// Delete a batch (OPEN or SEALED only) — returns rolls back to GREIGE
app.delete('/api/batches/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const batch = await client.query('SELECT * FROM batches WHERE batch_id=$1', [id]);
    if (!batch.rows.length) return res.status(404).json({ error: 'Batch not found' });
    if (batch.rows[0].status === 'SENT' || batch.rows[0].status === 'RECEIVED' || batch.rows[0].status === 'CLOSED')
      return res.status(400).json({ error: `Cannot delete lot in ${batch.rows[0].status} status` });
    await client.query('BEGIN');
    await client.query(`UPDATE rolls SET warehouse_status='GREIGE' WHERE roll_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)`, [id]);
    await client.query('DELETE FROM batch_rolls WHERE batch_id=$1', [id]);
    await client.query('DELETE FROM batches WHERE batch_id=$1', [id]);
    await client.query('COMMIT');
    res.json({ ok: true, message: `Lot ${batch.rows[0].batch_number} deleted, ${batch.rows[0].roll_count || 0} rolls returned to greige` });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

app.put('/api/batches/:id/seal', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const r = await pool.query(
      `UPDATE batches SET status='SEALED', updated_at=NOW() WHERE batch_id=$1 AND status='OPEN' RETURNING *`, [id]
    );
    if (!r.rows.length) return res.status(400).json({ error: 'Batch not found or not open' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// â"€â"€ SUBCONTRACTING â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

app.get('/api/subcontract/challans', async (req, res) => {
  try {
    const { status, from, to } = req.query;
    const conds = []; const vals = []; let p = 1;
    if (status) { conds.push(`c.status = $${p++}`); vals.push(status); }
    if (from)   { conds.push(`c.sent_date >= $${p++}`); vals.push(from); }
    if (to)     { conds.push(`c.sent_date <= $${p++}`); vals.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(`
      SELECT c.*, b.batch_number, b.fabric_type, b.color_name,
        CASE WHEN c.expected_return_date < CURRENT_DATE AND c.status = 'SENT'
             THEN true ELSE false END AS is_overdue
      FROM subcontract_challans c
      LEFT JOIN batches b ON c.batch_id = b.batch_id
      ${where}
      ORDER BY c.created_at DESC
    `, vals);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/subcontract/challans', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { batch_id, vendor_name, vendor_contact, job_type, sent_date, expected_return_date, rate_per_kg, notes, items } = req.body;
    if (!vendor_name || !job_type || !sent_date)
      return res.status(400).json({ error: 'vendor_name, job_type, sent_date are required' });

    // New style: items = [{batch_id, fabric_type, color, roll_count, weight_kg}]
    // Old style: single batch_id (kept for compatibility)
    const rows = Array.isArray(items) && items.length
      ? items.filter(it => it.batch_id && it.fabric_type)
      : (batch_id ? [{ batch_id }] : []);
    if (!rows.length) return res.status(400).json({ error: 'Select at least one lot / fabric line' });

    const batchIds = [...new Set(rows.map(it => parseInt(it.batch_id)))];
    for (const bid of batchIds) {
      const b = await client.query(`SELECT * FROM batches WHERE batch_id=$1`, [bid]);
      if (!b.rows.length) return res.status(404).json({ error: `Lot ${bid} not found` });
      if (!['OPEN','SEALED','DYED'].includes(b.rows[0].status))
        return res.status(400).json({ error: `Lot ${b.rows[0].batch_number} already sent or closed` });
      if (b.rows[0].status === 'DYED' && job_type !== 'FINISHING')
        return res.status(400).json({ error: 'Dyed lots can only be sent for FINISHING' });
    }
    const batch = await client.query(`SELECT * FROM batches WHERE batch_id=$1`, [batchIds[0]]);

    // Per-line stats: DYED lots use dyeing-received weights; greige lots use roll weights
    const lineStats = [];
    for (const it of rows) {
      const bRow = await client.query(`SELECT status FROM batches WHERE batch_id=$1`, [it.batch_id]);
      let st;
      if (bRow.rows[0]?.status === 'DYED') {
        st = await client.query(`
          SELECT COALESCE(SUM(ri.roll_count),0) AS roll_count,
                 ROUND(SUM(ri.weight_kg)::NUMERIC,3) AS total_kg
          FROM subcontract_receipt_items ri
          JOIN subcontract_receipts sr ON sr.receipt_id=ri.receipt_id
          JOIN subcontract_challans sc ON sc.challan_id=sr.challan_id
          WHERE sc.batch_id=$1 AND sc.job_type='DYEING' ${it.fabric_type ? 'AND ri.fabric_type = $2' : ''}
        `, it.fabric_type ? [it.batch_id, it.fabric_type] : [it.batch_id]);
      }
      if (!st || !parseFloat(st.rows[0]?.total_kg)) {
        st = await client.query(`
          SELECT COUNT(*) AS roll_count,
                 ROUND(SUM(COALESCE(r.actual_weight_kg, r.weight_kg, 0))::NUMERIC,3) AS total_kg
          FROM batch_rolls br JOIN rolls r ON br.roll_id=r.roll_id
          WHERE br.batch_id=$1 ${it.fabric_type ? 'AND COALESCE(r.fabric_type, \'Unknown\') = $2' : ''}
        `, it.fabric_type ? [it.batch_id, it.fabric_type] : [it.batch_id]);
      }
      lineStats.push({
        ...it,
        roll_count: parseInt(st.rows[0].roll_count) || 0,
        weight_kg: parseFloat(st.rows[0].total_kg) || 0,
      });
    }
    const roll_count = lineStats.reduce((s, l) => s + l.roll_count, 0);
    const total_kg   = lineStats.reduce((s, l) => s + l.weight_kg, 0).toFixed(3);
    const colorJoin  = [...new Set(lineStats.map(l => l.color).filter(Boolean))].join(', ') || null;

    const challan_number = await nextSeq('SC', 'subcontract_challans', 'challan_id');

    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO subcontract_challans
         (challan_number, batch_id, vendor_name, vendor_contact, job_type, sent_date,
          expected_return_date, sent_weight_kg, roll_count, rate_per_kg, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [challan_number, batchIds[0], vendor_name, vendor_contact||null, job_type, sent_date,
       expected_return_date||null, total_kg, roll_count, rate_per_kg||null, notes||null, req.user.username]
    );
    const challanId = r.rows[0].challan_id;
    for (const l of lineStats) {
      await client.query(
        `INSERT INTO subcontract_challan_items (challan_id, batch_id, fabric_type, color, roll_count, weight_kg)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [challanId, l.batch_id, l.fabric_type || null, l.color || null, l.roll_count, l.weight_kg]
      );
    }
    if (colorJoin) await client.query(`UPDATE subcontract_challans SET color_name=$1 WHERE challan_id=$2`, [colorJoin, challanId]);
    // Update all involved lots + their rolls
    for (const bid of batchIds) {
      await client.query(`UPDATE batches SET status='SENT', updated_at=NOW() WHERE batch_id=$1`, [bid]);
      await client.query(`
        UPDATE rolls SET warehouse_status='SENT_OUT'
        WHERE roll_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)
      `, [bid]);
    }
    await client.query('COMMIT');
    await pool.query(`INSERT INTO audit_logs (username,action,module,new_value) VALUES ($1,'SEND_SUBCONTRACT','WAREHOUSE',$2)`,
      [req.user.username, `challan=${challan_number} vendor=${vendor_name} kg=${total_kg}`]);

    // Auto: JOBWORK cost entry
    try {
      const challanRow = r.rows[0];
      if (rate_per_kg && parseFloat(rate_per_kg) > 0 && parseFloat(total_kg) > 0) {
        const component = job_type === 'DYEING' ? 'JOBWORK_DYEING' : job_type === 'FINISHING' ? 'JOBWORK_FINISHING' : 'JOBWORK_DYEING_FINISHING';
        const b = batch.rows[0];
        const client3 = await pool.connect();
        try {
          await addCostEntry(client3, { reference_type: 'CHALLAN', reference_id: challanRow.challan_id, cost_component: component, amount_rs: (parseFloat(total_kg) * parseFloat(rate_per_kg)).toFixed(2), quantity_kg: parseFloat(total_kg), rate_used: parseFloat(rate_per_kg), fabric_type: b.fabric_type, color_name: b.color_name, notes: `${vendor_name} â€" ${job_type}` });
        } finally { client3.release(); }
      }
    } catch (costErr) { console.error('Jobwork cost error:', costErr.message); }

    // stock_ledger: fabric OUT to dye house / finishing
    try {
      const challanRow = r.rows[0];
      const transitWh = await pool.query(`SELECT warehouse_id FROM warehouses WHERE code='TRANSIT' LIMIT 1`);
      const slClient = await pool.connect();
      try {
        const partnerIdRow = challanRow.partner_id || null;
        await postToLedger(slClient, {
          doc_type: 'SC_CHALLAN', doc_id: challanRow.challan_number,
          item_desc: `Fabric batch ${batch_id} â€" ${job_type}`,
          warehouse_id: transitWh.rows[0]?.warehouse_id || null,
          movement_type: 'OUT',
          quantity: parseFloat(total_kg),
          uom_code: 'KG',
          partner_id: partnerIdRow,
          notes: `Sent to ${vendor_name} for ${job_type}`,
          created_by: req.user?.username || 'system',
        });
      } finally { slClient.release(); }
    } catch (slErr) { console.error('Ledger challan error:', slErr.message); }

    res.json(r.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

// Knitting challan â€" sends yarn lots, receives rolls + balance yarn
app.post('/api/subcontract/knitting-challans', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { vendor_name, vendor_contact, job_type, sent_date, expected_return_date,
            rate_per_kg, notes, is_job_work, customer_name, yarn_items } = req.body;
    if (!vendor_name || !sent_date || !yarn_items?.length)
      return res.status(400).json({ error: 'vendor_name, sent_date, and yarn_items are required' });

    const total_kg = yarn_items.reduce((s, i) => s + parseFloat(i.sent_kg || 0), 0);
    const challan_number = await nextSeq('SC', 'subcontract_challans', 'challan_id');

    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO subcontract_challans
         (challan_number, batch_id, vendor_name, vendor_contact, job_type, sent_date,
          expected_return_date, sent_weight_kg, roll_count, rate_per_kg, notes,
          challan_type, is_job_work, customer_name, created_by)
       VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,0,$8,$9,'YARN_BASED',$10,$11,$12) RETURNING *`,
      [challan_number, vendor_name, vendor_contact||null, job_type||'KNITTING', sent_date,
       expected_return_date||null, total_kg.toFixed(3), rate_per_kg||null, notes||null,
       is_job_work||false, customer_name||null, req.user.username]
    );
    const challan_id = r.rows[0].challan_id;

    // Insert yarn items + deduct from yarn store
    for (const item of yarn_items) {
      await client.query(
        `INSERT INTO sc_challan_yarn_items (challan_id, lot_id, lot_number, yarn_type, color, sent_kg)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [challan_id, item.lot_id||null, item.lot_number||null, item.yarn_type||null, item.color||null, item.sent_kg]
      );
      if (item.lot_id) {
        await client.query(
          `UPDATE yarn_lots SET current_stock_kg = current_stock_kg - $1 WHERE lot_id = $2`,
          [item.sent_kg, item.lot_id]
        );
      }
    }
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

// Receive back from knitting â€" rolls + balance yarn
app.post('/api/subcontract/knitting-challans/:id/receive', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { received_date, received_weight_kg, rolls_received_count, balance_yarn_kg,
            quality_status, rejected_weight_kg, notes, vendor_invoice_no, vendor_bill_amount } = req.body;
    if (!received_date || !received_weight_kg)
      return res.status(400).json({ error: 'received_date and received_weight_kg are required' });

    const challan = await client.query(`SELECT * FROM subcontract_challans WHERE challan_id=$1`, [id]);
    if (!challan.rows.length) return res.status(404).json({ error: 'Challan not found' });
    if (challan.rows[0].status === 'RECEIVED') return res.status(400).json({ error: 'Already fully received' });

    await client.query('BEGIN');

    // Sum previously received weight for partial receipt support
    const prevReceived = await client.query(
      `SELECT COALESCE(SUM(received_weight_kg), 0) AS total FROM subcontract_receipts WHERE challan_id=$1`, [id]
    );
    const totalReceivedSoFar = parseFloat(prevReceived.rows[0].total) + parseFloat(received_weight_kg);
    const sentKg = parseFloat(challan.rows[0].sent_weight_kg || 0);
    const isFullyReceived = totalReceivedSoFar >= sentKg;

    const r = await client.query(
      `INSERT INTO subcontract_receipts
         (challan_id, received_date, received_weight_kg, quality_status, rejected_weight_kg, notes,
          rolls_received_count, balance_yarn_kg, created_by, vendor_invoice_no, vendor_bill_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [id, received_date, received_weight_kg, quality_status||'PASS',
       rejected_weight_kg||0, notes||null,
       rolls_received_count||0, balance_yarn_kg||0, req.user.username,
       vendor_invoice_no||null, vendor_bill_amount||null]
    );

    // Update challan status: PARTIALLY_RECEIVED or RECEIVED
    const newStatus = isFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    await client.query(
      `UPDATE subcontract_challans SET status=$1, updated_at=NOW() WHERE challan_id=$2`, [newStatus, id]
    );

    // Return balance yarn to yarn store on every receipt (partial or final)
    if (parseFloat(balance_yarn_kg||0) > 0) {
      const items = await client.query(
        `SELECT lot_id, sent_kg FROM sc_challan_yarn_items WHERE challan_id=$1 AND lot_id IS NOT NULL`, [id]
      );
      for (const item of items.rows) {
        const share = parseFloat(item.sent_kg) / parseFloat(challan.rows[0].sent_weight_kg || 1);
        const returnKg = (parseFloat(balance_yarn_kg) * share).toFixed(3);
        await client.query(
          `UPDATE yarn_lots SET current_stock_kg = current_stock_kg + $1 WHERE lot_id=$2`,
          [returnKg, item.lot_id]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ ...r.rows[0], challan_status: newStatus, total_received_kg: totalReceivedSoFar });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

app.get('/api/subcontract/challans/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [challan, rolls, receipts] = await Promise.all([
      pool.query(`
        SELECT c.*, b.batch_number, b.fabric_type,
          COALESCE(c.color_name, b.color_name) AS color_name
        FROM subcontract_challans c
        LEFT JOIN batches b ON c.batch_id=b.batch_id
        WHERE c.challan_id=$1
      `, [id]),
      pool.query(`
        SELECT DISTINCT r.roll_id,
          'ROLL-' || LPAD(r.roll_id::text, 4, '0') AS roll_display,
          r.machine_id, m.machine_name,
          r.fabric_type, r.shift, r.status,
          COALESCE(r.actual_weight_kg, r.weight_kg, 0) AS actual_weight_kg,
          COALESCE(h.hsn_code, '') AS hsn_code
        FROM batch_rolls br
        JOIN rolls r ON br.roll_id=r.roll_id
        LEFT JOIN machines m ON r.machine_id=m.machine_id
        LEFT JOIN items i ON UPPER(i.item_code) = UPPER(r.fabric_type) OR UPPER(i.item_name) = UPPER(r.fabric_type)
        LEFT JOIN hsn_codes h ON h.hsn_id = i.hsn_id
        WHERE br.batch_id IN (
          SELECT batch_id FROM subcontract_challans WHERE challan_id=$1
          UNION
          SELECT batch_id FROM subcontract_challan_items WHERE challan_id=$1 AND batch_id IS NOT NULL
        )
        ORDER BY r.roll_id
      `, [id]),
      pool.query(`SELECT * FROM subcontract_receipts WHERE challan_id=$1 ORDER BY created_at DESC`, [id]),
    ]);
    if (!challan.rows.length) return res.status(404).json({ error: 'Challan not found' });
    // For yarn-based (knitting) challans, fetch yarn items instead of rolls
    let yarnItems = [];
    if (challan.rows[0].challan_type === 'YARN_BASED') {
      const yi = await pool.query(`SELECT y.*, COALESCE(i.item_name, y.yarn_type) AS item_name FROM sc_challan_yarn_items y LEFT JOIN items i ON UPPER(i.item_code) = UPPER(y.yarn_type) WHERE y.challan_id=$1 ORDER BY y.item_id`, [id]);
      yarnItems = yi.rows;
    }
    const fabricItems = await pool.query(`
      SELECT ci.*, b.batch_number
      FROM subcontract_challan_items ci LEFT JOIN batches b ON b.batch_id = ci.batch_id
      WHERE ci.challan_id=$1 ORDER BY ci.item_id
    `, [id]);
    res.json({ ...challan.rows[0], rolls: rolls.rows, receipts: receipts.rows, yarn_items: yarnItems, fabric_items: fabricItems.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/subcontract/challans/:id/receive', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { received_date, received_weight_kg, quality_status, rejected_weight_kg, notes,
            vendor_invoice_no, vendor_bill_amount } = req.body;
    if (!received_date || !received_weight_kg)
      return res.status(400).json({ error: 'received_date and received_weight_kg required' });

    const challan = await client.query(`SELECT * FROM subcontract_challans WHERE challan_id=$1`, [id]);
    if (!challan.rows.length) return res.status(404).json({ error: 'Challan not found' });
    if (challan.rows[0].status === 'RECEIVED') return res.status(400).json({ error: 'Already fully received' });

    const c = challan.rows[0];
    await client.query('BEGIN');

    // Sum previously received weight for partial receipt support
    const prevReceived = await client.query(
      `SELECT COALESCE(SUM(received_weight_kg), 0) AS total FROM subcontract_receipts WHERE challan_id=$1`, [id]
    );
    const totalReceivedSoFar = parseFloat(prevReceived.rows[0].total) + parseFloat(received_weight_kg);
    const sentKg = parseFloat(c.sent_weight_kg || 0);
    // Receipts are FINAL by default — process loss means received < sent is normal.
    // Only stays open if the operator explicitly marks it a partial receipt.
    const isFullyReceived = !req.body.is_partial;

    // Insert receipt
    const receipt = await client.query(
      `INSERT INTO subcontract_receipts
         (challan_id, received_date, received_weight_kg, quality_status, rejected_weight_kg, notes, received_by,
          vendor_invoice_no, vendor_bill_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, received_date, received_weight_kg, quality_status||'PASS', rejected_weight_kg||0, notes||null, req.user.username,
       vendor_invoice_no||null, vendor_bill_amount||null]
    );

    const batch = await client.query(`SELECT * FROM batches WHERE batch_id=$1`, [c.batch_id]);
    const b = batch.rows[0];
    const isDyeingOnly = c.job_type === 'DYEING';

    // New: received_items = [{fabric_type, batch_id, color, weight_kg}]
    // Old roll IDs are lost in the wet process — generate NEW roll IDs for the fabric coming back.
    const receivedItems = Array.isArray(req.body.received_items)
      ? req.body.received_items.filter(it => it.fabric_type && parseFloat(it.weight_kg) > 0)
      : [];
    const newRolls = [];
    let fg = null;

    if (receivedItems.length) {
      let seq = 0;
      for (const it of receivedItems) {
        // Dyed-only fabric goes straight back out for finishing — no per-roll IDs needed.
        // New roll IDs + labels are generated only for FINISHED fabric.
        let newRollId = null;
        if (!isDyeingOnly) {
          seq += 1;
          newRollId = `${c.challan_number}-R${String(seq).padStart(3, '0')}`;
          await client.query(
            `INSERT INTO rolls (roll_id, fabric_type, weight_kg, actual_weight_kg, status, warehouse_status, source, closed_at, approved_at)
             VALUES ($1,$2,$3,$3,'APPROVED','FINISHED','SC_RECEIPT',NOW(),NOW())
             ON CONFLICT (roll_id) DO NOTHING`,
            [newRollId, it.fabric_type, parseFloat(it.weight_kg)]
          );
        }
        await client.query(
          `INSERT INTO subcontract_receipt_items (receipt_id, fabric_type, batch_id, color, weight_kg, new_roll_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [receipt.rows[0].receipt_id, it.fabric_type, it.batch_id || c.batch_id, it.color || null, parseFloat(it.weight_kg), newRollId]
        );
        if (newRollId) newRolls.push({ roll_id: newRollId, fabric_type: it.fabric_type, color: it.color, weight_kg: it.weight_kg });
        // One FG entry per received fabric line (finishing / dyeing+finishing)
        if (!isDyeingOnly) {
          fg = await client.query(
            `INSERT INTO finished_goods
               (receipt_id, batch_id, fabric_type, color_code, color_name, weight_kg, roll_count)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [receipt.rows[0].receipt_id, it.batch_id || c.batch_id, it.fabric_type, b.color_code, it.color || b.color_name,
             parseFloat(it.weight_kg), 1]
          );
        }
      }
    } else if (!isDyeingOnly) {
      // Old style: single FG entry from challan totals
      fg = await client.query(
        `INSERT INTO finished_goods
           (receipt_id, batch_id, fabric_type, color_code, color_name, weight_kg, roll_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [receipt.rows[0].receipt_id, c.batch_id, b.fabric_type, b.color_code, b.color_name,
         parseFloat(received_weight_kg) - parseFloat(rejected_weight_kg||0),
         0]
      );
    }

    // Update challan status: PARTIALLY_RECEIVED or RECEIVED
    const newStatus = isFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    await client.query(`UPDATE subcontract_challans SET status=$1, updated_at=NOW() WHERE challan_id=$2`, [newStatus, id]);

    // On full receipt: update batch and roll statuses
    if (isFullyReceived) {
      if (isDyeingOnly) {
        // Dyeing only: batch goes to DYED, rolls to DYED — ready for finishing
        await client.query(`UPDATE batches SET status='DYED', updated_at=NOW() WHERE batch_id=$1`, [c.batch_id]);
        await client.query(`
          UPDATE rolls SET warehouse_status='DYED'
          WHERE roll_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)
        `, [c.batch_id]);
      } else {
        // Finishing or Dyeing+Finishing: batch complete
        await client.query(`UPDATE batches SET status='RECEIVED', updated_at=NOW() WHERE batch_id=$1`, [c.batch_id]);
        await client.query(`
          UPDATE rolls SET warehouse_status='FINISHED'
          WHERE roll_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)
        `, [c.batch_id]);
      }
    }

    await client.query('COMMIT');
    await pool.query(`INSERT INTO audit_logs (username,action,module,new_value) VALUES ($1,'RECEIVE_SUBCONTRACT','WAREHOUSE',$2)`,
      [req.user.username, `challan=${c.challan_number} received_kg=${received_weight_kg} status=${newStatus} (${totalReceivedSoFar.toFixed(3)}/${sentKg} kg)`]);

    // Auto: WASTAGE cost entry - only on final receipt
    if (isFullyReceived) {
      try {
        const lossKg = sentKg - totalReceivedSoFar;
        if (lossKg > 0) {
          const rate = await getYarnRate(b.fabric_type);
          const c4 = await pool.connect();
          try { await addCostEntry(c4, { reference_type: 'BATCH', reference_id: c.batch_id, cost_component: 'WASTAGE', amount_rs: (lossKg * rate).toFixed(2), quantity_kg: lossKg, rate_used: rate, fabric_type: b.fabric_type, color_name: b.color_name, notes: `Processing loss: sent ${sentKg}kg total received ${totalReceivedSoFar.toFixed(3)}kg` }); }
          finally { c4.release(); }
        }
      } catch (costErr) { console.error('Wastage cost error:', costErr.message); }
    }

    // stock_ledger: fabric IN from dye house to FG store (per receipt)
    try {
      const fgWh = await pool.query(`SELECT warehouse_id FROM warehouses WHERE code='FG-STORE' LIMIT 1`);
      const slClient = await pool.connect();
      try {
        await postToLedger(slClient, {
          doc_type: 'SC_RECEIPT', doc_id: receipt.rows[0].receipt_id,
          item_desc: `${b.fabric_type || ''} ${b.color_name || ''} - Batch ${c.batch_id}`.trim(),
          warehouse_id: fgWh.rows[0]?.warehouse_id || null,
          movement_type: 'IN',
          quantity: parseFloat(received_weight_kg) - parseFloat(rejected_weight_kg || 0),
          uom_code: 'KG',
          notes: `Received from ${c.vendor_name} (${newStatus})`,
          created_by: req.user?.username || 'system',
        });
      } finally { slClient.release(); }
    } catch (slErr) { console.error('Ledger receipt error:', slErr.message); }

    res.json({ receipt: receipt.rows[0], finished_good: fg ? fg.rows[0] : null, challan_status: newStatus, total_received_kg: totalReceivedSoFar, new_rolls: newRolls });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

// â"€â"€ FINISHED GOODS â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

app.get('/api/finished-goods', async (req, res) => {
  try {
    const { status } = req.query;
    const conds = []; const vals = []; let p = 1;
    if (status) { conds.push(`fg.status = $${p++}`); vals.push(status); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(`
      SELECT fg.*, b.batch_number, b.color_name AS batch_color,
             c.vendor_name, c.job_type,
             ROUND(COALESCE(batch_cost.total_cost, 0)::NUMERIC, 2) AS total_cost_rs,
             CASE WHEN fg.weight_kg > 0
               THEN ROUND((COALESCE(batch_cost.total_cost, 0) / fg.weight_kg)::NUMERIC, 2)
               ELSE 0 END AS cost_per_kg
      FROM finished_goods fg
      LEFT JOIN batches b ON fg.batch_id = b.batch_id
      LEFT JOIN subcontract_receipts sr ON fg.receipt_id = sr.receipt_id
      LEFT JOIN subcontract_challans c ON sr.challan_id = c.challan_id
      LEFT JOIN (
        SELECT batch_id, SUM(amount_rs) AS total_cost FROM (
          -- Batch-level costs (WASTAGE, JOBWORK_DYEING, JOBWORK_FINISHING)
          SELECT reference_id AS batch_id, SUM(amount_rs) AS amount_rs
          FROM cost_entries WHERE reference_type = 'BATCH'
          GROUP BY reference_id
          UNION ALL
          -- Roll-level costs (YARN_COST, KNITTING_COST) via batch_rolls
          SELECT br.batch_id, SUM(ce.amount_rs) AS amount_rs
          FROM cost_entries ce
          JOIN batch_rolls br ON br.roll_id = ce.reference_id
          WHERE ce.reference_type = 'ROLL'
          GROUP BY br.batch_id
        ) sub GROUP BY batch_id
      ) batch_cost ON batch_cost.batch_id = fg.batch_id
      ${where}
      ORDER BY fg.created_at DESC
    `, vals);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/finished-goods/summary', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        COALESCE(fabric_type,'Unknown') AS fabric_type,
        COALESCE(color_name,'Undyed') AS color_name,
        COUNT(*) AS lot_count,
        ROUND(COALESCE(SUM(weight_kg),0)::NUMERIC,3) AS total_kg,
        status
      FROM finished_goods
      GROUP BY fabric_type, color_name, status
      ORDER BY total_kg DESC
    `);
    const tot = await pool.query(`
      SELECT COUNT(*) AS lot_count,
             ROUND(COALESCE(SUM(fg.weight_kg),0)::NUMERIC,3) AS total_kg,
             ROUND(COALESCE(SUM(batch_cost.total_cost),0)::NUMERIC,2) AS total_cost_rs,
             CASE WHEN SUM(fg.weight_kg) > 0
               THEN ROUND((COALESCE(SUM(batch_cost.total_cost),0) / SUM(fg.weight_kg))::NUMERIC, 2)
               ELSE 0 END AS avg_cost_per_kg
      FROM finished_goods fg
      LEFT JOIN (
        SELECT batch_id, SUM(amount_rs) AS total_cost FROM (
          SELECT reference_id AS batch_id, SUM(amount_rs) AS amount_rs
          FROM cost_entries WHERE reference_type = 'BATCH' GROUP BY reference_id
          UNION ALL
          SELECT br.batch_id, SUM(ce.amount_rs) AS amount_rs
          FROM cost_entries ce JOIN batch_rolls br ON br.roll_id = ce.reference_id
          WHERE ce.reference_type = 'ROLL' GROUP BY br.batch_id
        ) sub GROUP BY batch_id
      ) batch_cost ON batch_cost.batch_id = fg.batch_id
      WHERE fg.status='IN_STOCK'
    `);
    res.json({ by_type: r.rows, in_stock_totals: tot.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update SC receipt invoice details
app.put('/api/subcontract/receipts/:id/invoice', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { vendor_invoice_no, vendor_bill_amount, payment_status } = req.body;
    const r = await pool.query(
      `UPDATE subcontract_receipts SET vendor_invoice_no=$1, vendor_bill_amount=$2, payment_status=$3, updated_at=NOW()
       WHERE receipt_id=$4 RETURNING *`,
      [vendor_invoice_no||null, vendor_bill_amount||null, payment_status||'PENDING', req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Receipt not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Party-wise subcontract report with pending lots
app.get('/api/subcontract/party-report', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.challan_id, c.challan_number, c.vendor_name, c.vendor_contact,
        c.job_type, c.challan_type, c.status, c.sent_date, c.expected_return_date,
        c.sent_weight_kg, c.is_job_work, c.customer_name,
        b.batch_number, b.fabric_type, b.color_name,
        CASE WHEN c.expected_return_date < CURRENT_DATE AND c.status IN ('SENT','PARTIALLY_RECEIVED')
             THEN true ELSE false END AS is_overdue,
        (CURRENT_DATE - c.sent_date::date) AS days_out,
        COALESCE((SELECT SUM(sr.received_weight_kg) FROM subcontract_receipts sr WHERE sr.challan_id = c.challan_id), 0) AS total_received_kg
      FROM subcontract_challans c
      LEFT JOIN batches b ON c.batch_id = b.batch_id
      WHERE c.status != 'CANCELLED'
      ORDER BY c.vendor_name, c.sent_date DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// SC invoices pending payment — for invoice matching view
app.get('/api/subcontract/invoices-pending', async (req, res) => {
  try {
    const { status } = req.query; // 'pending' (default) | 'paid' | 'all'
    const statusClause = status === 'paid' ? `WHERE sr.payment_status = 'PAID'`
                       : status === 'all'  ? ''
                       : `WHERE sr.payment_status IS DISTINCT FROM 'PAID'`;
    const r = await pool.query(`
      SELECT sr.receipt_id, sr.received_date, sr.received_weight_kg, sr.vendor_invoice_no,
             sr.vendor_bill_amount, sr.payment_status,
             sc.challan_number, sc.vendor_name, sc.rate_per_kg,
             ROUND((sr.received_weight_kg * sc.rate_per_kg)::NUMERIC, 2) AS expected_amount
      FROM subcontract_receipts sr
      JOIN subcontract_challans sc ON sc.challan_id = sr.challan_id
      ${statusClause}
      ORDER BY sr.received_date DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/finished-goods/:id/location', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const { location } = req.body;
    const r = await pool.query(
      `UPDATE finished_goods SET location=$1, updated_at=NOW() WHERE fg_id=$2 RETURNING *`,
      [location, id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE Finished Goods (IN_STOCK only)
app.delete('/api/finished-goods/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const fg = await pool.query(`SELECT * FROM finished_goods WHERE fg_id=$1`, [req.params.id]);
    if (!fg.rows.length) return res.status(404).json({ error: 'Not found' });
    if (fg.rows[0].status === 'DISPATCHED') return res.status(400).json({ error: 'Cannot delete dispatched goods' });
    await pool.query(`DELETE FROM finished_goods WHERE fg_id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// CANCEL Subcontract Challan (SENT only — not yet received)
app.put('/api/subcontract/challans/:id/cancel', verifyToken, requireRole('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sc = await client.query(`SELECT * FROM subcontract_challans WHERE challan_id=$1`, [req.params.id]);
    if (!sc.rows.length) return res.status(404).json({ error: 'Challan not found' });
    if (sc.rows[0].status !== 'SENT') return res.status(400).json({ error: 'Only SENT challans can be cancelled' });
    // Reverse batch + roll status
    if (sc.rows[0].batch_id) {
      await client.query(`UPDATE batches SET status='SEALED', updated_at=NOW() WHERE batch_id=$1`, [sc.rows[0].batch_id]);
      await client.query(`
        UPDATE rolls SET warehouse_status='GREIGE'
        WHERE roll_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)
      `, [sc.rows[0].batch_id]);
    }
    // If yarn-based challan, return yarn to lots
    if (sc.rows[0].challan_type === 'YARN_BASED') {
      const yarnItems = await client.query(`SELECT * FROM sc_challan_yarn_items WHERE challan_id=$1`, [req.params.id]);
      for (const item of yarnItems.rows) {
        if (item.lot_id) {
          await client.query(`UPDATE yarn_lots SET current_stock_kg = current_stock_kg + $1 WHERE lot_id=$2`, [item.sent_kg, item.lot_id]);
        }
      }
    }
    await client.query(`UPDATE subcontract_challans SET status='CANCELLED', updated_at=NOW() WHERE challan_id=$1`, [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

// DELETE Subcontract Challan (hard delete — number freed)
app.delete('/api/subcontract/challans/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sc = await client.query(`SELECT * FROM subcontract_challans WHERE challan_id=$1`, [req.params.id]);
    if (!sc.rows.length) return res.status(404).json({ error: 'Challan not found' });
    if (sc.rows[0].status === 'RECEIVED') return res.status(400).json({ error: 'Cannot delete received challan' });
    // Reverse batch/roll/yarn stock same as cancel
    if (sc.rows[0].batch_id) {
      await client.query(`UPDATE batches SET status='SEALED', updated_at=NOW() WHERE batch_id=$1`, [sc.rows[0].batch_id]);
      await client.query(`UPDATE rolls SET warehouse_status='GREIGE' WHERE roll_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)`, [sc.rows[0].batch_id]);
    }
    if (sc.rows[0].challan_type === 'YARN_BASED') {
      const yarnItems = await client.query(`SELECT * FROM sc_challan_yarn_items WHERE challan_id=$1`, [req.params.id]);
      for (const item of yarnItems.rows) {
        if (item.lot_id) await client.query(`UPDATE yarn_lots SET current_stock_kg = current_stock_kg + $1 WHERE lot_id=$2`, [item.sent_kg, item.lot_id]);
      }
    }
    await client.query(`DELETE FROM cost_entries WHERE reference_type='CHALLAN' AND reference_id=$1`, [req.params.id]);
    await client.query(`DELETE FROM sc_challan_yarn_items WHERE challan_id=$1`, [req.params.id]);
    await client.query(`DELETE FROM subcontract_challans WHERE challan_id=$1`, [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

// EDIT Subcontract Challan (SENT only)
app.put('/api/subcontract/challans/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const sc = await pool.query(`SELECT status FROM subcontract_challans WHERE challan_id=$1`, [req.params.id]);
    if (!sc.rows.length) return res.status(404).json({ error: 'Not found' });
    if (sc.rows[0].status !== 'SENT') return res.status(400).json({ error: 'Only SENT challans can be edited' });
    const { vendor_name, vendor_contact, rate_per_kg, expected_return_date, notes } = req.body;
    const r = await pool.query(
      `UPDATE subcontract_challans SET vendor_name=COALESCE($1,vendor_name), vendor_contact=$2, rate_per_kg=$3, expected_return_date=$4, notes=$5, updated_at=NOW()
       WHERE challan_id=$6 RETURNING *`,
      [vendor_name, vendor_contact||null, rate_per_kg||null, expected_return_date||null, notes||null, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SC FEATURE #1: Last rate lookup (auto-fill from previous challans) ──
app.get('/api/subcontract/last-rate', async (req, res) => {
  try {
    const { vendor_name, job_type } = req.query;
    if (!vendor_name) return res.json({ rate_per_kg: null });
    const conds = [`vendor_name = $1`, `rate_per_kg IS NOT NULL`, `rate_per_kg > 0`];
    const vals = [vendor_name];
    let p = 2;
    if (job_type) { conds.push(`job_type = $${p++}`); vals.push(job_type); }
    const r = await pool.query(`
      SELECT rate_per_kg, job_type, sent_date, challan_number
      FROM subcontract_challans WHERE ${conds.join(' AND ')}
      ORDER BY sent_date DESC, challan_id DESC LIMIT 1
    `, vals);
    res.json(r.rows[0] || { rate_per_kg: null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SC FEATURE #2: Auto wastage calculation on receipt ──
app.get('/api/subcontract/wastage-summary', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.challan_id, c.challan_number, c.vendor_name, c.job_type,
        c.sent_weight_kg,
        COALESCE(SUM(sr.received_weight_kg), 0) AS total_received_kg,
        COALESCE(SUM(sr.rejected_weight_kg), 0) AS total_rejected_kg,
        ROUND(((c.sent_weight_kg - COALESCE(SUM(sr.received_weight_kg),0)) / NULLIF(c.sent_weight_kg,0) * 100)::NUMERIC, 2) AS wastage_pct
      FROM subcontract_challans c
      JOIN subcontract_receipts sr ON sr.challan_id = c.challan_id
      WHERE c.status = 'RECEIVED'
      GROUP BY c.challan_id
      HAVING c.sent_weight_kg - COALESCE(SUM(sr.received_weight_kg),0) > 0
      ORDER BY wastage_pct DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SC FEATURE #3: Overdue challan alerts for Dashboard ──
app.get('/api/subcontract/overdue-alerts', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.challan_id, c.challan_number, c.vendor_name, c.job_type,
        c.sent_date, c.expected_return_date, c.sent_weight_kg, c.status,
        (CURRENT_DATE - c.expected_return_date::DATE) AS days_overdue,
        b.batch_number, b.fabric_type, b.color_name
      FROM subcontract_challans c
      LEFT JOIN batches b ON c.batch_id = b.batch_id
      WHERE c.status IN ('SENT', 'PARTIALLY_RECEIVED')
        AND c.expected_return_date IS NOT NULL
        AND c.expected_return_date < CURRENT_DATE
      ORDER BY days_overdue DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SC FEATURE #4: Analytics — vendor turnaround, wastage trends, cost trends ──
app.get('/api/subcontract/analytics', async (req, res) => {
  try {
    const [vendorStats, monthlyTrend, wastageByVendor] = await Promise.all([
      pool.query(`
        SELECT c.vendor_name, c.job_type,
          COUNT(*) AS total_challans,
          COUNT(*) FILTER (WHERE c.status = 'RECEIVED') AS completed,
          COUNT(*) FILTER (WHERE c.status IN ('SENT','PARTIALLY_RECEIVED')) AS pending,
          ROUND(AVG(CASE WHEN c.status = 'RECEIVED' AND sr_agg.first_recv IS NOT NULL
            THEN (sr_agg.first_recv::DATE - c.sent_date::DATE) END)::NUMERIC, 1) AS avg_turnaround_days,
          ROUND(SUM(c.sent_weight_kg)::NUMERIC, 2) AS total_sent_kg,
          ROUND(COALESCE(SUM(sr_agg.total_recv), 0)::NUMERIC, 2) AS total_received_kg,
          ROUND(COALESCE(SUM(c.sent_weight_kg * COALESCE(c.rate_per_kg, 0)), 0)::NUMERIC, 2) AS total_cost
        FROM subcontract_challans c
        LEFT JOIN (
          SELECT challan_id, SUM(received_weight_kg) AS total_recv, MIN(received_date) AS first_recv
          FROM subcontract_receipts GROUP BY challan_id
        ) sr_agg ON sr_agg.challan_id = c.challan_id
        WHERE c.status != 'CANCELLED'
        GROUP BY c.vendor_name, c.job_type
        ORDER BY total_challans DESC
      `),
      pool.query(`
        SELECT TO_CHAR(c.sent_date, 'YYYY-MM') AS month,
          COUNT(*) AS challans,
          ROUND(SUM(c.sent_weight_kg)::NUMERIC, 2) AS sent_kg,
          ROUND(COALESCE(SUM(sr_agg.total_recv), 0)::NUMERIC, 2) AS received_kg,
          ROUND(COALESCE(SUM(c.sent_weight_kg * COALESCE(c.rate_per_kg, 0)), 0)::NUMERIC, 2) AS cost
        FROM subcontract_challans c
        LEFT JOIN (
          SELECT challan_id, SUM(received_weight_kg) AS total_recv
          FROM subcontract_receipts GROUP BY challan_id
        ) sr_agg ON sr_agg.challan_id = c.challan_id
        WHERE c.status != 'CANCELLED'
        GROUP BY month ORDER BY month DESC LIMIT 12
      `),
      pool.query(`
        SELECT c.vendor_name,
          ROUND(SUM(c.sent_weight_kg)::NUMERIC, 2) AS total_sent,
          ROUND(COALESCE(SUM(sr_agg.total_recv), 0)::NUMERIC, 2) AS total_received,
          ROUND(((SUM(c.sent_weight_kg) - COALESCE(SUM(sr_agg.total_recv),0)) / NULLIF(SUM(c.sent_weight_kg),0) * 100)::NUMERIC, 2) AS wastage_pct
        FROM subcontract_challans c
        LEFT JOIN (
          SELECT challan_id, SUM(received_weight_kg) AS total_recv
          FROM subcontract_receipts GROUP BY challan_id
        ) sr_agg ON sr_agg.challan_id = c.challan_id
        WHERE c.status = 'RECEIVED'
        GROUP BY c.vendor_name
        HAVING SUM(c.sent_weight_kg) > 0
        ORDER BY wastage_pct DESC
      `)
    ]);
    res.json({
      vendor_stats: vendorStats.rows,
      monthly_trend: monthlyTrend.rows.reverse(),
      wastage_by_vendor: wastageByVendor.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SC FEATURE #5: Multi-process chaining — forward dyed batch to finishing ──
app.post('/api/subcontract/challans/:id/forward', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { vendor_name, vendor_contact, rate_per_kg, expected_return_date, notes } = req.body;

    const challan = await client.query(`SELECT * FROM subcontract_challans WHERE challan_id=$1`, [id]);
    if (!challan.rows.length) return res.status(404).json({ error: 'Challan not found' });
    const orig = challan.rows[0];
    if (orig.status !== 'RECEIVED') return res.status(400).json({ error: 'Original challan must be fully received first' });
    if (orig.job_type !== 'DYEING') return res.status(400).json({ error: 'Only dyeing challans can be forwarded to finishing' });

    const batch = await client.query(`SELECT * FROM batches WHERE batch_id=$1`, [orig.batch_id]);
    if (!batch.rows.length) return res.status(404).json({ error: 'Batch not found' });
    if (batch.rows[0].status !== 'DYED') return res.status(400).json({ error: 'Batch is not in DYED status' });

    if (!vendor_name) return res.status(400).json({ error: 'vendor_name is required for forwarding' });

    // Get received weight from original challan receipts
    const recvStats = await client.query(
      `SELECT SUM(received_weight_kg) AS total, COUNT(*) AS roll_count FROM subcontract_receipts WHERE challan_id=$1`, [id]
    );
    const total_kg = parseFloat(recvStats.rows[0].total || orig.sent_weight_kg);
    const roll_count = parseInt(recvStats.rows[0].roll_count || orig.roll_count || 0);

    const challan_number = await nextSeq('SC', 'subcontract_challans', 'challan_id');
    const today = new Date().toISOString().slice(0, 10);

    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO subcontract_challans
         (challan_number, batch_id, vendor_name, vendor_contact, job_type, sent_date,
          expected_return_date, sent_weight_kg, roll_count, rate_per_kg, notes, created_by, forwarded_from_challan_id)
       VALUES ($1,$2,$3,$4,'FINISHING',$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [challan_number, orig.batch_id, vendor_name, vendor_contact||null, today,
       expected_return_date||null, total_kg.toFixed(3), roll_count, rate_per_kg||null,
       notes || `Forwarded from ${orig.challan_number} (${orig.vendor_name} dyeing)`,
       req.user.username, orig.challan_id]
    );

    await client.query(`UPDATE batches SET status='SENT', updated_at=NOW() WHERE batch_id=$1`, [orig.batch_id]);
    await client.query(`
      UPDATE rolls SET warehouse_status='SENT_OUT'
      WHERE roll_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)
    `, [orig.batch_id]);

    await client.query('COMMIT');

    // Jobwork cost entry for finishing
    if (rate_per_kg && parseFloat(rate_per_kg) > 0) {
      try {
        const c2 = await pool.connect();
        try {
          await addCostEntry(c2, { reference_type: 'CHALLAN', reference_id: r.rows[0].challan_id, cost_component: 'JOBWORK_FINISHING', amount_rs: (total_kg * parseFloat(rate_per_kg)).toFixed(2), quantity_kg: total_kg, rate_used: parseFloat(rate_per_kg), fabric_type: batch.rows[0].fabric_type, color_name: batch.rows[0].color_name, notes: `${vendor_name} — FINISHING (forwarded from ${orig.challan_number})` });
        } finally { c2.release(); }
      } catch (costErr) { console.error('Forward jobwork cost error:', costErr.message); }
    }

    await pool.query(`INSERT INTO audit_logs (username,action,module,new_value) VALUES ($1,'FORWARD_SUBCONTRACT','WAREHOUSE',$2)`,
      [req.user.username, `${orig.challan_number} → ${challan_number} vendor=${vendor_name} kg=${total_kg.toFixed(3)}`]);

    res.json(r.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

// EDIT Finished Goods
app.put('/api/finished-goods/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const fg = await pool.query(`SELECT * FROM finished_goods WHERE fg_id=$1`, [req.params.id]);
    if (!fg.rows.length) return res.status(404).json({ error: 'Not found' });
    if (fg.rows[0].status === 'DISPATCHED') return res.status(400).json({ error: 'Cannot edit dispatched goods' });
    const { weight_kg, fabric_type, color_name, location, notes } = req.body;
    const r = await pool.query(
      `UPDATE finished_goods SET weight_kg=COALESCE($1,weight_kg), fabric_type=COALESCE($2,fabric_type),
       color_name=COALESCE($3,color_name), location=$4, notes=$5, updated_at=NOW()
       WHERE fg_id=$6 RETURNING *`,
      [weight_kg||null, fabric_type||null, color_name||null, location||null, notes||null, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// EDIT Roll (OPEN, CLOSED, APPROVED — not SENT_OUT/DISPATCHED)
app.put('/api/rolls/:rollId', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT status, warehouse_status FROM rolls WHERE roll_id=$1`, [req.params.rollId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Roll not found' });
    if (['SENT_OUT','DISPATCHED'].includes(r.rows[0].warehouse_status))
      return res.status(400).json({ error: 'Cannot edit — roll is in subcontracting or dispatched' });
    if (r.rows[0].status === 'CANCELLED')
      return res.status(400).json({ error: 'Cannot edit a cancelled roll' });
    const { fabric_type, shift, operator_id, actual_weight_kg } = req.body;
    const result = await pool.query(
      `UPDATE rolls SET fabric_type=COALESCE($1,fabric_type), shift=COALESCE($2,shift),
       operator_id=COALESCE($3,operator_id), actual_weight_kg=COALESCE($4,actual_weight_kg)
       WHERE roll_id=$5 RETURNING *`,
      [fabric_type||null, shift||null, operator_id||null, actual_weight_kg||null, req.params.rollId]
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE Roll (CANCELLED only — permanent removal)
app.delete('/api/rolls/:rollId/permanent', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT status FROM rolls WHERE roll_id=$1`, [req.params.rollId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Roll not found' });
    if (r.rows[0].status !== 'CANCELLED') return res.status(400).json({ error: 'Only CANCELLED rolls can be permanently deleted' });
    await pool.query(`DELETE FROM rolls WHERE roll_id=$1`, [req.params.rollId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// â"€â"€ DISPATCH â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

app.get('/api/dispatch', async (req, res) => {
  try {
    const { from, to, dispatch_type } = req.query;
    const conds = []; const params = [];
    if (from)          { conds.push(`d.dispatch_date >= $${params.length+1}`); params.push(from); }
    if (to)            { conds.push(`d.dispatch_date <= $${params.length+1}`); params.push(to); }
    if (dispatch_type) { conds.push(`d.dispatch_type = $${params.length+1}`); params.push(dispatch_type); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(`
      SELECT d.*,
        COUNT(di.item_id) AS item_count,
        ROUND(COALESCE(SUM(di.weight_kg),0)::NUMERIC,3) AS total_kg
      FROM dispatch_challans d
      LEFT JOIN dispatch_items di ON di.dispatch_id=d.dispatch_id
      ${where}
      GROUP BY d.dispatch_id
      ORDER BY d.created_at DESC
    `, params);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/dispatch', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { customer_name, customer_contact, vehicle_number, dispatch_date, notes, items, dispatch_type = 'FG' } = req.body;
    if (!customer_name || !dispatch_date || !Array.isArray(items) || !items.length)
      return res.status(400).json({ error: 'customer_name, dispatch_date, items[] required' });

    const dispatch_number = await nextSeq('DC', 'dispatch_challans', 'dispatch_id');
    const total_kg = items.reduce((s, i) => s + parseFloat(i.weight_kg || 0), 0);

    // Optional commercial pricing per line (sale / job-work dispatches)
    const priceLine = (item) => {
      const rate = numOrNull(item.rate_per_kg);
      if (!rate || rate <= 0) return { rate: null, gst: null, taxable: null, gstAmt: null, total: null };
      const w = parseFloat(item.weight_kg || 0);
      const gst = numOrNull(item.gst_rate) ?? 5;
      const taxable = +(w * rate).toFixed(2);
      const gstAmt = +(taxable * gst / 100).toFixed(2);
      return { rate, gst, taxable, gstAmt, total: +(taxable + gstAmt).toFixed(2) };
    };
    const priced = items.map(priceLine);
    const hasPricing = priced.some(p => p.taxable !== null);
    const totTaxable = priced.reduce((s, p) => s + (p.taxable || 0), 0);
    const totGst     = priced.reduce((s, p) => s + (p.gstAmt  || 0), 0);

    await client.query('BEGIN');
    const d = await client.query(
      `INSERT INTO dispatch_challans
         (dispatch_number, customer_name, customer_contact, vehicle_number, dispatch_date, total_weight_kg, notes, dispatch_type, created_by,
          total_taxable_value, total_gst, grand_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [dispatch_number, customer_name, customer_contact||null, vehicle_number||null, dispatch_date,
       total_kg.toFixed(3), notes||null, dispatch_type, req.user.username,
       hasPricing ? totTaxable.toFixed(2) : null,
       hasPricing ? totGst.toFixed(2) : null,
       hasPricing ? (totTaxable + totGst).toFixed(2) : null]
    );
    const dispatch_id = d.rows[0].dispatch_id;

    const PRICE_COLS = `, rate_per_kg, gst_rate, taxable_value, gst_amount, line_total`;
    if (dispatch_type === 'FG') {
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx]; const p = priced[idx];
        const fg = await client.query(`SELECT * FROM finished_goods WHERE fg_id=$1`, [item.fg_id]);
        if (!fg.rows.length) continue;
        const f = fg.rows[0];
        await client.query(
          `INSERT INTO dispatch_items (dispatch_id, fg_id, item_type, weight_kg, fabric_type, color_name, item_description${PRICE_COLS})
           VALUES ($1,$2,'FG',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [dispatch_id, item.fg_id, item.weight_kg, f.fabric_type, f.color_name, item.item_description||null,
           p.rate, p.gst, p.taxable, p.gstAmt, p.total]
        );
        await client.query(`UPDATE finished_goods SET status='DISPATCHED', updated_at=NOW() WHERE fg_id=$1`, [item.fg_id]);
      }
    } else if (dispatch_type === 'GREIGE') {
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx]; const p = priced[idx];
        const roll = await client.query(`SELECT r.*, m.machine_name FROM rolls r LEFT JOIN machines m ON r.machine_id=m.machine_id WHERE r.roll_id=$1`, [item.roll_id]);
        if (!roll.rows.length) continue;
        const r = roll.rows[0];
        await client.query(
          `INSERT INTO dispatch_items (dispatch_id, roll_id, item_type, weight_kg, fabric_type, color_name, item_description${PRICE_COLS})
           VALUES ($1,$2,'GREIGE',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [dispatch_id, item.roll_id, item.weight_kg || r.actual_weight_kg, r.fabric_type, r.color||null, `Roll #${item.roll_id} · ${r.machine_name||''}`,
           p.rate, p.gst, p.taxable, p.gstAmt, p.total]
        );
        await client.query(`UPDATE rolls SET warehouse_status='DISPATCHED', updated_at=NOW() WHERE roll_id=$1`, [item.roll_id]);
      }
    } else if (dispatch_type === 'YARN') {
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx]; const p = priced[idx];
        const lot = await client.query(`SELECT * FROM yarn_lots WHERE lot_id=$1`, [item.lot_id]);
        if (!lot.rows.length) continue;
        const l = lot.rows[0];
        await client.query(
          `INSERT INTO dispatch_items (dispatch_id, lot_id, item_type, weight_kg, lot_number, yarn_type, color, item_description${PRICE_COLS})
           VALUES ($1,$2,'YARN',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [dispatch_id, item.lot_id, item.weight_kg || l.current_stock_kg, l.lot_number, l.yarn_type, l.color||null, `${l.lot_number} · ${l.yarn_type}`,
           p.rate, p.gst, p.taxable, p.gstAmt, p.total]
        );
        const dispKg = parseFloat(item.weight_kg || l.current_stock_kg);
        const beforeKg = parseFloat(l.current_stock_kg);
        await client.query(
          `UPDATE yarn_lots SET current_stock_kg = current_stock_kg - $1, status = CASE WHEN current_stock_kg - $1 <= 0 THEN 'DISPATCHED' ELSE status END, updated_at=NOW() WHERE lot_id=$2`,
          [dispKg, item.lot_id]
        );
        await client.query(
          `INSERT INTO yarn_lot_movements (lot_id, movement_type, quantity_kg, before_kg, after_kg, reference_type, reference_id, notes)
           VALUES ($1,'DISPATCH',$2,$3,$4,'DISPATCH',$5,$6)`,
          [item.lot_id, dispKg, beforeKg, beforeKg - dispKg, dispatch_id, `Dispatch ${dispatch_number} → ${customer_name}`]
        );
      }
    }
    await client.query('COMMIT');
    await pool.query(`INSERT INTO audit_logs (username,action,module,new_value) VALUES ($1,'CREATE_DISPATCH','WAREHOUSE',$2)`,
      [req.user.username, `dispatch=${dispatch_number} customer=${customer_name} kg=${total_kg.toFixed(3)}`]);

    // Auto: cost snapshot per FG lot dispatched
    try {
      for (const item of items) {
        const fgRow = await pool.query(`SELECT fg.*, b.batch_number FROM finished_goods fg LEFT JOIN batches b ON b.batch_id=fg.batch_id WHERE fg.fg_id=$1`, [item.fg_id]);
        if (!fgRow.rows.length) continue;
        const f = fgRow.rows[0];
        if (!f.batch_id) continue;
        const costRes = await pool.query(`SELECT COALESCE(SUM(amount_rs),0) AS total FROM cost_entries WHERE (reference_type='BATCH' AND reference_id=$1) OR (reference_type='ROLL' AND reference_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)) OR (reference_type='CHALLAN' AND reference_id IN (SELECT challan_id::text FROM subcontract_challans WHERE batch_id=$1))`, [f.batch_id]);
        const total_cost_rs = parseFloat(costRes.rows[0].total);
        const weight = parseFloat(item.weight_kg || f.weight_kg || 0);
        const cost_per_kg = weight > 0 ? (total_cost_rs / weight) : 0;
        await pool.query(`INSERT INTO cost_snapshots (snapshot_date, fabric_type, color_name, total_cost_rs, total_kg, cost_per_kg) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (snapshot_date,fabric_type,color_name) DO UPDATE SET total_cost_rs=cost_snapshots.total_cost_rs+$4, total_kg=cost_snapshots.total_kg+$5, cost_per_kg=ROUND((cost_snapshots.total_cost_rs+$4)/NULLIF(cost_snapshots.total_kg+$5,0),2)`,
          [dispatch_date, f.fabric_type, f.color_name, total_cost_rs.toFixed(2), weight.toFixed(3), cost_per_kg.toFixed(2)]);
      }
    } catch (costErr) { console.error('Dispatch snapshot error:', costErr.message); }

    // stock_ledger: FG OUT on dispatch
    try {
      const fgWh = await pool.query(`SELECT warehouse_id FROM warehouses WHERE code='FG-STORE' LIMIT 1`);
      const slClient = await pool.connect();
      try {
        await postToLedger(slClient, {
          doc_type: 'DISPATCH', doc_id: dispatch_number,
          item_desc: `Dispatch to ${customer_name}`,
          warehouse_id: fgWh.rows[0]?.warehouse_id || null,
          movement_type: 'OUT',
          quantity: parseFloat(total_kg.toFixed(3)),
          uom_code: 'KG',
          notes: `Customer: ${customer_name}`,
          created_by: req.user?.username || 'system',
        });
      } finally { slClient.release(); }
    } catch (slErr) { console.error('Ledger dispatch error:', slErr.message); }

    res.json(d.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

app.get('/api/dispatch/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const disp = await pool.query(`SELECT * FROM dispatch_challans WHERE dispatch_id=$1`, [id]);
    if (!disp.rows.length) return res.status(404).json({ error: 'Dispatch not found' });
    const dc = disp.rows[0];

    let items;
    if (dc.dispatch_type === 'GREIGE') {
      items = await pool.query(`
        SELECT di.*, r.actual_weight_kg AS stock_kg, r.fabric_type AS roll_fabric, r.shift, m.machine_name
        FROM dispatch_items di
        LEFT JOIN rolls r ON r.roll_id = di.roll_id
        LEFT JOIN machines m ON m.machine_id = r.machine_id
        WHERE di.dispatch_id=$1
      `, [id]);
    } else if (dc.dispatch_type === 'YARN') {
      items = await pool.query(`
        SELECT di.*, yl.yarn_type AS yl_yarn_type, yl.color AS yl_color, yl.supplier_lot_no, yl.count
        FROM dispatch_items di
        LEFT JOIN yarn_lots yl ON yl.lot_id = di.lot_id
        WHERE di.dispatch_id=$1
      `, [id]);
    } else {
      items = await pool.query(`
        SELECT di.*, fg.fabric_type AS fg_fabric, fg.color_name AS fg_color, fg.weight_kg AS stock_kg, b.batch_number
        FROM dispatch_items di
        LEFT JOIN finished_goods fg ON fg.fg_id = di.fg_id
        LEFT JOIN batches b ON fg.batch_id = b.batch_id
        WHERE di.dispatch_id=$1
      `, [id]);
    }
    res.json({ ...dc, items: items.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Delete Dispatch Challan ---
app.delete('/api/dispatch/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dc = await client.query('SELECT * FROM dispatch_challans WHERE dispatch_id=$1', [req.params.id]);
    if (!dc.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    // Restore stock for dispatched items
    const items = await client.query('SELECT * FROM dispatch_items WHERE dispatch_id=$1', [req.params.id]);
    for (const item of items.rows) {
      if (item.roll_id) await client.query("UPDATE rolls SET warehouse_status='GREIGE', updated_at=NOW() WHERE roll_id=$1", [item.roll_id]);
      if (item.fg_id) await client.query("UPDATE finished_goods SET status='IN_STOCK', updated_at=NOW() WHERE fg_id=$1", [item.fg_id]);
      if (item.lot_id) {
        await client.query('UPDATE yarn_lots SET current_stock_kg = current_stock_kg + COALESCE($1,0), updated_at=NOW() WHERE lot_id=$2', [item.quantity_kg, item.lot_id]);
      }
    }
    await client.query('DELETE FROM dispatch_items WHERE dispatch_id=$1', [req.params.id]);
    await client.query('DELETE FROM dispatch_challans WHERE dispatch_id=$1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

// --- Release Assignment ---
app.put('/api/assignments/:id/release', verifyToken, async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE operator_assignments SET status='RELEASED', released_at=NOW() WHERE assignment_id=$1 AND status='ACTIVE' RETURNING *",
      [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Assignment not found or already released' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Opening Balances ---
// Yarn Store opening
app.post('/api/opening/yarn', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { yarn_type, supplier_lot_no, brand, cones, weight_kg, rate_per_kg, value, item_id } = req.body;
    if (!yarn_type || !weight_kg) return res.status(400).json({ error: 'yarn_type and weight_kg required' });
    const lot_number = 'OB-' + Date.now();
    const finalRate = rate_per_kg || (value && weight_kg ? (parseFloat(value) / parseFloat(weight_kg)).toFixed(2) : null);
    const r = await pool.query(
      `INSERT INTO yarn_lots (lot_number, yarn_type, supplier_lot_no, brand, cones, net_weight_kg, current_stock_kg, rate_per_kg, item_id, status, source)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,'IN_STORE','OPENING') RETURNING *`,
      [lot_number, yarn_type, supplier_lot_no || null, brand || null, cones || null, weight_kg, finalRate, item_id || null]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Yarn at work center opening
app.post('/api/opening/yarn-at-machine', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { machine_id, yarn_type, supplier_lot_no, brand, cones, weight_kg, rate_per_kg, value, item_id } = req.body;
    if (!machine_id || !yarn_type || !weight_kg) return res.status(400).json({ error: 'machine_id, yarn_type, weight_kg required' });
    const lot_number = 'OB-WC-' + Date.now();
    const finalRate = rate_per_kg || (value && weight_kg ? (parseFloat(value) / parseFloat(weight_kg)).toFixed(2) : null);
    const lot = await client.query(
      `INSERT INTO yarn_lots (lot_number, yarn_type, supplier_lot_no, brand, cones, net_weight_kg, current_stock_kg, rate_per_kg, item_id, status, source)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,'ISSUED','OPENING') RETURNING *`,
      [lot_number, yarn_type, supplier_lot_no || null, brand || null, cones || null, weight_kg, finalRate, item_id || null]);
    // Create yarn issue
    const issue_number = 'OB-ISS-' + Date.now();
    const machine = await client.query('SELECT machine_name FROM machines WHERE machine_id=$1', [machine_id]);
    const iss = await client.query(
      `INSERT INTO yarn_issues (issue_number, machine_id, machine_name, issued_by, notes, status)
       VALUES ($1,$2,$3,'Opening Balance','Opening balance entry','ISSUED') RETURNING *`,
      [issue_number, machine_id, machine.rows[0]?.machine_name || machine_id]);
    await client.query(
      'INSERT INTO yarn_issue_items (issue_id, lot_id, issued_kg) VALUES ($1,$2,$3)',
      [iss.rows[0].issue_id, lot.rows[0].lot_id, weight_kg]);
    await client.query('COMMIT');
    res.json({ lot: lot.rows[0], issue: iss.rows[0] });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

// Greige stock opening — generic roll_id, no machine dependency
app.post('/api/opening/greige', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { fabric_type, weight_kg, value } = req.body;
    if (!fabric_type || !weight_kg) return res.status(400).json({ error: 'fabric_type and weight_kg required' });
    const seq = Date.now().toString().slice(-6);
    const roll_id = `OB-GR-${seq}`;
    const r = await pool.query(
      `INSERT INTO rolls (roll_id, fabric_type, actual_weight_kg, status, warehouse_status, source, approved_at)
       VALUES ($1,$2,$3,'APPROVED','GREIGE','OPENING',NOW()) RETURNING *`,
      [roll_id, fabric_type, weight_kg]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Subcontracting (sent) opening
app.post('/api/opening/subcontract', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { vendor_name, fabric_type, weight_kg, sent_date, process_type, rate_per_kg, value } = req.body;
    if (!weight_kg || !process_type) return res.status(400).json({ error: 'weight_kg and process_type required' });
    const challan_number = 'OB-SC-' + Date.now();
    const r = await pool.query(
      `INSERT INTO subcontract_challans (challan_number, vendor_name, job_type, fabric_type, sent_weight_kg, sent_date, rate_per_kg, status, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'SENT','OPENING') RETURNING *`,
      [challan_number, vendor_name || 'Opening', process_type, fabric_type || null, weight_kg, sent_date || new Date().toISOString().slice(0,10), rate_per_kg || null]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Finished Goods opening
app.post('/api/opening/finished-goods', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { fabric_type, color_name, lot_no, weight_kg, value } = req.body;
    if (!weight_kg) return res.status(400).json({ error: 'weight_kg required' });
    const r = await pool.query(
      `INSERT INTO finished_goods (fabric_type, color_name, lot_no, weight_kg, status, source)
       VALUES ($1,$2,$3,$4,'IN_STOCK','OPENING') RETURNING *`,
      [fabric_type || null, color_name || null, lot_no || null, weight_kg]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// -- WAREHOUSE DASHBOARD â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

app.get('/api/warehouse/overview', async (req, res) => {
  try {
    const [yarnStore, greige, inBatch, sentOut, finishedStock, dispatched, overdue] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS lots, ROUND(COALESCE(SUM(current_stock_kg),0)::NUMERIC,3) AS kg
                  FROM yarn_lots WHERE status='IN_STORE'`),
      pool.query(`SELECT COUNT(*) AS rolls, ROUND(COALESCE(SUM(actual_weight_kg),0)::NUMERIC,3) AS kg
                  FROM rolls WHERE status='APPROVED' AND (warehouse_status IS NULL OR warehouse_status='GREIGE')`),
      pool.query(`SELECT COUNT(*) AS rolls FROM rolls WHERE warehouse_status='IN_BATCH'`),
      pool.query(`SELECT COUNT(*) AS challans, ROUND(COALESCE(SUM(sent_weight_kg),0)::NUMERIC,3) AS kg
                  FROM subcontract_challans WHERE status='SENT'`),
      pool.query(`SELECT COUNT(*) AS lots, ROUND(COALESCE(SUM(weight_kg),0)::NUMERIC,3) AS kg
                  FROM finished_goods WHERE status='IN_STOCK'`),
      pool.query(`SELECT COUNT(*) AS orders, ROUND(COALESCE(SUM(total_weight_kg),0)::NUMERIC,3) AS kg
                  FROM dispatch_challans WHERE status='DISPATCHED'`),
      pool.query(`SELECT COUNT(*) AS count FROM subcontract_challans
                  WHERE status='SENT' AND expected_return_date < CURRENT_DATE`),
    ]);
    res.json({
      yarn_store:      yarnStore.rows[0],
      greige:          greige.rows[0],
      in_batch:        inBatch.rows[0],
      sent_out:        sentOut.rows[0],
      finished_stock:  finishedStock.rows[0],
      dispatched:      dispatched.rows[0],
      overdue_challans: parseInt(overdue.rows[0].count),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// ENTERPRISE INVENTORY MODULE
// ============================================================
const QRCode = require('qrcode');

async function generateQR(text) {
  try { return await QRCode.toDataURL(text, { width: 200, margin: 1 }); }
  catch (_) { return null; }
}

async function nextInvSeq(prefix, table, col) {
  const yr = new Date().getFullYear();
  const res = await pool.query(
    `SELECT ${col} FROM ${table} WHERE ${col} LIKE $1 ORDER BY ${col} DESC LIMIT 1`,
    [`${prefix}-${yr}-%`]
  );
  if (res.rows.length === 0) return `${prefix}-${yr}-001`;
  const last = res.rows[0][col];
  const n = parseInt(last.split('-').pop(), 10) + 1;
  return `${prefix}-${yr}-${String(n).padStart(3, '0')}`;
}

// â"€â"€ GRN â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.get('/api/grn', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0, from, to } = req.query;
    let q = `SELECT g.*, COUNT(yl.lot_id) AS lot_count,
               SUM(yl.net_weight_kg) AS total_kg
             FROM grn g LEFT JOIN yarn_lots yl ON yl.grn_id = g.grn_id`;
    const params = []; const conds = [];
    if (status) { conds.push(`g.status = $${params.length+1}`); params.push(status); }
    if (from)   { conds.push(`g.receipt_date >= $${params.length+1}`); params.push(from); }
    if (to)     { conds.push(`g.receipt_date <= $${params.length+1}`); params.push(to); }
    if (conds.length) q += ` WHERE ${conds.join(' AND ')}`;
    q += ` GROUP BY g.grn_id ORDER BY g.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(limit, offset);
    const r = await pool.query(q, params);
    const countConds = conds.map(c => c.replace(/g\./g, ''));
    const tot = await pool.query(`SELECT COUNT(*) FROM grn${countConds.length ? ' WHERE '+countConds.join(' AND ') : ''}`, params.slice(0, params.length-2));
    res.json({ data: r.rows, total: parseInt(tot.rows[0].count) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/grn', async (req, res) => {
  try {
    const { supplier_name, supplier_invoice, receipt_date, vehicle_number, received_by, notes, warehouse_id } = req.body;
    const grn_number = await nextInvSeq('GRN', 'grn', 'grn_number');
    const r = await pool.query(
      `INSERT INTO grn (grn_number, supplier_name, supplier_invoice, receipt_date, vehicle_number, received_by, notes, warehouse_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [grn_number, supplier_name, supplier_invoice || null, receipt_date, vehicle_number || null, received_by || null, notes || null, warehouse_id || null]
    );
    io.emit('inventory:grn_update', { action: 'created', grn: r.rows[0] });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/grn/:id', async (req, res) => {
  try {
    const g = await pool.query(`SELECT * FROM grn WHERE grn_id = $1`, [req.params.id]);
    if (!g.rows.length) return res.status(404).json({ error: 'GRN not found' });
    const lots = await pool.query(`
      SELECT yl.*,
        COALESCE(h.hsn_code, '') AS hsn_code,
        COALESCE(i.item_name, yl.yarn_type) AS item_name
      FROM yarn_lots yl
      LEFT JOIN items i ON UPPER(i.item_code) = UPPER(yl.yarn_type) OR UPPER(i.item_name) = UPPER(yl.yarn_type)
      LEFT JOIN hsn_codes h ON h.hsn_id = i.hsn_id
      WHERE yl.grn_id = $1 ORDER BY yl.lot_id
    `, [req.params.id]);
    res.json({ ...g.rows[0], lots: lots.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/grn/:id/lots', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { yarn_type, count, color, supplier_lot_no, net_weight_kg, cones, rate_per_kg, brand, location } = req.body;
    const lot_number = await nextInvSeq('LOT', 'yarn_lots', 'lot_number');
    const r = await client.query(
      `INSERT INTO yarn_lots (lot_number, grn_id, yarn_type, count, color, supplier_lot_no, net_weight_kg, current_stock_kg, cones, rate_per_kg, brand, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11) RETURNING *`,
      [lot_number, req.params.id, yarn_type, count || null, color || 'Grey', supplier_lot_no || null, net_weight_kg, cones || 0, rate_per_kg || null, brand || null, location || null]
    );
    await client.query(
      `INSERT INTO yarn_lot_movements (lot_id, movement_type, quantity_kg, before_kg, after_kg, notes, reference_type, reference_id)
       VALUES ($1, 'GRN_RECEIPT', $2, 0, $2, 'Initial receipt', 'GRN', $3)`,
      [r.rows[0].lot_id, net_weight_kg, req.params.id]
    );
    if (rate_per_kg && parseFloat(rate_per_kg) > 0) {
      await addCostEntry(client, {
        reference_type: 'LOT', reference_id: r.rows[0].lot_id,
        cost_component: 'YARN_COST',
        amount_rs: (parseFloat(net_weight_kg) * parseFloat(rate_per_kg)).toFixed(2),
        quantity_kg: parseFloat(net_weight_kg), rate_used: parseFloat(rate_per_kg),
        notes: `Yarn purchase: ${yarn_type || ''} ${color || ''} — GRN #${req.params.id}`.trim(),
      });
    }
    await client.query('COMMIT');
    io.emit('inventory:yarn_stock_update', { action: 'lot_added', lot: r.rows[0] });
    res.json(r.rows[0]);
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

app.delete('/api/grn/:id/lots/:lotId', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id, lotId } = req.params;
    const grn = await client.query(`SELECT status FROM grn WHERE grn_id=$1`, [id]);
    if (!grn.rows.length) return res.status(404).json({ error: 'GRN not found' });
    if (grn.rows[0].status !== 'DRAFT') return res.status(400).json({ error: 'Can only edit lots on a DRAFT GRN' });
    await client.query('BEGIN');
    await client.query(`DELETE FROM cost_entries WHERE reference_type='LOT' AND reference_id=$1`, [lotId]);
    await client.query(`DELETE FROM yarn_lot_movements WHERE lot_id=$1`, [lotId]);
    await client.query(`DELETE FROM yarn_lots WHERE lot_id=$1 AND grn_id=$2`, [lotId, id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

app.put('/api/grn/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`UPDATE grn SET status='APPROVED', updated_at=NOW() WHERE grn_id=$1 RETURNING *`, [req.params.id]);
    const grn = r.rows[0];

    // Post yarn lots to stock_ledger (one line per lot)
    const lots = await client.query(
      `SELECT yl.*, g.warehouse_id, g.partner_id FROM yarn_lots yl
       JOIN grn g ON g.grn_id=yl.grn_id WHERE yl.grn_id=$1`, [req.params.id]
    );
    for (const lot of lots.rows) {
      await postToLedger(client, {
        doc_type: 'GRN', doc_id: grn.grn_number || req.params.id,
        item_id: lot.item_id || null,
        item_desc: `${lot.yarn_type || ''} ${lot.color || ''}`.trim() || lot.lot_number,
        warehouse_id: lot.warehouse_id || null,
        movement_type: 'IN',
        quantity: parseFloat(lot.net_weight_kg || 0),
        uom_code: 'KG',
        partner_id: lot.partner_id || null,
        notes: `GRN lot ${lot.lot_number}`,
        created_by: req.user?.username || 'system',
      });
    }

    await client.query('COMMIT');
    io.emit('inventory:grn_update', { action: 'approved', grn_id: req.params.id });
    res.json(grn);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// DELETE GRN (DRAFT only) — removes lots, movements, cost entries
app.delete('/api/grn/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const g = await client.query(`SELECT * FROM grn WHERE grn_id=$1`, [req.params.id]);
    if (!g.rows.length) return res.status(404).json({ error: 'GRN not found' });
    if (g.rows[0].status !== 'DRAFT') return res.status(400).json({ error: 'Only DRAFT GRNs can be deleted' });
    const lots = await client.query(`SELECT lot_id FROM yarn_lots WHERE grn_id=$1`, [req.params.id]);
    const lotIds = lots.rows.map(r => r.lot_id);
    if (lotIds.length) {
      await client.query(`DELETE FROM yarn_lot_movements WHERE lot_id = ANY($1)`, [lotIds]);
      await client.query(`DELETE FROM cost_entries WHERE reference_type='LOT' AND reference_id = ANY($1)`, [lotIds]);
      await client.query(`DELETE FROM yarn_lots WHERE grn_id=$1`, [req.params.id]);
    }
    await client.query(`DELETE FROM grn WHERE grn_id=$1`, [req.params.id]);
    await client.query('COMMIT');
    io.emit('inventory:grn_update', { action: 'deleted', grn_id: req.params.id });
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

// CANCEL GRN (APPROVED) — marks CANCELLED, zeros out lot stock
app.put('/api/grn/:id/cancel', verifyToken, requireRole('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const g = await client.query(`SELECT * FROM grn WHERE grn_id=$1`, [req.params.id]);
    if (!g.rows.length) return res.status(404).json({ error: 'GRN not found' });
    if (g.rows[0].status !== 'APPROVED') return res.status(400).json({ error: 'Only APPROVED GRNs can be cancelled' });
    // Check no yarn has been issued from these lots
    const issued = await client.query(`
      SELECT SUM(ii.issued_kg - ii.returned_kg) AS net_issued
      FROM yarn_issue_items ii
      JOIN yarn_lots yl ON yl.lot_id = ii.lot_id
      WHERE yl.grn_id = $1
    `, [req.params.id]);
    if (parseFloat(issued.rows[0]?.net_issued || 0) > 0) {
      return res.status(400).json({ error: 'Cannot cancel — yarn from this GRN has been issued' });
    }
    const lots = await client.query(`SELECT lot_id, current_stock_kg FROM yarn_lots WHERE grn_id=$1`, [req.params.id]);
    for (const lot of lots.rows) {
      const before = parseFloat(lot.current_stock_kg);
      await client.query(`UPDATE yarn_lots SET current_stock_kg=0, status='CANCELLED', updated_at=NOW() WHERE lot_id=$1`, [lot.lot_id]);
      await client.query(
        `INSERT INTO yarn_lot_movements (lot_id, movement_type, quantity_kg, before_kg, after_kg, reference_type, reference_id, notes)
         VALUES ($1,'CANCEL',$2,$3,0,'GRN',$4,'GRN cancelled')`,
        [lot.lot_id, before, before, req.params.id]
      );
    }
    await client.query(`UPDATE grn SET status='CANCELLED', updated_at=NOW() WHERE grn_id=$1`, [req.params.id]);
    await client.query('COMMIT');
    io.emit('inventory:grn_update', { action: 'cancelled', grn_id: req.params.id });
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

// EDIT GRN header (DRAFT only)
app.put('/api/grn/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const g = await pool.query(`SELECT status FROM grn WHERE grn_id=$1`, [req.params.id]);
    if (!g.rows.length) return res.status(404).json({ error: 'GRN not found' });
    if (g.rows[0].status !== 'DRAFT') return res.status(400).json({ error: 'Only DRAFT GRNs can be edited' });
    const { supplier_name, supplier_invoice, receipt_date, vehicle_number, received_by, notes, warehouse_id } = req.body;
    const r = await pool.query(
      `UPDATE grn SET supplier_name=$1, supplier_invoice=$2, receipt_date=$3, vehicle_number=$4, received_by=$5, notes=$6, warehouse_id=$7, updated_at=NOW()
       WHERE grn_id=$8 RETURNING *`,
      [supplier_name, supplier_invoice||null, receipt_date, vehicle_number||null, received_by||null, notes||null, warehouse_id||null, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// â"€â"€ YARN STORE â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.get('/api/yarn-store', async (req, res) => {
  try {
    const { status } = req.query;
    let q = `SELECT yl.*, g.supplier_name, g.receipt_date
             FROM yarn_lots yl JOIN grn g ON g.grn_id = yl.grn_id`;
    const params = [];
    if (status) { q += ` WHERE yl.status = $1`; params.push(status); }
    q += ` ORDER BY yl.created_at DESC`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/yarn-store/summary', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT yarn_type, color,
             COUNT(*) AS lot_count,
             SUM(current_stock_kg) AS stock_kg,
             SUM(net_weight_kg) AS total_received_kg
      FROM yarn_lots GROUP BY yarn_type, color ORDER BY stock_kg DESC`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Low-stock alert: lots where current_stock_kg < low_stock_threshold (default 20% of net_weight)
app.get('/api/yarn-store/low-stock', async (req, res) => {
  try {
    const threshold = parseFloat(req.query.threshold_pct || 20) / 100;
    const r = await pool.query(`
      SELECT yl.*, g.supplier_name,
        CASE WHEN yl.net_weight_kg > 0 THEN ROUND((yl.current_stock_kg / yl.net_weight_kg * 100)::NUMERIC, 1) ELSE 0 END AS stock_pct
      FROM yarn_lots yl JOIN grn g ON g.grn_id = yl.grn_id
      WHERE yl.status = 'IN_STORE'
        AND yl.net_weight_kg > 0
        AND yl.current_stock_kg < (yl.net_weight_kg * $1)
      ORDER BY (yl.current_stock_kg / yl.net_weight_kg) ASC
    `, [threshold]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/yarn-store/:id/movements', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM yarn_lot_movements WHERE lot_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/yarn-store/:id/location', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE yarn_lots SET location=$1, updated_at=NOW() WHERE lot_id=$2 RETURNING *`,
      [req.body.location, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// â"€â"€ YARN ISSUES â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.get('/api/yarn-issues', async (req, res) => {
  try {
    const { status, machine_id } = req.query;
    let q = `SELECT yi.*, COUNT(ii.item_id) AS item_count, SUM(ii.issued_kg) AS total_issued_kg
             FROM yarn_issues yi LEFT JOIN yarn_issue_items ii ON ii.issue_id = yi.issue_id WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); q += ` AND yi.status=$${params.length}`; }
    if (machine_id) { params.push(machine_id); q += ` AND yi.machine_id=$${params.length}`; }
    q += ` GROUP BY yi.issue_id ORDER BY yi.created_at DESC`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/yarn-issues', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { machine_id, machine_name, issued_by, received_by, notes, items } = req.body;
    if (!items || !items.length) throw new Error('No items provided');
    const issue_number = await nextInvSeq('ISS', 'yarn_issues', 'issue_number');
    const iss = await client.query(
      `INSERT INTO yarn_issues (issue_number, machine_id, machine_name, issued_by, received_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [issue_number, machine_id || null, machine_name || null, issued_by || null, received_by || null, notes || null]
    );
    const issue_id = iss.rows[0].issue_id;

    for (const item of items) {
      const lot = await client.query(`SELECT current_stock_kg, current_cones FROM yarn_lots WHERE lot_id = $1 FOR UPDATE`, [item.lot_id]);
      if (!lot.rows.length) throw new Error(`Lot ${item.lot_id} not found`);
      const before = parseFloat(lot.rows[0].current_stock_kg);
      if (before < item.issued_kg) throw new Error(`Insufficient stock in lot ${item.lot_id}: have ${before}kg, need ${item.issued_kg}kg`);
      const after = before - item.issued_kg;
      const issuedCones = parseInt(item.issued_cones || 0);
      const conesBefore = parseInt(lot.rows[0].current_cones || 0);
      const conesAfter = Math.max(0, conesBefore - issuedCones);
      await client.query(`UPDATE yarn_lots SET current_stock_kg=$1, current_cones=$2, updated_at=NOW() WHERE lot_id=$3`, [after, conesAfter, item.lot_id]);
      await client.query(
        `INSERT INTO yarn_issue_items (issue_id, lot_id, issued_kg, issued_cones) VALUES ($1,$2,$3,$4)`,
        [issue_id, item.lot_id, item.issued_kg, issuedCones]
      );
      await client.query(
        `INSERT INTO yarn_lot_movements (lot_id, movement_type, quantity_kg, before_kg, after_kg, reference_id, reference_type, notes)
         VALUES ($1,'ISSUE',$2,$3,$4,$5,'ISSUE','Issued to machine')`,
        [item.lot_id, item.issued_kg, before, after, issue_id]
      );
      // FIFO yarn cost: record cost at this lot's GRN rate
      const lotInfo = await client.query('SELECT yl.item_id, yl.yarn_type, yl.color, yl.rate_per_kg, g.warehouse_id FROM yarn_lots yl LEFT JOIN grn g ON g.grn_id = yl.grn_id WHERE yl.lot_id=$1', [item.lot_id]);
      const l = lotInfo.rows[0] || {};
      // FIFO cost entry at this lot's GRN rate
      if (l.rate_per_kg && parseFloat(l.rate_per_kg) > 0) {
        const issuedKg  = parseFloat(item.issued_kg);
        const fifoRate  = parseFloat(l.rate_per_kg);
        await addCostEntry(client, {
          reference_type: 'ISSUE', reference_id: issue_id,
          cost_component: 'YARN_COST',
          amount_rs: (issuedKg * fifoRate).toFixed(2),
          quantity_kg: issuedKg, rate_used: fifoRate,
          notes: `FIFO: ${l.yarn_type||''} ${l.color||''} Lot ${item.lot_id} @ ₹${fifoRate}/kg → machine ${machine_name || machine_id || ''}`.trim(),
        });
      }
      await postToLedger(client, {
        doc_type: 'ISSUE', doc_id: issue_number,
        item_id: l.item_id || null,
        item_desc: `${l.yarn_type||''} ${l.color||''}`.trim() || `Lot ${item.lot_id}`,
        warehouse_id: l.warehouse_id || null,
        movement_type: 'OUT',
        quantity: item.issued_kg,
        uom_code: 'KG',
        notes: `Issued to ${machine_name || machine_id || 'machine'}`,
        created_by: issued_by || 'system',
      });
    }
    await client.query('COMMIT');
    io.emit('inventory:yarn_stock_update', { action: 'issued', issue_id });
    io.emit('inventory:dashboard_update', { type: 'yarn_issue' });
    res.json(iss.rows[0]);
  } catch (e) { await client.query('ROLLBACK'); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});

app.get('/api/yarn-issues/:id', async (req, res) => {
  try {
    const iss = await pool.query(`SELECT * FROM yarn_issues WHERE issue_id = $1`, [req.params.id]);
    if (!iss.rows.length) return res.status(404).json({ error: 'Not found' });
    const items = await pool.query(`
      SELECT ii.*,
        yl.lot_number, yl.yarn_type, yl.color, yl.count,
        yl.supplier_lot_no, yl.net_weight_kg AS lot_net_kg, yl.current_stock_kg,
        yl.location, yl.brand,
        COALESCE(i.item_name, yl.yarn_type) AS item_name,
        COALESCE(h.hsn_code, '') AS hsn_code
      FROM yarn_issue_items ii
      JOIN yarn_lots yl ON yl.lot_id = ii.lot_id
      LEFT JOIN items i ON UPPER(i.item_code) = UPPER(yl.yarn_type) OR UPPER(i.item_name) = UPPER(yl.yarn_type)
      LEFT JOIN hsn_codes h ON h.hsn_id = i.hsn_id
      WHERE ii.issue_id = $1
    `, [req.params.id]);
    res.json({ ...iss.rows[0], items: items.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Yarn return â€" partial return from machine
app.post('/api/yarn-issues/:id/return', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { returns } = req.body; // [{item_id, returned_kg}]
    for (const ret of returns) {
      const item = await client.query(
        `SELECT ii.*, yl.current_stock_kg FROM yarn_issue_items ii
         JOIN yarn_lots yl ON yl.lot_id = ii.lot_id
         WHERE ii.item_id = $1 FOR UPDATE`, [ret.item_id]
      );
      if (!item.rows.length) continue;
      const { lot_id, issued_kg, returned_kg } = item.rows[0];
      const new_returned = parseFloat(returned_kg) + parseFloat(ret.returned_kg);
      if (new_returned > issued_kg) throw new Error(`Return exceeds issued: item ${ret.item_id}`);
      const before = parseFloat(item.rows[0].current_stock_kg);
      const after = before + parseFloat(ret.returned_kg);
      await client.query(`UPDATE yarn_issue_items SET returned_kg=$1 WHERE item_id=$2`, [new_returned, ret.item_id]);
      await client.query(`UPDATE yarn_lots SET current_stock_kg=$1, updated_at=NOW() WHERE lot_id=$2`, [after, lot_id]);
      await client.query(
        `INSERT INTO yarn_lot_movements (lot_id, movement_type, quantity_kg, before_kg, after_kg, reference_id, reference_type)
         VALUES ($1,'RETURN',$2,$3,$4,$5,'ISSUE')`,
        [lot_id, ret.returned_kg, before, after, req.params.id]
      );
    }
    await client.query('COMMIT');
    io.emit('inventory:yarn_stock_update', { action: 'returned' });
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});

// ── Yarn Returns as separate documents (own navigator/register) ──
app.get('/api/yarn-returns', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT yr.*, yi.issue_number,
        (SELECT COUNT(*) FROM yarn_return_items WHERE return_id=yr.return_id) AS item_count
      FROM yarn_returns yr
      LEFT JOIN yarn_issues yi ON yi.issue_id = yr.issue_id
      ORDER BY yr.created_at DESC
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/yarn-returns/:id', async (req, res) => {
  try {
    const [ret, items] = await Promise.all([
      pool.query(`SELECT yr.*, yi.issue_number FROM yarn_returns yr LEFT JOIN yarn_issues yi ON yi.issue_id=yr.issue_id WHERE yr.return_id=$1`, [req.params.id]),
      pool.query(`
        SELECT ri.*, COALESCE(it.item_name, ri.yarn_type) AS item_name, yl.supplier_lot_no, yl.brand
        FROM yarn_return_items ri
        LEFT JOIN yarn_lots yl ON yl.lot_id = ri.lot_id
        LEFT JOIN items it ON UPPER(it.item_code) = UPPER(ri.yarn_type)
        WHERE ri.return_id=$1 ORDER BY ri.id
      `, [req.params.id]),
    ]);
    if (!ret.rows.length) return res.status(404).json({ error: 'Return not found' });
    res.json({ ...ret.rows[0], items: items.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/yarn-returns', verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { issue_id, return_date, notes, returns } = req.body; // returns:[{item_id, returned_kg}]
    if (!issue_id || !Array.isArray(returns) || !returns.filter(r => parseFloat(r.returned_kg) > 0).length)
      return res.status(400).json({ error: 'issue_id and at least one return quantity required' });
    const iss = await client.query(`SELECT * FROM yarn_issues WHERE issue_id=$1`, [issue_id]);
    if (!iss.rows.length) return res.status(404).json({ error: 'Issue not found' });

    await client.query('BEGIN');
    const cnt = await client.query(`SELECT COUNT(*) FROM yarn_returns`);
    const return_number = `YR-${new Date().getFullYear()}-${String(parseInt(cnt.rows[0].count) + 1).padStart(4, '0')}`;
    const rr = await client.query(
      `INSERT INTO yarn_returns (return_number, issue_id, machine_id, machine_name, return_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [return_number, issue_id, iss.rows[0].machine_id, iss.rows[0].machine_name, return_date || new Date().toISOString().slice(0, 10), notes || null, req.user.username]
    );
    const returnId = rr.rows[0].return_id;
    let totalKg = 0;

    for (const ret of returns) {
      const qty = parseFloat(ret.returned_kg);
      if (!(qty > 0)) continue;
      const item = await client.query(
        `SELECT ii.*, yl.current_stock_kg FROM yarn_issue_items ii JOIN yarn_lots yl ON yl.lot_id=ii.lot_id WHERE ii.item_id=$1 FOR UPDATE`, [ret.item_id]
      );
      if (!item.rows.length) continue;
      const { lot_id, issued_kg, returned_kg, yarn_type, color, lot_number } = item.rows[0];
      const new_returned = parseFloat(returned_kg) + qty;
      if (new_returned > parseFloat(issued_kg)) throw new Error(`Return exceeds issued for lot ${lot_number}`);
      const before = parseFloat(item.rows[0].current_stock_kg);
      const after = before + qty;
      await client.query(`UPDATE yarn_issue_items SET returned_kg=$1 WHERE item_id=$2`, [new_returned, ret.item_id]);
      await client.query(`UPDATE yarn_lots SET current_stock_kg=$1, updated_at=NOW() WHERE lot_id=$2`, [after, lot_id]);
      await client.query(
        `INSERT INTO yarn_lot_movements (lot_id, movement_type, quantity_kg, before_kg, after_kg, reference_id, reference_type, notes)
         VALUES ($1,'RETURN',$2,$3,$4,$5,'RETURN',$6)`,
        [lot_id, qty, before, after, returnId, return_number]
      );
      await client.query(
        `INSERT INTO yarn_return_items (return_id, item_id, lot_id, lot_number, yarn_type, color, returned_kg)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [returnId, ret.item_id, lot_id, lot_number, yarn_type, color, qty]
      );
      totalKg += qty;
    }
    await client.query(`UPDATE yarn_returns SET total_kg=$1 WHERE return_id=$2`, [totalKg.toFixed(3), returnId]);
    await client.query('COMMIT');
    io.emit('inventory:yarn_stock_update', { action: 'returned' });
    res.json({ ...rr.rows[0], total_kg: totalKg.toFixed(3) });
  } catch (e) { await client.query('ROLLBACK'); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});

// Helper: reverse yarn issue stock back to lots
async function reverseYarnIssueStock(client, issue_id) {
  const items = await client.query(`SELECT * FROM yarn_issue_items WHERE issue_id=$1`, [issue_id]);
  for (const item of items.rows) {
    const net = parseFloat(item.issued_kg) - parseFloat(item.returned_kg || 0);
    if (net > 0) {
      const lot = await client.query(`SELECT current_stock_kg, current_cones FROM yarn_lots WHERE lot_id=$1 FOR UPDATE`, [item.lot_id]);
      const before = parseFloat(lot.rows[0].current_stock_kg);
      const after = before + net;
      const conesRestore = parseInt(item.issued_cones || 0);
      await client.query(`UPDATE yarn_lots SET current_stock_kg=$1, current_cones=current_cones+$2, updated_at=NOW() WHERE lot_id=$3`, [after, conesRestore, item.lot_id]);
      await client.query(
        `INSERT INTO yarn_lot_movements (lot_id, movement_type, quantity_kg, before_kg, after_kg, reference_type, reference_id, notes)
         VALUES ($1,'CANCEL_RETURN',$2,$3,$4,'ISSUE',$5,'Issue reversed')`,
        [item.lot_id, net, before, after, issue_id]
      );
    }
  }
}

// DELETE Yarn Issue (hard delete — number freed)
app.delete('/api/yarn-issues/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const iss = await client.query(`SELECT * FROM yarn_issues WHERE issue_id=$1`, [req.params.id]);
    if (!iss.rows.length) return res.status(404).json({ error: 'Not found' });
    if (iss.rows[0].status === 'CANCELLED') return res.status(400).json({ error: 'Already cancelled, cannot delete' });
    await reverseYarnIssueStock(client, req.params.id);
    await client.query(`DELETE FROM cost_entries WHERE reference_type='ISSUE' AND reference_id=$1`, [req.params.id]);
    await client.query(`DELETE FROM yarn_issue_items WHERE issue_id=$1`, [req.params.id]);
    await client.query(`DELETE FROM yarn_issues WHERE issue_id=$1`, [req.params.id]);
    await client.query('COMMIT');
    io.emit('inventory:yarn_stock_update', { action: 'issue_deleted' });
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

// CANCEL Yarn Issue (soft — number stays, marked CANCELLED)
app.put('/api/yarn-issues/:id/cancel', verifyToken, requireRole('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const iss = await client.query(`SELECT * FROM yarn_issues WHERE issue_id=$1`, [req.params.id]);
    if (!iss.rows.length) return res.status(404).json({ error: 'Not found' });
    if (iss.rows[0].status === 'CANCELLED') return res.status(400).json({ error: 'Already cancelled' });
    await reverseYarnIssueStock(client, req.params.id);
    await client.query(`UPDATE yarn_issues SET status='CANCELLED', updated_at=NOW() WHERE issue_id=$1`, [req.params.id]);
    await client.query('COMMIT');
    io.emit('inventory:yarn_stock_update', { action: 'issue_cancelled' });
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

// EDIT Yarn Issue (notes, received_by)
app.put('/api/yarn-issues/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const iss = await pool.query(`SELECT status FROM yarn_issues WHERE issue_id=$1`, [req.params.id]);
    if (!iss.rows.length) return res.status(404).json({ error: 'Not found' });
    if (iss.rows[0].status === 'CANCELLED') return res.status(400).json({ error: 'Cannot edit cancelled issue' });
    const { notes, received_by } = req.body;
    const r = await pool.query(
      `UPDATE yarn_issues SET notes=$1, received_by=$2, updated_at=NOW() WHERE issue_id=$3 RETURNING *`,
      [notes||null, received_by||null, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// â"€â"€ LIVE INVENTORY DASHBOARD â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.get('/api/inventory/dashboard', async (req, res) => {
  try {
    const [yarnStock, grnPending, issueActive, greige, batches, finished, dispatched] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS lots, COALESCE(SUM(current_stock_kg),0) AS kg FROM yarn_lots WHERE status='IN_STORE'`),
      pool.query(`SELECT COUNT(*) FROM grn WHERE status='DRAFT'`),
      pool.query(`SELECT COUNT(*) FROM yarn_issues WHERE status='ISSUED'`),
      pool.query(`SELECT COUNT(*) AS rolls, COALESCE(SUM(weight_kg),0) AS kg FROM rolls WHERE warehouse_status='GREIGE'`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE status='OPEN') AS open, COUNT(*) FILTER (WHERE status='SEALED') AS sealed FROM batches`),
      pool.query(`SELECT COUNT(*) AS lots, COALESCE(SUM(weight_kg),0) AS kg FROM finished_goods WHERE status='IN_STOCK'`),
      pool.query(`SELECT COUNT(*) FROM dispatch_challans WHERE dispatch_date >= CURRENT_DATE - INTERVAL '30 days'`),
    ]);
    res.json({
      yarn_store:    { lots: yarnStock.rows[0].lots, stock_kg: yarnStock.rows[0].kg },
      grn_pending:   parseInt(grnPending.rows[0].count),
      active_issues: parseInt(issueActive.rows[0].count),
      greige:        { rolls: greige.rows[0].rolls, kg: greige.rows[0].kg },
      batches:       { open: batches.rows[0].open, sealed: batches.rows[0].sealed },
      finished:      { lots: finished.rows[0].lots, kg: finished.rows[0].kg },
      dispatched_30d: parseInt(dispatched.rows[0].count),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// â"€â"€ FINISHING MODULE â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// List all received challans with their finishing record status
app.get('/api/finishing', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        sr.receipt_id, sr.received_date, sr.received_weight_kg, sr.quality_status,
        sr.rejected_weight_kg, sr.shade,
        sr.notes, sr.received_by,
        sc.challan_number, sc.vendor_name, sc.job_type, sc.sent_weight_kg,
        b.batch_number, b.fabric_type, b.color_name, b.color_code,
        fr.finishing_id, fr.qa_passed, fr.finished_by, fr.finished_at,
        fr.shrinkage_pct, fr.qa_notes
      FROM subcontract_receipts sr
      JOIN subcontract_challans sc ON sc.challan_id = sr.challan_id
      LEFT JOIN batches b ON b.batch_id = sc.batch_id
      LEFT JOIN finishing_records fr ON fr.receipt_id = sr.receipt_id
      ORDER BY sr.created_at DESC
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Save / update QC details on a receipt + create finishing record
app.post('/api/finishing/:receipt_id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { receipt_id } = req.params;
    const { shade, gsm, qa_passed, shrinkage_pct, qa_notes } = req.body;

    // Upsert finishing record
    const existing = await client.query(
      `SELECT finishing_id FROM finishing_records WHERE receipt_id=$1`, [receipt_id]
    );
    let fr;
    if (existing.rows.length) {
      fr = await client.query(
        `UPDATE finishing_records
         SET shade=$1, gsm=$2, qa_passed=$3,
             shrinkage_pct=$4, qa_notes=$5, finished_by=$6, finished_at=NOW()
         WHERE receipt_id=$7 RETURNING *`,
        [shade||null, gsm||null, qa_passed !== false, shrinkage_pct||null, qa_notes||null, req.user.username, receipt_id]
      );
    } else {
      const rec = await client.query(`SELECT batch_id FROM subcontract_challans sc JOIN subcontract_receipts sr ON sc.challan_id=sr.challan_id WHERE sr.receipt_id=$1`, [receipt_id]);
      fr = await client.query(
        `INSERT INTO finishing_records
           (receipt_id, batch_id, shade, gsm, qa_passed, shrinkage_pct, qa_notes, finished_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [receipt_id, rec.rows[0]?.batch_id||null, shade||null, gsm||null,
         qa_passed !== false, shrinkage_pct||null, qa_notes||null, req.user.username]
      );
    }

    // If QA failed â€" mark finished goods as HOLD
    if (qa_passed === false) {
      await client.query(
        `UPDATE finished_goods SET status='HOLD' WHERE receipt_id=$1`, [receipt_id]
      );
    }

    await client.query('COMMIT');
    io.emit('inventory:dashboard_update', { type: 'finishing_record' });
    res.json(fr.rows[0]);
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

// ============================================================
// QUALITY INSPECTION MODULE
// ============================================================

// Get all quality inspections with optional filtering
app.get('/api/quality-inspections', verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const { roll_id, inspection_type, grade, passed, limit = 100 } = req.query;
    let query = `
      SELECT qi.*, r.roll_id as roll_number, m.machine_name
      FROM quality_inspections qi
      LEFT JOIN rolls r ON qi.roll_id = r.roll_id
      LEFT JOIN machines m ON r.machine_id = m.machine_id
      WHERE 1=1
    `;
    const params = [];

    if (roll_id) {
      query += ` AND qi.roll_id = $${params.length + 1}`;
      params.push(roll_id);
    }
    if (inspection_type) {
      query += ` AND qi.inspection_type = $${params.length + 1}`;
      params.push(inspection_type);
    }
    if (grade) {
      query += ` AND qi.grade = $${params.length + 1}`;
      params.push(grade);
    }
    if (typeof passed !== 'undefined') {
      query += ` AND qi.passed = $${params.length + 1}`;
      params.push(passed === 'true');
    }

    query += ` ORDER BY qi.inspection_date DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get quality inspection stats (must be registered BEFORE /:id so Express doesn't
// match "stats" as the :id param)
app.get('/api/quality-inspections/stats', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_inspections,
        COUNT(CASE WHEN passed = true THEN 1 END) as passed_inspections,
        COUNT(CASE WHEN passed = false THEN 1 END) as failed_inspections,
        COUNT(CASE WHEN grade = 'A' THEN 1 END) as grade_a_count,
        COUNT(CASE WHEN grade = 'B' THEN 1 END) as grade_b_count,
        COUNT(CASE WHEN grade = 'C' THEN 1 END) as grade_c_count,
        COUNT(CASE WHEN grade = 'R' THEN 1 END) as grade_r_count,
        AVG(CASE WHEN defect_count > 0 THEN defect_count END) as avg_defect_count
      FROM quality_inspections
      WHERE inspection_date >= CURRENT_DATE - INTERVAL '30 days'
    `);
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/quality-inspections/:id', verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT qi.*, r.roll_id as roll_number, m.machine_name, r.fabric_type
      FROM quality_inspections qi
      LEFT JOIN rolls r ON qi.roll_id = r.roll_id
      LEFT JOIN machines m ON r.machine_id = m.machine_id
      WHERE qi.inspection_id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quality inspection not found' });
    }

    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create new quality inspection
app.post('/api/quality-inspections', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      roll_id,
      inspection_type,
      inspection_stage,
      grade,
      width_mm,
      gsm,
      length_m,
      weight_kg,
      defect_type,
      defect_description,
      defect_location,
      defect_severity,
      defect_count,
      notes
    } = req.body;

    // Validate required fields
    if (!roll_id || !inspection_type) {
      return res.status(400).json({ error: 'roll_id and inspection_type are required' });
    }

    // Calculate if passed based on grade and defect severity
    const passed = grade !== 'R' &&
                  !(defect_severity === 'critical' && defect_count > 0);

    const result = await client.query(`
      INSERT INTO quality_inspections (
        roll_id, inspection_type, inspection_stage, grade,
        width_mm, gsm, length_m, weight_kg,
        defect_type, defect_description, defect_location,
        defect_severity, defect_count, passed, notes, inspector
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      ) RETURNING *
    `, [
      roll_id,
      inspection_type,
      inspection_stage || null,
      grade || null,
      width_mm || null,
      gsm || null,
      length_m || null,
      weight_kg || null,
      defect_type || null,
      defect_description || null,
      defect_location || null,
      defect_severity || null,
      parseInt(defect_count) || 0,
      passed,
      notes || null,
      req.user.username
    ]);

    // Update the roll's latest_inspection_id and grade if this is the latest inspection
    await client.query(`
      UPDATE rolls
      SET latest_inspection_id = $1,
          quality_grade = $2
      WHERE roll_id = $3
        AND (
          latest_inspection_id IS NULL OR
          (SELECT inspection_date FROM quality_inspections WHERE inspection_id = $1) >
          (SELECT inspection_date FROM quality_inspections WHERE inspection_id = COALESCE((SELECT latest_inspection_id FROM rolls WHERE roll_id = $3), 0))
        )
    `, [
      result.rows[0].inspection_id,
      grade || null,
      roll_id
    ]);

    await client.query('COMMIT');
    io.emit('quality:update', { roll_id, inspection_id: result.rows[0].inspection_id });
    res.status(201).json(result.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Update quality inspection
app.put('/api/quality-inspections/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      inspection_type,
      inspection_stage,
      grade,
      width_mm,
      gsm,
      length_m,
      weight_kg,
      defect_type,
      defect_description,
      defect_location,
      defect_severity,
      defect_count,
      notes
    } = req.body;

    // Get current inspection to verify roll_id
    const current = await client.query(
      'SELECT roll_id FROM quality_inspections WHERE inspection_id = $1',
      [req.params.id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Quality inspection not found' });
    }

    // Calculate if passed based on grade and defect severity
    const passed = grade !== 'R' &&
                  !(defect_severity === 'critical' && defect_count > 0);

    const result = await client.query(`
      UPDATE quality_inspections SET
        inspection_type = $2,
        inspection_stage = $3,
        grade = $4,
        width_mm = $5,
        gsm = $6,
        length_m = $7,
        weight_kg = $8,
        defect_type = $9,
        defect_description = $10,
        defect_location = $11,
        defect_severity = $12,
        defect_count = $13,
        passed = $14,
        notes = $15,
        updated_at = NOW()
      WHERE inspection_id = $1
      RETURNING *
    `, [
      req.params.id,
      inspection_type || null,
      inspection_stage || null,
      grade || null,
      width_mm || null,
      gsm || null,
      length_m || null,
      weight_kg || null,
      defect_type || null,
      defect_description || null,
      defect_location || null,
      defect_severity || null,
      parseInt(defect_count) || 0,
      passed,
      notes || null
    ]);

    // Update the roll's latest_inspection_id if this inspection is newer
    if (result.rows.length > 0) {
      await client.query(`
        UPDATE rolls
        SET latest_inspection_id = $1,
            quality_grade = $2
        WHERE roll_id = $3
          AND (
            latest_inspection_id IS NULL OR
            (SELECT inspection_date FROM quality_inspections WHERE inspection_id = $1) >
            (SELECT inspection_date FROM quality_inspections WHERE inspection_id = COALESCE((SELECT latest_inspection_id FROM rolls WHERE roll_id = $3), 0))
          )
      `, [
        result.rows[0].inspection_id,
        result.rows[0].grade || null,
        result.rows[0].roll_id
      ]);
    }

    await client.query('COMMIT');
    io.emit('quality:update', {
      roll_id: result.rows[0]?.roll_id,
      inspection_id: parseInt(req.params.id)
    });
    res.json(result.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Delete quality inspection
app.delete('/api/quality-inspections/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM quality_inspections WHERE inspection_id = $1 RETURNING *',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quality inspection not found' });
    }

    // Note: We don't automatically update the roll's latest_inspection_id here
    // as it could leave the roll without any inspection reference
    // In a production system, you might want to set it to the next most recent inspection

    res.json({ message: 'Quality inspection deleted successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get defect types for dropdown
app.get('/api/quality-defect-types', verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM defect_types WHERE is_active = true ORDER BY sort_order, name'
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// QUALITY INSPECTION REPORT
// ============================================================

// Get filter data for report
app.get('/api/quality-inspection-report/filters', verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    // Get machines
    const machinesResult = await pool.query(
      `SELECT machine_id, machine_name FROM machines ORDER BY machine_name`
    );
    // Get rolls
    const rollsResult = await pool.query(
      `SELECT roll_id FROM rolls ORDER BY roll_id`
    );
    // Get inspectors (operators who have done inspections, or all active operators)
    const inspectorsResult = await pool.query(
      `SELECT DISTINCT o.operator_id, o.operator_name FROM operators o
       JOIN quality_inspections qi ON o.operator_name = qi.inspector
       WHERE o.status != 'INACTIVE'
       ORDER BY o.operator_name`
    );
    // If no inspectors found from inspections, fall back to all active operators
    let inspectors = inspectorsResult.rows;
    if (inspectors.length === 0) {
      const opsResult = await pool.query(
        `SELECT operator_id, operator_name FROM operators WHERE status != 'INACTIVE' ORDER BY operator_name`
      );
      inspectors = opsResult.rows;
    }

    res.json({
      machines: machinesResult.rows,
      rolls: rollsResult.rows,
      inspectors: inspectors
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get filtered inspection data for report
app.get('/api/quality-inspection-report', verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const { dateFrom, dateTo, machineId, rollId, inspectorId, result } = req.query;
    let query = `
      SELECT qi.*, r.machine_name
      FROM quality_inspections qi
      LEFT JOIN rolls r ON qi.roll_id = r.roll_id
      WHERE 1=1
    `;
    const params = [];

    if (dateFrom) {
      query += ` AND qi.inspection_date >= $${params.length + 1}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      query += ` AND qi.inspection_date <= $${params.length + 1}`;
      params.push(dateTo);
    }
    if (machineId) {
      query += ` AND r.machine_id = $${params.length + 1}`;
      params.push(machineId);
    }
    if (rollId) {
      query += ` AND qi.roll_id = $${params.length + 1}`;
      params.push(rollId);
    }
    if (inspectorId) {
      query += ` AND qi.inspector = $${params.length + 1}`;
      params.push(inspectorId);
    }
    if (result) {
      if (result === 'passed') {
        query += ` AND qi.passed = true`;
      } else if (result === 'failed') {
        query += ` AND qi.passed = false`;
      }
    }

    query += ` ORDER BY qi.inspection_date DESC`;

    const dbResult = await pool.query(query, params);
    res.json(dbResult.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export report as CSV
app.get('/api/quality-inspection-report/csv', verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const { dateFrom, dateTo, machineId, rollId, inspectorId, result } = req.query;
    let query = `
      SELECT qi.inspection_id, qi.roll_id, r.machine_name, qi.inspection_type, qi.grade,
             qi.inspection_date, qi.inspector, qi.defect_count, qi.passed
      FROM quality_inspections qi
      LEFT JOIN rolls r ON qi.roll_id = r.roll_id
      WHERE 1=1
    `;
    const params = [];

    if (dateFrom) {
      query += ` AND qi.inspection_date >= $${params.length + 1}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      query += ` AND qi.inspection_date <= $${params.length + 1}`;
      params.push(dateTo);
    }
    if (machineId) {
      query += ` AND r.machine_id = $${params.length + 1}`;
      params.push(machineId);
    }
    if (rollId) {
      query += ` AND qi.roll_id = $${params.length + 1}`;
      params.push(rollId);
    }
    if (inspectorId) {
      query += ` AND qi.inspector = $${params.length + 1}`;
      params.push(inspectorId);
    }
    if (result) {
      if (result === 'passed') {
        query += ` AND qi.passed = true`;
      } else if (result === 'failed') {
        query += ` AND qi.passed = false`;
      }
    }

    query += ` ORDER BY qi.inspection_date DESC`;

    const dbResult = await pool.query(query, params);
    const rows = dbResult.rows;

    // Convert to CSV
    const headers = ['Inspection ID', 'Roll ID', 'Machine', 'Inspection Type', 'Grade', 'Inspection Date', 'Inspector', 'Defect Count', 'Result'];
    const csvRows = [];
    csvRows.push(headers.join(','));
    rows.forEach(row => {
      const values = [
        row.inspection_id,
        `"${row.roll_id}"`,
        `"${row.machine_name || ''}"`,
        `"${row.inspection_type}"`,
        row.grade || '',
        `"${row.inspection_date ? new Date(row.inspection_date).toISOString() : ''}"`,
        `"${row.inspector || ''}"`,
        row.defect_count || 0,
        row.passed ? 'Passed' : 'Failed'
      ];
      csvRows.push(values.map(v => String(v).replace(/"/g, '""')).join(','));
    });
    const csv = csvRows.join('\n');

    res.header('Content-Type', 'text/csv');
    res.attachment(`quality_inspection_report_${new Date().toISOString().slice(0,10)}.csv`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Generate PDF report
app.get('/api/quality-inspection-report/pdf', verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const { dateFrom, dateTo, machineId, rollId, inspectorId, result } = req.query;
    let query = `
      SELECT qi.inspection_id, qi.roll_id, r.machine_name, qi.inspection_type, qi.grade,
             qi.inspection_date, qi.inspector, qi.defect_count, qi.passed, qi.notes
      FROM quality_inspections qi
      LEFT JOIN rolls r ON qi.roll_id = r.roll_id
      WHERE 1=1
    `;
    const params = [];

    if (dateFrom) {
      query += ` AND qi.inspection_date >= $${params.length + 1}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      query += ` AND qi.inspection_date <= $${params.length + 1}`;
      params.push(dateTo);
    }
    if (machineId) {
      query += ` AND r.machine_id = $${params.length + 1}`;
      params.push(machineId);
    }
    if (rollId) {
      query += ` AND qi.roll_id = $${params.length + 1}`;
      params.push(rollId);
    }
    if (inspectorId) {
      query += ` AND qi.inspector = $${params.length + 1}`;
      params.push(inspectorId);
    }
    if (result) {
      if (result === 'passed') {
        query += ` AND qi.passed = true`;
      } else if (result === 'failed') {
        query += ` AND qi.passed = false`;
      }
    }

    query += ` ORDER BY qi.inspection_date DESC`;

    const dbResult = await pool.query(query, params);
    const rows = dbResult.rows;

    // Create PDF document
    const { PDFDocument } = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=quality_inspection_report_${new Date().toISOString().slice(0,10)}.pdf`);

    // Pipe the PDF to the response
    doc.pipe(res);

    // Add the content to the PDF
    doc.fontSize(20).text('Quality Inspection Report', { align: 'center' });
    doc.moveDown();

    // Add filters info
    doc.fontSize(12);
    let filterText = 'Filters:';
    if (dateFrom || dateTo) {
      filterText += ` Date: ${dateFrom || 'start'} to ${dateTo || 'end'}`;
    }
    if (machineId) {
      // We would need to get the machine name, but for simplicity, we'll show the ID
      filterText += ` Machine ID: ${machineId}`;
    }
    if (rollId) {
      filterText += ` Roll ID: ${rollId}`;
    }
    if (inspectorId) {
      filterText += ` Inspector ID: ${inspectorId}`;
    }
    if (result) {
      filterText += ` Result: ${result === 'passed' ? 'Passed' : 'Failed'}`;
    }
    if (filterText === 'Filters:') {
      filterText += ' None';
    }
    doc.text(filterText);
    doc.moveDown();

    // Add table header
    const tableTop = 150;
    const columns = [
      { label: 'ID', width: 50 },
      { label: 'Roll ID', width: 80 },
      { label: 'Machine', width: 100 },
      { label: 'Type', width: 100 },
      { label: 'Grade', width: 50 },
      { label: 'Date', width: 100 },
      { label: 'Inspector', width: 100 },
      { label: 'Defects', width: 60 },
      { label: 'Result', width: 60 }
    ];
    let x = 50;
    columns.forEach(col => {
      doc.text(col.label, x, tableTop, { width: col.width, align: 'left' });
      x += col.width;
    });
    doc.moveDown(0.5);

    // Add table rows
    let y = tableTop + 20;
    rows.forEach((row, index) => {
      x = 50;
      const rowData = [
        row.inspection_id,
        row.roll_id,
        row.machine_name || '',
        row.inspection_type,
        row.grade || '',
        row.inspection_date ? new Date(row.inspection_date).toLocaleString() : '',
        row.inspector || '',
        row.defect_count || 0,
        row.passed ? 'Passed' : 'Failed'
      ];
      rowData.forEach((cell, i) => {
        doc.text(String(cell), x, y, { width: columns[i].width, align: 'left' });
        x += columns[i].width;
      });
      y += 20;
      // Add a page break if needed
      if (y > 750) {
        doc.addPage();
        y = 50;
        // Redraw header
        x = 50;
        columns.forEach(col => {
          doc.text(col.label, x, y, { width: col.width, align: 'left' });
          x += col.width;
        });
        y += 20;
      }
    });

    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// COSTING MODULE
// ============================================================

// Helper: get yarn rate for a fabric_type (falls back to 'Default')
async function getYarnRate(fabric_type) {
  const r = await pool.query(
    `SELECT price_per_kg FROM cost_rates WHERE yarn_type=$1 OR yarn_type='Default' ORDER BY (yarn_type=$1) DESC LIMIT 1`,
    [fabric_type || 'Default']
  );
  return r.rows.length ? parseFloat(r.rows[0].price_per_kg) : 170;
}

// Helper: coerce form values to numeric or NULL (Postgres rejects '' for numeric columns)
function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

// Helper: insert a cost entry
async function addCostEntry(client, { reference_type, reference_id, cost_component, amount_rs, quantity_kg, rate_used, fabric_type, color_name, notes }) {
  await client.query(
    `INSERT INTO cost_entries (reference_type,reference_id,cost_component,amount_rs,quantity_kg,rate_used,fabric_type,color_name,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [reference_type, String(reference_id), cost_component, amount_rs, quantity_kg||null, rate_used||null, fabric_type||null, color_name||null, notes||null]
  );
}

// AI helper -- Groq cloud API (llama-3.3-70b-versatile, no local model required)
function callGroq(systemPrompt, userMessage) {
  return new Promise((resolve) => {
    const apiKey = process.env.GROQ_API_KEY;
    const model  = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    if (!apiKey) { resolve('GROQ_API_KEY not set in .env'); return; }

    const body = JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  },
      ],
    });

    const https = require('https');
    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (groqRes) => {
      let data = '';
      groqRes.on('data', chunk => data += chunk);
      groqRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.choices?.[0]?.message?.content || parsed.error?.message || 'No response from Groq');
        } catch (e) { resolve('Error parsing Groq response'); }
      });
    });
    req.setTimeout(30000, () => { req.destroy(); resolve('Groq request timed out (30s)'); });
    req.on('error', (e) => resolve(`Cannot reach Groq API: ${e.message}`));
    req.write(body); req.end();
  });
}

// AI helper -- NVIDIA GLM-5.2 (primary), src/ai/glm.js
const { askGLM } = require('./src/ai/glm');

// Primary/fallback -- all existing callOllama() calls try GLM first, then Groq.
async function callOllama(systemPrompt, userMessage) {
  try {
    return await askGLM(`${systemPrompt}\n\n${userMessage}`);
  } catch (e) {
    console.error('GLM failed, falling back to Groq:', e.message);
    return callGroq(systemPrompt, userMessage);
  }
}

// â"€â"€ COSTING ENDPOINTS â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// Knitting variance: yarn issued vs rolls produced, standard 1% vs actual
// Groups by machine, date range
app.get('/api/costing/knitting-variance', async (req, res) => {
  try {
    const { from, to } = req.query;
    const conds = []; const params = [];
    if (from) { conds.push(`yi.created_at::date >= $${params.length+1}`); params.push(from); }
    if (to)   { conds.push(`yi.created_at::date <= $${params.length+1}`); params.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    // Yarn issued per machine per day
    const issued = await pool.query(`
      SELECT yi.machine_id, yi.machine_name,
             yi.created_at::date AS issue_date,
             SUM(ii.issued_kg) AS yarn_issued_kg
      FROM yarn_issues yi
      JOIN yarn_issue_items ii ON ii.issue_id = yi.issue_id
      ${where}
      GROUP BY yi.machine_id, yi.machine_name, yi.created_at::date
      ORDER BY issue_date DESC, yi.machine_id
    `, params);

    // Rolls produced per machine per day (approved)
    const rollConds = []; const rollParams = [];
    if (from) { rollConds.push(`r.approved_at::date >= $${rollParams.length+1}`); rollParams.push(from); }
    if (to)   { rollConds.push(`r.approved_at::date <= $${rollParams.length+1}`); rollParams.push(to); }
    const rollWhere = rollConds.length ? `WHERE r.status='APPROVED' AND ${rollConds.join(' AND ')}` : `WHERE r.status='APPROVED'`;

    const produced = await pool.query(`
      SELECT r.machine_id,
             r.approved_at::date AS prod_date,
             SUM(r.actual_weight_kg) AS fabric_produced_kg,
             COUNT(*) AS roll_count,
             COALESCE(i.standard_loss_pct, 1.00) AS std_loss_pct
      FROM rolls r
      LEFT JOIN items i ON i.item_id = r.fabric_item_id
      ${rollWhere}
      GROUP BY r.machine_id, r.approved_at::date, i.standard_loss_pct
      ORDER BY prod_date DESC, r.machine_id
    `, rollParams);

    // Merge: match machine_id + date
    const issuedMap = {};
    for (const row of issued.rows) {
      const key = `${row.machine_id}__${row.issue_date}`;
      issuedMap[key] = { machine_id: row.machine_id, machine_name: row.machine_name, date: row.issue_date, yarn_issued_kg: parseFloat(row.yarn_issued_kg) };
    }
    const result = produced.rows.map(p => {
      const key = `${p.machine_id}__${p.prod_date}`;
      const iss = issuedMap[key] || {};
      const yarnIssued   = iss.yarn_issued_kg || 0;
      const fabricOut    = parseFloat(p.fabric_produced_kg);
      const stdLossPct   = parseFloat(p.std_loss_pct);
      const stdLossKg    = (yarnIssued * stdLossPct / 100);
      const actualLossKg = yarnIssued - fabricOut;
      const varianceKg   = actualLossKg - stdLossKg;
      return {
        machine_id:        p.machine_id,
        machine_name:      iss.machine_name || p.machine_id,
        date:              p.prod_date,
        yarn_issued_kg:    yarnIssued.toFixed(3),
        fabric_produced_kg: fabricOut.toFixed(3),
        roll_count:        p.roll_count,
        std_loss_pct:      stdLossPct,
        std_loss_kg:       stdLossKg.toFixed(3),
        actual_loss_kg:    actualLossKg.toFixed(3),
        variance_kg:       varianceKg.toFixed(3),
        variance_status:   varianceKg > 0.01 ? 'UNFAVORABLE' : varianceKg < -0.01 ? 'FAVORABLE' : 'ON_TARGET',
      };
    });

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// BOM Variance: actual yarn consumed by type vs BOM standard per machine
app.get('/api/costing/bom-variance', async (req, res) => {
  try {
    const { from, to } = req.query;

    // 1. Fabric produced per machine (approved rolls) in date range
    const prodConds = ["r.status='APPROVED'"]; const prodParams = [];
    if (from) { prodConds.push(`r.approved_at::date >= $${prodParams.length+1}`); prodParams.push(from); }
    if (to)   { prodConds.push(`r.approved_at::date <= $${prodParams.length+1}`); prodParams.push(to); }

    const produced = await pool.query(`
      SELECT r.machine_id, m.machine_name,
             r.fabric_item_id, fi.item_code AS fabric_code, fi.item_name AS fabric_name,
             COALESCE(fi.standard_loss_pct, 1.00) AS std_loss_pct,
             SUM(r.actual_weight_kg) AS fabric_kg, COUNT(*) AS roll_count
      FROM rolls r
      JOIN machines m ON m.machine_id = r.machine_id
      LEFT JOIN items fi ON fi.item_id = r.fabric_item_id
      WHERE ${prodConds.join(' AND ')} AND r.fabric_item_id IS NOT NULL
      GROUP BY r.machine_id, m.machine_name, r.fabric_item_id, fi.item_code, fi.item_name, fi.standard_loss_pct
    `, prodParams);

    if (!produced.rows.length) return res.json([]);

    // 2. BOM for each fabric
    const fabricIds = [...new Set(produced.rows.map(r => r.fabric_item_id).filter(Boolean))];
    const bomRes = await pool.query(`
      SELECT bl.fabric_item_id, bl.yarn_item_id, bl.percentage,
             yi.item_code AS yarn_code, yi.item_name AS yarn_name
      FROM bom_lines bl JOIN items yi ON yi.item_id = bl.yarn_item_id
      WHERE bl.fabric_item_id = ANY($1)
    `, [fabricIds]);

    const bomMap = {};
    for (const b of bomRes.rows) {
      if (!bomMap[b.fabric_item_id]) bomMap[b.fabric_item_id] = [];
      bomMap[b.fabric_item_id].push(b);
    }

    // 3. Actual yarn consumed per machine (yarn issues) in date range
    const issConds = []; const issParams = [];
    if (from) { issConds.push(`yi.created_at::date >= $${issParams.length+1}`); issParams.push(from); }
    if (to)   { issConds.push(`yi.created_at::date <= $${issParams.length+1}`); issParams.push(to); }
    const issWhere = issConds.length ? `WHERE ${issConds.join(' AND ')}` : '';

    const actual = await pool.query(`
      SELECT yi.machine_id, yl.item_id AS yarn_item_id,
             yit.item_code AS yarn_code, yit.item_name AS yarn_name,
             SUM(ii.issued_kg - COALESCE(ii.returned_kg,0)) AS net_consumed_kg
      FROM yarn_issues yi
      JOIN yarn_issue_items ii ON ii.issue_id = yi.issue_id
      JOIN yarn_lots yl ON yl.lot_id = ii.lot_id
      LEFT JOIN items yit ON yit.item_id = yl.item_id
      ${issWhere}
      GROUP BY yi.machine_id, yl.item_id, yit.item_code, yit.item_name
    `, issParams);

    const actualMap = {};
    for (const a of actual.rows) {
      const key = `${a.machine_id}__${a.yarn_item_id}`;
      actualMap[key] = parseFloat(a.net_consumed_kg || 0);
    }

    // 4. Build variance rows
    const result = [];
    for (const p of produced.rows) {
      const bom = bomMap[p.fabric_item_id] || [];
      if (!bom.length) continue;
      const fabricKg = parseFloat(p.fabric_kg);
      const stdLossPct = parseFloat(p.std_loss_pct);
      // Yarn needed = fabric produced / (1 - loss%) ... so yarn_in = fabric_out / (1 - loss/100)
      const yarnNeeded = fabricKg / (1 - stdLossPct / 100);

      for (const b of bom) {
        const stdKg = (yarnNeeded * parseFloat(b.percentage) / 100);
        const actKey = `${p.machine_id}__${b.yarn_item_id}`;
        const actKg = actualMap[actKey] || 0;
        const varianceKg = actKg - stdKg;
        result.push({
          machine_id: p.machine_id,
          machine_name: p.machine_name,
          fabric_code: p.fabric_code,
          fabric_name: p.fabric_name,
          fabric_produced_kg: fabricKg.toFixed(2),
          roll_count: parseInt(p.roll_count),
          yarn_code: b.yarn_code,
          yarn_name: b.yarn_name,
          bom_pct: parseFloat(b.percentage),
          std_consumption_kg: stdKg.toFixed(3),
          actual_consumption_kg: actKg.toFixed(3),
          variance_kg: varianceKg.toFixed(3),
          variance_pct: stdKg > 0 ? ((varianceKg / stdKg) * 100).toFixed(1) : '0.0',
          status: varianceKg > 0.5 ? 'OVER' : varianceKg < -0.5 ? 'SHORT' : 'OK',
        });
      }
    }

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rates CRUD
app.get('/api/costing/rates', async (req, res) => {
  try { res.json((await pool.query(`SELECT * FROM cost_rates ORDER BY yarn_type`)).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/costing/rates', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { yarn_type, price_per_kg, labour_per_shift, machine_depreciation_per_hour, notes } = req.body;
    const r = await pool.query(
      `INSERT INTO cost_rates (yarn_type, price_per_kg, labour_per_shift, machine_depreciation_per_hour, notes, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (yarn_type) DO UPDATE
         SET price_per_kg=$2, labour_per_shift=$3, machine_depreciation_per_hour=$4,
             notes=$5, updated_by=$6, updated_at=NOW()
       RETURNING *`,
      [yarn_type, price_per_kg, labour_per_shift||0, machine_depreciation_per_hour||0, notes||null, req.user.username]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Roll cost breakdown
app.get('/api/costing/roll/:id', async (req, res) => {
  try {
    const roll = await pool.query(`SELECT r.*, m.machine_name FROM rolls r LEFT JOIN machines m ON m.machine_id=r.machine_id WHERE r.roll_id=$1`, [req.params.id]);
    if (!roll.rows.length) return res.status(404).json({ error: 'Roll not found' });
    const entries = await pool.query(`SELECT * FROM cost_entries WHERE reference_type='ROLL' AND reference_id=$1 ORDER BY created_at`, [req.params.id]);
    const total = entries.rows.reduce((s, e) => s + parseFloat(e.amount_rs), 0);
    const r = roll.rows[0];
    const cost_per_kg = r.actual_weight_kg > 0 ? (total / r.actual_weight_kg).toFixed(2) : null;
    res.json({ roll: r, entries: entries.rows, total_cost_rs: total.toFixed(2), cost_per_kg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Batch cost P&L
app.get('/api/costing/batch/:id', async (req, res) => {
  try {
    const batch = await pool.query(`SELECT * FROM batches WHERE batch_id=$1`, [req.params.id]);
    if (!batch.rows.length) return res.status(404).json({ error: 'Batch not found' });

    // All rolls in batch
    const rolls = await pool.query(`SELECT r.roll_id FROM batch_rolls br JOIN rolls r ON r.roll_id=br.roll_id WHERE br.batch_id=$1`, [req.params.id]);
    const rollIds = rolls.rows.map(r => r.roll_id);

    // Cost entries: roll-level + batch-level
    const rollEntries = rollIds.length
      ? await pool.query(`SELECT cost_component, SUM(amount_rs) AS total, SUM(quantity_kg) AS kg FROM cost_entries WHERE reference_type='ROLL' AND reference_id=ANY($1) GROUP BY cost_component`, [rollIds])
      : { rows: [] };
    const batchEntries = await pool.query(`SELECT cost_component, SUM(amount_rs) AS total, SUM(quantity_kg) AS kg FROM cost_entries WHERE reference_type='BATCH' AND reference_id=$1 GROUP BY cost_component`, [req.params.id]);
    const challanEntries = await pool.query(`SELECT cost_component, SUM(amount_rs) AS total, SUM(quantity_kg) AS kg FROM cost_entries WHERE reference_type='CHALLAN' AND reference_id IN (SELECT challan_id::text FROM subcontract_challans WHERE batch_id=$1) GROUP BY cost_component`, [req.params.id]);

    const all = [...rollEntries.rows, ...batchEntries.rows, ...challanEntries.rows];
    const byComponent = {};
    all.forEach(e => {
      if (!byComponent[e.cost_component]) byComponent[e.cost_component] = { amount_rs: 0, quantity_kg: 0 };
      byComponent[e.cost_component].amount_rs += parseFloat(e.total);
      byComponent[e.cost_component].quantity_kg += parseFloat(e.kg || 0);
    });
    const total_cost_rs = Object.values(byComponent).reduce((s, v) => s + v.amount_rs, 0);
    const b = batch.rows[0];
    const cost_per_kg = b.total_weight_kg > 0 ? (total_cost_rs / b.total_weight_kg).toFixed(2) : null;
    res.json({ batch: b, breakdown: byComponent, total_cost_rs: total_cost_rs.toFixed(2), cost_per_kg, roll_count: rollIds.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Factory summary
app.get('/api/costing/summary', async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateClause = from && to ? `AND created_at::date BETWEEN '${from}' AND '${to}'` : `AND created_at >= NOW() - INTERVAL '30 days'`;

    const [byComponent, byFabric, totalWastage, totalJobwork, snapshots] = await Promise.all([
      pool.query(`SELECT cost_component, SUM(amount_rs) AS total_rs, SUM(quantity_kg) AS total_kg FROM cost_entries WHERE 1=1 ${dateClause} GROUP BY cost_component ORDER BY total_rs DESC`),
      pool.query(`SELECT fabric_type, SUM(amount_rs) AS total_rs, SUM(quantity_kg) AS total_kg, ROUND(SUM(amount_rs)/NULLIF(SUM(quantity_kg),0),2) AS cost_per_kg FROM cost_entries WHERE fabric_type IS NOT NULL ${dateClause} GROUP BY fabric_type ORDER BY cost_per_kg DESC`),
      pool.query(`SELECT COALESCE(SUM(amount_rs),0) AS wastage_rs FROM cost_entries WHERE cost_component='WASTAGE' ${dateClause}`),
      pool.query(`SELECT COALESCE(SUM(amount_rs),0) AS jobwork_rs FROM cost_entries WHERE cost_component IN ('JOBWORK_DYEING','JOBWORK_FINISHING','JOBWORK_DYEING_FINISHING') ${dateClause}`),
      pool.query(`SELECT * FROM cost_snapshots WHERE snapshot_date >= NOW() - INTERVAL '30 days' ORDER BY snapshot_date DESC LIMIT 90`),
    ]);

    const total_spend = byComponent.rows.reduce((s, r) => s + parseFloat(r.total_rs), 0);
    res.json({ byComponent: byComponent.rows, byFabric: byFabric.rows, total_spend_rs: total_spend.toFixed(2), wastage_rs: parseFloat(totalWastage.rows[0].wastage_rs).toFixed(2), jobwork_rs: parseFloat(totalJobwork.rows[0].jobwork_rs).toFixed(2), snapshots: snapshots.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// FG lot cost
app.get('/api/costing/fg/:id', async (req, res) => {
  try {
    const fg = await pool.query(`SELECT fg.*, b.batch_number FROM finished_goods fg LEFT JOIN batches b ON b.batch_id=fg.batch_id WHERE fg.fg_id=$1`, [req.params.id]);
    if (!fg.rows.length) return res.status(404).json({ error: 'FG lot not found' });
    const f = fg.rows[0];
    // Aggregate all costs for the batch
    const costs = f.batch_id
      ? await pool.query(`SELECT SUM(amount_rs) AS total FROM cost_entries WHERE (reference_type='BATCH' AND reference_id=$1) OR (reference_type='ROLL' AND reference_id IN (SELECT roll_id FROM batch_rolls WHERE batch_id=$1)) OR (reference_type='CHALLAN' AND reference_id IN (SELECT challan_id::text FROM subcontract_challans WHERE batch_id=$1))`, [f.batch_id])
      : { rows: [{ total: 0 }] };
    const total_cost_rs = parseFloat(costs.rows[0]?.total || 0);
    const cost_per_kg = f.weight_kg > 0 ? (total_cost_rs / f.weight_kg).toFixed(2) : null;
    res.json({ fg: f, total_cost_rs: total_cost_rs.toFixed(2), cost_per_kg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// AI Chat
app.post('/api/costing/ask', verifyToken, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'question required' });

    // Fetch relevant context data
    const [rates, summary, fabrics, knitRates, variance] = await Promise.all([
      pool.query(`SELECT yarn_type, price_per_kg FROM cost_rates ORDER BY yarn_type`),
      pool.query(`SELECT cost_component, ROUND(SUM(amount_rs),2) AS total_rs, ROUND(SUM(quantity_kg),2) AS total_kg FROM cost_entries WHERE created_at >= NOW() - INTERVAL '30 days' GROUP BY cost_component`),
      pool.query(`SELECT fabric_type, ROUND(SUM(amount_rs)/NULLIF(SUM(quantity_kg),0),2) AS cost_per_kg, ROUND(SUM(quantity_kg),2) AS kg FROM cost_entries WHERE created_at >= NOW() - INTERVAL '30 days' AND fabric_type IS NOT NULL GROUP BY fabric_type ORDER BY cost_per_kg DESC`),
      pool.query(`SELECT item_code, item_name, knitting_rate_per_kg, standard_loss_pct FROM items WHERE knitting_rate_per_kg IS NOT NULL ORDER BY item_code`),
      pool.query(`
        SELECT yi.machine_id, m.machine_name,
               ROUND(SUM(yii.issued_kg)::NUMERIC,2) AS yarn_issued_kg,
               ROUND(COALESCE(fab.fabric_kg,0)::NUMERIC,2) AS fabric_out_kg,
               ROUND((SUM(yii.issued_kg) - COALESCE(fab.fabric_kg,0))::NUMERIC,2) AS actual_loss_kg
        FROM yarn_issues yi
        JOIN yarn_issue_items yii ON yii.issue_id = yi.issue_id
        LEFT JOIN machines m ON m.machine_id = yi.machine_id
        LEFT JOIN (
          SELECT machine_id, SUM(actual_weight_kg) AS fabric_kg FROM rolls
          WHERE status='APPROVED' AND approved_at >= NOW() - INTERVAL '30 days'
          GROUP BY machine_id
        ) fab ON fab.machine_id = yi.machine_id
        WHERE yi.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY yi.machine_id, m.machine_name, fab.fabric_kg
        ORDER BY actual_loss_kg DESC
      `).catch(() => ({ rows: [] })),
    ]);

    const dataUsed = { rates: rates.rows, last30Days: summary.rows, byFabric: fabrics.rows, knittingRates: knitRates.rows, machineVariance: variance.rows };
    const context = `
DHOWN Hosiery Mills â€" Cost Data (last 30 days):

YARN RATES:
${rates.rows.map(r => `  ${r.yarn_type}: â‚¹${r.price_per_kg}/kg`).join('\n')}

COST BREAKDOWN (last 30 days):
${summary.rows.map(r => `  ${r.cost_component}: â‚¹${r.total_rs} (${r.total_kg}kg)`).join('\n') || '  No cost entries yet'}

COST PER KG BY FABRIC:
${fabrics.rows.map(r => `  ${r.fabric_type}: â‚¹${r.cost_per_kg}/kg (${r.kg}kg produced)`).join('\n') || '  No data yet'}

KNITTING RATES (from Item Master, standard loss %):
${knitRates.rows.map(r => `  ${r.item_code} ${r.item_name}: â‚¹${r.knitting_rate_per_kg}/kg (std loss ${r.standard_loss_pct}%)`).join('\n') || '  No rates set'}

KNITTING LOSS BY MACHINE (last 30 days, yarn issued vs fabric out):
${variance.rows.map(r => `  ${r.machine_name || r.machine_id}: issued ${r.yarn_issued_kg}kg, fabric ${r.fabric_out_kg}kg, loss ${r.actual_loss_kg}kg`).join('\n') || '  No yarn issues yet'}
`;

    const answer = await callOllama(
      'You are a costing assistant for DHOWN Hosiery Mills, a circular knitting factory in India. Answer in plain English with specific â‚¹ numbers from the data provided. Be concise â€" 2-4 sentences max.',
      `${context}\n\nQuestion: ${question}`
    );
    res.json({ answer, data_used: dataUsed, model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// â"€â"€ INVENTORY REPORTS â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// 1. Yarn stock report â€" by type & color, received vs consumed vs remaining
app.get('/api/reports/yarn-stock', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        yl.yarn_type, yl.color, yl.count,
        COUNT(yl.lot_id)                        AS lot_count,
        SUM(yl.net_weight_kg)                   AS total_received_kg,
        SUM(yl.current_stock_kg)                AS current_stock_kg,
        SUM(yl.net_weight_kg - yl.current_stock_kg) AS consumed_kg,
        ROUND(
          CASE WHEN SUM(yl.net_weight_kg) > 0
            THEN SUM(yl.current_stock_kg) / SUM(yl.net_weight_kg) * 100
            ELSE 0 END, 1
        ) AS stock_pct,
        MIN(yl.created_at)                      AS first_receipt,
        MAX(yl.updated_at)                      AS last_movement
      FROM yarn_lots yl
      GROUP BY yl.yarn_type, yl.color, yl.count
      ORDER BY consumed_kg DESC
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. Lot-wise ledger â€" each lot with full movement history
app.get('/api/reports/lot-ledger', async (req, res) => {
  try {
    const { lot_id } = req.query;
    let lots;
    if (lot_id) {
      lots = await pool.query(`SELECT yl.*, g.grn_number, g.supplier_name FROM yarn_lots yl JOIN grn g ON g.grn_id=yl.grn_id WHERE yl.lot_id=$1`, [lot_id]);
    } else {
      lots = await pool.query(`SELECT yl.*, g.grn_number, g.supplier_name FROM yarn_lots yl JOIN grn g ON g.grn_id=yl.grn_id ORDER BY yl.created_at DESC LIMIT 100`);
    }
    const result = await Promise.all(lots.rows.map(async lot => {
      const mv = await pool.query(`SELECT * FROM yarn_lot_movements WHERE lot_id=$1 ORDER BY created_at ASC`, [lot.lot_id]);
      return { ...lot, movements: mv.rows };
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3. Consumption analysis â€" yarn issued vs fabric produced
app.get('/api/reports/consumption', async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFilter = from && to ? `AND yi.issue_date BETWEEN $1 AND $2` : '';
    const params = from && to ? [from, to] : [];

    const issues = await pool.query(`
      SELECT
        yi.issue_id, yi.issue_number, yi.issue_date, yi.machine_name,
        SUM(ii.issued_kg)   AS issued_kg,
        SUM(ii.returned_kg) AS returned_kg,
        SUM(ii.consumed_kg) AS consumed_kg
      FROM yarn_issues yi
      JOIN yarn_issue_items ii ON ii.issue_id = yi.issue_id
      WHERE 1=1 ${dateFilter}
      GROUP BY yi.issue_id, yi.issue_number, yi.issue_date, yi.machine_name
      ORDER BY yi.issue_date DESC
    `, params);

    // Rolls produced during same period
    const rollsQ = from && to
      ? `SELECT machine_id, SUM(actual_weight_kg) AS fabric_kg, COUNT(*) AS roll_count FROM rolls WHERE status='APPROVED' AND DATE(approved_at) BETWEEN $1 AND $2 GROUP BY machine_id`
      : `SELECT machine_id, SUM(actual_weight_kg) AS fabric_kg, COUNT(*) AS roll_count FROM rolls WHERE status='APPROVED' GROUP BY machine_id`;
    const rolls = await pool.query(rollsQ, params);

    const totals = {
      total_issued_kg:   issues.rows.reduce((s, r) => s + parseFloat(r.issued_kg || 0), 0),
      total_consumed_kg: issues.rows.reduce((s, r) => s + parseFloat(r.consumed_kg || 0), 0),
      total_returned_kg: issues.rows.reduce((s, r) => s + parseFloat(r.returned_kg || 0), 0),
      total_fabric_kg:   rolls.rows.reduce((s, r) => s + parseFloat(r.fabric_kg || 0), 0),
    };
    totals.yield_pct = totals.total_consumed_kg > 0
      ? ((totals.total_fabric_kg / totals.total_consumed_kg) * 100).toFixed(1) : null;

    res.json({ issues: issues.rows, rolls: rolls.rows, totals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 4. Warehouse flow summary â€" rolls at each stage
app.get('/api/reports/warehouse-flow', async (req, res) => {
  try {
    const [stages, grns, batches, challans, fg] = await Promise.all([
      pool.query(`
        SELECT warehouse_status, COUNT(*) AS rolls, COALESCE(SUM(actual_weight_kg),0) AS kg
        FROM rolls WHERE status='APPROVED'
        GROUP BY warehouse_status ORDER BY warehouse_status`),
      pool.query(`SELECT status, COUNT(*) AS cnt FROM grn GROUP BY status`),
      pool.query(`SELECT status, COUNT(*) AS cnt, COALESCE(SUM(total_weight_kg),0) AS kg FROM batches GROUP BY status`),
      pool.query(`SELECT status, COUNT(*) AS cnt FROM subcontract_challans GROUP BY status`),
      pool.query(`SELECT status, COUNT(*) AS cnt, COALESCE(SUM(weight_kg),0) AS kg FROM finished_goods GROUP BY status`),
    ]);
    res.json({ stages: stages.rows, grns: grns.rows, batches: batches.rows, challans: challans.rows, finishedGoods: fg.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 5. Greige stock report — item-wise, lot-wise, colour-wise
app.get('/api/reports/greige-stock', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT r.fabric_type, r.warehouse_status, m.machine_name,
        COUNT(*) AS roll_count,
        ROUND(COALESCE(SUM(r.actual_weight_kg), 0)::numeric, 3) AS total_kg,
        MIN(r.approved_at) AS first_approved,
        MAX(r.approved_at) AS last_approved
      FROM rolls r
      LEFT JOIN machines m ON r.machine_id = m.machine_id
      WHERE r.status = 'APPROVED'
      GROUP BY r.fabric_type, r.warehouse_status, m.machine_name
      ORDER BY r.fabric_type, r.warehouse_status
    `);
    const lots = await pool.query(`
      SELECT r.lot_id, r.fabric_type, r.warehouse_status, m.machine_name, r.shift,
        COUNT(*) AS roll_count,
        ROUND(COALESCE(SUM(r.actual_weight_kg), 0)::numeric, 3) AS total_kg
      FROM rolls r
      LEFT JOIN machines m ON r.machine_id = m.machine_id
      WHERE r.status = 'APPROVED'
      GROUP BY r.lot_id, r.fabric_type, r.warehouse_status, m.machine_name, r.shift
      ORDER BY total_kg DESC
    `);
    const totals = await pool.query(`
      SELECT warehouse_status,
        COUNT(*) AS roll_count,
        ROUND(COALESCE(SUM(actual_weight_kg), 0)::numeric, 3) AS total_kg
      FROM rolls WHERE status = 'APPROVED'
      GROUP BY warehouse_status
    `);
    res.json({ by_item: r.rows, by_lot: lots.rows, totals: totals.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 6. Knitting / Job Work report — vendor-wise, lot-wise, colour-wise
app.get('/api/reports/knitting-jobwork', async (req, res) => {
  try {
    const challans = await pool.query(`
      SELECT c.challan_id, c.challan_number, c.vendor_name, c.job_type, c.status,
        c.sent_date, c.expected_return_date, c.sent_weight_kg, c.is_job_work, c.customer_name,
        CASE WHEN c.expected_return_date < CURRENT_DATE AND c.status IN ('SENT','PARTIALLY_RECEIVED')
             THEN true ELSE false END AS is_overdue,
        (CURRENT_DATE - c.sent_date::date) AS days_out,
        COALESCE((SELECT SUM(sr.received_weight_kg) FROM subcontract_receipts sr WHERE sr.challan_id = c.challan_id), 0) AS received_kg,
        COALESCE((SELECT SUM(sr.balance_yarn_kg) FROM subcontract_receipts sr WHERE sr.challan_id = c.challan_id), 0) AS balance_yarn_kg
      FROM subcontract_challans c
      WHERE c.challan_type = 'YARN_BASED' AND c.status != 'CANCELLED'
      ORDER BY c.sent_date DESC
    `);
    const yarn_items = await pool.query(`
      SELECT yi.challan_id, yi.lot_number, yi.yarn_type, yi.color, yi.sent_kg
      FROM sc_challan_yarn_items yi
      JOIN subcontract_challans c ON c.challan_id = yi.challan_id
      WHERE c.challan_type = 'YARN_BASED' AND c.status != 'CANCELLED'
      ORDER BY yi.challan_id, yi.item_id
    `);
    const summary = await pool.query(`
      SELECT c.vendor_name,
        COUNT(*) AS total_challans,
        COUNT(*) FILTER (WHERE c.status IN ('SENT','PARTIALLY_RECEIVED')) AS pending,
        ROUND(COALESCE(SUM(c.sent_weight_kg), 0)::numeric, 3) AS total_sent_kg,
        ROUND(COALESCE(SUM(
          (SELECT SUM(sr.received_weight_kg) FROM subcontract_receipts sr WHERE sr.challan_id = c.challan_id)
        ), 0)::numeric, 3) AS total_received_kg
      FROM subcontract_challans c
      WHERE c.challan_type = 'YARN_BASED' AND c.status != 'CANCELLED'
      GROUP BY c.vendor_name ORDER BY pending DESC
    `);
    res.json({ challans: challans.rows, yarn_items: yarn_items.rows, by_vendor: summary.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 7. Dyeing & Finishing report — item-wise, lot-wise, vendor-wise
app.get('/api/reports/dyeing-finishing', async (req, res) => {
  try {
    const challans = await pool.query(`
      SELECT c.challan_id, c.challan_number, c.vendor_name, c.job_type, c.status,
        c.sent_date, c.expected_return_date, c.sent_weight_kg, c.roll_count,
        b.batch_number, b.fabric_type, b.color_name,
        CASE WHEN c.expected_return_date < CURRENT_DATE AND c.status IN ('SENT','PARTIALLY_RECEIVED')
             THEN true ELSE false END AS is_overdue,
        (CURRENT_DATE - c.sent_date::date) AS days_out,
        COALESCE((SELECT SUM(sr.received_weight_kg) FROM subcontract_receipts sr WHERE sr.challan_id = c.challan_id), 0) AS received_kg,
        COALESCE((SELECT SUM(sr.rejected_weight_kg) FROM subcontract_receipts sr WHERE sr.challan_id = c.challan_id), 0) AS rejected_kg
      FROM subcontract_challans c
      LEFT JOIN batches b ON c.batch_id = b.batch_id
      WHERE c.challan_type = 'ROLL_BASED' AND c.status != 'CANCELLED'
      ORDER BY c.sent_date DESC
    `);
    const by_vendor = await pool.query(`
      SELECT c.vendor_name, c.job_type,
        COUNT(*) AS total_challans,
        COUNT(*) FILTER (WHERE c.status IN ('SENT','PARTIALLY_RECEIVED')) AS pending,
        COUNT(*) FILTER (WHERE c.expected_return_date < CURRENT_DATE AND c.status IN ('SENT','PARTIALLY_RECEIVED')) AS overdue,
        ROUND(COALESCE(SUM(c.sent_weight_kg), 0)::numeric, 3) AS total_sent_kg,
        ROUND(COALESCE(SUM(c.roll_count), 0)::numeric, 0) AS total_rolls,
        ROUND(COALESCE(SUM(
          (SELECT SUM(sr.received_weight_kg) FROM subcontract_receipts sr WHERE sr.challan_id = c.challan_id)
        ), 0)::numeric, 3) AS total_received_kg
      FROM subcontract_challans c
      WHERE c.challan_type = 'ROLL_BASED' AND c.status != 'CANCELLED'
      GROUP BY c.vendor_name, c.job_type ORDER BY pending DESC
    `);
    const by_fabric = await pool.query(`
      SELECT b.fabric_type, b.color_name, c.job_type,
        COUNT(*) AS challans,
        SUM(c.roll_count) AS rolls,
        ROUND(COALESCE(SUM(c.sent_weight_kg), 0)::numeric, 3) AS sent_kg,
        ROUND(COALESCE(SUM(
          (SELECT SUM(sr.received_weight_kg) FROM subcontract_receipts sr WHERE sr.challan_id = c.challan_id)
        ), 0)::numeric, 3) AS received_kg
      FROM subcontract_challans c
      LEFT JOIN batches b ON c.batch_id = b.batch_id
      WHERE c.challan_type = 'ROLL_BASED' AND c.status != 'CANCELLED'
      GROUP BY b.fabric_type, b.color_name, c.job_type
      ORDER BY b.fabric_type, b.color_name
    `);
    res.json({ challans: challans.rows, by_vendor: by_vendor.rows, by_fabric: by_fabric.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 8. Finished fabric report — item-wise, lot-wise, colour-wise
app.get('/api/reports/finished-fabric', async (req, res) => {
  try {
    const by_item = await pool.query(`
      SELECT fg.fabric_type, fg.color_name, fg.status,
        COUNT(*) AS lot_count,
        SUM(fg.roll_count) AS total_rolls,
        ROUND(COALESCE(SUM(fg.weight_kg), 0)::numeric, 3) AS total_kg
      FROM finished_goods fg
      GROUP BY fg.fabric_type, fg.color_name, fg.status
      ORDER BY fg.fabric_type, fg.color_name
    `);
    const by_lot = await pool.query(`
      SELECT fg.fg_id, fg.lot_no, fg.fabric_type, fg.color_name, fg.status,
        fg.roll_count, fg.weight_kg, fg.location, fg.created_at
      FROM finished_goods fg
      ORDER BY fg.created_at DESC
    `);
    const totals = await pool.query(`
      SELECT status,
        COUNT(*) AS lots,
        SUM(roll_count) AS rolls,
        ROUND(COALESCE(SUM(weight_kg), 0)::numeric, 3) AS kg
      FROM finished_goods
      GROUP BY status
    `);
    res.json({ by_item: by_item.rows, by_lot: by_lot.rows, totals: totals.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TRACEABILITY ───────────────────────────────────────────
app.get('/api/traceability/:roll_id', async (req, res) => {
  try {
    const { roll_id } = req.params;

    // 1. Roll core
    const rollRes = await pool.query(`
      SELECT r.*, m.machine_name, m.machine_type, o.operator_name
      FROM rolls r
      LEFT JOIN machines m ON m.machine_id = r.machine_id
      LEFT JOIN operators o ON o.operator_id = r.operator_id
      WHERE r.roll_id = $1
    `, [roll_id]);
    if (!rollRes.rows.length) return res.status(404).json({ error: 'Roll not found' });
    const roll = rollRes.rows[0];

    // 2. Yarn lot + GRN (if linked)
    let yarnLot = null, grn = null;
    if (roll.lot_id) {
      const lotRes = await pool.query(`SELECT yl.*, g.grn_number, g.supplier_name, g.receipt_date FROM yarn_lots yl JOIN grn g ON g.grn_id=yl.grn_id WHERE yl.lot_id=$1`, [roll.lot_id]);
      if (lotRes.rows.length) { yarnLot = lotRes.rows[0]; grn = { grn_number: yarnLot.grn_number, supplier_name: yarnLot.supplier_name, receipt_date: yarnLot.receipt_date }; }
    }

    // 3. Yarn issue (if linked)
    let yarnIssue = null;
    if (roll.issue_id) {
      const issRes = await pool.query(`SELECT * FROM yarn_issues WHERE issue_id=$1`, [roll.issue_id]);
      if (issRes.rows.length) yarnIssue = issRes.rows[0];
    }

    // 4. Batch
    const batchRes = await pool.query(`
      SELECT b.* FROM batch_rolls br JOIN batches b ON b.batch_id=br.batch_id WHERE br.roll_id=$1
    `, [roll_id]);
    const batch = batchRes.rows[0] || null;

    // 5. Subcontract challan + receipt + finishing
    let challan = null, receipt = null, finishing = null;
    if (batch) {
      const challanRes = await pool.query(`SELECT * FROM subcontract_challans WHERE batch_id=$1 ORDER BY created_at DESC LIMIT 1`, [batch.batch_id]);
      if (challanRes.rows.length) {
        challan = challanRes.rows[0];
        const recRes = await pool.query(`SELECT * FROM subcontract_receipts WHERE challan_id=$1 ORDER BY created_at DESC LIMIT 1`, [challan.challan_id]);
        if (recRes.rows.length) {
          receipt = recRes.rows[0];
          const frRes = await pool.query(`SELECT * FROM finishing_records WHERE receipt_id=$1 LIMIT 1`, [receipt.receipt_id]);
          if (frRes.rows.length) finishing = frRes.rows[0];
        }
      }
    }

    // 6. Finished goods + dispatch
    let finishedGoods = null, dispatch = null;
    if (receipt) {
      const fgRes = await pool.query(`SELECT * FROM finished_goods WHERE receipt_id=$1 LIMIT 1`, [receipt.receipt_id]);
      if (fgRes.rows.length) {
        finishedGoods = fgRes.rows[0];
        const diRes = await pool.query(`
          SELECT di.*, dc.dispatch_number, dc.customer_name, dc.dispatch_date, dc.vehicle_number, dc.invoice_number
          FROM dispatch_items di JOIN dispatch_challans dc ON dc.dispatch_id=di.dispatch_id
          WHERE di.fg_id=$1 LIMIT 1
        `, [finishedGoods.fg_id]);
        if (diRes.rows.length) dispatch = diRes.rows[0];
      }
    }

    res.json({ roll, grn, yarnLot, yarnIssue, batch, challan, receipt, finishing, finishedGoods, dispatch });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Trace by yarn lot number — forward chain from lot → rolls → batches → SC → FG → dispatch
app.get('/api/traceability/lot/:lot_number', async (req, res) => {
  try {
    const { lot_number } = req.params;
    const lotRes = await pool.query(`
      SELECT yl.*, g.grn_number, g.supplier_name, g.receipt_date
      FROM yarn_lots yl LEFT JOIN grn g ON g.grn_id = yl.grn_id
      WHERE yl.lot_number ILIKE $1
    `, [lot_number]);
    if (!lotRes.rows.length) return res.status(404).json({ error: 'Lot not found' });
    const lot = lotRes.rows[0];
    const grn = lot.grn_id ? { grn_number: lot.grn_number, supplier_name: lot.supplier_name, receipt_date: lot.receipt_date } : null;

    // Yarn issues that used this lot
    const issuesRes = await pool.query(`
      SELECT yi.*, yii.issued_kg,
             m.machine_name
      FROM yarn_issue_items yii
      JOIN yarn_issues yi ON yi.issue_id = yii.issue_id
      LEFT JOIN machines m ON m.machine_id = yi.machine_id
      WHERE yii.lot_id = $1
      ORDER BY yi.issue_date DESC
    `, [lot.lot_id]);

    // Rolls produced on machines that received this lot (via issue)
    const issueIds = issuesRes.rows.map(r => r.issue_id);
    let rolls = [];
    if (issueIds.length) {
      const rollRes = await pool.query(`
        SELECT r.roll_id, r.status, r.warehouse_status,
               COALESCE(r.actual_weight_kg, r.weight_kg) AS weight_kg,
               r.shift, COALESCE(r.closed_at, r.created_at) AS produced_at,
               m.machine_name, o.operator_name
        FROM rolls r
        LEFT JOIN machines m ON m.machine_id = r.machine_id
        LEFT JOIN operators o ON o.operator_id = r.operator_id
        WHERE r.issue_id = ANY($1)
        ORDER BY r.created_at DESC
      `, [issueIds]);
      rolls = rollRes.rows;
    }

    // For each roll, get batch → challan → receipt → FG → dispatch
    const downstream = [];
    for (const roll of rolls) {
      const batchRes = await pool.query(`SELECT b.* FROM batch_rolls br JOIN batches b ON b.batch_id=br.batch_id WHERE br.roll_id=$1`, [roll.roll_id]);
      const batch = batchRes.rows[0] || null;
      let challan = null, receipt = null, fg = null, dispatch = null;
      if (batch) {
        const cRes = await pool.query(`SELECT * FROM subcontract_challans WHERE batch_id=$1 ORDER BY created_at DESC LIMIT 1`, [batch.batch_id]);
        challan = cRes.rows[0] || null;
        if (challan) {
          const rRes = await pool.query(`SELECT * FROM subcontract_receipts WHERE challan_id=$1 ORDER BY created_at DESC LIMIT 1`, [challan.challan_id]);
          receipt = rRes.rows[0] || null;
          if (receipt) {
            const fgRes = await pool.query(`SELECT * FROM finished_goods WHERE receipt_id=$1 LIMIT 1`, [receipt.receipt_id]);
            fg = fgRes.rows[0] || null;
            if (fg) {
              const dRes = await pool.query(`
                SELECT di.weight_kg, dc.dispatch_number, dc.customer_name, dc.dispatch_date
                FROM dispatch_items di JOIN dispatch_challans dc ON dc.dispatch_id=di.dispatch_id
                WHERE di.fg_id=$1 LIMIT 1
              `, [fg.fg_id]);
              dispatch = dRes.rows[0] || null;
            }
          }
        }
      }
      downstream.push({ roll, batch, challan, receipt, fg, dispatch });
    }

    res.json({ lot, grn, issues: issuesRes.rows, downstream, totalRolls: rolls.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Search lots for traceability
app.get('/api/traceability/lot-search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    const r = await pool.query(`
      SELECT yl.lot_number, yl.yarn_type, yl.brand, yl.net_weight_kg, yl.current_stock_kg,
             g.grn_number, g.supplier_name
      FROM yarn_lots yl LEFT JOIN grn g ON g.grn_id = yl.grn_id
      WHERE yl.lot_number ILIKE $1 OR yl.yarn_type ILIKE $1 OR yl.brand ILIKE $1
      ORDER BY yl.created_at DESC LIMIT 20
    `, [`%${q}%`]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Search rolls for traceability
app.get('/api/traceability', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    const r = await pool.query(`
      SELECT r.roll_id, r.status, r.warehouse_status, r.actual_weight_kg, r.created_at,
             m.machine_name
      FROM rolls r LEFT JOIN machines m ON m.machine_id=r.machine_id
      WHERE r.roll_id ILIKE $1
      ORDER BY r.created_at DESC LIMIT 20
    `, [`%${q}%`]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// â"€â"€ QR lookup â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.get('/api/inventory/qr/:code', async (req, res) => {
  try {
    const { code } = req.params;
    if (code.startsWith('GRN:')) {
      const r = await pool.query(`SELECT * FROM grn WHERE grn_number=$1`, [code.replace('GRN:','')]);
      return res.json({ type: 'grn', data: r.rows[0] });
    }
    if (code.startsWith('YARN:')) {
      const r = await pool.query(`SELECT yl.*, g.supplier_name FROM yarn_lots yl JOIN grn g ON g.grn_id=yl.grn_id WHERE yl.lot_number=$1`, [code.replace('YARN:','')]);
      return res.json({ type: 'yarn_lot', data: r.rows[0] });
    }
    res.status(404).json({ error: 'Unknown QR code' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// React Router catch-all â€" must be after ALL api routes
// ============================================================
// All /api/erp/* routes require a valid JWT
app.use('/api/erp', verifyToken);

// ERP â€" STOCK LEDGER HELPER (Phase 1)
// ============================================================

async function postToLedger(client, { doc_type, doc_id, item_id, item_desc, warehouse_id, movement_type, quantity, uom_code, unit_cost, partner_id, notes, created_by }) {
  try {
    const total_cost = (unit_cost && quantity) ? parseFloat(unit_cost) * parseFloat(quantity) : null;
    await client.query(
      `INSERT INTO stock_ledger (doc_type,doc_id,item_id,item_desc,warehouse_id,movement_type,quantity,uom_code,unit_cost,total_cost,partner_id,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [doc_type, String(doc_id), item_id||null, item_desc||null, warehouse_id||null,
       movement_type, quantity, uom_code||'KG', unit_cost||null, total_cost,
       partner_id||null, notes||null, created_by||'system']
    );
  } catch (e) {
    console.error('stock_ledger write error:', e.message);
  }
}

// ============================================================
// ERP â€" DOC SERIES (Phase 0-A)
// ============================================================

// Generate next number from doc_series table
async function nextDocNumber(seriesCode) {
  const res = await pool.query('SELECT * FROM doc_series WHERE series_code=$1', [seriesCode]);
  if (res.rows.length === 0) throw new Error(`Unknown doc series: ${seriesCode}`);
  const s = res.rows[0];
  const now = new Date();
  const yr = now.getFullYear();
  const finYear = `${yr}-${String(yr + 1).slice(2)}`;

  let newSeq = s.current_seq + 1;
  if (s.reset_yearly && s.fin_year && s.fin_year !== finYear) newSeq = 1;

  await pool.query(
    `UPDATE doc_series SET current_seq=$1, fin_year=$2, last_reset=CASE WHEN $3 THEN CURRENT_DATE ELSE last_reset END, updated_at=NOW() WHERE series_code=$4`,
    [newSeq, finYear, (s.reset_yearly && s.fin_year !== finYear), seriesCode]
  );

  let num = s.prefix;
  if (s.include_year) num += String(yr).slice(2);
  if (s.include_month) num += String(now.getMonth() + 1).padStart(2, '0');
  num += String(newSeq).padStart(s.zero_pad, '0');
  if (s.suffix) num += s.suffix;
  return num;
}

app.get('/api/erp/doc-series', requireRole('ADMIN'), async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM doc_series ORDER BY series_code');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/erp/doc-series/:code', requireRole('ADMIN'), async (req, res) => {
  const { prefix, zero_pad } = req.body;
  try {
    await pool.query(
      `UPDATE doc_series SET prefix=$1, zero_pad=$2, updated_at=NOW() WHERE series_code=$3`,
      [prefix, zero_pad, req.params.code]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// ERP â€" ITEM MASTER (Phase 0-B)
// ============================================================

// --- UOM ---
app.get('/api/erp/uom', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM uom WHERE is_active=TRUE ORDER BY code');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- HSN Codes ---
app.get('/api/erp/hsn', async (req, res) => {
  try {
    const q = req.query.q ? `%${req.query.q}%` : '%';
    const r = await pool.query(
      `SELECT * FROM hsn_codes WHERE hsn_code ILIKE $1 OR description ILIKE $1 ORDER BY hsn_code LIMIT 50`,
      [q]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/erp/hsn', requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { hsn_code, description, gst_rate } = req.body;
    if (!hsn_code || !description) return res.status(400).json({ error: 'hsn_code and description required' });
    const r = await pool.query(
      `INSERT INTO hsn_codes (hsn_code, description, gst_rate)
       VALUES ($1, $2, $3)
       ON CONFLICT (hsn_code) DO UPDATE SET description=EXCLUDED.description, gst_rate=EXCLUDED.gst_rate
       RETURNING *`,
      [hsn_code.trim(), description.trim(), parseFloat(gst_rate) || 0]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Item Categories ---
app.get('/api/erp/item-categories', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM item_categories WHERE is_active=TRUE ORDER BY code');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Items LIST ---
app.get('/api/erp/items', async (req, res) => {
  try {
    const { page = 1, limit = 50, category, status, q } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let pi = 1;

    if (category) { conditions.push(`ic.code = $${pi++}`); params.push(category); }
    if (status)   { conditions.push(`i.status = $${pi++}`); params.push(status); }
    if (q)        { conditions.push(`(i.item_code ILIKE $${pi} OR i.item_name ILIKE $${pi})`); params.push(`%${q}%`); pi++; }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM items i JOIN item_categories ic ON i.category_id=ic.category_id ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count);

    const dataRes = await pool.query(
      `SELECT i.*, ic.code AS category_code, ic.name AS category_name, u.code AS uom_code
       FROM items i
       JOIN item_categories ic ON i.category_id=ic.category_id
       LEFT JOIN uom u ON i.uom_id=u.uom_id
       ${where}
       ORDER BY i.item_code
       LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, parseInt(limit), offset]
    );

    res.json({ data: dataRes.rows, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Item GET single ---
app.get('/api/erp/items/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.*, ic.code AS category_code, ic.name AS category_name,
              u.code AS uom_code, h.hsn_code, h.gst_rate AS hsn_gst_rate
       FROM items i
       JOIN item_categories ic ON i.category_id=ic.category_id
       LEFT JOIN uom u ON i.uom_id=u.uom_id
       LEFT JOIN hsn_codes h ON i.hsn_id=h.hsn_id
       WHERE i.item_id=$1`, [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const item = r.rows[0];

    const yarn = await pool.query('SELECT * FROM item_yarn_attrs WHERE item_id=$1', [item.item_id]);
    const fabric = await pool.query('SELECT * FROM item_fabric_attrs WHERE item_id=$1', [item.item_id]);
    const spare = await pool.query('SELECT * FROM item_spare_attrs WHERE item_id=$1', [item.item_id]);

    item.yarn_attrs = yarn.rows[0] || null;
    item.fabric_attrs = fabric.rows[0] || null;
    item.spare_attrs = spare.rows[0] || null;

    // BOM lines for fabric items
    const bom = await pool.query(
      `SELECT bl.*, yi.item_code AS yarn_code, yi.item_name AS yarn_name
       FROM bom_lines bl JOIN items yi ON yi.item_id = bl.yarn_item_id
       WHERE bl.fabric_item_id = $1 ORDER BY bl.sort_order, bl.bom_line_id`, [item.item_id]);
    item.bom_lines = bom.rows;

    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Item CREATE ---
app.post('/api/erp/items', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      item_code, item_name, category_id, description,
      uom_id, hsn_id, gst_rate, standard_cost,
      yarn_attrs, fabric_attrs, spare_attrs
    } = req.body;

    // Auto-generate item_code if blank
    let code = item_code;
    if (!code || !code.trim()) {
      const catR = await client.query('SELECT code FROM item_categories WHERE category_id=$1', [category_id]);
      const prefix = catR.rows[0]?.code?.slice(0, 3) || 'ITM';
      const seq = await client.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(item_code FROM '[0-9]+$') AS INTEGER)), 0)+1 AS n FROM items WHERE item_code LIKE $1`,
        [`${prefix}%`]
      );
      code = `${prefix}-${String(seq.rows[0].n).padStart(4, '0')}`;
    }

    const { knitting_rate_per_kg, standard_loss_pct } = req.body;
    const r = await client.query(
      `INSERT INTO items (item_code,item_name,category_id,description,uom_id,hsn_id,gst_rate,standard_cost,knitting_rate_per_kg,standard_loss_pct,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [code, item_name, category_id, description, uom_id || null, hsn_id || null,
       gst_rate || 0, standard_cost || 0,
       knitting_rate_per_kg || null, standard_loss_pct || 1.00,
       req.user?.username || 'system']
    );
    const item_id = r.rows[0].item_id;

    if (yarn_attrs && Object.keys(yarn_attrs).length) {
      await client.query(
        `INSERT INTO item_yarn_attrs (item_id,count,composition,shade,yarn_type)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (item_id) DO UPDATE
         SET count=$2,composition=$3,shade=$4,yarn_type=$5`,
        [item_id, yarn_attrs.count, yarn_attrs.composition, yarn_attrs.shade, yarn_attrs.yarn_type]
      );
    }
    if (fabric_attrs && Object.keys(fabric_attrs).length) {
      await client.query(
        `INSERT INTO item_fabric_attrs (item_id,fabric_code,structure,gsm,finished_gsm,width_cm,finished_width_cm,machine_type,gauge,dia_inches,feeders,stitch_length_mm)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (item_id) DO UPDATE
         SET fabric_code=$2,structure=$3,gsm=$4,finished_gsm=$5,width_cm=$6,finished_width_cm=$7,machine_type=$8,gauge=$9,dia_inches=$10,feeders=$11,stitch_length_mm=$12`,
        [item_id, fabric_attrs.fabric_code || null, fabric_attrs.structure || null, numOrNull(fabric_attrs.gsm),
         numOrNull(fabric_attrs.finished_gsm), numOrNull(fabric_attrs.width_cm), numOrNull(fabric_attrs.finished_width_cm),
         fabric_attrs.machine_type || null, numOrNull(fabric_attrs.gauge), numOrNull(fabric_attrs.dia_inches),
         numOrNull(fabric_attrs.feeders), numOrNull(fabric_attrs.stitch_length_mm)]
      );
    }
    if (spare_attrs && Object.keys(spare_attrs).length) {
      await client.query(
        `INSERT INTO item_spare_attrs (item_id,oem_part_number,compatible_machine,rack_bin,warranty_months)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (item_id) DO UPDATE
         SET oem_part_number=$2,compatible_machine=$3,rack_bin=$4,warranty_months=$5`,
        [item_id, spare_attrs.oem_part_number || null, spare_attrs.compatible_machine || null,
         spare_attrs.rack_bin || null, numOrNull(spare_attrs.warranty_months)]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (username, action, module, new_value)
       VALUES ($1,'CREATE_ITEM','ITEMS',$2)`,
      [req.user?.username || 'system', `item_id=${item_id} code=${item_code}`]
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, item_id, item_code: code });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// --- Item UPDATE ---
app.put('/api/erp/items/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      item_name, description, uom_id, hsn_id, gst_rate,
      standard_cost, status, yarn_attrs, fabric_attrs, spare_attrs,
      knitting_rate_per_kg, standard_loss_pct
    } = req.body;
    const item_id = req.params.id;

    await client.query(
      `UPDATE items SET item_name=$1,description=$2,uom_id=$3,hsn_id=$4,
       gst_rate=$5,standard_cost=$6,status=$7,
       knitting_rate_per_kg=$8,standard_loss_pct=$9,
       updated_at=NOW() WHERE item_id=$10`,
      [item_name, description, uom_id || null, hsn_id || null,
       gst_rate || 0, standard_cost || 0, status || 'ACTIVE',
       knitting_rate_per_kg || null, standard_loss_pct || 1.00,
       item_id]
    );

    if (yarn_attrs) {
      await client.query(
        `INSERT INTO item_yarn_attrs (item_id,count,composition,shade,yarn_type)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (item_id) DO UPDATE
         SET count=$2,composition=$3,shade=$4,yarn_type=$5`,
        [item_id, yarn_attrs.count, yarn_attrs.composition, yarn_attrs.shade, yarn_attrs.yarn_type]
      );
    }
    if (fabric_attrs) {
      await client.query(
        `INSERT INTO item_fabric_attrs (item_id,fabric_code,structure,gsm,finished_gsm,width_cm,finished_width_cm,machine_type,gauge,dia_inches,feeders,stitch_length_mm)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (item_id) DO UPDATE
         SET fabric_code=$2,structure=$3,gsm=$4,finished_gsm=$5,width_cm=$6,finished_width_cm=$7,machine_type=$8,gauge=$9,dia_inches=$10,feeders=$11,stitch_length_mm=$12`,
        [item_id, fabric_attrs.fabric_code || null, fabric_attrs.structure || null, numOrNull(fabric_attrs.gsm),
         numOrNull(fabric_attrs.finished_gsm), numOrNull(fabric_attrs.width_cm), numOrNull(fabric_attrs.finished_width_cm),
         fabric_attrs.machine_type || null, numOrNull(fabric_attrs.gauge), numOrNull(fabric_attrs.dia_inches),
         numOrNull(fabric_attrs.feeders), numOrNull(fabric_attrs.stitch_length_mm)]
      );
    }
    if (spare_attrs) {
      await client.query(
        `INSERT INTO item_spare_attrs (item_id,oem_part_number,compatible_machine,rack_bin,warranty_months)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (item_id) DO UPDATE
         SET oem_part_number=$2,compatible_machine=$3,rack_bin=$4,warranty_months=$5`,
        [item_id, spare_attrs.oem_part_number || null, spare_attrs.compatible_machine || null,
         spare_attrs.rack_bin || null, numOrNull(spare_attrs.warranty_months)]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// --- Item DEACTIVATE ---
app.delete('/api/erp/items/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    await pool.query(
      `UPDATE items SET is_active=FALSE, status='INACTIVE', updated_at=NOW() WHERE item_id=$1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- BOM (Bill of Materials) for fabric items ---
app.get('/api/erp/items/:id/bom', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT bl.*, yi.item_code AS yarn_code, yi.item_name AS yarn_name
       FROM bom_lines bl JOIN items yi ON yi.item_id = bl.yarn_item_id
       WHERE bl.fabric_item_id = $1 ORDER BY bl.sort_order, bl.bom_line_id`, [req.params.id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/erp/items/:id/bom', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { lines } = req.body; // [{ yarn_item_id, percentage }]
    if (!Array.isArray(lines)) throw new Error('lines array required');
    const total = lines.reduce((s, l) => s + parseFloat(l.percentage || 0), 0);
    if (lines.length > 0 && Math.abs(total - 100) > 0.1) throw new Error(`Percentages must total 100% (got ${total.toFixed(2)}%)`);
    await client.query('DELETE FROM bom_lines WHERE fabric_item_id = $1', [req.params.id]);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.yarn_item_id || !l.percentage) continue;
      await client.query(
        `INSERT INTO bom_lines (fabric_item_id, yarn_item_id, percentage, sort_order) VALUES ($1,$2,$3,$4)`,
        [req.params.id, l.yarn_item_id, l.percentage, i]);
    }
    await client.query('COMMIT');
    const r = await pool.query(
      `SELECT bl.*, yi.item_code AS yarn_code, yi.item_name AS yarn_name
       FROM bom_lines bl JOIN items yi ON yi.item_id = bl.yarn_item_id
       WHERE bl.fabric_item_id = $1 ORDER BY bl.sort_order`, [req.params.id]);
    res.json(r.rows);
  } catch (e) { await client.query('ROLLBACK'); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});

// Import fabric types from fabric_types table → items master
app.post('/api/erp/items/import-fabric-types', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const fts = await pool.query(`SELECT code, name, description FROM fabric_types ORDER BY code`);
    if (fts.rows.length === 0) return res.json({ imported: 0, skipped: 0, message: 'No fabric types found in Settings.' });

    // Get or create a FABRIC category
    let catRes = await pool.query(`SELECT category_id FROM item_categories WHERE UPPER(code) IN ('FINISHED_FABRIC','GREIGE_FABRIC','FABRIC') ORDER BY category_id LIMIT 1`);
    const categoryId = catRes.rows[0]?.category_id || null;

    let imported = 0, skipped = 0;
    for (const ft of fts.rows) {
      const existing = await pool.query(`SELECT item_id FROM items WHERE item_code = $1`, [ft.code]);
      if (existing.rows.length > 0) { skipped++; continue; }
      await pool.query(
        `INSERT INTO items (item_code, item_name, category_id, description, status, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', TRUE, NOW(), NOW())`,
        [ft.code, ft.name, categoryId, ft.description || null]
      );
      imported++;
    }
    res.json({ imported, skipped, total: fts.rows.length, message: `Imported ${imported} fabric types. ${skipped} already existed.` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// ERP â€" STOCK LEDGER QUERIES (Phase 1)
// ============================================================

// Stock Statement: current balance by item_desc + warehouse
app.get('/api/erp/stock-statement', requireRole('OPERATOR'), async (req, res) => {
  try {
    const { as_of, warehouse_id, doc_type } = req.query;
    const dateFilter = as_of ? `AND txn_date <= '${as_of}'` : '';
    const whFilter = warehouse_id ? `AND warehouse_id = ${parseInt(warehouse_id)}` : '';
    const dtFilter = doc_type ? `AND doc_type = '${doc_type}'` : '';

    const r = await pool.query(`
      SELECT
        sl.item_id,
        COALESCE(i.item_name, sl.item_desc, 'Unknown') AS item_name,
        COALESCE(i.item_code, 'â€"') AS item_code,
        COALESCE(ic.name, 'â€"') AS category,
        sl.warehouse_id,
        COALESCE(w.name, 'Unknown') AS warehouse_name,
        sl.uom_code,
        SUM(CASE WHEN sl.movement_type='IN' THEN sl.quantity ELSE 0 END) AS total_in,
        SUM(CASE WHEN sl.movement_type='OUT' THEN sl.quantity ELSE 0 END) AS total_out,
        SUM(CASE WHEN sl.movement_type='IN' THEN sl.quantity ELSE -sl.quantity END) AS balance,
        SUM(CASE WHEN sl.movement_type='IN' THEN COALESCE(sl.total_cost,0) ELSE -COALESCE(sl.total_cost,0) END) AS balance_value,
        MAX(sl.txn_date) AS last_txn_date,
        COUNT(*) AS txn_count
      FROM stock_ledger sl
      LEFT JOIN items i ON sl.item_id = i.item_id
      LEFT JOIN item_categories ic ON i.category_id = ic.category_id
      LEFT JOIN warehouses w ON sl.warehouse_id = w.warehouse_id
      WHERE 1=1 ${dateFilter} ${whFilter} ${dtFilter}
      GROUP BY sl.item_id, sl.item_desc, i.item_name, i.item_code, ic.name, sl.warehouse_id, w.name, sl.uom_code
      HAVING SUM(CASE WHEN sl.movement_type='IN' THEN sl.quantity ELSE -sl.quantity END) != 0
         OR SUM(CASE WHEN sl.movement_type='IN' THEN sl.quantity ELSE 0 END) > 0
      ORDER BY w.name, item_name
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Stock Ledger: transaction log for a specific item or doc
app.get('/api/erp/stock-ledger', requireRole('OPERATOR'), async (req, res) => {
  try {
    const { item_id, doc_type, warehouse_id, from_date, to_date, page = 1, limit = 100 } = req.query;
    const conds = []; const params = []; let pi = 1;
    if (item_id)     { conds.push(`sl.item_id=$${pi++}`); params.push(item_id); }
    if (doc_type)    { conds.push(`sl.doc_type=$${pi++}`); params.push(doc_type); }
    if (warehouse_id){ conds.push(`sl.warehouse_id=$${pi++}`); params.push(warehouse_id); }
    if (from_date)   { conds.push(`sl.txn_date>=$${pi++}`); params.push(from_date); }
    if (to_date)     { conds.push(`sl.txn_date<=$${pi++}`); params.push(to_date); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const offset = (parseInt(page)-1)*parseInt(limit);

    const total = await pool.query(`SELECT COUNT(*) FROM stock_ledger sl ${where}`, params);
    const rows = await pool.query(
      `SELECT sl.*, i.item_code, i.item_name, w.name AS warehouse_name
       FROM stock_ledger sl
       LEFT JOIN items i ON sl.item_id=i.item_id
       LEFT JOIN warehouses w ON sl.warehouse_id=w.warehouse_id
       ${where}
       ORDER BY sl.txn_time DESC
       LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, parseInt(limit), offset]
    );
    res.json({ data: rows.rows, total: parseInt(total.rows[0].count), page: parseInt(page) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// ERP â€" PARTNER MASTER (Phase 0-C)
// ============================================================

const VALID_ROLES = ['SUPPLIER','CUSTOMER','KNITTING_SUB','DYE_HOUSE','FINISHING_HOUSE','TRANSPORTER','AGENT'];

// Auto-generate partner code
async function nextPartnerCode() {
  const r = await pool.query(`SELECT COALESCE(MAX(CAST(SUBSTRING(partner_code FROM '[0-9]+$') AS INTEGER)),0)+1 AS n FROM partners`);
  return 'PART-' + String(r.rows[0].n).padStart(4, '0');
}

// --- Partner LIST ---
app.get('/api/erp/partners', verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const { page = 1, limit = 50, role, city, active, q } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conds = []; const params = []; let pi = 1;

    if (active === 'true')  { conds.push(`p.is_active=TRUE`); }
    if (active === 'false') { conds.push(`p.is_active=FALSE`); }
    if (city) { conds.push(`a.city ILIKE $${pi++}`); params.push(`%${city}%`); }
    if (q)    { conds.push(`(p.partner_code ILIKE $${pi} OR p.company_name ILIKE $${pi} OR p.gstin ILIKE $${pi})`); params.push(`%${q}%`); pi++; }

    const roleJoin = role ? `JOIN partner_roles pr2 ON pr2.partner_id=p.partner_id AND pr2.role=$${pi++}` : '';
    if (role) params.push(role);

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const countRes = await pool.query(
      `SELECT COUNT(DISTINCT p.partner_id) FROM partners p
       LEFT JOIN partner_addresses a ON a.partner_id=p.partner_id AND a.is_default=TRUE
       ${roleJoin} ${where}`, params
    );
    const total = parseInt(countRes.rows[0].count);

    const dataRes = await pool.query(
      `SELECT p.*, a.city, a.state,
              COALESCE(json_agg(DISTINCT pr.role) FILTER (WHERE pr.role IS NOT NULL), '[]') AS roles
       FROM partners p
       LEFT JOIN partner_addresses a ON a.partner_id=p.partner_id AND a.is_default=TRUE
       LEFT JOIN partner_roles pr ON pr.partner_id=p.partner_id
       ${roleJoin} ${where}
       GROUP BY p.partner_id, a.city, a.state
       ORDER BY p.partner_code
       LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, parseInt(limit), offset]
    );

    res.json({ data: dataRes.rows, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Partner GET single (full detail) ---
app.get('/api/erp/partners/:id', verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const id = req.params.id;
    const p = await pool.query('SELECT * FROM partners WHERE partner_id=$1', [id]);
    if (!p.rows.length) return res.status(404).json({ error: 'Not found' });
    const partner = p.rows[0];

    const [roles, addresses, contacts, banks] = await Promise.all([
      pool.query('SELECT * FROM partner_roles WHERE partner_id=$1', [id]),
      pool.query('SELECT * FROM partner_addresses WHERE partner_id=$1 ORDER BY is_default DESC', [id]),
      pool.query('SELECT * FROM partner_contacts WHERE partner_id=$1 ORDER BY is_primary DESC', [id]),
      pool.query('SELECT * FROM partner_bank WHERE partner_id=$1 ORDER BY is_default DESC', [id]),
    ]);

    partner.roles = roles.rows.map(r => r.role);
    partner.addresses = addresses.rows;
    partner.contacts = contacts.rows;
    partner.banks = banks.rows;
    res.json(partner);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Partner CREATE ---
app.post('/api/erp/partners', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      partner_code, company_name, short_name, gstin, pan, tan, iec, cin,
      msme_number, msme_category, payment_terms, credit_limit, credit_days,
      rating, notes, roles = [], address, contact, bank
    } = req.body;

    const code = (partner_code && partner_code.trim()) ? partner_code.trim() : await nextPartnerCode();

    const r = await client.query(
      `INSERT INTO partners (partner_code,company_name,short_name,gstin,pan,tan,iec,cin,
        msme_number,msme_category,payment_terms,credit_limit,credit_days,rating,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [code, company_name, short_name, gstin||null, pan||null, tan||null, iec||null, cin||null,
       msme_number||null, msme_category||null, payment_terms||30, credit_limit||null,
       credit_days||0, rating||null, notes||null, req.user?.username||'system']
    );
    const partner_id = r.rows[0].partner_id;

    for (const role of roles) {
      if (VALID_ROLES.includes(role)) {
        await client.query(
          `INSERT INTO partner_roles (partner_id, role) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [partner_id, role]
        );
      }
    }

    if (address && (address.line1 || address.city)) {
      await client.query(
        `INSERT INTO partner_addresses (partner_id,address_type,line1,line2,city,state,pincode,country,gstin,is_default)
         VALUES ($1,'PRIMARY',$2,$3,$4,$5,$6,$7,$8,TRUE)`,
        [partner_id, address.line1, address.line2, address.city, address.state,
         address.pincode, address.country||'India', address.gstin||null]
      );
    }

    if (contact && contact.name) {
      await client.query(
        `INSERT INTO partner_contacts (partner_id,name,designation,mobile,email,whatsapp,is_primary)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
        [partner_id, contact.name, contact.designation, contact.mobile, contact.email, contact.whatsapp]
      );
    }

    if (bank && bank.account_no) {
      await client.query(
        `INSERT INTO partner_bank (partner_id,bank_name,branch,account_no,ifsc,account_type,is_default)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
        [partner_id, bank.bank_name, bank.branch, bank.account_no, bank.ifsc, bank.account_type||'CURRENT']
      );
    }

    await client.query(
      `INSERT INTO audit_logs (username,action,module,new_value)
       VALUES ($1,'CREATE_PARTNER','PARTNERS',$2)`,
      [req.user?.username||'system', `partner_id=${partner_id} code=${code} name=${company_name}`]
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, partner_id, partner_code: code });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// --- Partner UPDATE (core fields + roles) ---
app.put('/api/erp/partners/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = req.params.id;
    const {
      company_name, short_name, gstin, pan, tan, iec, cin,
      msme_number, msme_category, payment_terms, credit_limit, credit_days,
      rating, notes, is_active, roles
    } = req.body;

    await client.query(
      `UPDATE partners SET company_name=$1,short_name=$2,gstin=$3,pan=$4,tan=$5,iec=$6,cin=$7,
       msme_number=$8,msme_category=$9,payment_terms=$10,credit_limit=$11,credit_days=$12,
       rating=$13,notes=$14,is_active=$15,updated_at=NOW() WHERE partner_id=$16`,
      [company_name, short_name, gstin||null, pan||null, tan||null, iec||null, cin||null,
       msme_number||null, msme_category||null, payment_terms||30, credit_limit||null,
       credit_days||0, rating||null, notes||null, is_active!==false, id]
    );

    if (Array.isArray(roles)) {
      await client.query('DELETE FROM partner_roles WHERE partner_id=$1', [id]);
      for (const role of roles) {
        if (VALID_ROLES.includes(role)) {
          await client.query(
            `INSERT INTO partner_roles (partner_id,role) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [id, role]
          );
        }
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// --- Partner: add address ---
app.post('/api/erp/partners/:id/addresses', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { address_type, line1, line2, city, state, pincode, country, gstin, is_default } = req.body;
    if (is_default) {
      await pool.query('UPDATE partner_addresses SET is_default=FALSE WHERE partner_id=$1', [req.params.id]);
    }
    const r = await pool.query(
      `INSERT INTO partner_addresses (partner_id,address_type,line1,line2,city,state,pincode,country,gstin,is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.id, address_type||'PRIMARY', line1, line2, city, state, pincode, country||'India', gstin||null, is_default||false]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Partner: add contact ---
app.post('/api/erp/partners/:id/contacts', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { name, designation, mobile, email, whatsapp, is_primary } = req.body;
    if (is_primary) {
      await pool.query('UPDATE partner_contacts SET is_primary=FALSE WHERE partner_id=$1', [req.params.id]);
    }
    const r = await pool.query(
      `INSERT INTO partner_contacts (partner_id,name,designation,mobile,email,whatsapp,is_primary)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, name, designation, mobile, email, whatsapp, is_primary||false]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Partner: delete contact ---
app.delete('/api/erp/partners/:id/contacts/:cid', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    await pool.query('DELETE FROM partner_contacts WHERE contact_id=$1 AND partner_id=$2', [req.params.cid, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Partner: add bank ---
app.post('/api/erp/partners/:id/banks', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { bank_name, branch, account_no, ifsc, account_type, is_default } = req.body;
    if (is_default) {
      await pool.query('UPDATE partner_bank SET is_default=FALSE WHERE partner_id=$1', [req.params.id]);
    }
    const r = await pool.query(
      `INSERT INTO partner_bank (partner_id,bank_name,branch,account_no,ifsc,account_type,is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, bank_name, branch, account_no, ifsc, account_type||'CURRENT', is_default||false]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Partner: deactivate ---
app.delete('/api/erp/partners/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    await pool.query('UPDATE partners SET is_active=FALSE, updated_at=NOW() WHERE partner_id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// ERP â€" LOCATION MASTER (Phase 0-D)
// â"€â"€ WORK CENTER STOCK / SHORTAGE â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.get('/api/work-center/stock', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        m.machine_id,
        m.machine_name,
        m.fabric AS fabric_type,
        CASE
          WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
          WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
          WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
          WHEN LOWER(COALESCE(ld.dc_status, 'offline')) <> 'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
          WHEN LOWER(COALESCE(ld.dc_status, 'offline')) <> 'online' THEN 'OFFLINE'
          WHEN COALESCE(ld.rpm, 0) > 0 THEN 'RUNNING'
          ELSE 'STOPPED'
        END AS machine_status,
        COALESCE(iss.issued_kg, 0)   AS issued_kg,
        COALESCE(iss.returned_kg, 0) AS returned_kg,
        COALESCE(iss.active_issues, 0) AS active_issues,
        COALESCE(rol.produced_kg, 0) AS produced_kg,
        COALESCE(rol.total_rolls, 0) AS total_rolls,
        ROUND(
          GREATEST(
            COALESCE(iss.issued_kg, 0) - COALESCE(iss.returned_kg, 0) - COALESCE(rol.produced_kg, 0),
            0
          )::NUMERIC, 3
        ) AS gap_kg
      FROM machines m
      LEFT JOIN (
        SELECT yi.machine_id::text,
          ROUND(SUM(ii.issued_kg)::NUMERIC, 3)   AS issued_kg,
          ROUND(SUM(COALESCE(ii.returned_kg,0))::NUMERIC, 3) AS returned_kg,
          COUNT(DISTINCT CASE WHEN yi.status = 'ISSUED' THEN yi.issue_id END) AS active_issues
        FROM yarn_issues yi
        JOIN yarn_issue_items ii ON ii.issue_id = yi.issue_id
        GROUP BY yi.machine_id
      ) iss ON iss.machine_id = m.machine_id::text
      LEFT JOIN (
        SELECT machine_id::text,
          ROUND(SUM(COALESCE(actual_weight_kg, weight_kg, 0))::NUMERIC, 3) AS produced_kg,
          COUNT(*) AS total_rolls
        FROM rolls
        WHERE status IN ('APPROVED','PENDING','OPEN')
        GROUP BY machine_id
      ) rol ON rol.machine_id = m.machine_id::text
      LEFT JOIN machine_live_data ld ON m.machine_id = ld.machine_id
      LEFT JOIN LATERAL (
        SELECT assignment_id FROM operator_assignments
        WHERE machine_id = m.machine_id AND status = 'ACTIVE'
        ORDER BY assigned_at DESC LIMIT 1
      ) oa ON true
      LEFT JOIN LATERAL (
        SELECT id FROM machine_downtime
        WHERE machine_id = m.machine_id AND status = 'OPEN'
        ORDER BY start_time DESC LIMIT 1
      ) dt ON true
      ORDER BY
        CASE SUBSTRING(m.machine_id,1,2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END,
        m.machine_id
    `);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================

app.get('/api/erp/warehouses', requireRole('OPERATOR'), async (req, res) => {
  try {
    const wh = await pool.query('SELECT * FROM warehouses ORDER BY code');
    const racks = await pool.query('SELECT * FROM racks ORDER BY warehouse_id, code');
    const bins = await pool.query('SELECT * FROM bins ORDER BY rack_id, code');
    const tree = wh.rows.map(w => ({
      ...w,
      racks: racks.rows.filter(r => r.warehouse_id === w.warehouse_id).map(r => ({
        ...r,
        bins: bins.rows.filter(b => b.rack_id === r.rack_id),
      })),
    }));
    res.json(tree);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/erp/warehouses', requireRole('ADMIN'), async (req, res) => {
  const { code, name, type, address } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO warehouses (code,name,type,address) VALUES ($1,$2,$3,$4) RETURNING *`,
      [code, name, type||'INTERNAL', address||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/erp/warehouses/:id', requireRole('ADMIN'), async (req, res) => {
  const { name, type, address, is_active } = req.body;
  try {
    await pool.query(
      `UPDATE warehouses SET name=$1,type=$2,address=$3,is_active=$4 WHERE warehouse_id=$5`,
      [name, type, address||null, is_active!==false, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/erp/warehouses/:wid/racks', requireRole('ADMIN'), async (req, res) => {
  const { code, name } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO racks (warehouse_id,code,name) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.wid, code, name||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/erp/racks/:id', requireRole('ADMIN'), async (req, res) => {
  const { name, is_active } = req.body;
  try {
    await pool.query(`UPDATE racks SET name=$1,is_active=$2 WHERE rack_id=$3`, [name, is_active!==false, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/erp/racks/:rid/bins', requireRole('ADMIN'), async (req, res) => {
  const { code } = req.body;
  try {
    const r = await pool.query(`INSERT INTO bins (rack_id,code) VALUES ($1,$2) RETURNING *`, [req.params.rid, code]);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/erp/bins/:id', requireRole('ADMIN'), async (req, res) => {
  const { is_active } = req.body;
  try {
    await pool.query(`UPDATE bins SET is_active=$1 WHERE bin_id=$2`, [is_active!==false, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// ERP â€" OTHER MASTERS (Phase 0-E)
// ============================================================

// Financial Years
app.get('/api/erp/financial-years', requireRole('OPERATOR'), async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM financial_years ORDER BY start_date DESC')).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/erp/financial-years', requireRole('ADMIN'), async (req, res) => {
  const { label, start_date, end_date } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO financial_years (label,start_date,end_date) VALUES ($1,$2,$3) RETURNING *`,
      [label, start_date, end_date]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/erp/financial-years/:id', requireRole('ADMIN'), async (req, res) => {
  const { is_active, is_closed } = req.body;
  try {
    if (is_active) await pool.query('UPDATE financial_years SET is_active=FALSE');
    await pool.query(
      `UPDATE financial_years SET is_active=$1,is_closed=$2 WHERE fy_id=$3`,
      [is_active||false, is_closed||false, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Departments
app.get('/api/erp/departments', requireRole('OPERATOR'), async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM departments ORDER BY code')).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/erp/departments', requireRole('ADMIN'), async (req, res) => {
  const { code, name, head_user } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO departments (code,name,head_user) VALUES ($1,$2,$3) RETURNING *`,
      [code, name, head_user||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/erp/departments/:id', requireRole('ADMIN'), async (req, res) => {
  const { name, head_user, is_active } = req.body;
  try {
    await pool.query(`UPDATE departments SET name=$1,head_user=$2,is_active=$3 WHERE dept_id=$4`,
      [name, head_user||null, is_active!==false, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cost Centres
app.get('/api/erp/cost-centres', requireRole('OPERATOR'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT cc.*, d.name AS dept_name FROM cost_centres cc
       LEFT JOIN departments d ON cc.dept_id=d.dept_id ORDER BY cc.code`
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/erp/cost-centres', requireRole('ADMIN'), async (req, res) => {
  const { code, name, dept_id } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO cost_centres (code,name,dept_id) VALUES ($1,$2,$3) RETURNING *`,
      [code, name, dept_id||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Tax Rates
app.get('/api/erp/tax-rates', requireRole('OPERATOR'), async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM tax_rates ORDER BY igst')).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/erp/tax-rates', requireRole('ADMIN'), async (req, res) => {
  const { code, name, cgst, sgst, igst } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO tax_rates (code,name,cgst,sgst,igst) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [code, name, cgst||0, sgst||0, igst||0]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/erp/tax-rates/:id', requireRole('ADMIN'), async (req, res) => {
  const { name, cgst, sgst, igst, is_active } = req.body;
  try {
    await pool.query(`UPDATE tax_rates SET name=$1,cgst=$2,sgst=$3,igst=$4,is_active=$5 WHERE tax_id=$6`,
      [name, cgst, sgst, igst, is_active!==false, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// ERP â€" PROCESS ROUTES (Phase 0-F)
// ============================================================

app.get('/api/erp/process-routes', requireRole('OPERATOR'), async (req, res) => {
  try {
    const routes = await pool.query('SELECT * FROM process_routes ORDER BY code');
    const steps = await pool.query(
      `SELECT s.*, d.name AS dept_name FROM process_route_steps s
       LEFT JOIN departments d ON s.dept_id=d.dept_id ORDER BY s.route_id, s.step_order`
    );
    const result = routes.rows.map(r => ({
      ...r,
      steps: steps.rows.filter(s => s.route_id === r.route_id),
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/erp/process-routes', requireRole('ADMIN'), async (req, res) => {
  const { code, name, description, item_category } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO process_routes (code,name,description,item_category,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [code, name, description||null, item_category||null, req.user?.username||'system']
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/erp/process-routes/:id', requireRole('ADMIN'), async (req, res) => {
  const { name, description, is_active } = req.body;
  try {
    await pool.query(`UPDATE process_routes SET name=$1,description=$2,is_active=$3 WHERE route_id=$4`,
      [name, description||null, is_active!==false, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/erp/process-routes/:id/steps', requireRole('ADMIN'), async (req, res) => {
  const { step_order, step_code, step_name, location_type, dept_id, generates_document, is_optional } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO process_route_steps (route_id,step_order,step_code,step_name,location_type,dept_id,generates_document,is_optional)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, step_order, step_code, step_name, location_type||'INTERNAL',
       dept_id||null, generates_document||null, is_optional||false]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/erp/process-routes/:id/steps/:sid', requireRole('ADMIN'), async (req, res) => {
  const { step_name, step_order, location_type, dept_id, generates_document, is_optional } = req.body;
  try {
    await pool.query(
      `UPDATE process_route_steps SET step_name=$1,step_order=$2,location_type=$3,dept_id=$4,generates_document=$5,is_optional=$6
       WHERE step_id=$7 AND route_id=$8`,
      [step_name, step_order, location_type, dept_id||null, generates_document||null, is_optional||false,
       req.params.sid, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/erp/process-routes/:id/steps/:sid', requireRole('ADMIN'), async (req, res) => {
  try {
    await pool.query('DELETE FROM process_route_steps WHERE step_id=$1 AND route_id=$2', [req.params.sid, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/erp/process-routes/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    await pool.query('DELETE FROM process_route_steps WHERE route_id=$1', [req.params.id]);
    await pool.query('DELETE FROM process_routes WHERE route_id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── BUSY 21 CSV SYNC ─────────────────────────────────────────────────────────
// Export GRN yarn purchases in Busy-compatible format for manual import
app.get('/api/busy-sync/grn-csv', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const { from, to } = req.query;
    const conds = ['g.status = \'APPROVED\'']; const params = [];
    if (from) { conds.push(`g.receipt_date >= $${params.length+1}`); params.push(from); }
    if (to)   { conds.push(`g.receipt_date <= $${params.length+1}`); params.push(to); }
    const r = await pool.query(`
      SELECT g.grn_number, g.receipt_date, g.supplier_name, g.supplier_invoice,
             yl.lot_number, yl.yarn_type, yl.count AS yarn_count, yl.color,
             yl.net_weight_kg, yl.cones AS boxes_bags, yl.rate_per_kg,
             ROUND((yl.net_weight_kg * yl.rate_per_kg)::NUMERIC, 2) AS amount
      FROM grn g JOIN yarn_lots yl ON yl.grn_id = g.grn_id
      WHERE ${conds.join(' AND ')}
      ORDER BY g.receipt_date, g.grn_number
    `, params);
    const header = 'Date,Voucher No,Party Name,Party Invoice,Lot No,Item,Count,Colour,Qty (kg),Pkg,Rate/kg,Amount';
    const lines = r.rows.map(row =>
      [row.receipt_date?.toISOString?.().slice(0,10) || row.receipt_date,
       row.grn_number, `"${row.supplier_name}"`, row.supplier_invoice||'',
       row.lot_number, `"${row.yarn_type||''}"`, row.yarn_count||'', row.color||'',
       row.net_weight_kg, row.boxes_bags||0, row.rate_per_kg||0, row.amount||0].join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="busy_grn_${Date.now()}.csv"`);
    res.send([header, ...lines].join('\n'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Export dispatch challans for Busy sales entry
app.get('/api/busy-sync/dispatch-csv', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const { from, to } = req.query;
    const conds = []; const params = [];
    if (from) { conds.push(`d.dispatch_date >= $${params.length+1}`); params.push(from); }
    if (to)   { conds.push(`d.dispatch_date <= $${params.length+1}`); params.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(`
      SELECT d.dispatch_number, d.dispatch_date, d.customer_name, d.dispatch_type,
             di.description, di.weight_kg, di.quantity
      FROM dispatch_challans d
      LEFT JOIN dispatch_items di ON di.dispatch_id = d.dispatch_id
      ${where}
      ORDER BY d.dispatch_date, d.dispatch_number
    `, params);
    const header = 'Date,Challan No,Party Name,Type,Item,Qty,Weight (kg)';
    const lines = r.rows.map(row =>
      [row.dispatch_date?.toISOString?.().slice(0,10) || row.dispatch_date,
       row.dispatch_number, `"${row.customer_name}"`, row.dispatch_type||'FG',
       `"${row.description||''}"`, row.quantity||1, row.weight_kg||0].join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="busy_dispatch_${Date.now()}.csv"`);
    res.send([header, ...lines].join('\n'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GST summary — output GST from priced dispatches, input GST from yarn purchases (GRN)
app.get('/api/reports/gst-summary', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to dates required' });

    // OUTPUT GST — priced dispatch lines only
    const output = await pool.query(`
      SELECT d.dispatch_date, d.dispatch_number, d.customer_name, d.dispatch_type,
             di.fabric_type, di.lot_number, di.weight_kg, di.rate_per_kg, di.gst_rate,
             di.taxable_value, di.gst_amount, di.line_total
      FROM dispatch_challans d
      JOIN dispatch_items di ON di.dispatch_id = d.dispatch_id
      WHERE d.dispatch_date BETWEEN $1 AND $2 AND di.taxable_value IS NOT NULL
      ORDER BY d.dispatch_date, d.dispatch_number
    `, [from, to]);

    // INPUT GST — yarn purchases from GRN lots (GST rate from linked item, default 5%)
    const input = await pool.query(`
      SELECT g.receipt_date, g.grn_number, g.supplier_name,
             yl.lot_number, yl.yarn_type, yl.net_weight_kg, yl.rate_per_kg,
             COALESCE(i.gst_rate, 5) AS gst_rate,
             ROUND((yl.net_weight_kg * yl.rate_per_kg)::NUMERIC, 2) AS taxable_value,
             ROUND((yl.net_weight_kg * yl.rate_per_kg * COALESCE(i.gst_rate, 5) / 100)::NUMERIC, 2) AS gst_amount
      FROM yarn_lots yl
      JOIN grn g ON g.grn_id = yl.grn_id
      LEFT JOIN items i ON i.item_id = yl.item_id
      WHERE g.receipt_date BETWEEN $1 AND $2 AND yl.rate_per_kg > 0
      ORDER BY g.receipt_date, g.grn_number
    `, [from, to]);

    const sum = (rows, key) => rows.reduce((s, r) => s + parseFloat(r[key] || 0), 0);
    res.json({
      period: { from, to },
      output: { lines: output.rows, taxable: sum(output.rows, 'taxable_value').toFixed(2), gst: sum(output.rows, 'gst_amount').toFixed(2) },
      input:  { lines: input.rows,  taxable: sum(input.rows, 'taxable_value').toFixed(2),  gst: sum(input.rows, 'gst_amount').toFixed(2) },
      net_gst_payable: (sum(output.rows, 'gst_amount') - sum(input.rows, 'gst_amount')).toFixed(2),
      note: 'Input GST covers yarn purchases (GRN) only. SC jobwork vendor bills are not included — add their GST manually if applicable.',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

if (fs.existsSync(path.join(__dirname, '..', 'frontend', 'build'))) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'build', 'index.html'));
  });
}

// ============================================================

server.listen(4000, async () => {
  await ensureProductionHistory();
  await ensureUsersSchema();
  await seedDefaultAdmin();
  console.log('Backend running on port 4000');

  // Daily backup at 2 AM
  scheduleDailyBackup();

  // Start machine alert polling every 60 seconds
  if (process.env.CALLMEBOT_APIKEY) {
    setInterval(checkMachineAlerts, 60 * 1000);
    console.log('[ALERT] WhatsApp auto-alerts enabled (CallMeBot)');
  } else {
    console.log('[ALERT] WhatsApp auto-alerts disabled â€" set CALLMEBOT_APIKEY in .env to enable');
  }
});

// Data collectors push to port 8090 â€" same express app, separate HTTP server
const DC_PORT = parseInt(process.env.DC_PORT || '8090');
const dcServer = http.createServer(app);
dcServer.listen(DC_PORT, () => console.log(`DC endpoint listening on port ${DC_PORT}`));
