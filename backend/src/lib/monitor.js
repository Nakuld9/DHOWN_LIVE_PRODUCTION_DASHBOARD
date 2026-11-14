// System monitor — one aggregated health/metrics snapshot for the ops dashboard.
// Pulls together: process uptime, DB reachability + latency, error summary (from
// error-tracker), local DB-backup freshness, AI provider health, and the in-memory
// metrics snapshot. Read-only; cheap enough to poll.

const fs = require('fs');
const path = require('path');

module.exports = ({ pool, obs, tenant, errors }) => {
  const startedAt = Date.now();

  // Newest local DB dump and its age — the backup that must never go stale.
  function backupFreshness() {
    try {
      const dir = tenant.backupDir;
      if (!dir || !fs.existsSync(dir)) return { ok: false, reason: 'backup dir missing' };
      const sql = fs.readdirSync(dir).filter(f => f.endsWith('.sql'))
        .map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.m - a.m)[0];
      if (!sql) return { ok: false, reason: 'no .sql backup found' };
      const ageH = Math.round((Date.now() - sql.m) / 3600000 * 10) / 10;
      return { ok: ageH <= 26, newest: sql.f, age_hours: ageH, stale: ageH > 26 };  // daily job + grace
    } catch (e) { return { ok: false, reason: e.message }; }
  }

  async function status() {
    const out = { generated_at: new Date().toISOString(), uptime_s: Math.round((Date.now() - startedAt) / 1000) };

    // Database + latency
    const t0 = Date.now();
    try { await pool.query('SELECT 1'); out.database = { ok: true, latency_ms: Date.now() - t0 }; }
    catch (e) { out.database = { ok: false, error: e.message }; }

    // Errors
    try { out.errors = await errors.summary(); } catch { out.errors = { open_groups: 0, last_24h: 0, last_1h: 0 }; }

    // Backups (local DB dump freshness)
    out.backup = backupFreshness();

    // AI providers + metrics
    try { out.ai_providers = obs.providerHealth ? obs.providerHealth() : {}; } catch { out.ai_providers = {}; }
    try { out.metrics = obs.snapshot ? obs.snapshot() : {}; } catch { out.metrics = {}; }

    // Overall verdict — the single light people look at first.
    const bad = !out.database.ok || (out.errors.last_1h > 20) || (out.backup.stale === true);
    const warn = (out.errors.open_groups > 0) || (out.database.latency_ms > 500) || (out.backup.ok === false);
    out.overall = bad ? 'critical' : warn ? 'warning' : 'ok';
    return out;
  }

  return { status, backupFreshness };
};
