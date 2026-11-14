// Local CI results store. The pre-commit hook already gates commits; this runs the
// FULL suite (all unit + all e2e) on demand or on a schedule and keeps a history,
// so regressions are caught and visible even between commits — without any hosted
// CI service (respects the local-only / no-hosted-git rule). Self-ensuring schema.

let ensured = false;

module.exports = (pool) => {
  async function ensure() {
    if (ensured) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ci_runs (
        run_id       BIGSERIAL PRIMARY KEY,
        trigger      TEXT NOT NULL DEFAULT 'manual',   -- manual | scheduled | cli
        started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at  TIMESTAMPTZ,
        duration_ms  INTEGER,
        overall      TEXT,                              -- pass | fail | running | error
        unit_pass    INTEGER DEFAULT 0,
        unit_total   INTEGER DEFAULT 0,
        e2e_pass     INTEGER DEFAULT 0,
        e2e_fail     INTEGER DEFAULT 0,
        e2e_total    INTEGER DEFAULT 0,
        failed_suites JSONB DEFAULT '[]',
        output_tail  TEXT,
        by_user      TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ci_runs_started ON ci_runs(started_at DESC);
    `);
    ensured = true;
  }

  async function start(trigger, by) {
    await ensure();
    const r = await pool.query(
      `INSERT INTO ci_runs (trigger, overall, by_user) VALUES ($1,'running',$2) RETURNING run_id`,
      [trigger || 'manual', by || null]);
    return r.rows[0].run_id;
  }

  async function finish(runId, res) {
    await ensure();
    await pool.query(
      `UPDATE ci_runs SET finished_at=NOW(), duration_ms=$2, overall=$3,
         unit_pass=$4, unit_total=$5, e2e_pass=$6, e2e_fail=$7, e2e_total=$8,
         failed_suites=$9, output_tail=$10, updated_at=NOW() WHERE run_id=$1`,
      [runId, res.duration_ms || null, res.overall,
       res.unit_pass || 0, res.unit_total || 0, res.e2e_pass || 0, res.e2e_fail || 0, res.e2e_total || 0,
       JSON.stringify(res.failed_suites || []), (res.output_tail || '').slice(0, 8000)]);
  }

  const latest = async () => { await ensure(); return (await pool.query(`SELECT * FROM ci_runs ORDER BY run_id DESC LIMIT 1`)).rows[0] || null; };
  const history = async (limit = 20) => { await ensure(); return (await pool.query(`SELECT run_id, trigger, started_at, finished_at, duration_ms, overall, unit_pass, unit_total, e2e_pass, e2e_fail, e2e_total, failed_suites, by_user FROM ci_runs ORDER BY run_id DESC LIMIT $1`, [Math.min(Number(limit) || 20, 100)])).rows; };
  const running = async () => { await ensure(); return (await pool.query(`SELECT run_id, started_at FROM ci_runs WHERE overall='running' AND started_at > NOW() - INTERVAL '30 minutes' ORDER BY run_id DESC LIMIT 1`)).rows[0] || null; };

  return { ensure, start, finish, latest, history, running };
};
