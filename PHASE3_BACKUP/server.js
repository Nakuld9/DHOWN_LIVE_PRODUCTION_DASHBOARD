console.log("SERVER STARTING");

const pool = require('./config/database');

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const PDFDocument = require("pdfkit");

const app = express();

app.use(cors());
app.use(express.json());


const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

// ==========================
// GET MACHINES (LIVE STATUS)
// ==========================
app.get('/api/machines', async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT
        m.*,

        COALESCE(ld.rpm,0) AS rpm,
        COALESCE(ld.production_counter,0) AS production_counter,

(
  COALESCE(ld.production_counter,0)
  *
  COALESCE(m.kg_per_counter,0)
) AS production_kg,
        COALESCE(ld.operator_name,'N/A') AS operator_name,
        COALESCE(ld.dc_status,'offline') AS dc_status,

        CASE
          WHEN LOWER(COALESCE(ld.dc_status,'offline')) <> 'online'
            THEN 'OFFLINE'

          WHEN COALESCE(ld.rpm,0) > 0
            THEN 'RUNNING'

          ELSE 'STOPPED'
        END AS live_status

      FROM machines m

      LEFT JOIN machine_live_data ld
      ON m.machine_id = ld.machine_id

      ORDER BY m.machine_id
    `);

    res.json(result.rows);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

});

// ==========================
// UPDATE MACHINE
// ==========================
app.put('/api/machines/:id', async (req, res) => {

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
io.on('connection', (socket) => {

  console.log('Dashboard connected');

});

// ==========================
// GET ROLLS
// ==========================

app.get('/api/rolls', async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT *
      FROM rolls
      ORDER BY created_at DESC
    `);

    res.json(result.rows);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: 'Failed to load rolls'
    });

  }

});
app.put('/api/rolls/approve/:rollId', async (req, res) => {

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

// ==========================
// GET OPERATORS
// ==========================
app.get('/api/operators', async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT *
      FROM operators
      ORDER BY operator_name
    `);

    res.json(result.rows);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: 'Failed to load operators'
    });

  }

});

// ==========================
// ADD OPERATOR
// ==========================
app.post('/api/operators', async (req, res) => {

  const {
    operator_code,
    operator_name,
    rfid_tag,
    mobile
  } = req.body;

  try {

    const result = await pool.query(
      `
      INSERT INTO operators
      (
        operator_code,
        operator_name,
        rfid_tag,
        mobile
      )
      VALUES
      ($1,$2,$3,$4)
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

app.post("/api/assignments", async (req, res) => {

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

    const result = await pool.query(`
      SELECT *
      FROM machine_downtime
      ORDER BY start_time DESC
    `);

    res.json(result.rows);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

});


// ==========================
// START DOWNTIME
// ==========================

app.post("/api/downtime", async (req, res) => {

  try {

    const {
      machine_id,
      reason
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO machine_downtime
      (
        machine_id,
        reason,
        start_time
      )
      VALUES
      (
        $1,
        $2,
        NOW()
      )
      RETURNING *
      `,
      [
        machine_id,
        reason
      ]
    );
    await pool.query(
  `
  UPDATE machines
  SET machine_status = 'STOPPED'
  WHERE machine_id = $1
  `,
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
// CLOSE DOWNTIME
// ==========================

app.put("/api/downtime/:id/close", async (req, res) => {

  try {

    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE machine_downtime
      SET
        end_time = NOW(),
        duration_minutes =
          EXTRACT(
            EPOCH FROM (NOW() - start_time)
          ) / 60
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );
    const machineResult = await pool.query(
  `
  SELECT machine_id
  FROM machine_downtime
  WHERE id = $1
  `,
  [id]
);

await pool.query(
  `
  UPDATE machines
  SET machine_status = 'RUNNING'
  WHERE machine_id = $1
  `,
  [machineResult.rows[0].machine_id]
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
// ALERTS
// ==========================

app.get("/api/alerts", async (req, res) => {

  try {

    const stoppedMachines = await pool.query(`
      SELECT *
      FROM machines
      WHERE machine_status = 'STOPPED'
    `);

    const openDowntime = await pool.query(`
      SELECT *
      FROM machine_downtime
      WHERE end_time IS NULL
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

    // Total machine count from machines master table
    const totalResult = await pool.query(
      `SELECT COUNT(*) FROM machines`
    );
    const totalMachines = Number(totalResult.rows[0].count);

    // Live data joined with machines for production calculation
    const liveResult = await pool.query(`
      SELECT
        ld.rpm,
        ld.dc_status,
        ld.production_counter,
        m.kg_per_counter
      FROM machine_live_data ld
      LEFT JOIN machines m
      ON ld.machine_id = m.machine_id
    `);

    const rows = liveResult.rows;

    // Running = dc online AND rpm > 0 (mirrors live_status logic in /api/machines)
    const running = rows.filter(
      r =>
        (r.dc_status || "").toLowerCase() === "online" &&
        Number(r.rpm || 0) > 0
    ).length;

    // Production = sum of (counter * kg_per_counter) across all live machines
    const production = rows.reduce(
      (sum, r) =>
        sum +
        Number(r.production_counter || 0) *
        Number(r.kg_per_counter || 0),
      0
    );

    const avgRpm =
      rows.length > 0
        ? Math.round(
            rows.reduce(
              (sum, r) => sum + Number(r.rpm || 0),
              0
            ) / rows.length
          )
        : 0;

    res.json({
      totalMachines,
      running,
      production: Math.round(production * 1000) / 1000,
      efficiency: avgRpm
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


//===========================
// TREND API
//===========================
app.get(
  "/api/dashboard/oee",
  async (req, res) => {

    try {

      const result = await pool.query(`
  SELECT
    ld.rpm,
    m.rpm_target
  FROM machine_live_data ld
  LEFT JOIN machines m
  ON ld.machine_id = m.machine_id
`);
      const rows = result.rows;

      let performance = 0;

      rows.forEach(r => {

        if (
          Number(r.rpm_target) > 0
        ) {

          performance +=
            (
              Number(r.rpm) /
              Number(r.rpm_target)
            ) * 100;
        }
      });

      performance =
        rows.length > 0
          ? Math.round(
              performance /
              rows.length
            )
          : 0;

      res.json({
        availability: 100,
        performance,
        quality: 98,
        oee: Math.round(
          (
            100 *
            performance *
            98
          ) / 10000
        )
      });

    } catch (err) {

      console.error(err);
      res.status(500).json(err);

    }
});

//===================
// production trend api
//====================
app.get(
  "/api/dashboard/production-trend",
  async (req, res) => {

    try {

      const result =
        await pool.query(`
          SELECT
            machine_id,
            COALESCE(
              production_counter,
              0
            ) AS production
          FROM machine_live_data
          ORDER BY production DESC
        `);

      res.json(
        result.rows
      );

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error: err.message
      });

    }

});
// ==========================
// START SERVER
// ==========================

server.listen(4000, () => {

  console.log('Backend running on port 4000');

});
console.log("END OF FILE REACHED")