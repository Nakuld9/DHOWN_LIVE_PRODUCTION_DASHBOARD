// Reports routes — all read-only report + PDF endpoints (layered extraction).
// Mounted at /api/reports. 34 handlers migrated VERBATIM from server.js (2026-07-10);
// read-only SQL -> json/PDF, so handlers are kept whole in this module rather than
// split into service/repository layers (no business logic or writes to isolate).
// Injected: pool, verifyToken, requireRole, PDFDocument (shared from server.js).
const express = require('express');
const { company } = require('../lib/company');
const ExcelJS = require('exceljs');
const { getShiftSettings, parseHHMM } = require('../lib/shift');

// ── Machine Utilization Log — cloud-interface report parity ──────────────
// Reproduces the 13-column report the machine vendor's cloud portal exports
// (No., Date, Shift, Machine, Running Time Details/Time/Total, Revolution,
//  Stop Time Details/Time/Total, Stop count, Live/Total Revolution),
// built entirely from MES data (oee_records + production_records +
// machine_downtime + machine_live_data). Grain: one row per machine/date/shift.

const CLOUD_LOG_COLUMNS = [
  'No.', 'Date', 'Shift Number', 'Machine Number',
  'RUNNING TIME DETAILS', 'RUNNING TIME', 'TOTAL RUNNING TIME', 'REVOLUTION',
  'STOP TIME DETAILS', 'STOP TIME', 'TOTAL STOP TIME',
  'TOTAL STOP /SHUTDOWN NUMBER', 'LIVE / TOTAL REVOLUTION',
];

