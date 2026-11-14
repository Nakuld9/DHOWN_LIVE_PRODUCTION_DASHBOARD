// Fabric 4-point inspection service.
//
// Records an inspection (header + defect lines), computes the grade with the pure
// grading library, and stores the result. A REJECT grade also quarantines the
// roll — the whole point of grading is that a failed roll cannot quietly ship — by
// reusing the existing roll quarantine mechanism, not inventing a parallel one.
//
// Thresholds come from app_settings so the mill owns its A/B line; grading itself
// is delegated to src/lib/fabric-grade.js so there is exactly one implementation.

const { gradeRoll } = require('./fabric-grade');

module.exports = (pool) => {
  async function getThresholds() {
    const r = await pool.query(
      `SELECT key, value FROM app_settings WHERE key IN ('fabric_grade_a_max','fabric_grade_b_max')`);
    const m = Object.fromEntries(r.rows.map(x => [x.key, x.value]));
    return {
      aMax: Number(m.fabric_grade_a_max) || 40,
      bMax: Number(m.fabric_grade_b_max) || 80,
    };
  }

  // Preview a grade without saving — used by the entry screen to show the grade
  // live as defects are added.
  async function preview({ defects, inspected_length_m, width_mm }) {
    const thresholds = await getThresholds();
    return gradeRoll({ defects: defects || [], lengthMeters: inspected_length_m, widthMm: width_mm, thresholds });
  }

  async function create(body, by) {
    const {
      roll_id, stage, inspected_length_m, width_mm, defects, inspector, notes,
    } = body || {};
    if (!roll_id) return { code: 400, error: 'roll_id is required' };
    if (!(Number(inspected_length_m) > 0) || !(Number(width_mm) > 0)) {
      return { code: 400, error: 'inspected_length_m and width_mm must be greater than zero to grade' };
    }

    const thresholds = await getThresholds();
    const scored = gradeRoll({
      defects: defects || [], lengthMeters: inspected_length_m, widthMm: width_mm, thresholds,
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hdr = (await client.query(
        `INSERT INTO fabric_inspection
           (roll_id, stage, inspected_length_m, width_mm, total_points,
            points_per_100sqyd, grade, a_max_used, b_max_used, inspector, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [roll_id, stage || 'GREIGE', inspected_length_m, width_mm, scored.totalPoints,
         scored.pointsPer100SqYd, scored.grade, thresholds.aMax, thresholds.bMax,
         inspector || by || null, notes || null]
      )).rows[0];

      for (const d of scored.lines) {
        await client.query(
          `INSERT INTO fabric_inspection_defect
             (inspection_id, defect_type, size_inches, is_hole, count, points, position_m, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [hdr.inspection_id, d.defect_type || null, Number(d.sizeInches) || 0,
           !!d.isHole, d.count, d.points, d.position_m ?? null, d.notes || null]
        );
      }

      // Reflect the computed grade onto the roll itself, so allocation sees it:
      // lot-allocation only offers grade-A stock by default and excludes anything
      // quarantined, so writing the 4-point grade here is what actually stops a
      // B/REJECT roll being sold as first quality. Updates 0 rows (harmlessly) if
      // the roll row does not exist. The latest inspection wins — which is correct,
      // since a finished-stage inspection is the last word on a roll's grade.
      // rolls.quality_grade is a single char (A/B/C convention), so REJECT maps to
      // 'R'; the full 'REJECT' is kept on the inspection record itself.
      const rollGrade = scored.grade === 'REJECT' ? 'R' : scored.grade; // A | B | R
      await client.query(`UPDATE rolls SET quality_grade=$2 WHERE roll_id=$1`, [roll_id, rollGrade]);

      // A rejected roll is additionally quarantined so it is excluded outright and
      // cannot ship even if grade filters were widened. Reuse the existing
      // roll-level quarantine + its audit log.
      let quarantined = false;
      if (scored.grade === 'REJECT') {
        const upd = await client.query(
          `UPDATE rolls SET quarantine_status='QUARANTINED',
                 quarantine_reason=$2, quarantined_at=NOW(), quarantined_by=$3
             WHERE roll_id=$1 AND quarantine_status <> 'QUARANTINED'`,
          [roll_id, `4-point REJECT: ${scored.pointsPer100SqYd} pts/100sqyd`, by || 'fabric-qc']);
        if (upd.rowCount > 0) {
          quarantined = true;
          await client.query(
            `INSERT INTO roll_quarantine_log (roll_id, from_status, to_status, reason, defect_type, changed_by)
             VALUES ($1,'NONE','QUARANTINED',$2,$3,$4)`,
            [roll_id, `4-point REJECT (${scored.pointsPer100SqYd} pts/100sqyd)`, 'fabric-grade', by || 'fabric-qc']);
        }
      }

      await client.query('COMMIT');
      return { ok: true, inspection: hdr, score: scored, quarantined };
    } catch (e) {
      await client.query('ROLLBACK');
      return { code: 500, error: e.message };
    } finally {
      client.release();
    }
  }

  async function list({ stage, grade, roll_id, from, to } = {}) {
    const conds = [`status <> 'VOID'`];
    const p = [];
    if (stage)   { p.push(stage);   conds.push(`stage = $${p.length}`); }
    if (grade)   { p.push(grade);   conds.push(`grade = $${p.length}`); }
    if (roll_id) { p.push(roll_id); conds.push(`roll_id = $${p.length}`); }
    if (from)    { p.push(from);    conds.push(`created_at >= $${p.length}`); }
    if (to)      { p.push(to);      conds.push(`created_at <= ($${p.length}::date + 1)`); }
    const r = await pool.query(
      `SELECT fi.*, (SELECT COUNT(*) FROM fabric_inspection_defect d WHERE d.inspection_id = fi.inspection_id) AS defect_lines
         FROM fabric_inspection fi
        WHERE ${conds.join(' AND ')}
        ORDER BY created_at DESC LIMIT 500`, p);
    return r.rows;
  }

  async function get(id) {
    const hdr = (await pool.query(`SELECT * FROM fabric_inspection WHERE inspection_id=$1`, [id])).rows[0];
    if (!hdr) return null;
    hdr.defects = (await pool.query(
      `SELECT * FROM fabric_inspection_defect WHERE inspection_id=$1 ORDER BY id`, [id])).rows;
    return hdr;
  }

  async function voidInspection(id, by) {
    const r = await pool.query(
      `UPDATE fabric_inspection SET status='VOID', updated_at=NOW()
         WHERE inspection_id=$1 AND status='FINAL' RETURNING inspection_id`, [id]);
    if (r.rowCount === 0) return { code: 404, error: 'Inspection not found or already void' };
    return { ok: true };
  }

  // Grade distribution + defect Pareto for a period — the quality dashboard feed.
  async function report({ stage, from, to } = {}) {
    const conds = [`fi.status <> 'VOID'`];
    const p = [];
    if (stage) { p.push(stage); conds.push(`fi.stage = $${p.length}`); }
    if (from)  { p.push(from);  conds.push(`fi.created_at >= $${p.length}`); }
    if (to)    { p.push(to);    conds.push(`fi.created_at <= ($${p.length}::date + 1)`); }
    const where = conds.join(' AND ');

    const grades = (await pool.query(
      `SELECT grade, COUNT(*) AS rolls, COALESCE(SUM(inspected_length_m),0) AS metres
         FROM fabric_inspection fi WHERE ${where} GROUP BY grade`, p)).rows;
    const pareto = (await pool.query(
      `SELECT d.defect_type,
              SUM(d.points * d.count) AS points,
              SUM(d.count) AS occurrences
         FROM fabric_inspection_defect d
         JOIN fabric_inspection fi ON fi.inspection_id = d.inspection_id
        WHERE ${where}
        GROUP BY d.defect_type
        ORDER BY points DESC`, p)).rows;

    // Per-machine grade split — surfaces the machine driving rejects. Uses the
    // grade already stored on the header (no re-computation), joined to the roll's
    // machine. Rolls with no machine row fall under "(unknown)".
    const byMachine = (await pool.query(
      `SELECT COALESCE(r.machine_id,'(unknown)') AS machine_id,
              COUNT(*) AS inspections,
              COUNT(*) FILTER (WHERE fi.grade='A')      AS a_grade,
              COUNT(*) FILTER (WHERE fi.grade='B')      AS b_grade,
              COUNT(*) FILTER (WHERE fi.grade='REJECT') AS rejects,
              COALESCE(SUM(fi.total_points),0)          AS points
         FROM fabric_inspection fi
         LEFT JOIN rolls r ON r.roll_id = fi.roll_id
        WHERE ${where}
        GROUP BY r.machine_id
        ORDER BY rejects DESC, points DESC`, p)).rows;

    return { grades, pareto, byMachine };
  }

  // Rolls awaiting inspection — the worklist that puts QC into the flow.
  //  GREIGE  : knit rolls (closed/weighed, not cancelled) with no greige inspection.
  //  FINISHED: finished fabric (back from job-work) with no finished inspection.
  async function pending({ stage } = {}) {
    if (String(stage).toUpperCase() === 'FINISHED') {
      const rows = (await pool.query(
        `SELECT fg.roll_id, fg.fabric_type, fg.color_name, fg.weight_kg AS weight, fg.created_at AS since
           FROM finished_goods fg
          WHERE fg.roll_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM fabric_inspection fi
                             WHERE fi.roll_id = fg.roll_id AND fi.stage='FINISHED' AND fi.status <> 'VOID')
          ORDER BY fg.created_at DESC LIMIT 100`)).rows;
      return { stage: 'FINISHED', count: rows.length, rolls: rows };
    }
    const rows = (await pool.query(
      `SELECT r.roll_id, r.machine_id, r.fabric_type, r.actual_weight_kg AS weight, r.closed_at AS since
         FROM rolls r
        WHERE r.closed_at IS NOT NULL
          AND COALESCE(r.warehouse_status,'') <> 'CANCELLED'
          AND NOT EXISTS (SELECT 1 FROM fabric_inspection fi
                           WHERE fi.roll_id = r.roll_id AND fi.stage='GREIGE' AND fi.status <> 'VOID')
        ORDER BY r.closed_at DESC LIMIT 100`)).rows;
    return { stage: 'GREIGE', count: rows.length, rolls: rows };
  }

  return { getThresholds, preview, create, list, get, voidInspection, report, pending };
};
