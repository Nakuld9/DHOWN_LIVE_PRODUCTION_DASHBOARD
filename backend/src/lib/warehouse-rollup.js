// Analytics warehouse rollup (the "thin data warehouse" layer).
//
// Turns raw operational rows into the day-grained shapes the AI assistant,
// dashboards, and forecasters actually query — so those never scan the full
// transaction tables and always see clean, pre-aggregated facts.
//
// Runs nightly (jobLock-guarded, single instance). Idempotent: every section
// UPSERTs a rolling window of days, so a re-run — or a catch-up after downtime —
// simply recomputes the same rows. Fail-closed per section, exactly like
// ai-insights: a missing table or bad query drops that ONE rollup and logs it,
// never the whole run. Safe to ship before the source tables carry much data —
// it just writes few/zero rows until they fill.

const obs = require('./observability');

module.exports = ({ pool }) => {
  const WINDOW_DAYS = (() => {
    const n = parseInt(process.env.WAREHOUSE_ROLLUP_WINDOW_DAYS, 10);
    return Number.isFinite(n) && n > 0 ? n : 90;
  })();

  // Create the warehouse tables if they don't exist. Kept here (not in the main
  // schema module) so this feature is self-contained: dropping the file removes
  // the whole layer. All are derived/rebuildable, so they carry no FKs.
  async function ensure() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_machine_day (
        machine_id     TEXT        NOT NULL,
        day            DATE        NOT NULL,
        shift          TEXT        NOT NULL DEFAULT 'ALL',
        production_kg  NUMERIC(14,3) NOT NULL DEFAULT 0,
        rpm_avg        NUMERIC(10,2),
        counter_delta  BIGINT      NOT NULL DEFAULT 0,
        sample_count   INTEGER     NOT NULL DEFAULT 0,
        active         BOOLEAN     NOT NULL DEFAULT false,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (machine_id, day, shift)
      );
      CREATE INDEX IF NOT EXISTS idx_dw_machine_day_day ON dw_machine_day(day);

      CREATE TABLE IF NOT EXISTS dw_operator_day (
        operator_id  TEXT        NOT NULL,
        day          DATE        NOT NULL,
        shift        TEXT        NOT NULL DEFAULT 'ALL',
        rolls_count  INTEGER     NOT NULL DEFAULT 0,
        weight_kg    NUMERIC(14,3) NOT NULL DEFAULT 0,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (operator_id, day, shift)
      );
      CREATE INDEX IF NOT EXISTS idx_dw_operator_day_day ON dw_operator_day(day);

      CREATE TABLE IF NOT EXISTS dw_yarn_day (
        day          DATE        PRIMARY KEY,
        consumed_kg  NUMERIC(14,3) NOT NULL DEFAULT 0,
        received_kg  NUMERIC(14,3) NOT NULL DEFAULT 0,
        movements    INTEGER     NOT NULL DEFAULT 0,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS dw_quality_day (
        day          DATE        PRIMARY KEY,
        inspected    INTEGER     NOT NULL DEFAULT 0,
        rejects      INTEGER     NOT NULL DEFAULT 0,
        avg_points   NUMERIC(10,2),
        reject_pct   NUMERIC(6,2),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS dw_order_aging_snapshot (
        snapshot_date       DATE    NOT NULL,
        partner_id          INTEGER NOT NULL,
        outstanding         NUMERIC(14,2) NOT NULL DEFAULT 0,
        overdue             NUMERIC(14,2) NOT NULL DEFAULT 0,
        open_invoices       INTEGER NOT NULL DEFAULT 0,
        oldest_overdue_days INTEGER NOT NULL DEFAULT 0,
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (snapshot_date, partner_id)
      );
    `);
    // Defensive: an earlier build named this column computed_at. Rename it in place
    // so every dw_ table satisfies the created_at/updated_at timestamp invariant
    // and no data is lost on upgrade.
    for (const t of ['dw_machine_day', 'dw_operator_day', 'dw_yarn_day', 'dw_quality_day', 'dw_order_aging_snapshot']) {
      await pool.query(`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${t}' AND column_name='computed_at')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${t}' AND column_name='updated_at')
        THEN EXECUTE 'ALTER TABLE ${t} RENAME COLUMN computed_at TO updated_at'; END IF;
      END $$;`);
    }
  }

  // Run one section, swallow its error so the rest of the rollup still runs.
  async function section(name, fn) {
    try { return { name, rows: await fn() }; }
    catch (e) { obs.log('error', 'warehouse.section.failed', { section: name, error: e.message }); return { name, error: e.message }; }
  }

  // 1. Machine × day × shift production. `active` = anything was produced that
  //    day/shift, the honest proxy until run-time telemetry (ESP32/alarms) lands.
  async function machineDay() {
    const r = await pool.query(`
      INSERT INTO dw_machine_day (machine_id, day, shift, production_kg, rpm_avg, counter_delta, sample_count, active, updated_at)
      SELECT machine_id::text,
             record_date::date AS day,
             COALESCE(NULLIF(shift,''),'ALL') AS shift,
             COALESCE(SUM(production_kg),0)::numeric(14,3),
             CASE WHEN SUM(COALESCE(sample_count,0)) > 0
                  THEN (SUM(COALESCE(rpm_avg,0) * COALESCE(sample_count,1)) / NULLIF(SUM(COALESCE(sample_count,1)),0))::numeric(10,2)
                  ELSE AVG(NULLIF(rpm_avg,0))::numeric(10,2) END,
             COALESCE(SUM(GREATEST(COALESCE(counter_end,0) - COALESCE(counter_start,0), 0)),0)::bigint,
             COALESCE(SUM(sample_count),0)::int,
             COALESCE(SUM(production_kg),0) > 0,
             NOW()
        FROM production_history
       WHERE record_date >= CURRENT_DATE - ($1::int)
         AND machine_id IS NOT NULL AND record_date IS NOT NULL
       GROUP BY machine_id, record_date::date, COALESCE(NULLIF(shift,''),'ALL')
      ON CONFLICT (machine_id, day, shift) DO UPDATE SET
        production_kg = EXCLUDED.production_kg, rpm_avg = EXCLUDED.rpm_avg,
        counter_delta = EXCLUDED.counter_delta, sample_count = EXCLUDED.sample_count,
        active = EXCLUDED.active, updated_at = NOW()`, [WINDOW_DAYS]);
    return r.rowCount;
  }

  // 2. Operator × day × shift output, from approved rolls (rolls carry operator_id;
  //    production_history does not). Uses the best available weight.
  async function operatorDay() {
    const r = await pool.query(`
      INSERT INTO dw_operator_day (operator_id, day, shift, rolls_count, weight_kg, updated_at)
      SELECT operator_id::text,
             created_at::date AS day,
             COALESCE(NULLIF(shift,''),'ALL') AS shift,
             COUNT(*)::int,
             COALESCE(SUM(COALESCE(actual_weight_kg, roll_weight_kg, weight_kg, 0)),0)::numeric(14,3),
             NOW()
        FROM rolls
       WHERE created_at >= CURRENT_DATE - ($1::int)
         AND operator_id IS NOT NULL
       GROUP BY operator_id, created_at::date, COALESCE(NULLIF(shift,''),'ALL')
      ON CONFLICT (operator_id, day, shift) DO UPDATE SET
        rolls_count = EXCLUDED.rolls_count, weight_kg = EXCLUDED.weight_kg, updated_at = NOW()`, [WINDOW_DAYS]);
    return r.rowCount;
  }

  // 3. Yarn consumed vs received per day. Movement types are classified by name
  //    so the rule holds whatever vocabulary the store uses (ISSUE/CONSUME vs
  //    RECEIPT/GRN/IN); anything else counts only toward the movement tally.
  async function yarnDay() {
    const r = await pool.query(`
      INSERT INTO dw_yarn_day (day, consumed_kg, received_kg, movements, updated_at)
      SELECT created_at::date AS day,
             COALESCE(SUM(ABS(quantity_kg)) FILTER (WHERE movement_type ILIKE ANY (ARRAY['%issue%','%consume%','%out%'])),0)::numeric(14,3),
             COALESCE(SUM(ABS(quantity_kg)) FILTER (WHERE movement_type ILIKE ANY (ARRAY['%receipt%','%grn%','%in%','%purchase%'])),0)::numeric(14,3),
             COUNT(*)::int,
             NOW()
        FROM yarn_lot_movements
       WHERE created_at >= CURRENT_DATE - ($1::int)
       GROUP BY created_at::date
      ON CONFLICT (day) DO UPDATE SET
        consumed_kg = EXCLUDED.consumed_kg, received_kg = EXCLUDED.received_kg,
        movements = EXCLUDED.movements, updated_at = NOW()`, [WINDOW_DAYS]);
    return r.rowCount;
  }

  // 4. Fabric inspection outcomes per day.
  async function qualityDay() {
    const r = await pool.query(`
      INSERT INTO dw_quality_day (day, inspected, rejects, avg_points, reject_pct, updated_at)
      SELECT created_at::date AS day,
             COUNT(*)::int,
             COUNT(*) FILTER (WHERE UPPER(COALESCE(grade,'')) = 'REJECT')::int,
             AVG(NULLIF(points_per_100sqyd,0))::numeric(10,2),
             (COUNT(*) FILTER (WHERE UPPER(COALESCE(grade,'')) = 'REJECT')::numeric
                * 100 / NULLIF(COUNT(*),0))::numeric(6,2),
             NOW()
        FROM fabric_inspection
       WHERE created_at >= CURRENT_DATE - ($1::int)
       GROUP BY created_at::date
      ON CONFLICT (day) DO UPDATE SET
        inspected = EXCLUDED.inspected, rejects = EXCLUDED.rejects,
        avg_points = EXCLUDED.avg_points, reject_pct = EXCLUDED.reject_pct, updated_at = NOW()`, [WINDOW_DAYS]);
    return r.rowCount;
  }

  // 5. Point-in-time receivables aging, snapshotted per day so trends over time
  //    can be charted (the live view only shows "now"). Re-running the same day
  //    overwrites that day's snapshot.
  async function orderAgingSnapshot() {
    const r = await pool.query(`
      INSERT INTO dw_order_aging_snapshot (snapshot_date, partner_id, outstanding, overdue, open_invoices, oldest_overdue_days, updated_at)
      SELECT CURRENT_DATE, partner_id,
             COALESCE(outstanding,0), COALESCE(overdue,0),
             COALESCE(open_invoices,0)::int, COALESCE(oldest_overdue_days,0)::int, NOW()
        FROM v_partner_outstanding
       WHERE partner_id IS NOT NULL
      ON CONFLICT (snapshot_date, partner_id) DO UPDATE SET
        outstanding = EXCLUDED.outstanding, overdue = EXCLUDED.overdue,
        open_invoices = EXCLUDED.open_invoices, oldest_overdue_days = EXCLUDED.oldest_overdue_days,
        updated_at = NOW()`);
    return r.rowCount;
  }

  async function run() {
    if (process.env.WAREHOUSE_ROLLUP_ENABLED === 'false') return { skipped: 'disabled' };
    await ensure();
    const results = [];
    results.push(await section('machine_day', machineDay));
    results.push(await section('operator_day', operatorDay));
    results.push(await section('yarn_day', yarnDay));
    results.push(await section('quality_day', qualityDay));
    results.push(await section('order_aging', orderAgingSnapshot));
    const summary = Object.fromEntries(results.map(r => [r.name, r.error ? `ERR:${r.error}` : r.rows]));
    const written = results.reduce((n, r) => n + (typeof r.rows === 'number' ? r.rows : 0), 0);
    if (written) obs.log('info', 'warehouse.rollup', summary);
    return { written, sections: summary };
  }

  return { run, ensure };
};
