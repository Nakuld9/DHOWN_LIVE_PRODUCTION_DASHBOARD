// Quality-inspections routes — CRUD + stats (grade, defects, pass/fail).
// Handlers moved VERBATIM from server.js; app.<m>('/api/quality-inspections...')
// -> router.<m>('/...'). Mounted at /api/quality-inspections.
// Auth: list/:id/stats (OPERATOR/SUPERVISOR), POST/PUT (SUPERVISOR), DELETE (ADMIN).
const express = require('express');
const { parsePage, pageEnvelope } = require('../lib/pagination');

module.exports = ({ pool, verifyToken, requireRole, io }) => {
  const router = express.Router();

  // Get all quality inspections with optional filtering
  router.get('/', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try {
      const { roll_id, inspection_type, grade, passed, limit = 100 } = req.query;

      // Shared WHERE built once so the count and data queries stay in sync.
      let where = ` WHERE 1=1`;
      const params = [];
      if (roll_id)                        { where += ` AND qi.roll_id = $${params.length + 1}`;         params.push(roll_id); }
      if (inspection_type)                { where += ` AND qi.inspection_type = $${params.length + 1}`; params.push(inspection_type); }
      if (grade)                          { where += ` AND qi.grade = $${params.length + 1}`;           params.push(grade); }
      if (typeof passed !== 'undefined')  { where += ` AND qi.passed = $${params.length + 1}`;          params.push(passed === 'true'); }

      const base = `
        SELECT qi.*, r.roll_id as roll_number, m.machine_name
        FROM quality_inspections qi
        LEFT JOIN rolls r ON qi.roll_id = r.roll_id
        LEFT JOIN machines m ON r.machine_id = m.machine_id
        ${where}
        ORDER BY qi.inspection_date DESC`;

      // Opt-in pagination: ?page=N returns an envelope; otherwise the legacy
      // capped array (unchanged for the existing frontend).
      const pg = parsePage(req.query, { defaultLimit: 100, maxLimit: 500 });
      if (!pg) {
        const result = await pool.query(`${base} LIMIT $${params.length + 1}`, [...params, parseInt(limit)]);
        return res.json(result.rows);
      }
      const [rows, cnt] = await Promise.all([
        pool.query(`${base} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, pg.limit, pg.offset]),
        pool.query(`SELECT COUNT(*) FROM quality_inspections qi ${where}`, params),
      ]);
      res.json(pageEnvelope(rows.rows, cnt.rows[0].count, pg));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  
  // Get quality inspection stats (must be registered BEFORE /:id so Express doesn't
  // match "stats" as the :id param)
  router.get('/stats', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
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
  
  router.get('/:id', verifyToken, requireRole('OPERATOR'), async (req, res) => {
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
  router.post('/', verifyToken, requireRole('SUPERVISOR', { also: ['QC'] }), async (req, res) => {
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
  router.put('/:id', verifyToken, requireRole('SUPERVISOR', { also: ['QC'] }), async (req, res) => {
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
  router.delete('/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
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

  return router;
};
