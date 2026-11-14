// Quality-report routes — defect types + inspection report (JSON/CSV/PDF).
// Handlers moved VERBATIM from server.js (report queries + CSV/PDF generation);
// only app.get('/api/quality...') rewritten to router.get('/quality...').
// Mounted at /api. All verifyToken + requireRole('OPERATOR'). pdfkit required inline.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();

  // Get defect types for dropdown
  router.get('/quality-defect-types', verifyToken, requireRole('OPERATOR'), async (req, res) => {
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
  router.get('/quality-inspection-report/filters', verifyToken, requireRole('OPERATOR'), async (req, res) => {
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
  router.get('/quality-inspection-report', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try {
      const { dateFrom, dateTo, machineId, rollId, inspectorId, result } = req.query;
      let query = `
        SELECT qi.*, m.machine_name
        FROM quality_inspections qi
        LEFT JOIN rolls r ON qi.roll_id = r.roll_id
        LEFT JOIN machines m ON r.machine_id = m.machine_id
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
  router.get('/quality-inspection-report/csv', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try {
      const { dateFrom, dateTo, machineId, rollId, inspectorId, result } = req.query;
      let query = `
        SELECT qi.inspection_id, qi.roll_id, m.machine_name, qi.inspection_type, qi.grade,
               qi.inspection_date, qi.inspector, qi.defect_count, qi.passed
        FROM quality_inspections qi
        LEFT JOIN rolls r ON qi.roll_id = r.roll_id
        LEFT JOIN machines m ON r.machine_id = m.machine_id
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
  router.get('/quality-inspection-report/pdf', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try {
      const { dateFrom, dateTo, machineId, rollId, inspectorId, result } = req.query;
      let query = `
        SELECT qi.inspection_id, qi.roll_id, m.machine_name, qi.inspection_type, qi.grade,
               qi.inspection_date, qi.inspector, qi.defect_count, qi.passed, qi.notes
        FROM quality_inspections qi
        LEFT JOIN rolls r ON qi.roll_id = r.roll_id
        LEFT JOIN machines m ON r.machine_id = m.machine_id
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
      const PDFDocument = require('pdfkit');
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
          row.inspection_date ? new Date(row.inspection_date).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-') : '',
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

  return router;
};