function hhmm(dt) {
  if (!dt) return '--';
  const d = new Date(dt);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function fmtMins(m) {
  const n = Math.max(0, Math.round(Number(m) || 0));
  const h = Math.floor(n / 60), mm = n % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

// [startHour, endHour] as decimal hours for a shift code; end may be < start (wraps midnight)
function shiftWindowHours(s, shiftCode) {
  const mode = s.shift_mode || '2-shift';
  if (mode === '3-shift') {
    if (shiftCode === 'D') return [parseHHMM(s.shift_a_start || '06:00'), parseHHMM(s.shift_a_end || '14:00')];
    if (shiftCode === 'N') return [parseHHMM(s.shift_b_start || '14:00'), parseHHMM(s.shift_b_end || '22:00')];
    return [parseHHMM(s.shift_c_start || '22:00'), parseHHMM(s.shift_c_end || '06:00')];
  }
  const [dS, dE] = (s.day_shift || '08:00 - 20:00').split(' - ').map(x => parseHHMM(x.trim()));
  return shiftCode === 'D' ? [dS, dE] : [dE, dS];
}

function windowDates(recordDate, [wS, wE]) {
  const start = new Date(recordDate); start.setHours(0, 0, 0, 0);
  start.setMinutes(Math.round(wS * 60));
  const end = new Date(recordDate); end.setHours(0, 0, 0, 0);
  end.setMinutes(Math.round(wE * 60));
  if (end <= start) end.setDate(end.getDate() + 1); // night shift crosses midnight
  return [start, end];
}

// Running intervals = shift window minus stop intervals.
function runningSegments(winStart, winEnd, stops) {
  const segs = [];
  let cursor = new Date(winStart);
  const inWindow = stops
    .map(s => ({ start: new Date(s.start_time), end: new Date(s.end_time || Date.now()) }))
    .filter(s => s.end > winStart && s.start < winEnd)
    .sort((a, b) => a.start - b.start);
  for (const st of inWindow) {
    const sStart = st.start < winStart ? winStart : st.start;
    const sEnd = st.end > winEnd ? winEnd : st.end;
    if (sStart > cursor) segs.push([new Date(cursor), new Date(sStart)]);
    if (sEnd > cursor) cursor = new Date(sEnd);
  }
  if (cursor < winEnd) segs.push([new Date(cursor), new Date(winEnd)]);
  return segs.filter(([a, b]) => b - a >= 60000); // drop <1min slivers
}

// Shared: pull downtime events + live counters once, provide overlap helpers.
async function loadStopsAndLive(pool, from, to) {
  const [dtR, liveR] = await Promise.all([
    pool.query(`
      SELECT machine_id, COALESCE(reason,'Stop') AS reason, start_time, end_time,
             ROUND(COALESCE(duration_minutes,
               EXTRACT(EPOCH FROM(COALESCE(end_time,NOW())-start_time))/60)::numeric,1) AS dur
      FROM machine_downtime
      WHERE DATE(start_time) BETWEEN $1 AND $2 OR DATE(COALESCE(end_time,start_time)) BETWEEN $1 AND $2
      ORDER BY start_time
    `, [from, to]),
    pool.query(`SELECT machine_id, COALESCE(production_counter,0) AS live_counter FROM machine_live_data`),
  ]);
  const stops = dtR.rows.map(s => ({
    ...s, s: new Date(s.start_time), e: new Date(s.end_time || Date.now()),
  }));
  const liveByMachine = {};
  liveR.rows.forEach(r => { liveByMachine[r.machine_id] = Number(r.live_counter); });
  return { stops, liveByMachine };
}

function stopsInWindow(allStops, machineId, winStart, winEnd) {
  return allStops.filter(x => x.machine_id === machineId && x.e > winStart && x.s < winEnd);
}
function overlapMinutes(winStart, winEnd, stops) {
  let m = 0;
  for (const st of stops) {
    const a = st.s < winStart ? winStart : st.s;
    const b = st.e > winEnd ? winEnd : st.e;
    if (b > a) m += (b - a) / 60000;
  }
  return m;
}

// Build one output row (array, cloud column order) from a time window.
// cumKey controls where the running totals reset: per shift (hourly view) so
// each shift's hours total on their own, or per machine (shift view).
function windowRow(no, dateStr, extraCols, shift, machineId, winStart, winEnd, revolution, allStops, liveByMachine, cum, cumKey) {
  const winStops = stopsInWindow(allStops, machineId, winStart, winEnd);
  const totalMin = (winEnd - winStart) / 60000;
  const stopMin = Math.min(overlapMinutes(winStart, winEnd, winStops), totalMin);
  const runMin = Math.max(0, totalMin - stopMin);
  const stopDetails = winStops.length
    ? winStops.map(s => `${hhmm(s.start_time)}-${hhmm(s.end_time)} ${s.reason} (${fmtMins(s.dur)})`).join('; ')
    : '-';
  const segs = runningSegments(winStart, winEnd, winStops);
  const runDetails = segs.length
    ? segs.map(([a, b]) => `${hhmm(a)}-${hhmm(b)}`).join('; ')
    : (runMin > 0 ? `${hhmm(winStart)}-${hhmm(winEnd)}` : '-');
  const key = cumKey || machineId;
  const c = cum[key] = cum[key] || { run: 0, stop: 0, rev: 0 };
  c.run += runMin; c.stop += stopMin; c.rev += Number(revolution);
  return [
    no, dateStr, ...extraCols, shift, machineId,
    runDetails, fmtMins(runMin), fmtMins(c.run), Number(revolution),
    stopDetails, fmtMins(stopMin), fmtMins(c.stop), winStops.length,
    `${liveByMachine[machineId] ?? 0} / ${c.rev}`,
  ];
}

// granularity: 'hourly' (default, per-hour rows from production_history) or 'shift'.
async function buildMachineLog(pool, from, to, machineFilter, shiftFilter, granularity = 'hourly') {
  const hourly = granularity !== 'shift';
  const { stops, liveByMachine } = await loadStopsAndLive(pool, from, to);
  const cum = {};

  if (hourly) {
    const params = [from, to];
    let mF = '', sF = '';
    if (machineFilter) { params.push(machineFilter); mF = `AND ph.machine_id = $${params.length}`; }
    if (shiftFilter)   { params.push(shiftFilter);   sF = `AND ph.shift = $${params.length}`; }
    const baseR = await pool.query(`
      SELECT ph.machine_id, ph.record_date, ph.shift, ph.hour_bucket,
             ph.period_start, ph.period_end,
             GREATEST(COALESCE(ph.counter_end - ph.counter_start, 0), 0) AS revolution
      FROM production_history ph
      WHERE ph.period_type = 'HOURLY' AND ph.record_date BETWEEN $1 AND $2 ${mF} ${sF}
      ORDER BY CASE SUBSTRING(ph.machine_id,1,2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END,
               ph.machine_id, ph.record_date, ph.hour_bucket
    `, params);
    const columns = [
      'No.', 'Date', 'Hour', 'Shift Number', 'Machine Number',
      'RUNNING TIME DETAILS', 'RUNNING TIME', 'TOTAL RUNNING TIME', 'REVOLUTION',
      'STOP TIME DETAILS', 'STOP TIME', 'TOTAL STOP TIME',
      'TOTAL STOP /SHUTDOWN NUMBER', 'LIVE / TOTAL REVOLUTION',
    ];
    const rows = baseR.rows.map((r, i) => {
      const dateStr = new Date(r.record_date).toISOString().slice(0, 10);
      const winStart = new Date(r.period_start), winEnd = new Date(r.period_end);
      const hb = Number(r.hour_bucket);
      const hourLabel = `${String(hb).padStart(2, '0')}:00-${String((hb + 1) % 24).padStart(2, '0')}:00`;
      // Reset the running totals at each machine+date+shift boundary so each
      // shift's hourly rows accumulate on their own.
      const cumKey = `${r.machine_id}|${dateStr}|${r.shift}`;
      return windowRow(i + 1, dateStr, [hourLabel], r.shift, r.machine_id, winStart, winEnd, r.revolution, stops, liveByMachine, cum, cumKey);
    });
    return { columns, rows };
  }

  // shift granularity — one row per machine/date/shift, window from shift settings.
  const settings = await getShiftSettings();
  const params = [from, to];
  let mF = '', sF = '';
  if (machineFilter) { params.push(machineFilter); mF = `AND o.machine_id = $${params.length}`; }
  if (shiftFilter)   { params.push(shiftFilter);   sF = `AND o.shift = $${params.length}`; }
  const baseR = await pool.query(`
    SELECT o.machine_id, o.record_date, o.shift,
           GREATEST(COALESCE(pr.counter_end - pr.counter_start, 0), 0) AS revolution
    FROM oee_records o
    LEFT JOIN production_records pr
      ON pr.machine_id = o.machine_id AND pr.record_date = o.record_date AND pr.shift = o.shift
    WHERE o.record_date BETWEEN $1 AND $2 ${mF} ${sF}
    ORDER BY CASE SUBSTRING(o.machine_id,1,2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END,
             o.machine_id, o.record_date, o.shift
  `, params);
  const columns = CLOUD_LOG_COLUMNS;
  const rows = baseR.rows.map((r, i) => {
    const dateStr = new Date(r.record_date).toISOString().slice(0, 10);
    const [winStart, winEnd] = windowDates(r.record_date, shiftWindowHours(settings, r.shift));
    return windowRow(i + 1, dateStr, [], r.shift, r.machine_id, winStart, winEnd, r.revolution, stops, liveByMachine, cum);
  });
  return { columns, rows };
}

module.exports = ({ pool, verifyToken, requireRole, PDFDocument }) => {
  const router = express.Router();

  // Every route in this file requires a valid token.
  //
  // For a long time only one of the 35 handlers here had a guard. The rest —
  // production records, machine data, operator names and attendance, stock,
  // costing — answered anyone who could reach the port. The reason it was
  // never fixed is that the download buttons used window.open(), which cannot
  // send an Authorization header, so guarding the router broke them. Those
  // call sites now fetch a blob through utils/download.js, so the guard can
  // go where it should have been: at the router, where a route added
  // tomorrow is protected without anyone having to remember.
  router.use(verifyToken);
  const gstr1 = require('../lib/gstr1')(pool);
  const gstSummary = require('../lib/gst-summary')(pool);
  const gstr9 = require('../lib/gstr9')(pool);
  const gstJson = require('../lib/gst-json')(pool);
  const financial = require('../lib/financial-dashboard')(pool);
  const compliance = require('../lib/compliance')(pool);
  const valuation = require('../lib/stock-valuation')(pool);
  const aiPerf = require('../lib/ai-performance')(pool);

router.get('/', async (req, res) => {

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

router.get('/production-pdf', async (req, res) => {
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
      .text((await company()).name, {
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
      `Generated: ${new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-')}`
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

 router.get('/downtime-pdf', async (req, res) => {
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
      .text((await company()).name, {
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

router.get('/operator-pdf', async (req, res) => {
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
      .text((await company()).name, {
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

router.get('/rfid-pdf', async (req, res) => {
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
      .text((await company()).name, {
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

router.get('/assignments-pdf', async (req, res) => {
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
      .text((await company()).name, {
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

router.get('/summary-pdf', async (req, res) => {
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
      .text((await company()).name, {
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

router.get('/daily-production-report', async (req, res) => {
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

router.get('/shift-production-report', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const r = await pool.query(`SELECT shift, SUM(production_kg) AS total_kg, COUNT(DISTINCT machine_id) AS machines, SUM(sample_count) AS total_samples FROM production_records WHERE record_date=$1 GROUP BY shift ORDER BY shift`, [date]);
    res.json({ report: 'shift-production', date, shifts: r.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.get('/machine-performance-report', async (req, res) => {
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

router.get('/oee-report', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const r = await pool.query(`SELECT o.machine_id, m.machine_name, o.shift, o.availability, o.performance, o.quality, o.oee, o.run_minutes, o.stopped_minutes, o.planned_minutes, o.rpm_avg, o.production_kg, o.updated_at FROM oee_records o LEFT JOIN machines m ON o.machine_id=m.machine_id WHERE o.record_date=$1 ORDER BY CASE SUBSTRING(o.machine_id,1,2) WHEN 'SJ' THEN 1 WHEN 'RB' THEN 2 WHEN 'IL' THEN 3 ELSE 4 END, o.machine_id, o.shift`, [date]);
    const avg = r.rows.length > 0 ? Math.round(r.rows.reduce((s, x) => s + parseFloat(x.oee || 0), 0) / r.rows.length * 100) / 100 : 0;
    res.json({ report: 'oee', date, avg_oee: avg, records: r.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.get('/downtime-analysis-report', async (req, res) => {
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

router.get('/filter-options', async (req, res) => {
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

router.get('/production', async (req, res) => {
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

router.get('/rolls', async (req, res) => {
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

router.get('/shifts', async (req, res) => {
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

router.get('/machines', async (req, res) => {
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

router.get('/downtime', async (req, res) => {
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

router.get('/operators', async (req, res) => {
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

router.get('/rfid', async (req, res) => {
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

router.get('/assignments', async (req, res) => {
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

router.get('/summary', async (req, res) => {
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

router.get('/maintenance', async (req, res) => {
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

router.get('/shift-handover', async (req, res) => {
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

router.get('/daily-summary', async (req, res) => {
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

router.get('/yarn-stock', async (req, res) => {
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

router.get('/lot-ledger', async (req, res) => {
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

router.get('/consumption', async (req, res) => {
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

router.get('/warehouse-flow', async (req, res) => {
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

router.get('/greige-stock', async (req, res) => {
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

router.get('/knitting-jobwork', async (req, res) => {
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

router.get('/dyeing-finishing', async (req, res) => {
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

router.get('/finished-fabric', async (req, res) => {
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

router.get('/gst-summary', verifyToken, requireRole('ADMIN', { also: ['ACCOUNTS'] }), async (req, res) => {
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

// GSTR-1 summary — outward supplies for a return period, from tax_invoices.
//
// Not a duplicate of /gst-summary above, and the difference matters. That one
// estimates output GST from dispatch challans and input GST from GRNs; it is a
// cash-position view and says so. This one is built from tax_invoices, which is
// the document the return is actually filed on — a challan is not a taxable
// supply, the invoice is. If the two disagree, something has been dispatched
// and not invoiced, and that is worth knowing rather than averaging away.
//
// verifyToken is explicit here rather than relying on the router: most handlers
// in this file have no guard at all (tracked separately), and a statutory
// report must not be the next one added to that list.
// ACCOUNTS prepares the return, so gating it at ADMIN would mean the person
// who files it cannot see it.
router.get('/gstr1', verifyToken, requireRole('ADMIN', { also: ['ACCOUNTS'] }), async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });
    res.json(await gstr1.summary({ from, to }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Busy-style consolidated GST Summary (both sides, netted to payable).
router.get('/gst-summary', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
  try {
    res.json(await gstSummary.summary({ from: req.query.from || null, to: req.query.to || null }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GSTR-9 annual consolidation (indicative).
router.get('/gstr9', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] }), async (req, res) => {
  try { res.json(await gstr9.summary({ from: req.query.from || null, to: req.query.to || null })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Portal-ready JSON (prep) — GSTR-1, GSTR-3B, E-Way Bill.
const GSTGATE = requireRole('SUPERVISOR', { also: ['ACCOUNTS', 'AUDITOR'] });
router.get('/gstr1-json', verifyToken, GSTGATE, async (req, res) => {
  try { res.json(await gstJson.gstr1Json({ from: req.query.from || null, to: req.query.to || null })); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/gstr3b-json', verifyToken, GSTGATE, async (req, res) => {
  try { res.json(await gstJson.gstr3bJson({ from: req.query.from || null, to: req.query.to || null })); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/eway-json', verifyToken, GSTGATE, async (req, res) => {
  try { res.json(await gstJson.ewayJson({ from: req.query.from || null, to: req.query.to || null, min_value: Number(req.query.min_value) || 50000 })); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Financial dashboard — receivables, collections and credit exposure in one view.
//
// SUPERVISOR rather than ADMIN: the people who chase money are the ones who
// need it, and the same ageing figures are already readable at OPERATOR level
// on the receipts screen. Gating this higher than its own source data would be
// theatre. verifyToken is explicit for the reason given on /gstr1 above.
router.get('/financial-dashboard', verifyToken, requireRole('SUPERVISOR', { also: ['ACCOUNTS'] }), async (req, res) => {
  try {
    res.json(await financial.overview({ from: req.query.from || null, to: req.query.to || null }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Compliance dashboard — the clocks that run out quietly: e-way bills nearing
// expiry, dispatches with no proof of delivery, returns still in draft, and
// credit notes raised but never applied.
router.get('/compliance', verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    res.json(await compliance.overview({
      ewayHours: Math.min(parseInt(req.query.eway_hours || '48', 10) || 48, 720),
      podDays: Math.min(parseInt(req.query.pod_days || '3', 10) || 3, 365),
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Stock valuation, optionally as at a past date. The response carries its own
// coverage and a `reliable` flag, because a past-dated figure is only as good
// as the ledger behind it.
router.get('/stock-valuation', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try { res.json(await valuation.valuation({ as_at: req.query.as_at || null })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// AI performance — what the assistant is doing, from the audit table nobody read.
// Behaviour, not quality: whether an answer was GOOD is what the eval harness is
// for. This answers what it is doing and whether that has changed.
router.get('/ai-performance', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const out = await aiPerf.overview({ from: req.query.from || null, to: req.query.to || null });
    // The registry lives in wa-tools, so the unused list is computed here
    // rather than inside a module that only reads the audit table.
    try {
      const defs = require('../lib/wa-tools')(pool, {}).definitions.map(d => d.name);
      out.unused_tools = aiPerf.unusedTools(defs, out.tools);
      out.tools_defined = defs.length;
    } catch { /* tool registry needs deps it may not have here */ }
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// JSON preview of the cloud-format machine utilization log.
router.get('/machine-log', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = req.query.from || today;
    const to   = req.query.to   || today;
    const granularity = req.query.granularity === 'shift' ? 'shift' : 'hourly';
    const { columns, rows } = await buildMachineLog(pool, from, to, req.query.machine, req.query.shift, granularity);
    res.json({ columns, rows, granularity, filters: { from, to, machine: req.query.machine || null, shift: req.query.shift || null } });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// Excel (.xlsx) download — matches the vendor cloud export layout (hourly or shift).
router.get('/machine-log-excel', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = req.query.from || today;
    const to   = req.query.to   || today;
    const granularity = req.query.granularity === 'shift' ? 'shift' : 'hourly';
    const { columns, rows } = await buildMachineLog(pool, from, to, req.query.machine, req.query.shift, granularity);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('sheet1');
    ws.addRow(columns);
    ws.getRow(1).font = { bold: true };
    rows.forEach(r => ws.addRow(r));
    ws.columns.forEach(col => {
      let max = 10;
      col.eachCell({ includeEmpty: true }, c => { max = Math.max(max, String(c.value ?? '').length + 2); });
      col.width = Math.min(max, 45);
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="machine_utilization_log_${granularity}_${from}_to_${to}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

  return router;
};
