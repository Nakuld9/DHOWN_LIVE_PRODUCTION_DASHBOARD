// Machine helpers — live status derivation + OEE rollup.
// updateOEE takes pool as its first arg (unchanged signature).

function computeLiveStatus(dcStatus, rpm) {
  if ((dcStatus || '').toLowerCase() !== 'online') return 'OFFLINE';
  return Number(rpm || 0) > 0 ? 'RUNNING' : 'STOPPED';
}

// Pick the OEE quality % from the best available real signal (pure, unit-tested):
//  1) actual QC inspections (good rolls / inspected rolls) if any were inspected
//  2) else roll approve/reject outcome
//  3) else the configured quality target (no real data yet)
function pickQuality({ totalInsp, passedInsp, totalRolls, goodRolls, qualityTarget }) {
  if (totalInsp > 0) return Math.round((passedInsp / totalInsp) * 10000) / 100;
  if (totalRolls > 0) return Math.round((goodRolls / totalRolls) * 10000) / 100;
  return Number(qualityTarget) || 0;
}

async function updateOEE(pool, machine_id, today, shift, rpm, rpmTarget, plannedMinutes, qualityTarget) {
  const [runR, stoppedR, prodR, rollsR, inspR] = await Promise.all([
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
    // Quality fallback source: APPROVED rolls / (APPROVED + REJECTED) rolls this shift
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('APPROVED','COMPLETED')) AS good_rolls,
         COUNT(*) FILTER (WHERE status = 'REJECTED')               AS bad_rolls
       FROM rolls
       WHERE machine_id=$1 AND shift=$2 AND DATE(created_at)=$3
         AND status IN ('APPROVED','COMPLETED','REJECTED')`,
      [machine_id, shift, today]
    ),
    // Preferred quality source: real QC inspections on this shift's rolls.
    // Aggregated per roll (a roll may have several defect rows) — a roll is good
    // only if ALL its inspections passed. total_insp = distinct inspected rolls.
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE roll_passed) AS passed_insp,
         COUNT(*)                            AS total_insp
       FROM (
         SELECT qi.roll_id, BOOL_AND(qi.passed) AS roll_passed
         FROM quality_inspections qi
         JOIN rolls r ON r.roll_id = qi.roll_id
         WHERE r.machine_id=$1 AND r.shift=$2 AND DATE(r.created_at)=$3
         GROUP BY qi.roll_id
       ) t`,
      [machine_id, shift, today]
    )
  ]);

  const runMins     = parseFloat(runR.rows[0].mins || 0);
  const stoppedMins = parseFloat(stoppedR.rows[0].mins || 0);
  const prodKg      = parseFloat(prodR.rows[0].kg || 0);
  const goodRolls   = parseInt(rollsR.rows[0].good_rolls || 0);
  const badRolls    = parseInt(rollsR.rows[0].bad_rolls  || 0);
  const totalRolls  = goodRolls + badRolls;
  const passedInsp  = parseInt(inspR.rows[0].passed_insp || 0);
  const totalInsp   = parseInt(inspR.rows[0].total_insp  || 0);

  const quality = pickQuality({ totalInsp, passedInsp, totalRolls, goodRolls, qualityTarget });

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
    [machine_id, today, shift, plannedMinutes, runMins, stoppedMins, avail, perf, quality, oee, prodKg, rpm || 0]
  );
}

module.exports = { computeLiveStatus, updateOEE, pickQuality };
