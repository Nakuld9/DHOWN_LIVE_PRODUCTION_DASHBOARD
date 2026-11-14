// Fabric 4-point inspection — end to end against the real DB.
//
// What matters here is that the grade the pure library computes is what gets
// STORED, that a REJECT actually quarantines the roll (so it cannot ship), and
// that the report aggregates grades + a defect Pareto. Test data uses a ZZ roll
// and is torn down.
//
//   node tests/fabric-inspection.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { ensureFabricInspectionSchema } = require('../src/db/schema');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

const ROLL = 'ZZFI' + Date.now().toString().slice(-6);

(async () => {
  // The service reads schema.js's pool via config/database; give the ensure a pool.
  // ensureFabricInspectionSchema uses the module's own pool, so just call it.
  await ensureFabricInspectionSchema();
  const svc = require('../src/lib/fabric-inspection')(pool);

  // A real machine + roll so the REJECT-quarantine path can act on it (rolls.machine_id is a FK).
  const MACH = 'ZZQC' + Date.now().toString().slice(-4);
  await pool.query(`INSERT INTO machines (machine_id, machine_name) VALUES ($1,'ZZ FI Test') ON CONFLICT DO NOTHING`, [MACH]);
  await pool.query(
    `INSERT INTO rolls (roll_id, machine_id, fabric_type, actual_weight_kg, warehouse_status, quarantine_status, created_at)
     VALUES ($1,$2,'Single Jersey',24,'IN_STOCK','NONE',NOW()) ON CONFLICT (roll_id) DO NOTHING`, [ROLL, MACH]);

  try {
    console.log('\nGrade is computed and stored, not invented');
    // 100yd (91.44m) × 60in (1524mm). 5 defects of >9in = 20 pts → 12 pts/100sqyd → A.
    const a = await svc.create({
      roll_id: ROLL, stage: 'GREIGE', inspected_length_m: 91.44, width_mm: 1524,
      inspector: 'test',
      defects: [{ defect_type: 'Hole', sizeInches: 12, count: 5 }],
    }, 'test');
    ok(a.ok, 'inspection is recorded');
    ok(a.score.totalPoints === 20, 'total points computed (5 × 4)', `${a.score.totalPoints}`);
    ok(a.score.grade === 'A', 'graded A (12 pts/100sqyd ≤ 40)', a.score.grade);
    const stored = await svc.get(a.inspection.inspection_id);
    ok(String(stored.grade) === 'A' && Number(stored.total_points) === 20, 'stored grade matches the computed grade');
    ok(stored.defects.length === 1 && Number(stored.defects[0].points) === 4, 'defect line persisted with its points');
    const gA = (await pool.query(`SELECT quality_grade FROM rolls WHERE roll_id=$1`, [ROLL])).rows[0];
    ok(gA && gA.quality_grade === 'A', 'the grade is written onto the roll for allocation to see', gA?.quality_grade);

    console.log('\nA REJECT grade quarantines the roll so it cannot ship');
    // 40 defects × 4 = 160 pts → 96 pts/100sqyd → REJECT.
    const r = await svc.create({
      roll_id: ROLL, stage: 'FINISHED', inspected_length_m: 91.44, width_mm: 1524,
      defects: [{ defect_type: 'Hole', sizeInches: 12, count: 40 }],
    }, 'test');
    ok(r.score.grade === 'REJECT', 'graded REJECT (96 pts/100sqyd > 80)', r.score.grade);
    ok(r.quarantined === true, 'the roll was quarantined');
    const q = (await pool.query(`SELECT quarantine_status, quality_grade FROM rolls WHERE roll_id=$1`, [ROLL])).rows[0];
    ok(q && q.quarantine_status === 'QUARANTINED', 'roll.quarantine_status is QUARANTINED', q?.quarantine_status);
    ok(q && q.quality_grade === 'R', 'roll grade set to R (reject) — allocation A-filter excludes it too', q?.quality_grade);
    // Allocation offers only grade-A, unquarantined stock; this roll is now neither,
    // so it cannot be allocated for sale — verified via the two conditions above,
    // which are exactly the WHERE clauses lot-allocation.availableLots enforces.

    console.log('\nA roll with no measured area is refused, not mis-graded');
    const bad = await svc.create({ roll_id: ROLL, inspected_length_m: 0, width_mm: 1524, defects: [] });
    ok(bad.code === 400, 'zero length is a 400, not a silent UNGRADED save', bad.error);

    console.log('\nReport aggregates grades and a defect Pareto');
    const rep = await svc.report({});
    const hasA = rep.grades.some(g => g.grade === 'A');
    const hasReject = rep.grades.some(g => g.grade === 'REJECT');
    ok(hasA && hasReject, 'grade distribution includes A and REJECT');
    ok(rep.pareto.length > 0 && rep.pareto[0].defect_type != null, 'defect Pareto has entries', `${rep.pareto.length}`);
    const mach = (rep.byMachine || []).find(m => m.machine_id === MACH);
    ok(mach && Number(mach.rejects) >= 1, 'per-machine breakdown attributes the reject to its machine', mach ? `${mach.machine_id}: ${mach.rejects} rej` : 'missing');

  } finally {
    await pool.query(
      `DELETE FROM fabric_inspection_defect WHERE inspection_id IN
        (SELECT inspection_id FROM fabric_inspection WHERE roll_id=$1)`, [ROLL]).catch(() => {});
    await pool.query(`DELETE FROM fabric_inspection WHERE roll_id=$1`, [ROLL]).catch(() => {});
    await pool.query(`DELETE FROM roll_quarantine_log WHERE roll_id=$1`, [ROLL]).catch(() => {});
    await pool.query(`DELETE FROM rolls WHERE roll_id=$1`, [ROLL]).catch(() => {});
    await pool.query(`DELETE FROM machines WHERE machine_id=$1`, [MACH]).catch(() => {});
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
